import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

function lanIPv4(): string {
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows ?? []) {
      if (row.family === 'IPv4' && !row.internal) return row.address;
    }
  }
  return '127.0.0.1';
}

const HOST = process.env.PODU_LAN_HOST ?? lanIPv4();
const PORT = 5173;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/room-vite.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://${HOST}:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node server/sync.mjs',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        PODU_SYNC_PORT: '8787',
        PODU_ROOMS_DIR: path.resolve('test-results/rooms-vite'),
      },
    },
    {
      command: 'npx vite --host --port 5173 --strictPort',
      url: `http://${HOST}:${String(PORT)}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
