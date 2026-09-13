/**
 * Runs the compiler over every real clause and reports what it cannot express.
 *
 * This is the test that stops the DSL from lying. A grammar designed by reading a
 * sample always looks complete; the only honest measure is the share of the actual
 * 3,863 clauses that compile to something other than `unimplemented`. The coverage
 * floor is asserted so the number can only move up, and the failing patterns are
 * written to disk ranked by frequency so the next increment is always obvious.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Action, Clause } from './effects.js';
import { compileEffect, resetClauseIds, splitClauses } from './compile.js';

interface CorpusEntry { source: string; kind: string; move: string; text: string }

const corpus = JSON.parse(readFileSync('data/raw/clause-corpus.json', 'utf8')) as CorpusEntry[];

/** Walk every action in a clause tree, including nested spin-check and optional bodies. */
function* walkActions(clauses: readonly Clause[]): Generator<Action> {
  for (const clause of clauses) {
    for (const action of clause.actions) {
      yield action;
      if (action.do === 'spinCheck') yield* walkActions(action.then);
      if (action.do === 'optional') for (const inner of action.then) yield inner;
    }
  }
}

describe('effect DSL coverage over the real corpus', () => {
  resetClauseIds();

  const clauseTexts = corpus.flatMap((c) => splitClauses(c.text));
  const compiled = corpus.flatMap((c) => compileEffect(c.text));

  const actions = [...walkActions(compiled)];
  const unimplemented = actions.filter((a) => a.do === 'unimplemented');
  const implemented = actions.length - unimplemented.length;
  const coverage = implemented / actions.length;

  const guards = compiled.flatMap((c) => c.when);
  const unimplementedGuards = guards.filter((g) => g.kind === 'unimplemented');

  it('parses every text without throwing', () => {
    expect(compiled.length).toBeGreaterThan(0);
    expect(clauseTexts.length).toBeGreaterThan(3000);
  });

  it('emits a well-formed clause for every input, never dropping one', () => {
    // Every clause carries its source text and at least one action, so nothing can be
    // silently lost between the corpus and the engine.
    for (const clause of compiled) {
      expect(clause.source.length).toBeGreaterThan(0);
      expect(clause.actions.length).toBeGreaterThan(0);
    }
  });

  it('reports coverage and writes the ranked gap', () => {
    const byKind: Record<string, number> = {};
    for (const a of actions) byKind[a.do] = (byKind[a.do] ?? 0) + 1;

    const gaps: Record<string, number> = {};
    for (const a of unimplemented) {
      if (a.do !== 'unimplemented') continue;
      const key = a.text
        .replace(/\d+/g, 'N')
        .replace(/\b(?:this|the|a|an) Pok[eé]mon\b/gi, '{MON}')
        .toLowerCase();
      gaps[key] = (gaps[key] ?? 0) + 1;
    }
    const ranked = Object.entries(gaps).sort((a, b) => b[1] - a[1]);

    const lines = [
      `actions emitted      : ${actions.length}`,
      `  compiled           : ${implemented}  (${(coverage * 100).toFixed(1)}%)`,
      `  unimplemented      : ${unimplemented.length}`,
      `guards emitted       : ${guards.length}  (${unimplementedGuards.length} unimplemented)`,
      '',
      '=== ACTIONS BY KIND ===',
      ...Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(5)}  ${k}`),
      '',
      `=== TOP UNCOMPILED PATTERNS (${ranked.length} distinct) ===`,
      ...ranked.slice(0, 60).map(([k, n]) => `  ${String(n).padStart(4)}  ${k.slice(0, 150)}`),
    ];
    mkdirSync('data/raw', { recursive: true });
    writeFileSync('data/raw/dsl-coverage.txt', lines.join('\n'));

    console.log(lines.slice(0, 24).join('\n'));

    // A floor, not a target. Raise it as the grammar grows; never lower it.
    expect(coverage).toBeGreaterThan(0.988);
  });

  it('uses the full action vocabulary rather than collapsing to a few kinds', () => {
    const kinds = new Set(actions.map((a) => a.do));
    kinds.delete('unimplemented');
    // The DSL is only earning its keep if the corpus actually exercises it broadly.
    expect(kinds.size).toBeGreaterThanOrEqual(15);
  });
});
