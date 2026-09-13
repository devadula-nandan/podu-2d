/**
 * xoshiro128** as a value, not a service.
 *
 * The generator's whole state is four 32-bit words that live *inside* `GameState`, and
 * every draw returns a new state rather than mutating one. A module-global generator
 * would be one line shorter and would quietly destroy the property the entire engine is
 * built to have: that a seed plus a command list reproduces a duel exactly. With the
 * state inline, a replay, an AI rollout and a server re-simulation all draw the same
 * numbers in the same order without anyone having to remember to reseed.
 *
 * xoshiro128** rather than a linear congruential generator because it is fast, has a
 * 2^128 period, passes the standard statistical batteries, and - the reason that
 * matters here - is exactly reproducible in 32-bit integer arithmetic, which JavaScript
 * can do losslessly with `Math.imul` and `>>>`. Anything touching `Math.random`,
 * `Date.now` or 64-bit floats would not be reproducible across engines.
 */

export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
  /**
   * How many raw words have been drawn. Nothing reads it to make a decision; it exists
   * so a divergent replay can be bisected by "which draw first differed" instead of by
   * staring at two final states.
   */
  readonly draws: number;
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** splitmix32, used only to expand a single seed into four well-mixed words. */
function splitmix32(seed: number): { value: number; next: number } {
  const next = (seed + 0x9e3779b9) | 0;
  let t = next ^ (next >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return { value: t >>> 0, next };
}

/**
 * Expand a 32-bit seed into a generator state.
 *
 * The all-zero state is a fixed point of xoshiro and would emit zeros forever, so it is
 * replaced. That can only happen for a seed that splitmix maps to four zeros, which is
 * vanishingly unlikely and still worth handling: a silently dead generator would look
 * like a very deterministic engine.
 */
export function createRng(seed: number): RngState {
  let cursor = seed | 0;
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    const step = splitmix32(cursor);
    cursor = step.next;
    words.push(step.value);
  }
  const [s0 = 0, s1 = 0, s2 = 0, s3 = 0] = words;
  if ((s0 | s1 | s2 | s3) === 0) return { s0: 0x9e3779b9, s1: 0x243f6a88, s2: 0xb7e15162, s3: 0x85ebca6b, draws: 0 };
  return { s0, s1, s2, s3, draws: 0 };
}

/** One raw 32-bit draw. */
export function nextUint32(rng: RngState): { value: number; rng: RngState } {
  const value = Math.imul(rotl(Math.imul(rng.s1, 5) >>> 0, 7), 9) >>> 0;

  const t = (rng.s1 << 9) >>> 0;
  const s2a = (rng.s2 ^ rng.s0) >>> 0;
  const s3a = (rng.s3 ^ rng.s1) >>> 0;
  const s1b = (rng.s1 ^ s2a) >>> 0;
  const s0b = (rng.s0 ^ s3a) >>> 0;
  const s2b = (s2a ^ t) >>> 0;
  const s3b = rotl(s3a, 11);

  return { value, rng: { s0: s0b, s1: s1b, s2: s2b, s3: s3b, draws: rng.draws + 1 } };
}

/**
 * A uniform integer in `[0, bound)`.
 *
 * Rejection sampling rather than `value % bound`. The modulo shortcut biases the low
 * residues, and the bound that matters most here is 96 - the wheel - which does not
 * divide 2^32, so the bias would land directly on which attack a figure spins. It would
 * be small, permanent, and almost impossible to notice from play.
 */
export function nextInt(rng: RngState, bound: number): { value: number; rng: RngState } {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError(`nextInt bound must be a positive integer, got ${bound}`);
  }
  if (bound === 1) return { value: 0, rng };
  const limit = 0x100000000 - (0x100000000 % bound);
  let current = rng;
  for (;;) {
    const draw = nextUint32(current);
    current = draw.rng;
    if (draw.value < limit) return { value: draw.value % bound, rng: current };
  }
}

/** Pick one element. Returns `null` for an empty list rather than inventing an index. */
export function pick<T>(rng: RngState, items: readonly T[]): { value: T | null; rng: RngState } {
  if (items.length === 0) return { value: null, rng };
  const draw = nextInt(rng, items.length);
  return { value: items[draw.value] ?? null, rng: draw.rng };
}

/**
 * Fisher-Yates, returning a new array.
 *
 * Used by setup and by the fuzz harness. Written out rather than borrowed so the draw
 * order is fixed by this file and cannot change under us.
 */
export function shuffle<T>(rng: RngState, items: readonly T[]): { value: T[]; rng: RngState } {
  const out = [...items];
  let current = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const draw = nextInt(current, i + 1);
    current = draw.rng;
    const j = draw.value;
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return { value: out, rng: current };
}
