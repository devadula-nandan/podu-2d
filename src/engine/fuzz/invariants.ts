/**
 * Per-dispatch checks the walker runs after every command.
 *
 * `stateProblems` already covers occupancy, P.C. capacity, markers-off-field and
 * clocks. This module re-states those cheaply (so a failure names the rule) and adds
 * the two things the core helper does not: event-fold equality, and "a battle wheel
 * still totals 96".
 */
import { WHEEL_TOTAL_UNITS } from '../../rules/constants.js';
import { applyEvents } from '../reduce.js';
import { hashState } from '../hash.js';
import { wheelTotal } from '../rules/wheel.js';
import type { GameEvent } from '../events.js';
import type { GameState, Phase } from '../state.js';
import { stateProblems } from '../state.js';

export class FuzzInvariantError extends Error {
  readonly seed: number;
  readonly step: number;
  readonly problems: readonly string[];

  constructor(seed: number, step: number, problems: readonly string[]) {
    super(`fuzz invariant break seed=${seed} step=${step}:\n  ${problems.join('\n  ')}`);
    this.name = 'FuzzInvariantError';
    this.seed = seed;
    this.step = step;
    this.problems = problems;
  }
}

/**
 * Checks `stateProblems` does not already make: the reverse phase/result implication,
 * and battle-wheel totals. Occupancy, P.C. ≤ 2, markers-off-field and clocks ≥ 0 are
 * asserted via `stateProblems` on the same call.
 */
export function extraProblems(state: GameState): string[] {
  const problems: string[] = [];

  if (state.phase === 'gameOver' && state.result === null) {
    problems.push('phase is gameOver but result is null');
  }

  if (state.battle !== null) {
    const attacker = wheelTotal(state.battle.attacker.wheel);
    const defender = wheelTotal(state.battle.defender.wheel);
    if (attacker !== WHEEL_TOTAL_UNITS) {
      problems.push(`attacker battle wheel sums to ${attacker}, not ${WHEEL_TOTAL_UNITS}`);
    }
    if (defender !== WHEEL_TOTAL_UNITS) {
      problems.push(`defender battle wheel sums to ${defender}, not ${WHEEL_TOTAL_UNITS}`);
    }
  }

  return problems;
}

export function allStateProblems(state: GameState): string[] {
  return [...stateProblems(state), ...extraProblems(state)];
}

export function notePhases(events: readonly GameEvent[], resting: Phase, into: Set<Phase>): void {
  into.add(resting);
  for (const event of events) {
    if (event.kind === 'phaseChanged') {
      into.add(event.from);
      into.add(event.to);
    }
  }
}

/**
 * `applyEvents(state, events)` must hash to `nextState`. A miss here is a reducer bug,
 * not a rules bug: replays and Time Travel both assume the fold is exact.
 */
export function foldProblems(state: GameState, events: readonly GameEvent[], nextState: GameState): string[] {
  const folded = applyEvents(state, events);
  const foldedHash = hashState(folded);
  const nextHash = hashState(nextState);
  if (foldedHash !== nextHash) {
    return [`applyEvents hash ${foldedHash} !== nextState hash ${nextHash}`];
  }
  return [];
}

export function assertAfterDispatch(
  seed: number,
  step: number,
  before: GameState,
  events: readonly GameEvent[],
  nextState: GameState,
): void {
  const problems = [...allStateProblems(nextState), ...foldProblems(before, events, nextState)];
  if (problems.length > 0) throw new FuzzInvariantError(seed, step, problems);
}
