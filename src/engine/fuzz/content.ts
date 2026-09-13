/**
 * Load the real content bundle for the fuzz harness.
 *
 * `src/engine/**` must not import `src/content/load` (it touches the filesystem through
 * a dedicated door, and the purity lint forbids the specifier). Tests already read
 * `data/content/*.json` with `readFileSync`; this module is that same door, shared by
 * the CI fuzz and the soak CLI.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilitiesSchema, figuresSchema, parseOrThrow, platesSchema } from '../../content/schema.js';
import type { Ability, Figure, Plate } from '../../content/schema.js';
import { createEngine } from '../dispatch.js';
import type { Engine } from '../dispatch.js';

export interface FuzzContent {
  readonly figures: readonly Figure[];
  readonly plates: readonly Plate[];
  readonly abilities: readonly Ability[];
}

function resolveContentDir(): string {
  const candidates = [
    path.resolve('data/content'),
    path.resolve(fileURLToPath(new URL('../../../data/content', import.meta.url))),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'figures.json'))) return dir;
  }
  throw new Error('cannot find data/content/figures.json from the cwd or the repo layout');
}

function readJson(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as unknown;
}

export function loadFuzzContent(): FuzzContent {
  const dir = resolveContentDir();
  return {
    figures: parseOrThrow('figure', figuresSchema, readJson(dir, 'figures.json')),
    plates: parseOrThrow('plate', platesSchema, readJson(dir, 'plates.json')),
    abilities: parseOrThrow('ability', abilitiesSchema, readJson(dir, 'abilities.json')),
  };
}

/** One engine over the real bundle. Reuse it: compiling 596 figures is the expensive part. */
export function createFuzzEngine(content: FuzzContent = loadFuzzContent()): Engine {
  return createEngine(content);
}
