/** Piece slide after a deploy or MP move. One hop is this; longer walks add HOP_MS. */
export const MOVE_MS = 280;

/** Extra time per corridor between nodes. */
export const HOP_MS = 220;

/** Surround hatch pulse. */
export const SURROUND_MS = 520;

/** Clash rush before the wheels appear. */
export const CLASH_MS = 720;

/** 96-unit wheel spin — matches pokemon-duel-webgl (~2.7s). */
export const SPIN_MS = 2700;

/** Hold the landed segment before the result text appears. */
export const SPIN_HOLD_MS = 420;

/** Player overlay: keep the result on screen, then auto-dismiss (no Continue). */
export const RESULT_HOLD_MS = 2200;

/** Extra beat after a KO / surround so the table does not jump. */
export const KO_HOLD_MS = 420;

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

export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

/** How long a walk of `hops` corridors should last. */
export function moveMs(hops: number): number {
  const n = Math.max(1, hops);
  return motionMs(Math.min(1400, Math.max(MOVE_MS, n * HOP_MS)));
}

/**
 * Which corridor the walker is on, and how far along it.
 *
 * `t` is 0..1 over the whole walk. Each hop gets an equal slice so a 3-step MP
 * move actually visits the two nodes in between instead of flying the chord.
 */
export function walkSample(t: number, hops: number): { readonly index: number; readonly local: number } {
  if (hops <= 0) return { index: 0, local: 1 };
  const u = Math.min(1, Math.max(0, t));
  if (u >= 1) return { index: hops - 1, local: 1 };
  const x = u * hops;
  const index = Math.min(hops - 1, Math.floor(x));
  return { index, local: x - index };
}
