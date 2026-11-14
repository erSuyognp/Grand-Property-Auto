import { defineConfig } from 'vite';

const SERVER = 'http://localhost:8787';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': SERVER,
      '/phone': SERVER,
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
