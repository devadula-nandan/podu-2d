import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Ability, Figure, Plate } from '../content/schema.js';
import { createEngine } from './dispatch.js';
import { coverageSummary, UnimplementedContentError } from './effects/registry.js';
import { makeFigure, harness } from './test/helpers.js';

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(`data/content/${name}.json`, 'utf8'));
}

describe('coverage registry', () => {
  it('reports clause coverage over the real content bundle', () => {
    const figures = loadJson('figures') as Figure[];
    const plates = loadJson('plates') as Plate[];
    const abilities = loadJson('abilities') as Ability[];
    const engine = createEngine({ figures, plates, abilities });
    const { totals, rankedGaps } = engine.registry;

    expect(totals.figures).toBe(605);
    expect(totals.plates).toBe(152);
    expect(totals.clauses).toBeGreaterThan(0);
    expect(totals.clausesSupported).toBeGreaterThan(0);
    expect(totals.clausesSupported).toBeLessThanOrEqual(totals.clauses);
    expect(totals.clausesSupported / totals.clauses).toBeGreaterThanOrEqual(0.988);

    const summary = coverageSummary(engine.registry);
    console.log(`engine coverage: ${summary}`);
    console.log(`top gaps: ${rankedGaps.slice(0, 8).map(([k, n]) => `${k}=${n}`).join('; ')}`);
    const leftoverPlates = [...engine.registry.plates.values()]
      .filter((entry) => !entry.implemented)
      .map((entry) => entry.name);
    console.log(`unimplemented plates (${leftoverPlates.length}): ${leftoverPlates.join(', ')}`);

    expect(summary).toMatch(/figures fully implemented/);
    expect(summary).toMatch(/clauses executable/);
  });

  it('refuses a duel that fields an unimplemented clause unless allowUnimplemented is set', () => {
    const broken = makeFigure(9, {
      ability: { name: 'Banana', text: 'This Pokémon becomes a banana and then teleports to Mars.' },
    });
    expect(() => harness({ p0: [broken], p1: [makeFigure(10)] })).toThrow(UnimplementedContentError);

    const allowed = harness({ p0: [broken], p1: [makeFigure(10)], allowUnimplemented: true });
    expect(allowed.state.unimplementedClauses.length).toBeGreaterThan(0);
  });
});
