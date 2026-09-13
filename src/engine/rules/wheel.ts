/**
 * Wheel construction and spinning.
 *
 * A figure's printed wheel is not the wheel it spins. Burn and paralysis rewrite the
 * smallest non-Miss segment to a Miss, Frozen forces every segment to Miss, rotation
 * effects shift the whole disk, and substitution hooks swap individual moves. Resolving
 * all of that into a flat per-battle array before the spin means the spin itself is one
 * uniform draw over 96 units - which is exactly what makes the odds computable exactly
 * later, and what keeps the RNG usage to a single draw per spin.
 *
 * `spin` is a standalone primitive rather than part of the battle phase, because a
 * couple of dozen abilities force spins outside combat entirely - Entry Shot, the
 * Lock On family, Long Lick, Entangle, Grudge Stone, Spark Noise, Acid Downpour.
 */
import {
  PURPLE_STAR_MAX,
  PURPLE_STAR_MIN,
  STARLESS_PURPLE_POLICY,
  STARLESS_PURPLE_SUBSTITUTE_STARS,
  WHEEL_TOTAL_UNITS,
} from '../../rules/constants.js';
import type { WheelSegment } from '../../content/schema.js';
import { figureContent } from '../content.js';
import type { EngineDeps } from '../effects/context.js';
import type { FigureUid } from '../ids.js';
import { nextInt } from '../rng.js';
import type { RngState } from '../rng.js';
import type { GameState, ResolvedSegment } from '../state.js';
import { figureOf } from '../state.js';

function resolveSegment(segment: WheelSegment, index: number): ResolvedSegment {
  const damage = segment.damage;
  let value: number | null = null;
  let stars: number | null = null;
  let isMultiplier = false;
  const notes: string[] = [];

  if (damage !== null) {
    switch (damage.kind) {
      case 'fixed':
        value = damage.base;
        break;
      case 'stars':
        stars = damage.stars;
        break;
      case 'multiplier':
        value = damage.base;
        isMultiplier = true;
        break;
      case 'variable':
        // Written "90+" in the source. The base is the guaranteed floor, and no source
        // says what the bonus depends on, so the floor is used and the fact is recorded
        // rather than a number being invented.
        value = damage.base;
        notes.push('variable damage: using the printed floor');
        break;
    }
  }

  if (segment.color === 'purple' && stars === null && STARLESS_PURPLE_POLICY === 'sourceOmission') {
    stars = STARLESS_PURPLE_SUBSTITUTE_STARS;
    notes.push(`starless Purple: substituted ${STARLESS_PURPLE_SUBSTITUTE_STARS}*`);
  }
  if (stars !== null && (stars < PURPLE_STAR_MIN || stars > PURPLE_STAR_MAX)) {
    notes.push(`star value ${stars} is outside ${PURPLE_STAR_MIN}..${PURPLE_STAR_MAX}`);
  }

  return {
    size: segment.size,
    moveName: segment.moveName,
    color: segment.color,
    damage: value,
    stars,
    isMultiplier,
    sourceIndex: index,
    notes,
  };
}

function applyWheelPatches(
  state: GameState,
  figure: ReturnType<typeof figureOf>,
  wheel: readonly ResolvedSegment[],
): ResolvedSegment[] {
  const live = figure.wheelPatches.filter(
    (patch) => patch.expiresOnTurn === null || state.turn.number < patch.expiresOnTurn,
  );
  if (live.length === 0) return [...wheel];
  return wheel.map((segment) => {
    let next = segment;
    for (const patch of live) {
      const except = patch.exceptMoveNames ?? [];
      const printed = next.moveName.replace(/\*+$/g, '').trim().toLowerCase();
      const patchName = patch.moveName.replace(/\*+$/g, '').trim().toLowerCase();
      if (except.some((name) => name.replace(/\*+$/g, '').trim().toLowerCase() === printed)) continue;
      const byName = patch.fromColor === undefined && patchName === printed;
      const byColor = patch.fromColor !== undefined && next.color === patch.fromColor;
      if (!byName && !byColor) continue;
      if (patch.starDelta !== undefined && patch.starDelta !== 0) {
        next = {
          ...next,
          stars: (next.stars ?? 0) + patch.starDelta,
          notes: [...next.notes, `modifyStars: ${patch.starDelta > 0 ? '+' : ''}${patch.starDelta}`],
        };
      }
      if (patch.toColor === 'miss' || /^miss$/i.test(patch.replacement)) {
        next = toMiss(next, `replaceSegment: ${segment.moveName} becomes Miss`);
        continue;
      }
      if (patch.toColor !== undefined && patch.toColor !== next.color) {
        next = {
          ...next,
          color: patch.toColor,
          notes: [...next.notes, `recolorAttacks: ${segment.color} → ${patch.toColor}`],
        };
      } else if (patch.replacement !== '' && patch.fromColor === undefined) {
        next = {
          ...next,
          moveName: patch.replacement,
          notes: [...next.notes, `replaceSegment: ${segment.moveName} → ${patch.replacement}`],
        };
      }
      if (patch.damage !== undefined && next.color !== 'miss') {
        next = {
          ...next,
          damage: patch.damage,
          notes: [...next.notes, `replaceSegment: damage ${patch.damage}`],
        };
      }
    }
    return next;
  });
}

