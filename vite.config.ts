import os from 'node:os';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function lanIPv4(): string[] {
  const out: string[] = [];
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows ?? []) {
      if (row.family === 'IPv4' && !row.internal) out.push(row.address);
    }
  }
  return out;
}

function lanHostsPlugin(): Plugin {
  return {
    name: 'podu-lan-hosts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path !== '/__lan.json') {
          next();
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.setHeader('access-control-allow-origin', '*');
        res.end(JSON.stringify({ ipv4: lanIPv4() }));
      });
    },
  };
}

const syncProxy = {
  '/sync': {
    target: process.env.PODU_SYNC_TARGET ?? 'http://127.0.0.1:8787',
    ws: true,
    changeOrigin: true,
    secure: false,
  },
};

// Project Pages lives at /podu-2d/. Local `npm run dev` / `npm run start` stay at `/`.
const pagesBase = process.env.GITHUB_PAGES === 'true' ? '/podu-2d/' : '/';

export default defineConfig({
  base: pagesBase,
  plugins: [react(), lanHostsPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { outDir: 'dist', sourcemap: true },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    cors: true,
    allowedHosts: true,
    proxy: syncProxy,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    proxy: syncProxy,
  },
});
