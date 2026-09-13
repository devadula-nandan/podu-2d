/**
 * A stable hash of a `GameState`, for golden replays.
 *
 * `JSON.stringify` is not enough on its own: object key order follows insertion order,
 * and a reducer that rebuilds a record in a different order produces different JSON for
 * an identical state. A golden test built on that fails for reasons that have nothing
 * to do with the rules, and then gets deleted. So keys are sorted at every level before
 * serialising.
 *
 * The hash is FNV-1a: not cryptographic, and it does not need to be. Its job is to make
 * "the final state changed" a one-line assertion and a short diffable string, not to
 * resist an adversary.
 *
 * The PRNG state *is* included. A replay that ends on the right board with the wrong
 * generator has consumed a different number of draws somewhere, which is exactly the
 * class of bug the golden test exists to catch, and it is invisible in the board alone.
 */
import type { GameState } from './state.js';

/** Recursively sort object keys so serialisation is order-independent. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Map) {
    return [...value.entries()].map(([k, v]) => [canonical(k), canonical(v)]).sort();
  }
  if (value instanceof Set) return [...value].map(canonical).sort();
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const record: Record<string, unknown> = { ...value };
    for (const key of Object.keys(record).sort()) {
      out[key] = canonical(record[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

/** FNV-1a, 32-bit, rendered as eight lowercase hex digits. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const hashState = (state: GameState): string => fnv1a(canonicalJson(state));
