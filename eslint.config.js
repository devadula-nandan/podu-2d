import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Node >= 23.6 strips types natively, so the boundary spec can be authored in
// TypeScript and shared with the test that proves it fires.
import {
  ENGINE_GLOBS,
  ENGINE_RESTRICTED_GLOBALS,
  ENGINE_RESTRICTED_IMPORTS,
} from './tools/lint-boundaries.ts';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'data',
      'tools/cache',
      'tools/cache-bulba',
      'playwright-report',
      'test-results',
      'storybook-static',
    ],
  },

  // The data pipeline is plain ESM scripts with no type information behind them.
  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  // Everything TypeScript, linted with type information.
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // The strict preset's defaults, tightened where this project has an opinion.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Numbers in template literals are safe and idiomatic; the rest of the strict
      // preset's interpolation ban (any, boolean, nullish, RegExp) stays on.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Non-null assertions are banned outright: `noUncheckedIndexedAccess` is on, and
      // silencing it with `!` defeats the reason it is on.
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use a union of literals or an `as const` object; enums are not erasable syntax.',
        },
      ],
    },
  },

  // The React entry point and (later) the UI layer.
  {
    files: [
      'src/main.tsx',
      'src/ui/**/*.tsx',
      'src/ui/use-table.ts',
      'src/player/**/*.tsx',
      'src/pages/**/*.tsx',
      'src/stage3d/**/*.tsx',
    ],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },

  // Tooling and test files legitimately talk to the console and the filesystem.
  {
    files: [
      'tools/**/*.ts',
      'tests/**/*.ts',
      'src/**/*.test.ts',
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'playwright.vite.config.ts',
    ],
    rules: { 'no-console': 'off', '@typescript-eslint/no-unnecessary-condition': 'off' },
  },

  // ─── The engine-purity boundary ───────────────────────────────────────────────
  // Options live in tools/lint-boundaries.ts and are asserted to fire by
  // tests/lint/engine-purity.test.ts.
  {
    files: [...ENGINE_GLOBS],
    rules: {
      'no-restricted-imports': ['error', ENGINE_RESTRICTED_IMPORTS],
      'no-restricted-globals': ['error', ...ENGINE_RESTRICTED_GLOBALS],
    },
  },

  prettier,
);
