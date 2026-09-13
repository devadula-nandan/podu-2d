import { describe, expect, it } from 'vitest';
import type { ResolvedSegment } from '../engine/index.js';
import { WHEEL_TOTAL_UNITS } from '../rules/constants.js';
import { formatMatchupShare, formatUnits, matchupOdds, unitsOf, wheelOdds } from './odds.js';

function seg(
  size: number,
  color: ResolvedSegment['color'],
  damage: number | null = null,
  stars: number | null = null,
): ResolvedSegment {
  return {
    size,
    moveName: color,
    color,
    damage,
    stars,
    isMultiplier: false,
    sourceIndex: 0,
    notes: [],
  };
}

describe('wheel odds', () => {
  it('treats a segment of size N as N/96 and sums to 100%', () => {
    const odds = wheelOdds([{ size: 24 }, { size: 24 }, { size: 48 }]);
    expect(odds.totalUnits).toBe(WHEEL_TOTAL_UNITS);
    expect(odds.sumPercent).toBe(100);
    expect(odds.segments[0]?.chance).toBe(24 / 96);
    expect(odds.segments.map((row) => row.size).reduce((a, b) => a + b, 0)).toBe(96);
    expect(formatUnits(24)).toBe('24/96 (25%)');
  });

  it('reports the actual total when a wheel is short', () => {
    expect(unitsOf([{ size: 40 }, { size: 8 }])).toBe(48);
    expect(wheelOdds([{ size: 40 }, { size: 8 }]).sumPercent).toBe(100);
    expect(formatUnits(40, 48)).toBe('40/48 (83.33%)');
  });
});

describe('matchup odds', () => {
  it('is an exact 96×96 colour table, not a sample', () => {
    const attacker = [seg(96, 'blue')];
    const defender = [seg(48, 'white', 50), seg(48, 'miss')];
    const odds = matchupOdds(attacker, defender);
    expect(odds.pairs).toBe(96 * 96);
    expect(odds.attacker).toBe(96 * 96);
    expect(odds.defender).toBe(0);
    expect(odds.draw).toBe(0);
    expect(formatMatchupShare(odds.attacker, odds.pairs)).toBe('9216/9216 (100%)');
  });

  it('splits a White/Gold mirror on printed damage', () => {
    const attacker = [seg(96, 'white', 40)];
    const defender = [seg(48, 'white', 50), seg(48, 'white', 10)];
    const odds = matchupOdds(attacker, defender);
    expect(odds.attacker + odds.defender + odds.draw).toBe(odds.pairs);
    expect(odds.defender).toBe(96 * 48);
    expect(odds.attacker).toBe(96 * 48);
  });
});
