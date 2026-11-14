// Grand Property Auto server: API routes, Vexcel proxy, phone controller websocket relay.
// Phase 0: health check, route stubs and an empty room relay. Later phases fill these in.
import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    keys: {
      vexcel: !!process.env.VEXCEL_API_KEY,
      matterport: !!process.env.MATTERPORT_SDK_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
  });
});

// Filled in by Phase 7.
app.post('/api/mission', (_req, res) => res.status(501).json({ error: 'not implemented' }));
app.post('/api/narrate', (_req, res) => res.status(501).json({ error: 'not implemented' }));
// Filled in by Phase 7 (semantic search proxy).
app.all('/api/vexcel/*splat', (_req, res) => res.status(501).json({ error: 'not implemented' }));

// Serve the production build when it exists (Phase 10 runs everything from here).
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
}

const server = createServer(app);

// Phone controller relay: clients join /ws?room=ID, messages go to everyone else in the room.
const rooms = new Map();
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const room = new URL(req.url, 'http://x').searchParams.get('room') || 'default';
  if (!rooms.has(room)) rooms.set(room, new Set());
  const peers = rooms.get(room);
  peers.add(ws);
  ws.on('message', (data) => {
    for (const p of peers) if (p !== ws && p.readyState === 1) p.send(data.toString());
  });
  ws.on('close', () => {
    peers.delete(ws);
    if (!peers.size) rooms.delete(room);
  });
});

server.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`));
