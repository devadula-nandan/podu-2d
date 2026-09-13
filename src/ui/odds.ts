/**
 * Exact battle odds from the 96-unit wheels.
 *
 * A segment of size N is N/96. Two independent wheels are a 96×96 (or size-product)
 * table, so matchup percentages are fractions, not Monte Carlo.
 */
import { resolveColors, type ResolvedSegment } from '../engine/index.js';
import { WHEEL_TOTAL_UNITS } from '../rules/constants.js';

export interface SegmentChance {
  readonly index: number;
  readonly size: number;
  readonly chance: number;
  readonly percent: number;
}

export interface WheelOdds {
  readonly segments: readonly SegmentChance[];
  readonly totalUnits: number;
  readonly sumPercent: number;
}

export interface MatchupOdds {
  readonly pairs: number;
  readonly attacker: number;
  readonly defender: number;
  readonly draw: number;
}

export function unitsOf(segments: readonly { readonly size: number }[]): number {
  return segments.reduce((sum, segment) => sum + segment.size, 0);
}

export function wheelOdds(segments: readonly { readonly size: number }[]): WheelOdds {
  const totalUnits = unitsOf(segments);
  const denom = totalUnits > 0 ? totalUnits : WHEEL_TOTAL_UNITS;
  return {
    segments: segments.map((segment, index) => ({
      index,
      size: segment.size,
      chance: segment.size / denom,
      percent: (segment.size / denom) * 100,
    })),
    totalUnits,
    sumPercent: totalUnits > 0 ? 100 : 0,
  };
}

export function formatUnits(size: number, total: number = WHEEL_TOTAL_UNITS): string {
  const denom = total > 0 ? total : WHEEL_TOTAL_UNITS;
  const percent = (size / denom) * 100;
  const shown = Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
  return `${size}/${denom} (${shown}%)`;
}

export function matchupOdds(
  attacker: readonly ResolvedSegment[],
  defender: readonly ResolvedSegment[],
): MatchupOdds {
  let attackerWin = 0;
  let defenderWin = 0;
  let draw = 0;
  for (const atk of attacker) {
    for (const def of defender) {
      const outcome = resolveColors(atk, def, atk.damage, def.damage);
      const weight = atk.size * def.size;
      if (outcome.winner === 'attacker') attackerWin += weight;
      else if (outcome.winner === 'defender') defenderWin += weight;
      else draw += weight;
    }
  }
  return { pairs: attackerWin + defenderWin + draw, attacker: attackerWin, defender: defenderWin, draw };
}

export function formatMatchupShare(count: number, pairs: number): string {
  if (pairs <= 0) return '0%';
  const percent = (count / pairs) * 100;
  const shown = Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
  return `${count}/${pairs} (${shown}%)`;
}
