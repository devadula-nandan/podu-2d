/** Piece slide after a deploy or MP move. */
export const MOVE_MS = 380;

/** Surround hatch pulse. */
export const SURROUND_MS = 720;

/** 96-unit wheel spin — long enough to read as a spin, not a flash. */
export const SPIN_MS = 1050;

/** Hold the landed segment before the result text appears. */
export const SPIN_HOLD_MS = 420;

/** Player overlay: keep the result on screen, then auto-dismiss (no Continue). */
export const RESULT_HOLD_MS = 2000;

/** Extra beat after a KO / surround so the table does not jump. */
export const KO_HOLD_MS = 640;

const REDUCED_MS = 80;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionMs(full: number): number {
  return prefersReducedMotion() ? Math.min(REDUCED_MS, full) : full;
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}
