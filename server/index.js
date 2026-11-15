// Grand Property Auto server: client config, voice mission parsing, arrival narration,
// optional TTS, the semantic search proxy and the phone controller websocket relay.
import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer } from 'ws';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataWindowGuard, inDataWindow } from './dataWindow.js';
import { parseMission, narrate } from '../src/parser.js';
import { llmMission, llmNarrate, llmReady } from './llm.js';
import { createMaya } from './maya.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const GAME_MODE = process.env.GAME_MODE === 'mock' ? 'mock' : 'real';
const LLM_ENABLED = process.env.LLM_ENABLED === 'true';
// Sending narration text to a TTS provider is third party sharing too, so it follows LLM_ENABLED.
const TTS_ENABLED = LLM_ENABLED && !!process.env.TTS_API_KEY && GAME_MODE !== 'mock';

function lanIp() {
  const nets = os.networkInterfaces();
  const found = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) found.push({ name, address: n.address });
    }
  }
  // prefer real wifi / ethernet / hotspot adapters over virtual ones
  found.sort((a, b) => Number(/virtual|vethernet|wsl|vmware|docker|loopback/i.test(a.name)) - Number(/virtual|vethernet|wsl|vmware|docker|loopback/i.test(b.name)));
  return found[0]?.address || '127.0.0.1';
}

const maya = createMaya({ root: ROOT, mode: GAME_MODE, enabled: LLM_ENABLED });

const app = express();
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true, mode: GAME_MODE, llm: LLM_ENABLED, dataWindow: inDataWindow(),
    keys: { vexcel: !!process.env.VEXCEL_API_KEY, matterport: !!process.env.MATTERPORT_SDK_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY, tts: !!process.env.TTS_API_KEY },
  });
});

// Client config. GAME_MODE=mock means the client loads only public/data/mock/.
// Two keys reach the browser, both meant for it: MATTERPORT_SDK_KEY (domain locked public key)
// and GOOGLE_MAPS_API_KEY (Map Tiles; restrict it by HTTP referrer in the Google console).
app.get('/api/config', (_req, res) => {
  res.json({
    mode: GAME_MODE,
    llm: LLM_ENABLED && llmReady(),
    tts: TTS_ENABLED,
    maya: maya.ready(), mayaTts: maya.ttsReady(), stt: maya.ttsReady(), mayaAgent: maya.liveReady(), voiceProvider: maya.ttsReady() ? maya.provider : null,
    matterportSdkKey: GAME_MODE === 'mock' ? '' : process.env.MATTERPORT_SDK_KEY || '',
    googleMapsKey: GAME_MODE === 'mock' ? '' : process.env.GOOGLE_MAPS_API_KEY || '',
    showcaseBase: process.env.MATTERPORT_SHOWCASE_BASE || 'https://my.matterport.com',
    sdkUrl: process.env.MATTERPORT_SDK_URL || 'https://static.matterport.com/showcase-sdk/latest.js',
    lanIp: lanIp(),
    httpsPort: httpsUp ? HTTPS_PORT : 0,
  });
});

// ---- voice mission: transcript in, filters out. Claude when enabled, keyword parser otherwise.
app.post('/api/mission', async (req, res) => {
  const { transcript = '', filters = null, last = null } = req.body || {};
  const text = String(transcript).slice(0, 300);
  const local = parseMission(text, { kind: filters?.kind });
  if (!LLM_ENABLED || !llmReady() || local.action || local.reset) return res.json({ source: 'local', ...local });
  try {
    const out = await llmMission(text, filters, last);
    if (out) return res.json({ source: 'llm', ...local, ...out, similar: out.similar ?? local.similar });
  } catch (e) {
    console.warn('[mission] LLM failed, using the keyword parser:', e.message);
  }
  res.json({ source: 'local', ...local });
});

// ---- arrival narration: two sentences from a few listing numbers and aerial facts.
app.post('/api/narrate', async (req, res) => {
  const l = req.body || {};
  const fallback = narrate({ ...l, vexcel: { poolDetected: l.aerial?.pool, treeCoverPct: l.aerial?.treeCoverPct, solar: l.aerial?.solar, roofMaterial: l.aerial?.roof }, listingPool: l.aerial?.listingMentionsPool, nearby: { park: l.aerial?.parkMeters, school: l.aerial?.schoolMeters } }, Math.floor(Math.random() * 3));
  if (!LLM_ENABLED || !llmReady()) return res.json({ source: 'local', text: fallback });
  try {
    const text = await llmNarrate(l);
    if (text) return res.json({ source: 'llm', text });
  } catch (e) {
    console.warn('[narrate] LLM failed, using a template:', e.message);
  }
  res.json({ source: 'local', text: fallback });
});

// ---- Maya, the voice sales agent (server/maya.js)
app.post('/api/maya', (req, res) => maya.handle(req, res));
app.get('/api/maya/tts/status', (req, res) => maya.ttsStatus(req, res));
app.post('/api/maya/tts', (req, res) => maya.tts(req, res));
app.get('/api/maya/tts', (req, res) => maya.tts(req, res));
app.get('/api/maya/voices', (req, res) => maya.voices(req, res));
app.get('/api/maya/session', (req, res) => maya.session(req, res));
app.post('/api/stt', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '6mb' }), (req, res) => maya.stt(req, res));

// ---- "My places": look up an address the player typed (Census geocoder, public, no key).
// Only the player's own text is sent; never anything from the data kit.
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 120);
  if (q.length < 4 || GAME_MODE === 'mock') return res.status(400).json({ error: 'no query' });
  try {
    const r = await fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q), { signal: AbortSignal.timeout(6000) });
    const m = (await r.json())?.result?.addressMatches?.[0];
    if (!m) return res.status(404).json({ error: 'not found' });
    res.json({ lat: m.coordinates.y, lon: m.coordinates.x, label: String(m.matchedAddress || q).split(',').slice(0, 2).join(',') });
  } catch { res.status(504).json({ error: 'geocoder timeout' }); }
});

