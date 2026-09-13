import { describe, expect, it } from 'vitest';
import { Z_GAUGE_MAX } from './constants.js';
import { figureContent } from './content.js';
import { rewind, replayTo, timeTravelAftermath, timeTravelAvailable } from './rewind.js';
import { applyEvents } from './reduce.js';
import { hashState } from './hash.js';
import { figureOf } from './state.js';
import { contentFigureId } from './ids.js';
import { buildWheel } from './rules/wheel.js';
import { harness, makeFigure, nid, onField, uid } from './test/helpers.js';

describe('Z-Moves', () => {
  it('offers a Z-Move battle when the gauge is full and spends it to 0', () => {
    const zMoves = [
      {
        size: 96,
        moveName: 'Catastropika',
        color: 'white' as const,
        damage: { kind: 'fixed' as const, base: 300 },
        notes: 'Z-Move',
        isZMove: true as const,
      },
    ];
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'Pikachu', zMoves })],
      p1: [makeFigure(2)],
    });
    expect(figureContent(engine.content, contentFigureId(1)).figure.zMoves[0]?.color).toBe('white');

    let current = applyEvents(onField(state, [[0, 'r3c0'], [1, 'r2c0']]), [
      { kind: 'zGaugeChanged', player: 0, from: 0, to: Z_GAUGE_MAX },
      { kind: 'phaseChanged', from: state.phase, to: 'battleDecision' },
    ]);
    const zBattle = engine
      .legalCommands(current)
      .find((command) => command.kind === 'initiateBattle' && command.zMoveIndex === 0);
    expect(zBattle).toEqual({
      kind: 'initiateBattle',
      player: 0,
      attacker: uid(0),
      defender: uid(1),
      zMoveIndex: 0,
    });
    if (zBattle === undefined) throw new Error('expected a Z-Move initiateBattle');

    current = engine.dispatch(current, zBattle).nextState;
    expect(current.players[0]?.zGauge).toBe(0);
    expect(current.battle?.attacker.wheel).toHaveLength(1);
    expect(current.battle?.attacker.wheel[0]?.moveName).toBe('Catastropika');
    expect(current.battle?.attacker.wheel[0]?.size).toBe(96);
    expect(current.battle?.attacker.wheel[0]?.color).toBe('white');
  });

  it('applies replaceSegment patches and armed spin shifts (plan: wheel)', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const placed = onField(state, [[0, 'r4c1']]);
    const patched = applyEvents(placed, [
      { kind: 'wheelPatched', uid: uid(0), moveName: 'Tackle', replacement: 'Miss', expiresOnTurn: null },
      {
        kind: 'spinShiftArmed',
        uid: uid(0),
        until: { kind: 'color', colors: ['miss'] },
        expiresOnTurn: null,
      },
    ]);
    const wheel = buildWheel(patched, engine.deps, uid(0));
    const tackle = wheel.find((segment) => segment.moveName === 'Tackle');
    expect(tackle?.color).toBe('miss');
    expect(tackle?.notes.some((note) => /replaceSegment/.test(note))).toBe(true);
    expect(figureOf(patched, uid(0)).spinShifts).toHaveLength(1);
  });
});

describe('Celebi Time Travel', () => {
  it('rewinds from a caller-owned log and does not store that log on GameState', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    expect(state).not.toHaveProperty('log');
    expect(timeTravelAvailable(state)).toBe(true);

    const deployed = engine.dispatch(state, {
      kind: 'deploy',
      player: 0,
      uid: uid(0),
      entry: nid('r4c0'),
      to: nid('r4c0'),
    });
    expect(figureOf(deployed.nextState, uid(0)).zone).toBe('field');

    const rewound = rewind(state, []);
    expect(figureOf(rewound, uid(0)).zone).toBe('bench');
    expect(rewound.turn.number).toBe(state.turn.number);

    const kept = rewind(state, deployed.events);
    expect(figureOf(kept, uid(0)).node).toBe(figureOf(deployed.nextState, uid(0)).node);

    const aftermath = timeTravelAftermath(rewound, uid(0));
    expect(figureOf(aftermath.state, uid(0)).zone).toBe('excluded');
    expect(aftermath.state.timeTravelLockedUntilTurn).toBe(rewound.turn.number + 2);
    expect(timeTravelAvailable(aftermath.state)).toBe(false);
  });

  it('replayTo is rewind of a prefix and matches applyEvents', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const deployed = engine.dispatch(state, {
      kind: 'deploy',
      player: 0,
      uid: uid(0),
      entry: nid('r4c0'),
      to: nid('r4c0'),
    });
    expect(hashState(replayTo(state, deployed.events, 0))).toBe(hashState(state));
    expect(hashState(replayTo(state, deployed.events, deployed.events.length))).toBe(
      hashState(deployed.nextState),
    );
    expect(hashState(replayTo(state, deployed.events, 1_000))).toBe(hashState(deployed.nextState));
  });
});
