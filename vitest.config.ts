import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    // Playwright specs live in tests/e2e and are matched by `*.spec.ts`, so the two
    // runners never pick up each other's files.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
