import { describe, expect, it } from 'vitest';
import { harness, makeFigure } from '../engine/test/helpers.js';
import { clockAdvanceCommand, shouldRunChessClock } from './clock-host.js';

describe('chess clock host', () => {
  it('keeps the clock running while the AI is thinking', () => {
    expect(shouldRunChessClock({ hasHost: true, gameOver: false, handover: false })).toBe(true);
  });

  it('pauses only for a missing host, a finished duel, a hotseat hand-off, or a replay scrub', () => {
    expect(shouldRunChessClock({ hasHost: false, gameOver: false, handover: false })).toBe(false);
    expect(shouldRunChessClock({ hasHost: true, gameOver: true, handover: false })).toBe(false);
    expect(shouldRunChessClock({ hasHost: true, gameOver: false, handover: true })).toBe(false);
    expect(shouldRunChessClock({ hasHost: true, gameOver: false, handover: false, scrubbing: true })).toBe(
      false,
    );
  });

  it('sends measured elapsed ms via advanceClock and the engine subtracts them', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      clockMs: 5_000,
    });
    expect(state.players[0].clockMs).toBe(5_000);

    const command = clockAdvanceCommand(0, 1_250);
    expect(command).toEqual({ kind: 'advanceClock', player: 0, ms: 1250 });

    const next = engine.dispatch(state, command);
    expect(next.nextState.players[0].clockMs).toBe(3_750);
    expect(next.nextState.result).toBeNull();
  });

  it('ends the duel when the measured tick runs a seat out of time', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      clockMs: 800,
    });
    const lost = engine.dispatch(state, clockAdvanceCommand(0, 800));
    expect(lost.nextState.result).toEqual({
      winner: 1,
      reason: 'clock',
      detail: 'player 0 ran out of time',
    });
  });
});
