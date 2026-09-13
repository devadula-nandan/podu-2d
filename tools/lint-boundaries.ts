/**
 * The engine-purity import boundary, in one place.
 *
 * `src/engine/**` is the deterministic, event-sourced core: pure TypeScript that
 * must stay runnable inside a Vitest process, an AI rollout loop and (later) a
 * server, with no DOM and no I/O. Anything it imports becomes part of that
 * contract, so the boundary is enforced mechanically rather than by convention.
 *
 * This module is the single source of truth for the rule options. `eslint.config.js`
 * feeds them to ESLint; `tests/lint/engine-purity.test.ts` feeds the same object to
 * a `Linter` instance and asserts it actually reports the violations it claims to.
 * A boundary rule whose globs silently match nothing is worse than no rule at all,
 * so the patterns are treated as code under test.
 */

/** Files the boundary applies to. `src/engine/` does not exist yet; the glob is ready for it. */
export const ENGINE_GLOBS = ['src/engine/**/*.ts', 'src/engine/**/*.tsx'] as const;

const DENY = (what: string): string =>
  `src/engine/** is pure: it may not import ${what}. ` +
  'Move the impure part to src/rules, src/render, src/ui or src/net and pass data in.';

/**
 * Options for the core `no-restricted-imports` rule. Deliberately the core rule and
 * not the typescript-eslint extension: the core rule needs no type information, so
 * the test can exercise it in-memory with `Linter.verify` on a virtual engine file.
 *
 * Pure *types* from the content layer are fine — `src/content/schema.ts` is not
 * restricted, only the loader, which touches the filesystem.
 */
export const ENGINE_RESTRICTED_IMPORTS = {
  patterns: [
    {
      group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'react-dom/client'],
      message: DENY('React'),
    },
    {
      group: ['**/net', '**/net/**', '@/net', '@/net/**'],
      message: DENY('src/net/** (transports are injected, never reached for)'),
    },
    {
      group: ['**/ui', '**/ui/**', '@/ui', '@/ui/**'],
      message: DENY('src/ui/**'),
    },
    {
      group: ['**/render', '**/render/**', '@/render', '@/render/**'],
      message: DENY('src/render/**'),
    },
    {
      group: ['**/content/load', '**/content/load.*', '@/content/load', '@/content/load.*'],
      message: DENY(
        'the content loader (it reads the filesystem) — import types from content/schema instead',
      ),
    },
    {
      // A `src/content/index.ts` barrel would re-export the loader and route around
      // the rule above, so the bare directory import is denied outright. Expressed as
      // a regex, not a glob: glob groups are gitignore-flavoured, so `**/content`
      // would also swallow `../content/schema.js`, which must stay allowed.
      regex: '(?:^|/)content$',
      message: DENY('src/content as a barrel — name the module, e.g. content/schema'),
    },
  ],
} as const;

/**
 * DOM reachability is not expressible as an import restriction, because the DOM
 * arrives as ambient globals. This is the other half of the same boundary.
 */
export const ENGINE_RESTRICTED_GLOBALS = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'fetch',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'XMLHttpRequest',
  'WebSocket',
  'alert',
].map((name) => ({ name, message: DENY(`the DOM/browser global \`${name}\``) }));
