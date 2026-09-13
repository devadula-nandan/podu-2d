/**
 * Zone transitions: Bench, Field, P.C., Excluded, Ultra Space.
 *
 * Every route between zones goes through this module, because the interesting rules are
 * all in the transitions rather than in the zones:
 *
 * - A knockout is not "remove from board", it is a P.C. arrival that can *evict* a
 *   third figure - FIFO, not the player's choice - and the evicted one lands on the
 *   bench carrying a Wait.
 * - A marker is cleared on leaving the field *or* Ultra Space for bench / P.C. /
 *   excluded. Ultra Space retains markers (and conditions); that is the ruling the
 *   previous clear-on-any-exit stub contradicted.
 * - Exclusion can be temporary with a return timer (Rampager 5 turns, Inferno Ladder 7),
 *   so "excluded" is not always terminal.
 * - Ultra Space retains markers and conditions but freezes Wait and Mega timers, so the
 *   tick loop has to ask the zone before counting down.
 */
import { PC_CAPACITY, TEMPORARY_EXCLUSION_DEFAULT_TURNS } from '../../rules/constants.js';
import { ultraSpaceFreezesTimers } from '../rulings.js';
import type { Zone } from '../../content/dsl/primitives.js';
import { PC_OVERFLOW_WAIT_TURNS } from '../constants.js';
import type { GameEvent, KnockOutCause } from '../events.js';
import type { FigureUid, NodeId } from '../ids.js';
import { applyEvents } from '../reduce.js';
import type { GameState } from '../state.js';
import { figureOf, pcFigures } from '../state.js';

export interface EventBatch {
  readonly events: readonly GameEvent[];
  readonly state: GameState;
}

export const emptyBatch = (state: GameState): EventBatch => ({ events: [], state });

/** Markers persist on the field and in Ultra Space; they clear on every other zone. */
export const retainsMarkers = (zone: Zone): boolean => zone === 'field' || zone === 'ultraSpace';

/** Append a batch of events to a running batch, keeping state and log in step. */
export function extend(batch: EventBatch, events: readonly GameEvent[]): EventBatch {
  if (events.length === 0) return batch;
  return { events: [...batch.events, ...events], state: applyEvents(batch.state, events) };
}

export function concatBatches(first: EventBatch, second: EventBatch): EventBatch {
  return { events: [...first.events, ...second.events], state: second.state };
}

/**
 * Whether this figure's turn-scoped timers advance.
 *
 * Ultra Space freezes Wait and Mega duration. Everything else - conditions, markers -
 * is retained either way, which is why this is a timer question and not a zone question.
 */
export function timersRun(state: GameState, uid: FigureUid): boolean {
  const figure = figureOf(state, uid);
  return !(ultraSpaceFreezesTimers && figure.zone === 'ultraSpace');
}

/**
 * Move a figure between zones, emitting the marker clear that leaving the field forces.
 *
 * The explicit `markerCleared` is not redundant with the reducer's defensive clear: the
 * event log is what the rules inspector and the replay read, and "the marker vanished
 * because of a zone change" needs to be visible there rather than inferable.
 */
export function changeZone(state: GameState, uid: FigureUid, to: Zone, node: NodeId | null): EventBatch {
  const figure = figureOf(state, uid);
  if (figure.zone === to && figure.node === node) return emptyBatch(state);

  const events: GameEvent[] = [];
  if (retainsMarkers(figure.zone) && !retainsMarkers(to) && figure.marker !== null) {
    events.push({ kind: 'markerCleared', uid, marker: figure.marker.id });
  }
  const pcOrder = to === 'pc' ? state.pcCounter : null;
  events.push({ kind: 'zoneChanged', uid, from: figure.zone, to, node: to === 'field' ? node : null, pcOrder });
  return extend(emptyBatch(state), events);
}

/**
 * Send a figure to its owner's P.C., evicting the oldest occupant if it is full.
 *
 * The eviction is deliberately not a choice. `PC_OVERFLOW_IS_FIFO` records that the
 * game picks "the Pokemon on the Pokemon Center closest to the summoning bench", which
 * is the first one that arrived, and making it a decision would both invent an option
 * and give the AI a branch the real game does not have.
 */
