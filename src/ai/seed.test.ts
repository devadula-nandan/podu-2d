import { describe, expect, it } from 'vitest';
import { aiSeedFrom } from './seed.js';

describe('aiSeedFrom', () => {
  it('is stable for a given duel seed and turn', () => {
    expect(aiSeedFrom(2, 1)).toBe(aiSeedFrom(2, 1));
    expect(aiSeedFrom(2, 1)).toBe(((2 >>> 0) ^ (Math.imul(1, 0x9e3779b9) >>> 0)) >>> 0);
  });

  it('changes when the turn number changes and stays in uint32', () => {
    const a = aiSeedFrom(2, 1);
    const b = aiSeedFrom(2, 2);
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    expect(aiSeedFrom(-1, 1)).toBe(aiSeedFrom(0xffffffff, 1));
  });
});
