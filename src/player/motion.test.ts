import { describe, expect, it } from 'vitest';
import { BOARD, mpPath, nodeId, OPEN_MOVEMENT } from '../engine/index.js';
import { HOP_MS, MOVE_MS, moveMs, walkSample } from './motion.js';

describe('walkSample', () => {
  it('puts t=0 at the first corridor start', () => {
    expect(walkSample(0, 3)).toEqual({ index: 0, local: 0 });
  });

  it('lands on the last corridor at t=1', () => {
    expect(walkSample(1, 3)).toEqual({ index: 2, local: 1 });
  });

  it('visits each corridor for an equal slice of t', () => {
    expect(walkSample(0.5, 4)).toEqual({ index: 2, local: 0 });
    expect(walkSample(1 / 3, 3).index).toBe(1);
  });

  it('treats a one-node walk as already arrived', () => {
    expect(walkSample(0.4, 0)).toEqual({ index: 0, local: 1 });
  });
});

describe('moveMs', () => {
  it('keeps a single hop at MOVE_MS', () => {
    expect(moveMs(1)).toBe(MOVE_MS);
  });

  it('stretches with extra hops, capped', () => {
    expect(moveMs(3)).toBe(3 * HOP_MS);
    expect(moveMs(20)).toBe(1400);
  });
});

describe('mpPath reconstruction', () => {
  it('returns the in-between nodes of a 3-step walk', () => {
    const from = nodeId('r4c0');
    const to = nodeId('r1c0');
    const path = mpPath(BOARD, from, to, 8, new Set(), OPEN_MOVEMENT);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path.at(-1)).toBe(to);
    expect(path.includes(from)).toBe(false);
  });
});
