import { describe, expect, it } from 'vitest';
import { IllegalCommandError } from './commands.js';
import { harness, makeFigure, nid, uid } from './test/helpers.js';

describe('phase machine gaps', () => {
  it('rejects abilityAction and resolveDecision when they are not in the legal set', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const legal = engine.legalCommands(state);
    expect(legal.some((command) => command.kind === 'abilityAction')).toBe(false);
    expect(legal.some((command) => command.kind === 'resolveDecision')).toBe(false);

    expect(() =>
      engine.dispatch(state, { kind: 'abilityAction', player: 0, uid: uid(0), clauseId: 'x' }),
    ).toThrow(IllegalCommandError);

    expect(() =>
      engine.dispatch(state, {
        kind: 'resolveDecision',
        player: 0,
        resumeToken: 'x',
        accept: true,
        figures: [],
        nodes: [],
      }),
    ).toThrow(IllegalCommandError);
  });

  it('rejects a move that is not in the legal set without changing the phase', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    expect(() =>
      engine.dispatch(state, { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r0c3') }),
    ).toThrow(IllegalCommandError);
    expect(state.phase).toBe('action');
  });
});
