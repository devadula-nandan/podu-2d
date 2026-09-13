/**
 * Colour resolution and the damage pipeline.
 *
 * Two things here are easy to get wrong and expensive to get wrong quietly.
 *
 * **The colour hierarchy is not a total order.** Written as "Blue > Gold > Purple >
 * White > Miss" it looks like one, and implementing it as a ranking is a real bug:
 * Gold has *no* advantage over White, so Gold vs White is an ordinary damage comparison
 * that Gold frequently loses. Gold's only privilege is beating Purple. The table below
 * is written as explicit cases for that reason, and every ruling it depends on comes
 * from `src/rules/constants.ts` so a source correction is a one-token change.
 *
 * **Damage is not a running integer sum.** Dual Brains deals x2, Fluffy and Shadow
 * Shield halve, Hacking Gems applies -1, the dance abilities add per-figure increments,
 * and the multiplier segments are a repeat-until-miss *loop* rather than a modifier. So
 * the pipeline is ordered stages, and it records each stage so the rules inspector can
 * show why a number came out the way it did.
 */
import { BATTLE_RANGE_DEFAULT, CHAIN_LEVEL_DAMAGE_PER_LEVEL } from '../../rules/constants.js';
import type { SpecialCondition } from '../../content/dsl/primitives.js';
import type { DamageModifier } from '../../content/dsl/effects.js';
import { stepDistance } from '../board/graph.js';
import { CONDITION_DAMAGE_MODIFIER } from '../constants.js';
import { equalDamageIsDraw, equalStarsIsDraw, goldBeatsBlue, goldBeatsWhite } from '../rulings.js';
import type { EngineDeps } from '../effects/context.js';
import type { DamageStage } from '../events.js';
import type { FigureUid } from '../ids.js';
import { opponentOf } from '../ids.js';
import type { BattleOutcome, GameState, ResolvedSegment } from '../state.js';
import { figureOf } from '../state.js';

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

/**
 * Legal battle targets for a figure.
 *
 * Range is a parameter rather than a constant because "Range 2" is explicit game
 * vocabulary: High Flying attacks two spaces away *through* an intervening figure, and
 * five other abilities grant the same. That "through" is why this uses `stepDistance`
 * and not `mpReachable` - occupancy does not block a battle target the way it blocks a
 * move.
 */
