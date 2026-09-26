import { describe, expect, it } from 'vitest';
import { IllegalCommandError } from './commands.js';
import { harness, makeFigure, nid, onField, uid } from './test/helpers.js';

/** Plain initiateBattle pairs, ignoring Z-Move variants. */
function battlePairs(legal: readonly { kind: string; attacker?: number; defender?: number; zMoveIndex?: number }[]) {
  return legal
    .filter(
      (command): command is { kind: 'initiateBattle'; attacker: number; defender: number } =>
        command.kind === 'initiateBattle' && command.zMoveIndex === undefined,
    )
    .map((command) => [command.attacker, command.defender] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * Two of yours, each already next to a rival:
 *   A (0) r3c0 — X (2) r2c0
 *   B (1) r3c6 — Y (3) r2c6
 */
function twoAdjacentPairs() {
  const { engine, state } = harness({
    p0: [makeFigure(1, { name: 'A' }), makeFigure(2, { name: 'B' })],
    p1: [makeFigure(3, { name: 'X' }), makeFigure(4, { name: 'Y' })],
  });
  const placed = onField(state, [
    [0, 'r3c0'],
    [1, 'r3c6'],
    [2, 'r2c0'],
    [3, 'r2c6'],
  ]);
  return { engine, state: placed };
}

describe('battle initiation', () => {
  it('offers stand-and-fight for every adjacent pair before anyone MP-moves', () => {
    const { engine, state } = twoAdjacentPairs();
    expect(state.phase).toBe('action');
    expect(state.turn.moved).toBe(false);
    expect(state.turn.movedUid).toBeNull();
    expect(battlePairs(engine.legalCommands(state))).toEqual([
      [uid(0), uid(2)],
      [uid(1), uid(3)],
    ]);
  });

  it('after an MP-move, only the figure that walked may initiate', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'A' }), makeFigure(2, { name: 'B' })],
      p1: [makeFigure(3, { name: 'X' }), makeFigure(4, { name: 'Y' })],
    });
    // A walks r4c0 → r3c0 into X; B is already next to Y.
    const placed = onField(state, [
      [0, 'r4c0'],
      [1, 'r3c6'],
      [2, 'r2c0'],
      [3, 'r2c6'],
    ]);
    const moved = engine.dispatch(placed, { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r3c0') });
    expect(moved.nextState.turn.moved).toBe(true);
    expect(moved.nextState.turn.movedUid).toBe(uid(0));
    expect(moved.nextState.phase).toBe('battleDecision');
    expect(battlePairs(engine.legalCommands(moved.nextState))).toEqual([[uid(0), uid(2)]]);
    expect(engine.legalCommands(moved.nextState).some((command) => command.kind === 'declineBattle')).toBe(
      true,
    );

    expect(() =>
      engine.dispatch(moved.nextState, {
        kind: 'initiateBattle',
        player: 0,
        attacker: uid(1),
        defender: uid(3),
      }),
    ).toThrow(IllegalCommandError);
  });

  it('after deploy, only the deployed figure may initiate', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'A' }), makeFigure(2, { name: 'B' })],
      p1: [makeFigure(3, { name: 'X' }), makeFigure(4, { name: 'Y' })],
    });
    const placed = onField(state, [
      [1, 'r3c6'],
      [2, 'r3c0'],
      [3, 'r2c6'],
    ]);
    const deployed = engine.dispatch(placed, {
      kind: 'deploy',
      player: 0,
      uid: uid(0),
      entry: nid('r4c0'),
      to: nid('r4c0'),
    });
    expect(deployed.nextState.turn.moved).toBe(true);
    expect(deployed.nextState.turn.movedUid).toBe(uid(0));
    expect(deployed.nextState.phase).toBe('battleDecision');
    expect(battlePairs(engine.legalCommands(deployed.nextState))).toEqual([[uid(0), uid(2)]]);
    expect(() =>
      engine.dispatch(deployed.nextState, {
        kind: 'initiateBattle',
        player: 0,
        attacker: uid(1),
        defender: uid(3),
      }),
    ).toThrow(IllegalCommandError);
  });

  it('after deploy with no adjacent fight, the turn ends even if another figure is adjacent', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'A' }), makeFigure(2, { name: 'B' })],
      p1: [makeFigure(3, { name: 'X' }), makeFigure(4, { name: 'Y' })],
    });
    const placed = onField(state, [
      [1, 'r3c6'],
      [3, 'r2c6'],
    ]);
    const deployed = engine.dispatch(placed, {
      kind: 'deploy',
      player: 0,
      uid: uid(0),
      entry: nid('r4c0'),
      to: nid('r4c0'),
    }).nextState;
    expect(deployed.turn.player).toBe(1);
    expect(engine.legalCommands(deployed).some((command) => command.kind === 'declineBattle')).toBe(false);
    expect(
      engine.legalCommands(deployed).some(
        (command) => command.kind === 'initiateBattle' && command.attacker === uid(1),
      ),
    ).toBe(false);
  });

  it('rejects a non-adjacent initiateBattle', () => {
    const { engine, state } = twoAdjacentPairs();
    expect(battlePairs(engine.legalCommands(state))).not.toContainEqual([uid(0), uid(3)]);
    expect(() =>
      engine.dispatch(state, {
        kind: 'initiateBattle',
        player: 0,
        attacker: uid(0),
        defender: uid(3),
      }),
    ).toThrow(IllegalCommandError);
  });

  it('starts a no-move battle from the action window without a decline prompt', () => {
    const { engine, state } = twoAdjacentPairs();
    expect(engine.legalCommands(state).some((command) => command.kind === 'declineBattle')).toBe(false);
    const next = engine.dispatch(state, {
      kind: 'initiateBattle',
      player: 0,
      attacker: uid(0),
      defender: uid(2),
    });
    expect(next.nextState.phase).toBe('spin');
    expect(next.nextState.battle?.attacker.uid).toBe(uid(0));
    expect(next.nextState.battle?.defender.uid).toBe(uid(2));
  });

  it('refuses initiation from a figure whose ability forbids battling', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'Wobbuffet', ability: { name: 'Bide', text: 'This Pokémon cannot battle.' } })],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r3c0'], [1, 'r2c0']]);
    expect(battlePairs(engine.legalCommands(placed))).toEqual([]);
    expect(() =>
      engine.dispatch(placed, { kind: 'initiateBattle', player: 0, attacker: uid(0), defender: uid(1) }),
    ).toThrow(IllegalCommandError);
  });
});
