import { describe, expect, it } from 'vitest';
import { harness, makeFigure, makePlate, nid, onField, uid } from './test/helpers.js';

describe('canonical turn flow', () => {
  it('offers plates and MP-moves together, and forbids plate after a move', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'A' }), makeFigure(2, { name: 'B' })],
      p1: [makeFigure(3, { name: 'X' })],
      p0Plates: [
        makePlate(12, 'Choose one of your Pokémon on the field or bench. For this turn, it deals +30 damage', {
          name: 'X Attack',
          endsTurn: false,
        }),
      ],
    });
    const placed = onField(state, [
      [0, 'r4c0'],
      [1, 'r4c6'],
      [2, 'r2c0'],
    ]);
    expect(placed.phase).toBe('plateWindow');
    const before = engine.legalCommands(placed);
    expect(before.some((command) => command.kind === 'playPlate')).toBe(true);
    expect(before.some((command) => command.kind === 'mpMove' && command.uid === uid(0))).toBe(true);
    expect(before.some((command) => command.kind === 'mpMove' && command.uid === uid(1))).toBe(true);
    expect(before.some((command) => command.kind === 'declineBattle')).toBe(false);

    const played = engine.dispatch(placed, { kind: 'playPlate', player: 0, slot: 0 }).nextState;
    expect(played.phase === 'plateWindow' || played.pending !== null).toBe(true);
    const token = played.pending?.resumeToken ?? '';
    const afterPlate =
      played.pending === null
        ? played
        : engine.dispatch(played, {
            kind: 'resolveDecision',
            player: 0,
            resumeToken: token,
            accept: true,
            figures: [uid(0)],
            nodes: [],
          }).nextState;
    expect(afterPlate.turn.moved).toBe(false);
    expect(engine.legalCommands(afterPlate).some((command) => command.kind === 'mpMove')).toBe(true);
    expect(engine.legalCommands(afterPlate).some((command) => command.kind === 'playPlate')).toBe(false);

    const moved = engine.dispatch(afterPlate, { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r3c0') }).nextState;
    expect(moved.turn.moved).toBe(true);
    expect(engine.legalCommands(moved).some((command) => command.kind === 'playPlate')).toBe(false);
  });

  it('after deploy with no adjacent fight, the turn ends without declineBattle', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'A' }), makeFigure(2, { name: 'B' })],
      p1: [makeFigure(3, { name: 'X' })],
    });
    const placed = onField(state, [[1, 'r4c6'], [2, 'r0c6']]);
    const deployed = engine.dispatch(placed, {
      kind: 'deploy',
      player: 0,
      uid: uid(0),
      entry: nid('r4c0'),
      to: nid('r4c0'),
    }).nextState;
    expect(deployed.turn.player).toBe(1);
    expect(deployed.turn.movedUid).toBeNull();
    expect(engine.legalCommands(deployed).some((command) => command.kind === 'declineBattle')).toBe(false);
  });

  it('after mpMove with no adjacent fight, the turn ends without declineBattle', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'A' })],
      p1: [makeFigure(2, { name: 'X' })],
    });
    const placed = onField(state, [
      [0, 'r4c0'],
      [1, 'r0c6'],
    ]);
    const moved = engine.dispatch(placed, { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r3c0') }).nextState;
    expect(moved.turn.player).toBe(1);
    expect(moved.phase === 'plateWindow' || moved.phase === 'action').toBe(true);
    expect(engine.legalCommands(moved).some((command) => command.kind === 'declineBattle')).toBe(false);
  });

  it('after mpMove, plates and other figures are blocked; End turn is declineBattle', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'A' }), makeFigure(2, { name: 'B' })],
      p1: [makeFigure(3, { name: 'X' }), makeFigure(4, { name: 'Y' })],
      p0Plates: [
        makePlate(12, 'Choose one of your Pokémon on the field or bench. For this turn, it deals +30 damage', {
          name: 'X Attack',
          endsTurn: false,
        }),
      ],
    });
    const placed = onField(state, [
      [0, 'r4c0'],
      [1, 'r3c6'],
      [2, 'r2c0'],
      [3, 'r2c6'],
    ]);
    const moved = engine.dispatch(placed, { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r3c0') }).nextState;
    expect(moved.phase).toBe('battleDecision');
    expect(moved.turn.movedUid).toBe(uid(0));
    const legal = engine.legalCommands(moved);
    expect(legal.some((command) => command.kind === 'playPlate')).toBe(false);
    expect(legal.some((command) => command.kind === 'mpMove')).toBe(false);
    expect(
      legal.some((command) => command.kind === 'initiateBattle' && command.attacker === uid(1)),
    ).toBe(false);
    expect(
      legal.some(
        (command) =>
          command.kind === 'initiateBattle' && command.attacker === uid(0) && command.defender === uid(2),
      ),
    ).toBe(true);
    expect(legal.some((command) => command.kind === 'declineBattle' && command.player === 0)).toBe(true);
    expect(legal.some((command) => command.kind === 'declineBattle' && command.player === 1)).toBe(false);
  });
});