export function battleTargets(
  state: GameState,
  deps: EngineDeps,
  attacker: FigureUid,
  range: number = BATTLE_RANGE_DEFAULT,
): FigureUid[] {
  const source = figureOf(state, attacker);
  if (source.zone !== 'field' || source.node === null) return [];
  const enemy = opponentOf(source.owner);
  return state.figures
    .filter(
      (figure) =>
        figure.owner === enemy &&
        figure.zone === 'field' &&
        figure.node !== null &&
        stepDistance(deps.board, source.node as typeof figure.node & string, figure.node) <= range,
    )
    .map((figure) => figure.uid)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// The damage pipeline
// ---------------------------------------------------------------------------

export interface DamageInput {
  readonly segment: ResolvedSegment;
  /** Tally from the repeat-until-miss loop. 1 for an ordinary segment. */
  readonly repeats: number;
  readonly chainLevel: number;
  readonly condition: SpecialCondition | null;
  /** Collected by the hook bus in layer order; additive ones are applied first. */
  readonly modifiers: readonly DamageModifier[];
  /** Resolved counts for `multiplyByCount` with a `figures` source. */
  readonly counts: readonly number[];
}

export interface DamageResult {
  readonly stages: readonly DamageStage[];
  readonly final: number | null;
}

/**
 * Base, then every additive stage, then every multiplicative stage, then a floor at 0.
 *
 * Additive-before-multiplicative is a real decision and it is the one the card text
 * implies: "-1 damage" and "+50 damage" read as adjustments to the printed attack, and
 * "x2 damage" reads as doubling what the attack would otherwise have done. The stage
 * list is returned in full so a disputed number can be audited rather than argued about.
 */
export function computeDamage(input: DamageInput): DamageResult {
  const stages: DamageStage[] = [];
  const base = input.segment.damage;
  if (base === null) return { stages, final: null };

  let running = base;
  stages.push({ label: input.segment.moveName, kind: 'base', amount: base, running });

  if (input.segment.isMultiplier && input.repeats > 1) {
    running = base * input.repeats;
    stages.push({
      label: `x${input.repeats} (repeat-until-miss)`,
      kind: 'multiply',
      amount: input.repeats,
      running,
    });
  }

  if (input.chainLevel > 0) {
    const bonus = input.chainLevel * CHAIN_LEVEL_DAMAGE_PER_LEVEL;
    running += bonus;
    stages.push({ label: `chain level ${input.chainLevel}`, kind: 'add', amount: bonus, running });
  }

  if (input.condition !== null) {
    const penalty = CONDITION_DAMAGE_MODIFIER[input.condition];
    if (penalty !== 0) {
      running += penalty;
      stages.push({ label: input.condition, kind: 'add', amount: penalty, running });
    }
  }

  let zeroed = false;
  let countCursor = 0;
  for (const modifier of input.modifiers) {
    if (modifier.kind === 'flat') {
      running += modifier.amount;
      stages.push({
        label: `ability ${modifier.amount >= 0 ? '+' : ''}${modifier.amount}`,
        kind: 'add',
        amount: modifier.amount,
        running,
      });
    } else if (modifier.kind === 'flatByCount') {
      const amount = modifier.amount * (input.counts[countCursor++] ?? 0);
      running += amount;
      stages.push({
        label: `+${amount} (counted)`,
        kind: 'add',
        amount,
        running,
      });
    } else if (modifier.kind === 'none') {
      zeroed = true;
    }
  }

  for (const modifier of input.modifiers) {
    if (modifier.kind === 'multiply') {
      running = Math.trunc(running * modifier.factor);
      stages.push({ label: `x${modifier.factor}`, kind: 'multiply', amount: modifier.factor, running });
    } else if (modifier.kind === 'multiplyByCount') {
      const factor =
        modifier.of.kind === 'spinRepeats' ? input.repeats : (input.counts[countCursor++] ?? 0);
      running = Math.trunc(running * factor);
      stages.push({ label: `x${factor} (counted)`, kind: 'multiply', amount: factor, running });
    }
  }

  if (zeroed) {
    running = 0;
    stages.push({ label: 'takes no damage', kind: 'multiply', amount: 0, running });
  }
  if (running < 0) {
    running = 0;
    stages.push({ label: 'floor', kind: 'floor', amount: 0, running });
  }
  return { stages, final: running };
}

// ---------------------------------------------------------------------------
// Colour resolution
// ---------------------------------------------------------------------------

const draw = (reason: string, decidedBy: BattleOutcome['decidedBy']): BattleOutcome => ({
  winner: null,
  decidedBy,
  reason,
});

/**
 * Who wins the exchange.
 *
 * `attackerDamage` and `defenderDamage` are the *post-pipeline* numbers, so conditions,
 * chain level and ability modifiers are already in them - a Poisoned attacker really
 * can lose a White mirror it would otherwise have won, which is the whole point of the
 * -20.
 */
export function resolveColors(
  attacker: ResolvedSegment,
  defender: ResolvedSegment,
  attackerDamage: number | null,
  defenderDamage: number | null,
): BattleOutcome {
  const a = attacker.color;
  const d = defender.color;

  if (a === 'miss' && d === 'miss') return draw('both missed', 'draw');
  if (a === 'miss') return { winner: 'defender', decidedBy: 'miss', reason: 'the attacker missed' };
  if (d === 'miss') return { winner: 'attacker', decidedBy: 'miss', reason: 'the defender missed' };

  if (a === 'blue' && d === 'blue') return draw('Blue against Blue', 'draw');
  if (a === 'blue' || d === 'blue') {
    const blueSide = a === 'blue' ? 'attacker' : 'defender';
    const otherColor = a === 'blue' ? d : a;
    if (goldBeatsBlue && otherColor === 'gold') {
      return {
        winner: blueSide === 'attacker' ? 'defender' : 'attacker',
        decidedBy: 'gold',
        reason: 'Gold beats Blue under the current ruling',
      };
    }
    return { winner: blueSide, decidedBy: 'blue', reason: 'Blue beats every other colour' };
  }

  if (a === 'purple' && d === 'purple') {
    const starsA = attacker.stars ?? 0;
    const starsD = defender.stars ?? 0;
    if (starsA === starsD) {
      return equalStarsIsDraw
        ? draw(`Purple mirror at ${starsA}*: neither effect fires`, 'draw')
        : { winner: 'attacker', decidedBy: 'stars', reason: 'equal stars broken towards the attacker' };
    }
    return {
      winner: starsA > starsD ? 'attacker' : 'defender',
      decidedBy: 'stars',
      reason: `${Math.max(starsA, starsD)}* beats ${Math.min(starsA, starsD)}*`,
    };
  }

  if (a === 'purple' || d === 'purple') {
    const purpleSide = a === 'purple' ? 'attacker' : 'defender';
    const otherColor = a === 'purple' ? d : a;
    if (otherColor === 'gold') {
      return {
        winner: purpleSide === 'attacker' ? 'defender' : 'attacker',
        decidedBy: 'gold',
        reason: 'Gold beats Purple - its only privilege',
      };
    }
    return { winner: purpleSide, decidedBy: 'purple', reason: 'Purple beats White' };
  }

  // Only White and Gold remain, in any combination.
  if (goldBeatsWhite && a !== d) {
    return {
      winner: a === 'gold' ? 'attacker' : 'defender',
      decidedBy: 'gold',
      reason: 'Gold beats White under the current ruling',
    };
  }
  const da = attackerDamage ?? 0;
  const dd = defenderDamage ?? 0;
  if (da === dd) {
    return equalDamageIsDraw
      ? draw(`equal damage at ${da}: both survive`, 'draw')
      : { winner: 'attacker', decidedBy: 'damage', reason: 'equal damage broken towards the attacker' };
  }
  return {
    winner: da > dd ? 'attacker' : 'defender',
    decidedBy: 'damage',
    reason: `${Math.max(da, dd)} damage beats ${Math.min(da, dd)}`,
  };
}

/**
 * Whether the winning colour knocks the loser out.
 *
 * White and Gold do; Purple applies its own effect text instead; Blue is a dodge and
 * kills nothing. Gold knocking out "on any damage above 0" is the same rule as White's,
 * which is why they share a branch.
 */
export function knocksOut(outcome: BattleOutcome, winningSegment: ResolvedSegment, winningDamage: number | null): boolean {
  if (outcome.winner === null) return false;
  switch (winningSegment.color) {
    case 'white':
    case 'gold':
      return (winningDamage ?? 0) > 0;
    case 'purple':
    case 'blue':
    case 'miss':
      return false;
  }
}
