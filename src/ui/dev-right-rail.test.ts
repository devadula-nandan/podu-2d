import { describe, expect, it } from 'vitest';
import {
  DEV_RIGHT_RAIL_DEFAULT_REM,
  DEV_RIGHT_RAIL_KEY,
  DEV_RIGHT_RAIL_MIN_REM,
  clampRightRailPx,
  parseRightRailRem,
  persistRightRailPx,
  readRightRailPx,
} from './dev-right-rail.js';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('dev right rail width', () => {
  it('parses stored rem and rejects junk', () => {
    expect(parseRightRailRem('27')).toBe(27);
    expect(parseRightRailRem('0')).toBeNull();
    expect(parseRightRailRem('nope')).toBeNull();
    expect(parseRightRailRem(null)).toBeNull();
  });

  it('clamps to 22rem–50vw and leaves the board a mid column', () => {
    const rem = 16;
    const vw = 1280;
    expect(clampRightRailPx(200, vw, rem)).toBe(DEV_RIGHT_RAIL_MIN_REM * rem);
    expect(clampRightRailPx(900, vw, rem)).toBe(vw * 0.5);
    expect(clampRightRailPx(432, vw, rem)).toBe(432);
    expect(clampRightRailPx(432, vw, rem) + 16.5 * rem + 12 * rem).toBeLessThanOrEqual(vw);
  });

  it('reads the default and persists rem', () => {
    const rem = 16;
    const store = memory();
    expect(readRightRailPx(null, 1440, rem)).toBe(DEV_RIGHT_RAIL_DEFAULT_REM * rem);
    persistRightRailPx(store, 30 * rem, rem);
    expect(store.getItem(DEV_RIGHT_RAIL_KEY)).toBe('30.00');
    expect(readRightRailPx(store, 1440, rem)).toBe(30 * rem);
  });
});
