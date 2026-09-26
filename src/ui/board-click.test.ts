import { describe, expect, it } from 'vitest';
import type { FigureState, GameState } from '../engine/index.js';
import { contentFigureId, contentPlateId } from '../engine/index.js';
import { bootEngine } from './boot.js';
import { resolveBoardClick, resolveFigureClick } from './board-click.js';
import { resolvedPresets, rivalStrategyDraft } from '../player/presets.js';
import { harness, makeFigure, makePlate, nid, onField, uid } from '../engine/test/helpers.js';

function occupantAt(state: GameState, node: string): FigureState | null {
  return state.figures.find((figure) => figure.zone === 'field' && figure.node === node) ?? null;
}

describe('board click → initiateBattle', () => {
  it('maps select-your-figure then click-adjacent-rival to a no-move initiateBattle', async () => {
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
    const legal = engine.legalCommands(placed);
    const pickA = resolveBoardClick(legal, 0, null, occupantAt(placed, 'r3c0'), nid('r3c0'), undefined);
    expect(pickA).toEqual({ kind: 'select', uid: uid(0) });
    const fight = resolveBoardClick(legal, 0, uid(0), occupantAt(placed, 'r2c0'), nid('r2c0'), undefined);
    expect(fight.kind).toBe('command');
    if (fight.kind !== 'command') throw new Error('expected a command');
    expect(fight.command).toEqual({
      kind: 'initiateBattle',
      player: 0,
      attacker: uid(0),
      defender: uid(2),
    });

    const pickB = resolveBoardClick(legal, 0, null, occupantAt(placed, 'r3c6'), nid('r3c6'), undefined);
    expect(pickB).toEqual({ kind: 'select', uid: uid(1) });
    const fightB = resolveBoardClick(legal, 0, uid(1), occupantAt(placed, 'r2c6'), nid('r2c6'), undefined);
    expect(fightB.kind).toBe('command');
    if (fightB.kind !== 'command') throw new Error('expected a command');
    expect(fightB.command).toMatchObject({
      kind: 'initiateBattle',
      attacker: uid(1),
      defender: uid(3),
    });
  });

  it('after A MP-moves, only A’s adjacent rival click initiates; B’s does not', async () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'A' }), makeFigure(2, { name: 'B' })],
      p1: [makeFigure(3, { name: 'X' }), makeFigure(4, { name: 'Y' })],
    });
    const placed = onField(state, [
      [0, 'r4c0'],
      [1, 'r3c6'],
      [2, 'r2c0'],
      [3, 'r2c6'],
    ]);
    const moved = engine.dispatch(placed, { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r3c0') }).nextState;
    const legal = engine.legalCommands(moved);
    const lock = moved.turn.movedUid;

    const fromA = resolveBoardClick(legal, 0, uid(0), occupantAt(moved, 'r2c0'), nid('r2c0'), undefined, lock);
    expect(fromA.kind).toBe('command');
    if (fromA.kind !== 'command') throw new Error('expected a command');
    expect(fromA.command).toMatchObject({
      kind: 'initiateBattle',
      attacker: uid(0),
      defender: uid(2),
    });

    const pickB = resolveBoardClick(legal, 0, null, occupantAt(moved, 'r3c6'), nid('r3c6'), undefined, lock);
    expect(pickB).toEqual({ kind: 'none' });
    const fromB = resolveBoardClick(legal, 0, uid(1), occupantAt(moved, 'r2c6'), nid('r2c6'), undefined, lock);
    expect(fromB).toEqual({ kind: 'none' });
  });

  it('after A deploys, B cannot be selected to initiate', async () => {
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
    }).nextState;
    const legal = engine.legalCommands(deployed);
    const lock = deployed.turn.movedUid;
    expect(lock).toBe(uid(0));
    expect(resolveBoardClick(legal, 0, null, occupantAt(deployed, 'r3c6'), nid('r3c6'), undefined, lock)).toEqual({
      kind: 'none',
    });
    expect(resolveBoardClick(legal, 0, uid(1), occupantAt(deployed, 'r2c6'), nid('r2c6'), undefined, lock)).toEqual({
      kind: 'none',
    });
  });

  it('picks a field figure for Double Chance from a real Stone Guard table', async () => {
    const engine = await bootEngine();
    const rows = resolvedPresets(engine);
    const frost = rows.find((row) => row.preset.id === 'stone-guard')?.draft;
    const rival = rivalStrategyDraft(engine, 5001, 'stone-guard');
    expect(frost).toBeDefined();
    if (frost === undefined) return;
    let state = engine.createGame({
      seed: 5001,
      startingPlayer: 1,
      decks: {
        0: {
          figures: frost.figures.map(contentFigureId),
          plates: frost.plates.map(contentPlateId),
        },
        1: {
          figures: rival.figures.map(contentFigureId),
          plates: rival.plates.map(contentPlateId),
        },
      },
      allowUnimplemented: true,
    }).nextState;
    const aiDeploy = engine
      .legalCommands(state)
      .find((command) => command.kind === 'deploy' && command.player === 1);
    expect(aiDeploy).toBeDefined();
    if (aiDeploy === undefined) return;
    state = engine.dispatch(state, aiDeploy).nextState;
    const deploy = engine
      .legalCommands(state)
      .find((command) => command.kind === 'deploy' && command.player === 0 && command.uid === 0);
    expect(deploy).toBeDefined();
    if (deploy === undefined || deploy.kind !== 'deploy') return;
    state = engine.dispatch(state, deploy).nextState;
    const decline = engine
      .legalCommands(state)
      .find((command) => command.kind === 'declineBattle' && command.player === 0);
    if (decline !== undefined) state = engine.dispatch(state, decline).nextState;
    for (let steps = 0; state.turn.player !== 0 && state.result === null && steps < 40; steps++) {
      const next = engine.legalCommands(state).find((command) => command.player === 1 && command.kind !== 'concede');
      if (next === undefined) break;
      state = engine.dispatch(state, next).nextState;
    }
    expect(state.turn.player).toBe(0);
    expect(state.figures[0]?.zone).toBe('field');
    const doubleChance = engine
      .legalCommands(state)
      .find((command) => command.kind === 'playPlate' && command.player === 0 && command.slot === 1);
    expect(doubleChance).toBeDefined();
    if (doubleChance === undefined) return;
    state = engine.dispatch(state, doubleChance).nextState;
    expect(state.pending?.kind).toBe('chooseFigures');
    expect(state.pending?.figureOptions).toContain(uid(0));
    const legal = engine.legalCommands(state);
    const occupant = occupantAt(state, deploy.to);
    expect(occupant?.uid).toBe(uid(0));
    const fromNode = resolveBoardClick(legal, 0, null, occupant, deploy.to, undefined);
    expect(fromNode.kind).toBe('command');
    if (fromNode.kind !== 'command') throw new Error('expected a field pick');
    expect(fromNode.command).toMatchObject({
      kind: 'resolveDecision',
      accept: true,
      figures: [uid(0)],
    });
    expect(resolveFigureClick(legal, 0, uid(0)).kind).toBe('command');
  });

  it('does not implicit-declinePlate when a figure is clicked in the plate window', async () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      p0Plates: [
        makePlate(12, 'Choose one of your Pokémon on the field or bench. For this turn, it deals +30 damage', {
          name: 'X Attack',
          endsTurn: false,
        }),
      ],
    });
    const legal = engine.legalCommands(state);
    expect(state.phase).toBe('plateWindow');
    expect(legal.some((command) => command.kind === 'declinePlate')).toBe(true);
    expect(legal.some((command) => command.kind === 'playPlate')).toBe(true);
    expect(resolveFigureClick(legal, 0, uid(0))).toEqual({ kind: 'select', uid: uid(0) });
  });
});