export function sendToPc(state: GameState, uid: FigureUid): EventBatch {
  const figure = figureOf(state, uid);
  let batch = emptyBatch(state);

  const occupants = pcFigures(state, figure.owner);
  if (occupants.length >= PC_CAPACITY) {
    const oldest = occupants[0];
    if (oldest !== undefined) {
      batch = concatBatches(batch, changeZone(batch.state, oldest.uid, 'bench', null));
      batch = extend(batch, [
        { kind: 'waitSet', uid: oldest.uid, from: oldest.wait, to: PC_OVERFLOW_WAIT_TURNS },
        { kind: 'figureReturned', uid: oldest.uid, to: 'bench' },
      ]);
    }
  }
  return concatBatches(batch, changeZone(batch.state, uid, 'pc', null));
}

/** A knockout, from whatever cause. Always routes through the P.C. */
export function knockOut(state: GameState, uid: FigureUid, cause: KnockOutCause): EventBatch {
  const figure = figureOf(state, uid);
  if (figure.zone !== 'field') return emptyBatch(state);
  const batch = extend(emptyBatch(state), [{ kind: 'figureKnockedOut', uid, cause }]);
  return concatBatches(batch, sendToPc(batch.state, uid));
}

/**
 * Remove a figure from the duel, permanently or with a return timer.
 *
 * `returnAfterTurns === null` is permanent exclusion; a number schedules a return to
 * `returnZone`. The fallback duration is the longer of the two the corpus contains, so
 * a missing timer can never bring a figure back early.
 */
export function exclude(
  state: GameState,
  uid: FigureUid,
  returnAfterTurns: number | null,
  returnZone: Zone | null,
  returnWhenUid: FigureUid | null = null,
): EventBatch {
  const timed = returnWhenUid === null && returnZone !== null;
  const turns = timed ? (returnAfterTurns ?? TEMPORARY_EXCLUSION_DEFAULT_TURNS) : null;
  let batch = changeZone(state, uid, 'excluded', null);
  batch = extend(batch, [
    {
      kind: 'figureExcluded',
      uid,
      returnOnTurn: turns === null ? null : state.turn.number + turns,
      returnZone,
      ...(returnWhenUid !== null ? { returnWhenUid } : {}),
    },
  ]);
  return batch;
}

/** Desolate Land: bring back anyone waiting on this figure leaving the field. */
export function returnExclusionsFor(state: GameState, sourceUid: FigureUid): EventBatch {
  let batch = emptyBatch(state);
  for (const figure of state.figures) {
    if (figure.zone !== 'excluded' || figure.returnWhenUid !== sourceUid) continue;
    const dest = figure.returnZone ?? 'bench';
    batch = concatBatches(
      batch,
      dest === 'pc' ? sendToPc(batch.state, figure.uid) : changeZone(batch.state, figure.uid, dest, null),
    );
    batch = extend(batch, [{ kind: 'figureReturned', uid: figure.uid, to: dest }]);
  }
  return batch;
}

/** Called at the start of every turn: bring back anything whose exclusion timer expired. */
export function returnExpiredExclusions(state: GameState): EventBatch {
  let batch = emptyBatch(state);
  for (const figure of state.figures) {
    if (figure.zone !== 'excluded') continue;
    if (figure.returnOnTurn === null || figure.returnZone === null) continue;
    if (batch.state.turn.number < figure.returnOnTurn) continue;
    batch = concatBatches(
      batch,
      figure.returnZone === 'pc'
        ? sendToPc(batch.state, figure.uid)
        : changeZone(batch.state, figure.uid, figure.returnZone, null),
    );
    batch = extend(batch, [{ kind: 'figureReturned', uid: figure.uid, to: figure.returnZone }]);
  }
  return batch;
}

/**
 * Tick Wait and Mega on every figure whose timers are running.
 *
 * `WAIT_TICKS_ON_BOTH_TURNS` is why this runs at the start of *every* turn rather than
 * only the owner's: Wait 4 costs two of your own turns, not four, and a version that
 * ticks on your turns only would double every Wait in the game.
 */
export function tickTimers(state: GameState, skipMega: ReadonlySet<FigureUid> = new Set()): EventBatch {
  let batch = emptyBatch(state);
  for (const figure of state.figures) {
    if (!timersRun(batch.state, figure.uid)) continue;
    const events: GameEvent[] = [];
    if (figure.wait > 0) events.push({ kind: 'waitSet', uid: figure.uid, from: figure.wait, to: figure.wait - 1 });
    if (figure.megaTurnsLeft !== null && !skipMega.has(figure.uid)) {
      const left = figure.megaTurnsLeft - 1;
      events.push({ kind: 'megaTicked', uid: figure.uid, turnsLeft: left > 0 ? left : null });
    }
    batch = extend(batch, events);
  }
  return batch;
}
