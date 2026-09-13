import { describe, expect, it } from 'vitest';
import { createRng, nextInt, nextUint32, pick, shuffle } from './rng.js';

function take(seed: number, n: number): number[] {
  let rng = createRng(seed);
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    const step = nextUint32(rng);
    values.push(step.value);
    rng = step.rng;
  }
  return values;
}

describe('PRNG', () => {
  it('is deterministic: the same seed yields the same sequence', () => {
    expect(take(0x706f6475, 32)).toEqual(take(0x706f6475, 32));
    expect(take(0, 16)).toEqual(take(0, 16));
  });

  it('is seed-sensitive: different seeds yield different sequences', () => {
    expect(take(1, 16)).not.toEqual(take(2, 16));
    expect(take(0, 8)).not.toEqual(take(0x9e3779b9, 8));
  });

  it('does not mutate the input state', () => {
    const rng = createRng(7);
    const before = { ...rng };
    nextUint32(rng);
    nextInt(rng, 96);
    expect(rng).toEqual(before);
  });

  it('draws uniformly in [0, bound) without using modulo bias on the wheel', () => {
    let rng = createRng(96);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const step = nextInt(rng, 96);
      expect(step.value).toBeGreaterThanOrEqual(0);
      expect(step.value).toBeLessThan(96);
      seen.add(step.value);
      rng = step.rng;
    }
    // 400 draws over 96 bins should cover a large majority; a stuck generator would not.
    expect(seen.size).toBeGreaterThan(50);
  });

  it('rejects a non-positive nextInt bound', () => {
    const rng = createRng(1);
    expect(() => nextInt(rng, 0)).toThrow(RangeError);
    expect(() => nextInt(rng, -3)).toThrow(RangeError);
  });

  it('returns null from pick on an empty list and does not draw', () => {
    const rng = createRng(3);
    const picked = pick(rng, []);
    expect(picked.value).toBeNull();
    expect(picked.rng).toEqual(rng);
  });

  it('shuffles deterministically and leaves the input array untouched', () => {
    const items = [1, 2, 3, 4, 5];
    const a = shuffle(createRng(11), items);
    const b = shuffle(createRng(11), items);
    expect(a.value).toEqual(b.value);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(shuffle(createRng(12), items).value).not.toEqual(a.value);
  });
});
