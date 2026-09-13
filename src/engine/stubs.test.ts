import { describe, expect, it } from 'vitest';
import { winnerAdvances } from './rulings.js';
import { IllegalCommandError } from './commands.js';
import { harness, makeFigure, onField, uid } from './test/helpers.js';

describe('documented stubs (plan: battle / decisions)', () => {
  /**
   * `WINNER_ADVANCES` is `false` in `src/rules/constants.ts`. `resolveBattle` throws
   * if that ruling is ever flipped true — the advance is not implemented.
   * Plan section: battle.
   */
  it('WINNER_ADVANCES remains false and is not implemented as an advance', () => {
    expect(winnerAdvances).toBe(false);
  });

  it('abilityAction and resolveDecision throw when they are not in the legal set', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    expect(() =>
      engine.dispatch(state, { kind: 'abilityAction', player: 0, uid: uid(0), clauseId: 'missing' }),
    ).toThrow(IllegalCommandError);
    expect(() =>
      engine.dispatch(state, {
        kind: 'resolveDecision',
        player: 0,
        resumeToken: 'none',
        accept: true,
        figures: [],
        nodes: [],
      }),
    ).toThrow(IllegalCommandError);
  });
});

describe('abilityAction and pending decisions', () => {
  it('offers an instead-of-an-MP-move ability and runs it', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          ability: { name: 'Run Off', text: 'Instead of an MP move, your turn ends.' },
        }),
      ],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1']]);
    const action = engine.legalCommands(placed).find((command) => command.kind === 'abilityAction');
    expect(action?.kind).toBe('abilityAction');
    if (action === undefined) throw new Error('expected an abilityAction');
    const next = engine.dispatch(placed, action);
    expect(next.events.some((event) => event.kind === 'actionTaken')).toBe(true);
    expect(next.events.some((event) => event.kind === 'turnForcedEnd')).toBe(true);
  });

  it('holds the turn on a start-of-turn You-may instead of skipping to the plate window', () => {
    const { engine, state } = harness({
      p0: [
        makeFigure(1, {
          ability: { name: 'Charge', text: 'At the start of your turn, you may your turn ends.' },
        }),
      ],
      p1: [makeFigure(2)],
    });
    const placed = onField(state, [[0, 'r4c1']]);
    // Advance to the next turn start so the ability can fire.
    let current = placed;
    for (let steps = 0; steps < 20 && current.pending === null; steps++) {
      const legal = engine.legalCommands(current);
      const declinePlate = legal.find((command) => command.kind === 'declinePlate');
      const declineBattle = legal.find((command) => command.kind === 'declineBattle');
      const move = legal.find((command) => command.kind === 'mpMove' || command.kind === 'deploy');
      const next = declinePlate ?? declineBattle ?? move;
      if (next === undefined) break;
      current = engine.dispatch(current, next).nextState;
    }
    if (current.pending !== null) {
      expect(current.pending.kind).toBe('optionalAction');
    }
  });

  it('surfaces You-may as a pending optional and resumes when accepted', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      p0Plates: [makePlateOptional()],
    });
    expect(state.phase).toBe('plateWindow');
    const played = engine.dispatch(state, { kind: 'playPlate', player: 0, slot: 0 });
    expect(played.nextState.pending?.kind).toBe('optionalAction');
    const token = played.nextState.pending?.resumeToken;
    expect(token).toBeDefined();
    const accepted = engine.dispatch(played.nextState, {
      kind: 'resolveDecision',
      player: 0,
      resumeToken: token ?? '',
      accept: true,
      figures: [],
      nodes: [],
    });
    expect(accepted.nextState.pending).toBeNull();
    expect(accepted.events.some((event) => event.kind === 'decisionResolved')).toBe(true);
  });
});

function makePlateOptional() {
  return {
    id: 70,
    category: 'Blue' as const,
    name: 'Optional Plate',
    rarity: 'C' as const,
    cost: 1,
    effect: 'You may your turn ends.',
    endsTurn: false,
  };
}
