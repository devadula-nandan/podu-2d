/**
 * Celebi Time Travel is a replay, not a special-case mutator.
 *
 * The event log is owned by the caller — UI, AI, or a server — and is deliberately
 * not stored on `GameState`. Given a prior snapshot and the events that should still
 * have happened, folding them is the rewind. Clock fields ride along in that snapshot,
 * which is what "neither player's remaining time changes" means without the engine
 * reading a wall clock.
 */
import type { GameEvent } from './events.js';
import { applyEvents } from './reduce.js';
import type { EventBatch } from './rules/zones.js';
import { exclude as excludeFigure, extend } from './rules/zones.js';
import type { FigureUid } from './ids.js';
import { figureOf } from './state.js';
import type { GameState } from './state.js';

/**
 * Replay `eventsToKeep` onto `base`. Pure: same inputs, same state.
 *
 * This is `applyEvents` under a name the Time Travel ability can be documented against.
 * Callers who kept a snapshot at the start of the previous turn pass that snapshot and
 * an empty event list; callers who kept the full log pass the prefix they want to keep.
 */
export function rewind(base: GameState, eventsToKeep: readonly GameEvent[]): GameState {
  return applyEvents(base, eventsToKeep);
}

/**
 * Replay the first `keep` events of a caller-owned log onto `base`.
 *
 * Time Travel, undo and the scrubber all go through this. `keep === 0` is `base`;
 * `keep === log.length` folds the whole log. The log never lives on `GameState`.
 */
export function replayTo(base: GameState, log: readonly GameEvent[], keep: number): GameState {
  const n = Math.max(0, Math.min(keep, log.length));
  return rewind(base, log.slice(0, n));
}

/**
 * Aftermath of Time Travel after the caller has rewound: exclude Celebi and lock the
 * ability until the end of the opponent's next turn (`turn.number + 2`).
 *
 * Kept separate from `rewind` so the engine never needs the log to apply the cost.
 */
export function timeTravelAftermath(state: GameState, celebiUid: FigureUid): EventBatch {
  const figure = figureOf(state, celebiUid);
  let batch = excludeFigure(state, celebiUid, null, null);
  batch = extend(batch, [
    { kind: 'timeTravelLocked', untilTurn: state.turn.number + 2 },
    { kind: 'timeTravelRequested', uid: celebiUid },
    { kind: 'actionTaken', player: figure.owner, uid: celebiUid },
  ]);
  return batch;
}

export function timeTravelAvailable(state: GameState): boolean {
  const locked = state.timeTravelLockedUntilTurn;
  return locked === null || state.turn.number >= locked;
}
