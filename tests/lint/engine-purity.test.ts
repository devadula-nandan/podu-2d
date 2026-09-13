/**
 * Proves the engine-purity boundary reports what it claims to.
 *
 * The failure mode this guards against is specific: `no-restricted-imports` glob
 * groups match the *specifier string*, so a plausible-looking pattern can match
 * nothing at all and the rule passes silently forever. Since `src/engine/` does not
 * exist yet, nothing would notice. So the rule options are linted here against
 * synthetic engine files, in-memory, with no filesystem involved.
 *
 * Uses `Linter` rather than the `ESLint` class because these are core, non-type-aware
 * rules: no TS program is needed, and a virtual file path is enough.
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { ENGINE_RESTRICTED_GLOBALS, ENGINE_RESTRICTED_IMPORTS } from '../../tools/lint-boundaries.js';

const linter = new Linter();

const ENGINE_CONFIG: Linter.Config[] = [
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': ['error', ENGINE_RESTRICTED_IMPORTS],
      'no-restricted-globals': ['error', ...ENGINE_RESTRICTED_GLOBALS],
    },
  },
];

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(code, ENGINE_CONFIG, { filename: 'src/engine/probe.ts' });
}

/** Every specifier here is one an engine file might realistically reach for. */
const FORBIDDEN_SPECIFIERS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  '../net/transport.js',
  '../../net/local.js',
  './net/index.js',
  '@/net/transport.js',
  '../ui/App.js',
  '@/ui/hud/Timer.js',
  '../render/scene.js',
  '@/render/board.js',
  '../content/load.js',
  '@/content/load.js',
  // A barrel would re-export the loader, so the bare directory import is denied too.
  '../content',
  '@/content',
];

const ALLOWED_SPECIFIERS = [
  'node:assert',
  '../content/schema.js',
  '@/content/schema.js',
  '../content/dsl/effects.js',
  './rng.js',
  '../rules/constants.js',
  'zod',
  // "net" and "ui" as substrings of a longer segment must not trip the globs.
  '../network-free-helper.js',
  '../guid/net-utils.js',
];

describe('engine-purity import boundary', () => {
  it.each(FORBIDDEN_SPECIFIERS)('rejects `import x from %j`', (specifier) => {
    const messages = lint(`import x from '${specifier}';\nexport default x;\n`);
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  it.each(FORBIDDEN_SPECIFIERS)('rejects `export * from %j`', (specifier) => {
    const messages = lint(`export * from '${specifier}';\n`);
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  it('rejects type-only imports of the impure layers too', () => {
    // A type import of React still couples the engine to a rendering library's
    // lifecycle vocabulary, so it is denied along with the value import.
    const messages = lint(`import type { ReactNode } from 'react';\nexport type T = ReactNode;\n`);
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  it.each(ALLOWED_SPECIFIERS)('allows `import x from %j`', (specifier) => {
    const messages = lint(`import x from '${specifier}';\nexport default x;\n`);
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  it('carries a message explaining the boundary, not just a rule name', () => {
    const messages = lint(`import { createRoot } from 'react-dom/client';\nexport default createRoot;\n`);
    expect(messages[0]?.message).toMatch(/src\/engine\/\*\* is pure/);
  });

  it.each(['document', 'window', 'localStorage', 'fetch', 'requestAnimationFrame'])(
    'rejects the DOM global `%s`',
    (name) => {
      const messages = lint(`export const x = ${name};\n`);
      expect(messages.map((m) => m.ruleId)).toContain('no-restricted-globals');
    },
  );

  it('leaves ordinary identifiers alone', () => {
    const messages = lint('export const documentCount = 3;\nexport const myWindow = documentCount;\n');
    expect(messages).toEqual([]);
  });

  it('keeps both halves of the boundary non-empty', () => {
    // Cheap tripwire: someone emptying the lists would otherwise make every
    // assertion above vacuous.
    expect(ENGINE_RESTRICTED_IMPORTS.patterns.length).toBeGreaterThanOrEqual(5);
    expect(ENGINE_RESTRICTED_GLOBALS.length).toBeGreaterThanOrEqual(5);
  });
});
