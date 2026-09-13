import { describe, expect, it } from 'vitest';
import {
  EQUAL_DAMAGE_IS_DRAW,
  EQUAL_STARS_IS_DRAW,
  GOLD_BEATS_BLUE,
  GOLD_BEATS_WHITE,
} from '../../rules/constants.js';
import { CONDITION_DAMAGE_MODIFIER } from '../constants.js';
import type { ResolvedSegment } from '../state.js';
import { computeDamage, knocksOut, resolveColors } from './battle.js';
import type { DamageInput } from './battle.js';

function segment(
  color: ResolvedSegment['color'],
  opts: { damage?: number | null; stars?: number | null; moveName?: string; isMultiplier?: boolean } = {},
): ResolvedSegment {
  const defaultDamage = color === 'white' || color === 'gold' ? 40 : null;
  const defaultStars = color === 'purple' ? 2 : null;
  return {
    size: 24,
    moveName: opts.moveName ?? color,
    color,
    damage: 'damage' in opts ? (opts.damage ?? null) : defaultDamage,
    stars: 'stars' in opts ? (opts.stars ?? null) : defaultStars,
    isMultiplier: opts.isMultiplier ?? false,
    sourceIndex: 0,
    notes: [],
  };
}

const white = (damage: number): ResolvedSegment => segment('white', { damage });
const gold = (damage: number): ResolvedSegment => segment('gold', { damage });
const purple = (stars: number): ResolvedSegment => segment('purple', { stars, damage: null });
const blue = (): ResolvedSegment => segment('blue', { damage: null });
const miss = (): ResolvedSegment => segment('miss', { damage: null });

describe('colour hierarchy', () => {
  it('does not treat the printed ranking as a total order: Gold does not beat White', () => {
    const goldLoses = resolveColors(gold(30), white(50), 30, 50);
    const whiteLoses = resolveColors(white(30), gold(50), 30, 50);
    if (GOLD_BEATS_WHITE) {
      expect(goldLoses.winner).toBe('attacker');
      expect(goldLoses.decidedBy).toBe('gold');
    } else {
      expect(goldLoses.winner).toBe('defender');
      expect(goldLoses.decidedBy).toBe('damage');
      expect(whiteLoses.winner).toBe('defender');
    }
  });

  it('resolves Blue vs Gold according to GOLD_BEATS_BLUE', () => {
    const goldAttacks = resolveColors(gold(40), blue(), 40, null);
    const blueAttacks = resolveColors(blue(), gold(40), null, 40);
    if (GOLD_BEATS_BLUE) {
      expect(goldAttacks.winner).toBe('attacker');
      expect(blueAttacks.winner).toBe('defender');
      expect(goldAttacks.decidedBy).toBe('gold');
    } else {
      expect(goldAttacks.winner).toBe('defender');
      expect(blueAttacks.winner).toBe('attacker');
      expect(goldAttacks.decidedBy).toBe('blue');
    }
  });

  it('lets Blue beat every other colour and draw the Blue mirror', () => {
    expect(resolveColors(blue(), white(90), null, 90).winner).toBe('attacker');
    expect(resolveColors(blue(), purple(4), null, null).winner).toBe('attacker');
    expect(resolveColors(blue(), miss(), null, null).winner).toBe('attacker');
    expect(resolveColors(blue(), blue(), null, null)).toMatchObject({ winner: null, decidedBy: 'draw' });
  });

  it('gives Gold its only privilege: beating Purple', () => {
    expect(resolveColors(gold(10), purple(4), 10, null)).toMatchObject({
      winner: 'attacker',
      decidedBy: 'gold',
    });
    expect(resolveColors(purple(4), gold(10), null, 10)).toMatchObject({
      winner: 'defender',
      decidedBy: 'gold',
    });
  });

  it('compares Purple vs Purple by stars and draws equals when the ruling says so', () => {
    expect(resolveColors(purple(3), purple(2), null, null).winner).toBe('attacker');
    expect(resolveColors(purple(1), purple(4), null, null).winner).toBe('defender');
    const tied = resolveColors(purple(2), purple(2), null, null);
    if (EQUAL_STARS_IS_DRAW) {
      expect(tied.winner).toBeNull();
      expect(tied.decidedBy).toBe('draw');
    } else {
      expect(tied.winner).toBe('attacker');
    }
  });

  it('lets Purple beat White', () => {
    expect(resolveColors(purple(1), white(90), null, 90).winner).toBe('attacker');
  });

  it('treats equal White/Gold damage as a draw when EQUAL_DAMAGE_IS_DRAW is set', () => {
    const tied = resolveColors(white(40), gold(40), 40, 40);
    if (EQUAL_DAMAGE_IS_DRAW) {
      expect(tied.winner).toBeNull();
      expect(tied.decidedBy).toBe('draw');
    } else {
      expect(tied.winner).toBe('attacker');
    }
  });

  it('makes Miss lose to anything and draw the Miss mirror', () => {
    expect(resolveColors(miss(), white(10), null, 10).winner).toBe('defender');
    expect(resolveColors(white(10), miss(), 10, null).winner).toBe('attacker');
    expect(resolveColors(miss(), miss(), null, null).winner).toBeNull();
  });
});

