import { describe, expect, it } from 'vitest';
import { hashState } from './hash.js';
import {
  GOLDEN_SEED,
  goldenCommands,
  goldenContent,
  harness,
  play,
  playHashed,
} from './test/helpers.js';

/**
 * Pinned after the first green run of this command list on this engine.
 * Bumped from `0fb23a26` when "Before using this Pokémon" moved off the global
 * preSelect scan onto per-figure abilityAction (always latches preSelectClosed).
 * If this fails again, the engine's observable state changed: do not
 * "fix" the hash unless the rules change was deliberate.
 */
export const GOLDEN_HASH = 'cce0ee57';

describe('golden replay', () => {
  it('reaches a pinned hashState from a fixed seed and command list', () => {
    const { engine, state } = harness({ ...goldenContent(), seed: GOLDEN_SEED });
    const final = play(engine, state, goldenCommands());
    const hash = hashState(final);
    expect(hash).toBe(GOLDEN_HASH);
    expect(final.figures[0]?.node).toBe('r2c0');
    expect(final.figures[1]?.node).toBe('r0c1');
    expect(final.phase).toBe('action');
    expect(final.turn.player).toBe(0);
  });

  it('reproduces the same hash from the same seed and diverges on another seed', () => {
    const a = harness({ ...goldenContent(), seed: GOLDEN_SEED });
    const b = harness({ ...goldenContent(), seed: GOLDEN_SEED });
    expect(playHashed(a.engine, a.state, goldenCommands())).toBe(
      playHashed(b.engine, b.state, goldenCommands()),
    );

    const other = harness({ ...goldenContent(), seed: GOLDEN_SEED ^ 1 });
    expect(playHashed(other.engine, other.state, goldenCommands())).not.toBe(GOLDEN_HASH);
  });
});
