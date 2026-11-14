import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    { command: 'node server/index.js', url: 'http://localhost:8787/api/health', reuseExistingServer: true, timeout: 30_000 },
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
});