/** A Z-Move is spun as a single 96-unit segment of the already-resolved colour. */
export function buildZMoveWheel(segment: WheelSegment): ResolvedSegment[] {
  return [resolveSegment({ ...segment, size: WHEEL_TOTAL_UNITS }, 0)];
}

const toMiss = (segment: ResolvedSegment, why: string): ResolvedSegment => ({
  ...segment,
  color: 'miss',
  damage: null,
  stars: null,
  isMultiplier: false,
  notes: [...segment.notes, why],
});

/**
 * The smallest non-Miss segment, by size then by wheel order.
 *
 * Burn and Paralysis both convert exactly one segment and the text does not say which
 * when two tie, so the tie is broken by position. That is a genuine choice, but it is a
 * choice between two identically-sized segments, so it can only change *which move* is
 * lost and never how much wheel space the penalty costs.
 */
function smallestNonMissIndex(wheel: readonly ResolvedSegment[]): number | null {
  let best: number | null = null;
  let bestSize = Number.POSITIVE_INFINITY;
  wheel.forEach((segment, index) => {
    if (segment.color === 'miss') return;
    if (segment.size < bestSize) {
      bestSize = segment.size;
      best = index;
    }
  });
  return best;
}

export interface WheelOptions {
  /** Extra clockwise rotation on top of the figure's own `wheelRotation`. */
  readonly extraRotation: number;
}

/**
 * Build the wheel a figure will actually spin, in the order the effects apply.
 *
 * Order matters and is: printed wheel, then rotation, then Frozen (which subsumes
 * everything), then Burn/Paralysis. Applying the condition before the rotation would
 * blank a different segment.
 */
export function buildWheel(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  options: WheelOptions = { extraRotation: 0 },
): ResolvedSegment[] {
  const figure = figureOf(state, uid);
  const printed = figureContent(deps.content, figure.figureId).figure.wheel;
  let wheel = printed.map(resolveSegment);
  wheel = applyWheelPatches(state, figure, wheel);

  const rotation = ((figure.wheelRotation + options.extraRotation) % wheel.length + wheel.length) % wheel.length;
  if (rotation !== 0) wheel = [...wheel.slice(rotation), ...wheel.slice(0, rotation)];

  if (figure.condition === 'frozen') {
    return wheel.map((segment) => toMiss(segment, 'frozen: attacks are forced to Miss'));
  }
  if (figure.condition === 'burned' || figure.condition === 'paralyzed') {
    const index = smallestNonMissIndex(wheel);
    if (index !== null) {
      const target = wheel[index];
      if (target !== undefined) {
        wheel = wheel.map((segment, i) =>
          i === index ? toMiss(target, `${figure.condition ?? ''}: smallest non-Miss segment becomes Miss`) : segment,
        );
      }
    }
  }
  return wheel;
}

export const wheelTotal = (wheel: readonly ResolvedSegment[]): number =>
  wheel.reduce((sum, segment) => sum + segment.size, 0);

export interface SpinResult {
  readonly unit: number;
  readonly index: number;
  readonly rng: RngState;
}

/**
 * One spin: a single uniform draw over the wheel's total units.
 *
 * The draw is over the *actual* total rather than the constant 96, because a wheel that
 * failed to total 96 would otherwise index out of range and silently land on the last
 * segment forever. The content layer guarantees 96 for every complete figure; this is
 * the line that makes a violation harmless instead of invisible.
 */
export function spinWheel(wheel: readonly ResolvedSegment[], rng: RngState): SpinResult {
  const total = wheelTotal(wheel);
  const draw = nextInt(rng, total > 0 ? total : WHEEL_TOTAL_UNITS);
  let cursor = 0;
  for (let index = 0; index < wheel.length; index++) {
    const segment = wheel[index];
    if (segment === undefined) continue;
    cursor += segment.size;
    if (draw.value < cursor) return { unit: draw.value, index, rng: draw.rng };
  }
  return { unit: draw.value, index: Math.max(0, wheel.length - 1), rng: draw.rng };
}

/** Confusion advances the landed result one segment clockwise. */
export const advanceClockwise = (wheel: readonly ResolvedSegment[], index: number): number =>
  wheel.length === 0 ? index : (index + 1) % wheel.length;

export function segmentAt(wheel: readonly ResolvedSegment[], index: number | null): ResolvedSegment | null {
  if (index === null) return null;
  return wheel[index] ?? null;
}
