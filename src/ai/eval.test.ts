import { describe, expect, it } from 'vitest';
import { evaluate } from './eval.js';
import { BOARD } from '../engine/index.js';
import { harness, makeFigure, onField } from '../engine/test/helpers.js';

describe('evaluate', () => {
  it('scores a win, loss and draw from state.result', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { mp: 3 })],
      p1: [makeFigure(2, { mp: 3 })],
    });
    const lost = engine.dispatch(state, { kind: 'concede', player: 0 }).nextState;
    expect(evaluate(lost, 0, BOARD)).toBe(-1);
    expect(evaluate(lost, 1, BOARD)).toBe(1);

    const drawn = {
      ...state,
      result: { winner: null, reason: 'turnLimit' as const, detail: 'draw' },
      phase: 'gameOver' as const,
    };
    expect(evaluate(drawn, 0, BOARD)).toBe(0);
    expect(evaluate(drawn, 1, BOARD)).toBe(0);
  });

  it('prefers a figure closer to the enemy goal', () => {
    const { state } = harness({
      p0: [makeFigure(1, { mp: 3 })],
      p1: [makeFigure(2, { mp: 3 })],
    });
    const close = onField(state, [
      [0, 'r1c0'],
      [1, 'r1c6'],
    ]);
    const far = onField(state, [
      [0, 'r3c0'],
      [1, 'r1c6'],
    ]);
    expect(evaluate(close, 0, BOARD)).toBeGreaterThan(evaluate(far, 0, BOARD));
  });

  it('does not read opponent unused plate identities — only the public count', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { mp: 3 })],
      p1: [makeFigure(2, { mp: 3 })],
    });
    const leaked = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          plates: [{ plateId: 99 as never, used: false }],
        },
      ],
    } as typeof state;
    // Same public unused count (1 vs 0 originally 0 vs 0) would change the score;
    // swapping the hidden id must not. Compare two ids with the same unused count.
    const otherId = {
      ...leaked,
      players: [
        leaked.players[0],
        {
          ...leaked.players[1],
          plates: [{ plateId: 7 as never, used: false }],
        },
      ],
    } as typeof state;
    expect(evaluate(leaked, 0, engine.deps.board)).toBe(evaluate(otherId, 0, engine.deps.board));
  });
});
