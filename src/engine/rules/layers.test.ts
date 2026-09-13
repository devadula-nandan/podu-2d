import { describe, expect, it } from 'vitest';
import { marker } from '../../content/dsl/primitives.js';
import { MAX_CONDITIONS_PER_FIGURE, MAX_MARKERS_PER_FIGURE, WAIT_TICKS_ON_BOTH_TURNS } from '../../rules/constants.js';
import { applyEvents } from '../reduce.js';
import { figureOf } from '../state.js';
import { harness, makeFigure, nid, onField, uid } from '../test/helpers.js';
import { changeZone, tickTimers } from './zones.js';

describe('special conditions', () => {
  it('holds at most one and replaces rather than stacking', () => {
    expect(MAX_CONDITIONS_PER_FIGURE).toBe(1);
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const poisoned = applyEvents(placed, [
      { kind: 'conditionApplied', uid: uid(0), condition: 'poisoned', replaced: null },
    ]);
    expect(figureOf(poisoned, uid(0)).condition).toBe('poisoned');

    const burned = applyEvents(poisoned, [
      { kind: 'conditionApplied', uid: uid(0), condition: 'burned', replaced: 'poisoned' },
    ]);
    expect(figureOf(burned, uid(0)).condition).toBe('burned');
    expect(figureOf(burned, uid(0)).condition).not.toBe('poisoned');
  });

  it('never expires on a timer tick', () => {
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const afflicted = applyEvents(onField(state, [[0, 'r4c1']]), [
      { kind: 'conditionApplied', uid: uid(0), condition: 'asleep', replaced: null },
    ]);
    const ticked = tickTimers(afflicted);
    expect(figureOf(ticked.state, uid(0)).condition).toBe('asleep');
    expect(ticked.events.some((event) => event.kind === 'conditionCleared')).toBe(false);
  });
});

describe('Wait', () => {
  it('ticks at the start of both players’ turns when WAIT_TICKS_ON_BOTH_TURNS is set', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1), makeFigure(2)],
      p1: [makeFigure(3)],
    });
    const waiting = applyEvents(state, [{ kind: 'waitSet', uid: uid(0), from: 0, to: 3 }]);
    expect(figureOf(waiting, uid(0)).wait).toBe(3);

    const afterP0 = engine.dispatch(waiting, {
      kind: 'deploy',
      player: 0,
      uid: uid(1),
      entry: nid('r4c6'),
      to: nid('r4c6'),
    });
    // P0's action ends the turn (no adjacent enemy), so P1's turn start ticks Wait.
    if (WAIT_TICKS_ON_BOTH_TURNS) {
      expect(figureOf(afterP0.nextState, uid(0)).wait).toBe(2);
    } else {
      expect(figureOf(afterP0.nextState, uid(0)).wait).toBe(3);
    }

    const afterP1 = engine.dispatch(afterP0.nextState, {
      kind: 'deploy',
      player: 1,
      uid: uid(2),
      entry: nid('r0c0'),
      to: nid('r0c0'),
    });
    if (WAIT_TICKS_ON_BOTH_TURNS) {
      expect(figureOf(afterP1.nextState, uid(0)).wait).toBe(1);
    }
  });
});

describe('markers', () => {
  it('holds at most one, replacing the previous', () => {
    expect(MAX_MARKERS_PER_FIGURE).toBe(1);
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const cracked = applyEvents(placed, [
      { kind: 'markerAttached', uid: uid(0), marker: marker('cracked'), value: null, replaced: null },
    ]);
    expect(figureOf(cracked, uid(0)).marker).toEqual({ id: marker('cracked'), value: null });

    const cursed = applyEvents(cracked, [
      {
        kind: 'markerAttached',
        uid: uid(0),
        marker: marker('curse'),
        value: null,
        replaced: marker('cracked'),
      },
    ]);
    expect(figureOf(cursed, uid(0)).marker?.id).toBe(marker('curse'));
  });

  it('clears the marker on leaving the field and keeps the condition and Wait', () => {
    const { state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const prepared = applyEvents(onField(state, [[0, 'r4c1']]), [
      { kind: 'conditionApplied', uid: uid(0), condition: 'burned', replaced: null },
      { kind: 'waitSet', uid: uid(0), from: 0, to: 4 },
      { kind: 'markerAttached', uid: uid(0), marker: marker('photon'), value: null, replaced: null },
    ]);

    const left = changeZone(prepared, uid(0), 'bench', null);
    expect(left.events.some((event) => event.kind === 'markerCleared' && event.marker === 'photon')).toBe(
      true,
    );
    const figure = figureOf(left.state, uid(0));
    expect(figure.zone).toBe('bench');
    expect(figure.marker).toBeNull();
    expect(figure.condition).toBe('burned');
    expect(figure.wait).toBe(4);
  });
});
