import { describe, expect, it } from 'vitest';
import {
  PHASE_ZOOM_DEFAULT,
  PHASE_ZOOM_MAX,
  PHASE_ZOOM_MIN,
  clampPhaseZoom,
  stepPhaseZoom,
  zoomFromWheel,
} from './phase-machine-zoom.js';

describe('phase machine zoom', () => {
  it('clamps and steps', () => {
    expect(clampPhaseZoom(Number.NaN)).toBe(PHASE_ZOOM_DEFAULT);
    expect(clampPhaseZoom(0.1)).toBe(PHASE_ZOOM_MIN);
    expect(clampPhaseZoom(9)).toBe(PHASE_ZOOM_MAX);
    expect(stepPhaseZoom(1, 1)).toBe(1.25);
    expect(stepPhaseZoom(PHASE_ZOOM_MIN, -1)).toBe(PHASE_ZOOM_MIN);
  });

  it('zooms from wheel delta', () => {
    expect(zoomFromWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomFromWheel(1, 100)).toBeLessThan(1);
    expect(zoomFromWheel(PHASE_ZOOM_MAX, -400)).toBe(PHASE_ZOOM_MAX);
  });
});
