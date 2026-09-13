/**
 * Caller-owned command/event log: Time Travel, undo and the scrubber share one fold.
 *
 * The engine never stores this log. `rewind` / `replayTo` replay a prefix of events
 * onto the opening state. Commands are the source of truth for "what the players did";
 * `advanceClock` is how time enters, and undo drops the clocks that belong to the
 * undone decision (think-time immediately before it, plus everything after it).
 *
 * Celebi is the same rewind: keep events through the batch that opened the target
 * turn, then apply `timeTravelAftermath`. Chess clocks are *not* restored — the card
 * says remaining time does not change — so current `clockMs` is stamped back on via
 * `clockAdvanced` events after the rewind.
 */
import type { Command, Engine, GameEvent, GameState, PlayerId } from '../engine/index.js';
import { replayTo, rewind, timeTravelAftermath } from '../engine/index.js';

export type LogActor = 'human' | 'ai' | 'clock';

export interface LoggedCommand {
  readonly command: Command;
  readonly who: LogActor;
}

export interface CommandStep extends LoggedCommand {
  readonly events: readonly GameEvent[];
}

export interface ApplyLogResult {
  readonly state: GameState;
  readonly steps: readonly CommandStep[];
  readonly liveEvents: readonly GameEvent[];
}

export function isClockCommand(command: Command): boolean {
  return command.kind === 'advanceClock';
}

export function actorForCommand(command: Command, who: 'human' | 'ai'): LogActor {
  return isClockCommand(command) ? 'clock' : who;
}

export function flattenEvents(steps: readonly Pick<CommandStep, 'events'>[]): GameEvent[] {
  return steps.flatMap((step) => [...step.events]);
}

/**
 * Events through the end of the dispatch that opened `targetTurn`.
 *
 * The opening settle is already folded into `base`, so a request for that turn
 * (or earlier) is an empty prefix.
 */
export function eventsThroughTurnOpen(
  steps: readonly Pick<CommandStep, 'events'>[],
  targetTurn: number,
  openingTurn: number,
): readonly GameEvent[] {
  if (targetTurn <= openingTurn) return [];
  const kept: GameEvent[] = [];
  for (const step of steps) {
    kept.push(...step.events);
    if (step.events.some((event) => event.kind === 'turnBegan' && event.number === targetTurn)) {
      return kept;
    }
  }
  return kept;
}

/** Stamp the live remaining times onto a rewound board. Reducer reads `remaining` only. */
export function retainClockEvents(from: GameState, onto: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  for (const player of [0, 1] as const satisfies readonly PlayerId[]) {
    const remaining = from.players[player].clockMs;
    if (onto.players[player].clockMs !== remaining) {
      events.push({ kind: 'clockAdvanced', player, ms: 0, remaining });
    }
  }
  return events;
}

/**
 * Undo drops the last relevant decision, every `advanceClock` immediately before it
 * (think-time), and every command after it (trailing clocks; in vs-AI, the replies).
 *
 * Relevant = last human command in vs-AI; last non-clock command in hotseat.
 * Folding the returned prefix from the opening state is the undone position.
 */
export function undoCommandPrefix(
  log: readonly LoggedCommand[],
  mode: 'hotseat' | 'vsAi',
): LoggedCommand[] {
  const isTarget = (row: LoggedCommand): boolean =>
    mode === 'vsAi' ? row.who === 'human' : !isClockCommand(row.command);

  let last = -1;
  for (let i = 0; i < log.length; i += 1) {
    const row = log[i];
    if (row !== undefined && isTarget(row)) last = i;
  }
  if (last < 0) return [...log];

  let keep = last;
  while (keep > 0) {
    const prior = log[keep - 1];
    if (prior === undefined || !isClockCommand(prior.command)) break;
    keep -= 1;
  }
  return log.slice(0, keep);
}

export function canUndoLog(log: readonly LoggedCommand[], mode: 'hotseat' | 'vsAi'): boolean {
  return undoCommandPrefix(log, mode).length !== log.length;
}

export function applyLoggedCommand(
  engine: Engine,
  base: GameState,
  state: GameState,
  steps: readonly CommandStep[],
  liveEvents: readonly GameEvent[],
  command: Command,
  who: 'human' | 'ai',
): ApplyLogResult {
  const result = engine.dispatch(state, command);
  const actor = actorForCommand(command, who);
  const nextSteps: CommandStep[] = [...steps, { command, who: actor, events: result.events }];
  const travel = result.events.find(
    (event): event is Extract<GameEvent, { kind: 'timeTravelRequested' }> =>
      event.kind === 'timeTravelRequested',
  );
  if (travel === undefined) {
    return {
      state: result.nextState,
      steps: nextSteps,
      liveEvents: [...liveEvents, ...result.events],
    };
  }

  const targetTurn = Math.max(1, result.nextState.turn.number - 1);
  const prefix = eventsThroughTurnOpen(steps, targetTurn, base.turn.number);
  const rewound = rewind(base, prefix);
  const clockEvents = retainClockEvents(result.nextState, rewound);
  const stamped = replayTo(rewound, clockEvents, clockEvents.length);
  const after = timeTravelAftermath(stamped, travel.uid);
  return {
    state: after.state,
    steps: nextSteps,
    liveEvents: [...prefix, ...clockEvents, ...after.events],
  };
}

export function foldLoggedCommands(
  engine: Engine,
  base: GameState,
  log: readonly LoggedCommand[],
): ApplyLogResult {
  let state = base;
  let steps: readonly CommandStep[] = [];
  let liveEvents: readonly GameEvent[] = [];
  for (const row of log) {
    const who = row.who === 'ai' ? 'ai' : 'human';
    const applied = applyLoggedCommand(engine, base, state, steps, liveEvents, row.command, who);
    state = applied.state;
    steps = applied.steps;
    liveEvents = applied.liveEvents;
  }
  return { state, steps, liveEvents };
}

export function eventLabel(event: GameEvent): string {
  if (event.kind === 'clockAdvanced') return `clock ${event.player === 0 ? 'A' : 'B'} → ${event.remaining}ms`;
  if (event.kind === 'figureDeployed') return `deploy #${event.uid} → ${event.to}`;
  if (event.kind === 'figureMoved') return `move #${event.uid} → ${event.to}`;
  if (event.kind === 'turnBegan') return `turn ${event.number} (${event.player === 0 ? 'A' : 'B'})`;
  if (event.kind === 'phaseChanged') return `${event.from} → ${event.to}`;
  return event.kind;
}
