import { defineConfig } from 'vite';
import fs from 'node:fs';

const SERVER = 'http://localhost:8787';

// The build output must never hold Sponsor Data: only the synthetic mock neighborhood is
// copied into dist/. Real city files stay in public/data/ and the local server serves them
// from there (see server/index.js).
const mockDataOnly = () => ({
  name: 'mock-data-only',
  apply: 'build',
  closeBundle() {
    fs.rmSync('dist/data', { recursive: true, force: true });
    fs.cpSync('public/data/mock', 'dist/data/mock', { recursive: true });
  },
});

export default defineConfig({
  plugins: [mockDataOnly()],
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5173,
    host: true,
    watch: { ignored: ['**/data/**', '**/public/data/**', '**/shots/**', '**/dist/**'] },
    proxy: {
      '/api': SERVER,
      '/phone': SERVER,
      '/qrcode.js': SERVER,
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500, copyPublicDir: false },
});
