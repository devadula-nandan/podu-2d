/**
 * The four ways a duel ends, plus concession.
 *
 * Each has a trap in it:
 *
 * - **Goal capture is by movement only.** A figure pushed, swapped or teleported onto
 *   the goal by an effect does not win, and three abilities forbid their own figure
 *   from winning there at all - hence the per-figure lockout rather than a global flag.
 * - **Surround outranks the goal.** If one movement both captures the goal and leaves
 *   the mover surrounded, the mover dies and the goal does not count. That is
 *   [Ruling 3](docs/RULES.md) at medium confidence, so it is read from
 *   `SURROUND_GOAL_PRIORITY` and never branched on directly.
 * - **Wait Victory is the absence of a legal action, not a pass.** A player with zero
 *   MP everywhere and nothing to battle loses; a player who *could* play a plate does
 *   not, because a plate counts as an action.
 * - **The turn limit is a low-confidence ruling.** 300 player-turns ending in a draw is
 *   the current reading, and both the number and the outcome come from constants
 *   precisely because that reading is expected to change.
 */
import {
  SURROUND_GOAL_PRIORITY,
  TURN_LIMIT,
  TURN_LIMIT_COUNTING,
  TURN_LIMIT_OUTCOME,
} from '../../rules/constants.js';
import { goalCaptureRequiresMovement } from '../rulings.js';
import type { EngineDeps } from '../effects/context.js';
import type { GameEvent } from '../events.js';
import type { FigureUid, PlayerId } from '../ids.js';
import { opponentOf, PLAYER_IDS } from '../ids.js';
import type { GameResult, GameState } from '../state.js';
import { figureOf } from '../state.js';

/**
 * Did this movement win the game?
 *
 * `movedByAction` is the caller's assertion that a *movement action* put the figure
 * there, which is the whole content of `GOAL_CAPTURE_REQUIRES_MOVEMENT`. Passing it in
 * rather than inferring it from the state keeps effect-driven relocation - swaps,
 * pushes, Teleport - from accidentally scoring.
 */
export function goalOutcome(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  movedByAction: boolean,
): GameEvent[] {
  const figure = figureOf(state, uid);
  if (figure.zone !== 'field' || figure.node === null) return [];

  const target = deps.board.goals[opponentOf(figure.owner)];
  if (figure.node !== target) return [];

  if (goalCaptureRequiresMovement && !movedByAction) return [];
  if (figure.goalLocked) {
    return [{ kind: 'goalDenied', uid, node: figure.node, reason: 'figureLocked' }];
  }
  return [
    { kind: 'goalReached', uid, node: figure.node, player: figure.owner },
    {
      kind: 'gameEnded',
      result: {
        winner: figure.owner,
        reason: 'goal',
        detail: `figure ${uid} reached ${figure.node}`,
      },
    },
  ];
}

/**
 * The goal attempt that a simultaneous surround cancelled.
 *
 * Called when the mover is no longer on the field after the surround check. Emitting
 * the denial rather than staying silent is what makes the two rulings distinguishable
 * in a replay, which is the only way the low-confidence one ever gets corrected.
 */
export function goalDeniedBySurround(uid: FigureUid, node: GameState['figures'][number]['node']): GameEvent[] {
  if (SURROUND_GOAL_PRIORITY !== 'surroundFirst' || node === null) return [];
  return [{ kind: 'goalDenied', uid, node, reason: 'surroundFirst' }];
}

/** A player whose chess clock has run out has lost. Time enters only via `advanceClock`. */
export function clockResult(state: GameState): GameResult | null {
  for (const id of PLAYER_IDS) {
    if (state.players[id].clockMs <= 0) {
      return { winner: opponentOf(id), reason: 'clock', detail: `player ${id} ran out of time` };
    }
  }
  return null;
}

/**
 * Whether the turn cap has been reached, and what that means.
 *
 * `TURN_LIMIT_COUNTING` decides whether 300 counts player-turns or full rounds; the
 * state counts player-turns, so the round reading doubles the threshold rather than
 * changing the counter.
 */
export function turnLimitResult(state: GameState): GameResult | null {
  const cap = TURN_LIMIT_COUNTING === 'rounds' ? TURN_LIMIT * 2 : TURN_LIMIT;
  if (state.turn.number <= cap) return null;

  const detail = `reached the ${cap} player-turn cap`;
  switch (TURN_LIMIT_OUTCOME) {
    case 'draw':
      return { winner: null, reason: 'turnLimit', detail };
    case 'doubleLoss':
      return { winner: null, reason: 'turnLimit', detail: `${detail}: both players lose` };
    case 'mostFiguresOnField': {
      const counts = PLAYER_IDS.map(
        (id) => state.figures.filter((f) => f.owner === id && f.zone === 'field').length,
      );
      const [zero = 0, one = 0] = counts;
      if (zero === one) return { winner: null, reason: 'turnLimit', detail: `${detail}: equal figures on field` };
      return { winner: zero > one ? 0 : 1, reason: 'turnLimit', detail: `${detail}: more figures on field` };
    }
    case 'suddenDeath':
      // Sudden death is a *continuation* rule, not an ending, so there is deliberately
      // no result here. Encoding one would end games the ruling says keep going.
      return null;
  }
}

/**
 * Wait Victory: a player with no legal action loses.
 *
 * `hasLegalAction` is supplied by the phase machine, which is the only thing that knows
 * the full legal set. Inverting the dependency keeps this module from importing the FSM
 * that imports it.
 */
export function waitVictoryResult(player: PlayerId, hasLegalAction: boolean): GameResult | null {
  if (hasLegalAction) return null;
  return {
    winner: opponentOf(player),
    reason: 'waitVictory',
    detail: `player ${player} had no legal action`,
  };
}

export function concedeResult(player: PlayerId): GameResult {
  return { winner: opponentOf(player), reason: 'concede', detail: `player ${player} conceded` };
}
