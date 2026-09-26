import { describe, expect, it } from 'vitest';
import type { ResolvedSegment } from '../engine/index.js';
import { WHEEL_TOTAL_UNITS } from '../rules/constants.js';
import { RIVAL_POINTER_TURNS, YOU_POINTER_TURNS, segmentCallout, spinTargetTurns } from './draw-wheel.js';

function seg(partial: Partial<ResolvedSegment> & Pick<ResolvedSegment, 'color' | 'moveName' | 'size'>): ResolvedSegment {
  return {
    damage: null,
    stars: null,
    isMultiplier: false,
    sourceIndex: 0,
    notes: [],
    ...partial,
  };
}

describe('segmentCallout', () => {
  it('prints white/gold damage', () => {
    expect(segmentCallout(seg({ color: 'white', moveName: 'Tackle', size: 40, damage: 70 }))).toBe('70');
  });

  it('prints purple stars and miss', () => {
    expect(segmentCallout(seg({ color: 'purple', moveName: 'Toxic', size: 8, stars: 2 }))).toBe('2★');
    expect(segmentCallout(seg({ color: 'miss', moveName: 'Miss', size: 8 }))).toBe('MISS');
  });
});

describe('spinTargetTurns', () => {
  it('spins clockwise so unit 24 lands under the top pointer', () => {
    expect(spinTargetTurns(24, 0)).toBe(1 - 24 / WHEEL_TOTAL_UNITS + 6);
  });

  it('parks you at 12 o\'clock and rival at 6 o\'clock so a vertical clash meets in the middle', () => {
    expect(YOU_POINTER_TURNS).toBe(0);
    expect(RIVAL_POINTER_TURNS).toBe(0.5);
    expect(spinTargetTurns(0, YOU_POINTER_TURNS)).toBe(1 + 6);
    expect(spinTargetTurns(0, RIVAL_POINTER_TURNS)).toBe(RIVAL_POINTER_TURNS + 6);
  });
});
