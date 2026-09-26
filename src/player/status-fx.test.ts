import { describe, expect, it } from 'vitest';
import { CONDITION_FX, markerShort } from './status-fx.js';

describe('status presentation', () => {
  it('covers every special condition the engine stores', () => {
    expect(Object.keys(CONDITION_FX).sort()).toEqual(
      ['asleep', 'burned', 'confused', 'frozen', 'noxious', 'paralyzed', 'poisoned'].sort(),
    );
  });

  it('prints Wait-style MP markers the way the original disc badge did', () => {
    expect(markerShort('mpModifier', -2)).toBe('MP-2');
    expect(markerShort('curse', null)).toBe('CRS');
    expect(markerShort('cracked', null)).toBe('CRK');
  });
});
