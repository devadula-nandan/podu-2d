import { describe, expect, it } from 'vitest';
import { BOARD_SPAN, visualUnit, worldOf } from './world.js';

describe('stage3d world', () => {
  it('parks player 0 (unit y=1) toward the camera on +Z', () => {
    const you = worldOf(0.5, 1, false);
    const rival = worldOf(0.5, 0, false);
    expect(you.z).toBeCloseTo(BOARD_SPAN / 2);
    expect(rival.z).toBeCloseTo(-BOARD_SPAN / 2);
  });

  it('flips 180° so player 1 sits at the camera', () => {
    expect(visualUnit(0, 0, true)).toEqual({ x: 1, y: 1 });
    const you = worldOf(0, 0, true);
    expect(you.z).toBeCloseTo(BOARD_SPAN / 2);
  });
});
