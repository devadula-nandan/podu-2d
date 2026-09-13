import { describe, expect, it } from 'vitest';
import { hashState } from '../hash.js';
import { createFuzzEngine } from './content.js';
import { FUZZ_GOLDENS } from './fixtures.js';
import { replayCommands } from './walk.js';

const engine = createFuzzEngine();

describe('fuzz golden replays', () => {
  it('does not overwrite the original ea6a37de pin', () => {
    expect(FUZZ_GOLDENS.every((golden) => golden.hash !== 'ea6a37de')).toBe(true);
  });

  it.each(FUZZ_GOLDENS)('$name reaches its pinned hashState', (golden) => {
    expect(golden.hash).not.toBe('PENDING');
    expect(golden.hash).toMatch(/^[0-9a-f]{8}$/);
    const final = replayCommands(engine, golden.setup, golden.commands, golden.setup.seed);
    expect(hashState(final)).toBe(golden.hash);
  });

  it('is deterministic: the same fixture hashes twice', () => {
    const golden = FUZZ_GOLDENS[0];
    if (golden === undefined) throw new Error('expected at least one extra golden');
    const a = hashState(replayCommands(engine, golden.setup, golden.commands, golden.setup.seed));
    const b = hashState(replayCommands(engine, golden.setup, golden.commands, golden.setup.seed));
    expect(a).toBe(b);
    expect(a).toBe(golden.hash);
  });
});
