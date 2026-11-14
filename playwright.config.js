import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    // --force_high_performance_gpu: test pages land on the discrete card (the RTX), like Chrome does here
    launchOptions: { args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] },
  },
  webServer: [
    { command: 'node server/index.js', url: 'http://localhost:8787/api/health', reuseExistingServer: true, timeout: 30_000 },
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
});
