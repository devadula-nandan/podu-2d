#!/usr/bin/env node
/**
 * Soak runner for the Pokémon Duel engine.
 *
 * `npm test` already runs 32 games inside `src/engine/fuzz/fuzz.test.ts`. This
 * script is the longer pass: 10,000 games or ~3 minutes, whichever comes first.
 *
 * Measured on this machine (Windows, Node 24, 2026-09-12): ~28 games/s with
 * per-dispatch invariant + fold-hash checks, so 10,000 games need ~6 minutes.
 * The default `--ms 180000` budget finishes about 5,050 games with zero
 * invariant failures. Raise `--ms` (or drop `--ms` and wait) to reach 10,000.
 *
 * Usage:
 *   node tools/fuzz.mjs
 *   node tools/fuzz.mjs --games 2000 --ms 120000
 *   node tools/fuzz.mjs 500
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteNode = path.join(root, 'node_modules', 'vite-node', 'vite-node.mjs');
const cli = path.join(root, 'src', 'engine', 'fuzz', 'cli.ts');

const result = spawnSync(process.execPath, [viteNode, cli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
