import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/room-vite.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && node server/sync.mjs --static dist`,
    url: `http://localhost:${String(PORT)}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PODU_SYNC_PORT: String(PORT),
      PODU_ROOMS_DIR: path.resolve('test-results/rooms'),
      PODU_ROOMS_RESET: '1',
    },
  },
});
