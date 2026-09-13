import { describe, expect, it } from 'vitest';
import { EngineError } from './state.js';
import { UnimplementedContentError } from './effects/registry.js';
import {
  figureDeckIssues,
  isDeckLimitExempt,
  isFormOnlyFigure,
  plateCostTowardBudget,
  plateDeckCost,
  plateDeckIssues,
  plateStandIn,
  usedPlateSlots,
} from './plates.js';
import { applyEvents } from './reduce.js';
import { harness, makeFigure, makePlate, uid } from './test/helpers.js';

describe('plates', () => {
  it('treats a Mega Stone null cost as zero toward the budget of 8', () => {
    const stone = makePlate(1, 'mega evolve this Pokémon for 7 turns', { cost: null, name: 'Charizardite X' });
    expect(plateCostTowardBudget(stone)).toBe(0);
    expect(plateDeckIssues([stone, makePlate(2), makePlate(3)])).toEqual([]);
    expect(plateDeckCost([stone, ...Array.from({ length: 5 }, (_, i) => makePlate(10 + i))])).toBe(5);
    expect(plateDeckIssues(Array.from({ length: 6 }, (_, i) => makePlate(20 + i, 'Your turn ends.', { cost: 2 })))).toEqual([
      'plate cost 12 exceeds the budget of 8',
    ]);
  });

  it('rejects a seventh plate and a form-only figure in a primary slot', () => {
    expect(plateDeckIssues(Array.from({ length: 7 }, (_, i) => makePlate(i + 1)))).toEqual([
      '7 plates; the deck has 6 slots',
    ]);

    const formOnly = makeFigure(1, {
      ability: { name: 'Form', text: 'This Pokémon can only be set as a form. Your turn ends.' },
    });
    expect(isFormOnlyFigure(formOnly)).toBe(true);
    expect(() => harness({ p0: [formOnly], p1: [makeFigure(2)], allowUnimplemented: true })).toThrow(EngineError);
  });

  it('enforces the 3-copy name limit unless the printed exemption is on the figure', () => {
    const copies = [1, 2, 3, 4].map((id) => makeFigure(id, { name: 'Pikachu' }));
    expect(figureDeckIssues(copies.slice(0, 3))).toEqual([]);
    expect(figureDeckIssues(copies)).toEqual([
      '4 copies of Pikachu; the 3 Pokémon limit allows 3',
    ]);
    const exempt = makeFigure(5, {
      name: 'Unown',
      ability: {
        name: 'Shape',
        text: 'Once per turn, you can force your opponent to spin again. The 3 Pokémon limit does not apply to this Pokémon in your deck.',
      },
    });
    expect(isDeckLimitExempt(exempt)).toBe(true);
    expect(figureDeckIssues([exempt, exempt, exempt, exempt])).toEqual([]);
    expect(() =>
      harness({
        p0: copies,
        p1: [makeFigure(9)],
        allowUnimplemented: true,
      }),
    ).toThrow(EngineError);
  });

  it('plays a plate with no field figure using the lowest-uid owned stand-in', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1), makeFigure(3)],
      p1: [makeFigure(2)],
      p0Plates: [makePlate(50, 'Your turn ends.')],
    });
    expect(state.phase).toBe('plateWindow');
    expect(state.figures.every((figure) => figure.zone === 'bench')).toBe(true);
    expect(plateStandIn(state, 0)).toBe(0);

    const played = engine.dispatch(state, { kind: 'playPlate', player: 0, slot: 0 });
    expect(played.nextState.players[0]?.plates[0]?.used).toBe(true);
    expect(played.events.some((event) => event.kind === 'platePlayed')).toBe(true);
    expect(played.events.some((event) => event.kind === 'turnForcedEnd')).toBe(true);
  });

  it('asks which figure Double Chance grants a respin, then leaves the plate window', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'Machop' }), makeFigure(3, { name: 'Sylveon' })],
      p1: [makeFigure(2, { name: 'Riolu' })],
      p0Plates: [
        makePlate(
          7,
          'Choose a Pokémon on the field or bench. (You cannot select unusable Pokémon) For this turn, you can choose to respin once for it.',
          { name: 'Double Chance', endsTurn: false },
        ),
      ],
    });
    const played = engine.dispatch(state, { kind: 'playPlate', player: 0, slot: 0 });
    expect(played.nextState.pending?.kind).toBe('chooseFigures');
    expect(played.nextState.phase).toBe('plateWindow');
    const token = played.nextState.pending?.resumeToken ?? '';
    const picked = engine.dispatch(played.nextState, {
      kind: 'resolveDecision',
      player: 0,
      resumeToken: token,
      accept: true,
      figures: [uid(1)],
      nodes: [],
    });
    expect(picked.nextState.pending).toBeNull();
    expect(picked.nextState.phase).toBe('action');
    expect(picked.nextState.figures[1]?.lingering?.some((effect) =>
      effect.actions.some((action) => action.do === 'respin'),
    )).toBe(true);
  });

  it('asks which figure X Attack buffs instead of hanging it on the lowest-uid bench slot', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'Machop' }), makeFigure(3, { name: 'Sylveon' })],
      p1: [makeFigure(2, { name: 'Riolu' })],
      p0Plates: [
        makePlate(12, 'Choose one of your Pokémon on the field or bench. For this turn, it deals +30 damage', {
          name: 'X Attack',
          endsTurn: false,
        }),
      ],
    });
    expect(state.phase).toBe('plateWindow');
    const played = engine.dispatch(state, { kind: 'playPlate', player: 0, slot: 0 });
    expect(played.nextState.players[0]?.plates[0]?.used).toBe(true);
    expect(played.nextState.pending?.kind).toBe('chooseFigures');
    expect(played.nextState.figures[0]?.lingering ?? []).toEqual([]);
    const token = played.nextState.pending?.resumeToken ?? '';
    const picked = engine.dispatch(played.nextState, {
      kind: 'resolveDecision',
      player: 0,
      resumeToken: token,
      accept: true,
      figures: [uid(1)],
      nodes: [],
    });
    expect(picked.nextState.pending).toBeNull();
    expect(picked.nextState.figures[1]?.lingering?.some((effect) =>
      effect.actions.some((action) => action.do === 'modifyDamage'),
    )).toBe(true);
    expect(picked.nextState.figures[0]?.lingering ?? []).toEqual([]);
    expect(picked.nextState.phase).toBe('action');
  });

  it('is once per duel unless refreshPlate restores a used slot', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      p0Plates: [
        makePlate(1, 'Your turn ends.'),
        makePlate(2, 'One of your plates will switch from used to unused.', { endsTurn: true }),
      ],
    });
    const afterFirst = engine.dispatch(state, { kind: 'playPlate', player: 0, slot: 0 });
    expect(usedPlateSlots(afterFirst.nextState, 0, 2)).toEqual([0]);

    let current = afterFirst.nextState;
    for (let steps = 0; current.phase !== 'plateWindow' || current.turn.player !== 0; steps++) {
      if (steps > 40) throw new Error('did not return to player 0 plate window');
      const legal = engine.legalCommands(current);
      const declinePlate = legal.find((command) => command.kind === 'declinePlate');
      const declineBattle = legal.find((command) => command.kind === 'declineBattle');
      const move = legal.find((command) => command.kind === 'mpMove' || command.kind === 'deploy');
      const next = declinePlate ?? declineBattle ?? move;
      if (next === undefined) throw new Error(`no progress command in phase ${current.phase}`);
      current = engine.dispatch(current, next).nextState;
    }
    expect(current.phase).toBe('plateWindow');
    const refreshed = engine.dispatch(current, { kind: 'playPlate', player: 0, slot: 1 });
    expect(refreshed.nextState.players[0]?.plates[0]?.used).toBe(false);
    expect(refreshed.nextState.players[0]?.plates[1]?.used).toBe(true);
  });

  it('honours plate lockout and refuses an unimplemented plate on the default path', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      p0Plates: [makePlate(1)],
    });
    const locked = applyEvents(state, [{ kind: 'platesLocked', player: 0, untilTurn: 99 }]);
    expect(engine.legalCommands(locked).some((command) => command.kind === 'playPlate')).toBe(false);

    expect(() =>
      harness({
        p0: [makeFigure(1)],
        p1: [makeFigure(2)],
        p0Plates: [makePlate(9, 'This plate teleports every figure to Mars.')],
      }),
    ).toThrow(UnimplementedContentError);
  });
});