describe('knockout', () => {
  it('knocks out on White or Gold damage above 0, never on Blue or Purple', () => {
    const win = { winner: 'attacker' as const, decidedBy: 'damage' as const, reason: 'test' };
    expect(knocksOut(win, white(40), 40)).toBe(true);
    expect(knocksOut(win, gold(10), 10)).toBe(true);
    expect(knocksOut(win, gold(0), 0)).toBe(false);
    expect(knocksOut(win, blue(), null)).toBe(false);
    expect(knocksOut(win, purple(3), null)).toBe(false);
    expect(knocksOut({ winner: null, decidedBy: 'draw', reason: 'draw' }, white(40), 40)).toBe(false);
  });
});

describe('damage pipeline', () => {
  const base = (segment: ResolvedSegment, extra: Partial<DamageInput> = {}): DamageResultish =>
    computeDamage({
      segment,
      repeats: 1,
      chainLevel: 0,
      condition: null,
      modifiers: [],
      counts: [],
      ...extra,
    });

  type DamageResultish = ReturnType<typeof computeDamage>;

  it('applies every additive stage before every multiplicative stage', () => {
    const result = base(white(40), {
      modifiers: [
        { kind: 'flat', amount: 10 },
        { kind: 'multiply', factor: 2 },
      ],
    });
    expect(result.final).toBe(100);
    expect(result.stages.map((s) => s.kind)).toEqual(['base', 'add', 'multiply']);
    expect(result.stages.map((s) => s.running)).toEqual([40, 50, 100]);
  });

  it('would be a different number if multiply ran first: 40×2+10 is not used', () => {
    const result = base(white(40), {
      modifiers: [
        { kind: 'multiply', factor: 2 },
        { kind: 'flat', amount: 10 },
      ],
    });
    expect(result.final).toBe(100);
    expect(result.final).not.toBe(90);
  });

  it('folds chain level, conditions and -1 flats into the additive pass', () => {
    const result = base(white(40), {
      chainLevel: 2,
      condition: 'poisoned',
      modifiers: [
        { kind: 'flat', amount: -1 },
        { kind: 'multiply', factor: 2 },
      ],
    });
    const additive = 40 + 2 + CONDITION_DAMAGE_MODIFIER.poisoned + -1;
    expect(result.final).toBe(additive * 2);
  });

  it('multiplies a repeat-until-miss segment before later stages', () => {
    const result = base(segment('white', { damage: 20, isMultiplier: true }), {
      repeats: 3,
      modifiers: [{ kind: 'multiply', factor: 2 }],
    });
    // 20 × 3 repeats, then a later ×2 modifier: 120, not 20 × 2 + later arithmetic.
    expect(result.final).toBe(120);
    expect(result.stages[1]?.label).toContain('repeat-until-miss');
    expect(result.stages.map((s) => s.running)).toEqual([20, 60, 120]);
  });

  it('floors at 0 and honours a takes-no-damage modifier', () => {
    expect(base(white(10), { condition: 'noxious' }).final).toBe(0);
    expect(
      base(white(40), { modifiers: [{ kind: 'none' }, { kind: 'flat', amount: 50 }] }).final,
    ).toBe(0);
  });

  it('returns null when the segment has no damage', () => {
    expect(base(blue()).final).toBeNull();
    expect(base(miss()).final).toBeNull();
  });
});