// ---- optional nicer narrator voice
app.post('/api/tts', async (req, res) => {
  if (!TTS_ENABLED) return res.status(404).json({ error: 'tts off' });
  const text = String(req.body?.text || '').slice(0, 500);
  if (!text) return res.status(400).json({ error: 'no text' });
  const key = process.env.TTS_API_KEY;
  try {
    let r;
    if (key.startsWith('sk_')) {
      const voice = process.env.TTS_VOICE || 'EXAVITQu4vr4xnSDxMaL';
      r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
        method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: process.env.TTS_MODEL || 'eleven_turbo_v2_5' }), signal: AbortSignal.timeout(3200),
      });
    } else {
      r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.TTS_MODEL || 'gpt-4o-mini-tts', voice: process.env.TTS_VOICE || 'alloy', input: text }), signal: AbortSignal.timeout(3200),
      });
    }
    if (!r.ok) return res.status(502).json({ error: 'tts provider ' + r.status });
    res.set('content-type', 'audio/mpeg');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(504).json({ error: 'tts timeout' });
  }
});

// ---- live semantic search for words that are not in the prebuilt index, and "more like this".
// The Sponsor API details live in server/sponsor/ (local only). Without it these answer 501
// and the game falls back to what it has on disk.
let sponsor = null;
try {
  sponsor = await import('./sponsor/search.js');
} catch { /* not present: mock mode or a clean checkout */ }
const searchGuard = dataWindowGuard('semantic search');
app.post('/api/near', searchGuard, async (req, res) => {
  if (!sponsor || GAME_MODE === 'mock') return res.status(501).json({ error: 'not available' });
  try {
    res.json(await sponsor.nearWord(req.body || {}));
  } catch (e) {
    res.status(504).json({ error: String(e.message || e).slice(0, 120) });
  }
});
app.post('/api/similar', searchGuard, async (req, res) => {
  if (!sponsor || GAME_MODE === 'mock') return res.status(501).json({ error: 'not available' });
  try {
    res.json(await sponsor.similarTo(req.body || {}));
  } catch (e) {
    res.status(504).json({ error: String(e.message || e).slice(0, 120) });
  }
});

// ---- phone controller page
app.get('/phone', (_req, res) => res.sendFile(path.join(__dirname, 'phone.html')));
app.get('/qrcode.js', (_req, res) => res.sendFile(path.join(ROOT, 'node_modules', 'qrcode', 'build', 'qrcode.js')));

// Serve the production build when it exists (one command runs everything from here).
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: 0 }));
  // real city data is not copied into dist: serve it straight from public/data (never in mock mode)
  if (GAME_MODE !== 'mock') app.use('/data', express.static(path.join(ROOT, 'public', 'data')));
  // Matterport's Showcase SDK bundle, if it has been downloaded (local only, see MORNING.md)
  if (GAME_MODE !== 'mock' && fs.existsSync(path.join(ROOT, 'public', 'mp-bundle'))) app.use('/mp-bundle', express.static(path.join(ROOT, 'public', 'mp-bundle')));
}

// ---- websocket relay with rooms: every message goes to everyone else in the room
const rooms = new Map();
function attachRelay(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const u = new URL(req.url, 'http://x');
    const room = (u.searchParams.get('room') || 'default').slice(0, 24);
    const role = u.searchParams.get('role') === 'game' ? 'game' : 'phone';
    if (!rooms.has(room)) rooms.set(room, new Set());
    const peers = rooms.get(room);
    ws.role = role;
    peers.add(ws);
    const tell = (msg) => { for (const p of peers) if (p !== ws && p.readyState === 1) p.send(JSON.stringify(msg)); };
    tell({ t: 'peer', role, on: true });
    for (const p of peers) if (p !== ws && p.readyState === 1) ws.send(JSON.stringify({ t: 'peer', role: p.role, on: true }));
    ws.on('message', (data) => {
      if (data.length > 20000) return;
      const s = data.toString();
      for (const p of peers) if (p !== ws && p.readyState === 1) p.send(s);
    });
    ws.on('close', () => {
      peers.delete(ws);
      tell({ t: 'peer', role, on: false });
      if (!peers.size) rooms.delete(room);
    });
  });
}

const server = createServer(app);
attachRelay(server);

// HTTPS on the LAN for the phone: tilt steering and the mic need a secure page. Self-signed,
// generated at startup, so the phone shows a one-time warning. Nothing leaves the local network.
let httpsUp = false;
try {
  const selfsigned = (await import('selfsigned')).default;
  const ip = lanIp();
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'grand-property-auto.local' }], {
    days: 7, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, { type: 7, ip }] }],
  });
  const https = createHttpsServer({ key: pems.private, cert: pems.cert }, app);
  attachRelay(https);
  https.on('error', (e) => console.warn('[server] https for the phone is off:', e.message));
  https.listen(HTTPS_PORT, () => { httpsUp = true; console.log(`[server] phone controller: https://${ip}:${HTTPS_PORT}/phone (self-signed, same wifi or hotspot only)`); });
} catch (e) {
  console.warn('[server] https for the phone is off:', e.message);
}

server.listen(PORT, () =>
  console.log(`[server] http://localhost:${PORT} mode=${GAME_MODE} llm=${LLM_ENABLED && llmReady()} tts=${TTS_ENABLED} dataWindow=${inDataWindow()}`));
