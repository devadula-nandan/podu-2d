import { describe, expect, it } from 'vitest';
import { createFuzzEngine } from './content.js';
import { fuzzPools } from './pool.js';
import { formatReport, missingPhases } from './report.js';
import { CI_FUZZ_GAMES, DEFAULT_BASE_SEED, runFuzz } from './run.js';
import { playFuzzGame, replayCommands } from './walk.js';
import { hashState } from '../hash.js';
import { DECK_FIGURE_COUNT } from '../constants.js';

const engine = createFuzzEngine();
const pools = fuzzPools(engine);

describe('fuzz pools', () => {
  it('has enough implemented figures for two six-figure decks without allowUnimplemented', () => {
    expect(pools.noAbility.length + pools.withAbility.length).toBeGreaterThanOrEqual(DECK_FIGURE_COUNT * 2);
    expect(pools.noAbility.length).toBeGreaterThanOrEqual(DECK_FIGURE_COUNT);
    expect(engine.registry.totals.platesImplemented).toBe(pools.plates.length);
  });
});

describe('random-legal self-play', () => {
  it('reproduces the same final hash from the same seed and recorded commands', () => {
    const walk = playFuzzGame(engine, 0x70696e31, {}, pools);
    const replayed = replayCommands(engine, walk.setup, walk.commands, walk.seed);
    expect(hashState(replayed)).toBe(hashState(walk.state));
    expect(walk.setup.seed).toBe(0x70696e31);
    expect(walk.setup.decks[0].figures).toHaveLength(DECK_FIGURE_COUNT);
    expect(walk.setup.decks[1].figures).toHaveLength(DECK_FIGURE_COUNT);
  });

  it(`runs ${CI_FUZZ_GAMES} seeded games with empty invariants`, { timeout: 25_000 }, () => {
    const report = runFuzz(engine, { games: CI_FUZZ_GAMES, baseSeed: DEFAULT_BASE_SEED });
    // Printed so a verify log shows the CI histogram without opening the soak.
    console.log(formatReport(report));
    expect(report.invariantFailures).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.games).toBe(CI_FUZZ_GAMES);
    expect(report.commands).toBeGreaterThan(0);
    expect(report.uniqueFinishedSeeds.length + report.unfinished).toBe(CI_FUZZ_GAMES);
    expect(missingPhases(report.phasesSeen)).not.toContain('action');
  });
});
