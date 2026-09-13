import { describe, expect, it } from 'vitest';
import {
  PC_CAPACITY,
  PC_OVERFLOW_IS_FIFO,
  TEMPORARY_EXCLUSION_DEFAULT_TURNS,
  ULTRA_SPACE_FREEZES_TIMERS,
} from '../../rules/constants.js';
import { PC_OVERFLOW_WAIT_TURNS } from '../constants.js';
import { marker } from '../../content/dsl/primitives.js';
import { applyEvents } from '../reduce.js';
import { figureOf, pcFigures } from '../state.js';
import { harness, makeFigure, onField, uid } from '../test/helpers.js';
import {
  changeZone,
  exclude,
  returnExpiredExclusions,
  sendToPc,
  tickTimers,
  timersRun,
} from './zones.js';

describe('P.C.', () => {
  it('holds two figures and evicts the oldest to the bench with Wait', () => {
    expect(PC_CAPACITY).toBe(2);
    const { state } = harness({
      p0: [makeFigure(1), makeFigure(2), makeFigure(3)],
      p1: [makeFigure(4)],
    });

    const first = sendToPc(state, uid(0));
    const second = sendToPc(first.state, uid(1));
    expect(pcFigures(second.state, 0)).toHaveLength(PC_CAPACITY);
    expect(pcFigures(second.state, 0).map((figure) => figure.uid)).toEqual([0, 1]);

    const overflow = sendToPc(second.state, uid(2));
    const inPc = pcFigures(overflow.state, 0);
    expect(inPc).toHaveLength(PC_CAPACITY);

    if (PC_OVERFLOW_IS_FIFO) {
      expect(inPc.map((figure) => figure.uid)).toEqual([1, 2]);
      const evicted = figureOf(overflow.state, uid(0));
      expect(evicted.zone).toBe('bench');
      expect(evicted.wait).toBe(PC_OVERFLOW_WAIT_TURNS);
    }
  });
});

describe('Ultra Space', () => {
  it('retains markers when entering Ultra Space and clears them on the bench', () => {
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const marked = applyEvents(onField(state, [[0, 'r4c1']]), [
      { kind: 'markerAttached', uid: uid(0), marker: marker('curse'), value: null, replaced: null },
    ]);
    expect(figureOf(marked, uid(0)).marker?.id).toBe('curse');

    const parked = changeZone(marked, uid(0), 'ultraSpace', null);
    expect(figureOf(parked.state, uid(0)).zone).toBe('ultraSpace');
    expect(figureOf(parked.state, uid(0)).marker?.id).toBe('curse');
    expect(parked.events.some((event) => event.kind === 'markerCleared')).toBe(false);

    const benched = changeZone(parked.state, uid(0), 'bench', null);
    expect(figureOf(benched.state, uid(0)).marker).toBeNull();
    expect(benched.events.some((event) => event.kind === 'markerCleared')).toBe(true);
  });

  it('freezes Wait and Mega timers and keeps the special condition', () => {
    const { state } = harness({
      p0: [makeFigure(1), makeFigure(2)],
      p1: [makeFigure(3)],
    });
    const prepared = applyEvents(onField(state, [[0, 'r4c1'], [1, 'r4c5']]), [
      { kind: 'conditionApplied', uid: uid(0), condition: 'frozen', replaced: null },
      { kind: 'waitSet', uid: uid(0), from: 0, to: 4 },
      { kind: 'megaTicked', uid: uid(0), turnsLeft: 7 },
      { kind: 'waitSet', uid: uid(1), from: 0, to: 4 },
    ]);
    const parked = changeZone(prepared, uid(0), 'ultraSpace', null);

    expect(figureOf(parked.state, uid(0)).condition).toBe('frozen');
    expect(timersRun(parked.state, uid(0))).toBe(!ULTRA_SPACE_FREEZES_TIMERS);
    expect(timersRun(parked.state, uid(1))).toBe(true);

    const ticked = tickTimers(parked.state);
    if (ULTRA_SPACE_FREEZES_TIMERS) {
      expect(figureOf(ticked.state, uid(0)).wait).toBe(4);
      expect(figureOf(ticked.state, uid(0)).megaTurnsLeft).toBe(7);
      expect(figureOf(ticked.state, uid(1)).wait).toBe(3);
    } else {
      expect(figureOf(ticked.state, uid(0)).wait).toBe(3);
      expect(figureOf(ticked.state, uid(0)).megaTurnsLeft).toBe(6);
    }
    expect(figureOf(ticked.state, uid(0)).condition).toBe('frozen');
  });
});

describe('exclusion', () => {
  it('returns a temporarily excluded figure when its timer expires', () => {
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const gone = exclude(placed, uid(0), 2, 'bench');
    expect(figureOf(gone.state, uid(0)).zone).toBe('excluded');
    expect(figureOf(gone.state, uid(0)).returnOnTurn).toBe(placed.turn.number + 2);
    expect(figureOf(gone.state, uid(0)).returnZone).toBe('bench');

    const tooSoon = returnExpiredExclusions(gone.state);
    expect(figureOf(tooSoon.state, uid(0)).zone).toBe('excluded');

    const due = {
      ...gone.state,
      turn: { ...gone.state.turn, number: placed.turn.number + 2 },
    };
    const back = returnExpiredExclusions(due);
    expect(figureOf(back.state, uid(0)).zone).toBe('bench');
    expect(figureOf(back.state, uid(0)).returnOnTurn).toBeNull();
  });

  it('uses the default duration when a return zone is set but no timer is named', () => {
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const gone = exclude(onField(state, [[0, 'r4c1']]), uid(0), null, 'bench');
    expect(figureOf(gone.state, uid(0)).returnOnTurn).toBe(
      state.turn.number + TEMPORARY_EXCLUSION_DEFAULT_TURNS,
    );
  });

  it('never returns a permanently excluded figure', () => {
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const gone = exclude(onField(state, [[0, 'r4c1']]), uid(0), null, null);
    expect(figureOf(gone.state, uid(0)).returnOnTurn).toBeNull();
    const later = {
      ...gone.state,
      turn: { ...gone.state.turn, number: gone.state.turn.number + 99 },
    };
    expect(figureOf(returnExpiredExclusions(later).state, uid(0)).zone).toBe('excluded');
  });
});
