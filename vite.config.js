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

// Draco and Basis decoders for the Google 3D Tiles, served from our own origin (no CDN):
// copied out of three's package into public/libs for dev and into dist/libs for the build.
const decoders = () => {
  const copy = (to) => {
    fs.cpSync('node_modules/three/examples/jsm/libs/draco/gltf', `${to}/libs/draco`, { recursive: true });
    fs.cpSync('node_modules/three/examples/jsm/libs/basis', `${to}/libs/basis`, { recursive: true });
  };
  // the CC0 car models live in public/models and go into the build as they are
  const models = () => fs.cpSync('public/models', 'dist/models', { recursive: true });
  return { name: 'decoders', buildStart() { copy('public'); }, closeBundle() { if (fs.existsSync('dist')) { copy('dist'); models(); } } };
};

export default defineConfig({
  plugins: [mockDataOnly(), decoders()],
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
