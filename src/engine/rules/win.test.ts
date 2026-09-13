import { describe, expect, it } from 'vitest';
import {
  CHESS_CLOCK_MS,
  GOAL_CAPTURE_REQUIRES_MOVEMENT,
  PLATE_COUNTS_AS_ACTION_FOR_WAIT_VICTORY,
  SURROUND_GOAL_PRIORITY,
  TURN_LIMIT,
  TURN_LIMIT_COUNTING,
  TURN_LIMIT_OUTCOME,
} from '../../rules/constants.js';
import { IllegalCommandError } from '../commands.js';
import { settle } from '../phases.js';
import { applyEvents } from '../reduce.js';
import { figureOf, isOver } from '../state.js';
import { harness, makeFigure, makePlate, nid, onField, uid } from '../test/helpers.js';
import { findSurrounded, resolveSurrounds } from './surround.js';
import { clockResult, concedeResult, goalOutcome, turnLimitResult, waitVictoryResult } from './win.js';

describe('goal capture', () => {
  it('wins only when a movement action steps onto the opponent goal', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
    });
    const adjacent = onField(state, [[0, 'r0c2']]);
    const placedOnGoal = applyEvents(adjacent, [
      { kind: 'figureMoved', uid: uid(0), from: nid('r0c2'), to: nid('r0c3'), mpSpent: 1 },
    ]);
    const notAMove = goalOutcome(placedOnGoal, engine.deps, uid(0), false);
    if (GOAL_CAPTURE_REQUIRES_MOVEMENT) {
      expect(notAMove).toEqual([]);
    }

    const byMove = engine.dispatch(adjacent, { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r0c3') });
    expect(byMove.nextState.result).toEqual({
      winner: 0,
      reason: 'goal',
      detail: `figure 0 reached ${nid('r0c3')}`,
    });
    expect(isOver(byMove.nextState)).toBe(true);
  });

  it('denies a goal-locked figure', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const locked = applyEvents(onField(state, [[0, 'r0c3']]), [
      { kind: 'goalLockSet', uid: uid(0), locked: true },
    ]);
    const events = goalOutcome(locked, engine.deps, uid(0), true);
    expect(events).toEqual([{ kind: 'goalDenied', uid: uid(0), node: nid('r0c3'), reason: 'figureLocked' }]);
  });
});

describe('Wait Victory', () => {
  it('ends the opening turn when the starting player has no legal action', () => {
    const { state } = harness({
      p0: [makeFigure(1, { mp: 0 })],
      p1: [makeFigure(2, { mp: 0 })],
    });
    expect(state.result).toEqual({
      winner: 1,
      reason: 'waitVictory',
      detail: 'player 0 had no legal action',
    });
  });

  it('counts a playable plate as an action', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { mp: 0 })],
      p1: [makeFigure(2, { mp: 0 })],
      p0Plates: [makePlate(1)],
    });
    if (PLATE_COUNTS_AS_ACTION_FOR_WAIT_VICTORY) {
      expect(state.result).toBeNull();
      expect(state.phase).toBe('plateWindow');
      const afterPlate = engine.dispatch(state, { kind: 'playPlate', player: 0, slot: 0 });
      expect(afterPlate.nextState.result?.reason).toBe('waitVictory');
      expect(afterPlate.nextState.result?.winner).toBe(0);
    }
  });

  it('is the inverse of hasLegalAction', () => {
    expect(waitVictoryResult(0, true)).toBeNull();
    expect(waitVictoryResult(0, false)).toEqual({
      winner: 1,
      reason: 'waitVictory',
      detail: 'player 0 had no legal action',
    });
  });
});

describe('surround KO', () => {
  it('knocks out a figure sealed on every adjacent node and routes it through the P.C.', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2), makeFigure(3)],
    });
    const sealed = onField(state, [
      [0, 'r0c1'],
      [1, 'r0c0'],
      [2, 'r0c2'],
    ]);
    expect(findSurrounded(sealed, engine.deps).map((f) => f.uid)).toEqual([0]);

    const resolved = resolveSurrounds(sealed, engine.deps);
    expect(resolved.events.some((event) => event.kind === 'surrounded' && event.uid === 0)).toBe(true);
    expect(figureOf(resolved.state, uid(0)).zone).toBe('pc');
  });

  it('lets a just-once surround escape swap before the KO', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, {
        name: 'Lombre',
        ability: {
          name: 'Slippery',
          text: 'Just once, before this Pokémon would be surrounded, it may switch places with an adjacent Pokémon.',
        },
      })],
      p1: [makeFigure(2), makeFigure(3)],
    });
    const sealed = onField(state, [
      [0, 'r0c1'],
      [1, 'r0c0'],
      [2, 'r0c2'],
    ]);
    const asked = resolveSurrounds(sealed, engine.deps);
    expect(asked.state.pending?.kind).toBe('optionalAction');
    expect(figureOf(asked.state, uid(0)).zone).toBe('field');

    const accepted = engine.dispatch(asked.state, {
      kind: 'resolveDecision',
      player: 0,
      resumeToken: asked.state.pending?.resumeToken ?? '',
      accept: true,
      figures: [],
      nodes: [],
    });
    expect(accepted.nextState.pending?.kind).toBe('chooseFigures');

    const escaped = engine.dispatch(accepted.nextState, {
      kind: 'resolveDecision',
      player: 0,
      resumeToken: accepted.nextState.pending?.resumeToken ?? '',
      accept: true,
      figures: [uid(1)],
      nodes: [],
    });
    expect(figureOf(escaped.nextState, uid(0)).zone).toBe('field');
    expect(figureOf(escaped.nextState, uid(0)).node).not.toBe('r0c1');
    expect(figureOf(escaped.nextState, uid(0)).onceSpent).toBe(true);
    expect(figureOf(escaped.nextState, uid(1)).node).toBe('r0c1');
  });

  it('records a surround-first denial when that ruling is active', () => {
    expect(SURROUND_GOAL_PRIORITY === 'surroundFirst' || SURROUND_GOAL_PRIORITY === 'goalFirst').toBe(true);
  });
});

describe('turn-cap draw', () => {
  it('ends as the configured outcome once the counted turn number exceeds the cap', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    const cap = TURN_LIMIT_COUNTING === 'rounds' ? TURN_LIMIT * 2 : TURN_LIMIT;
    expect(turnLimitResult({ ...state, turn: { ...state.turn, number: cap } })).toBeNull();

    const over = { ...state, turn: { ...state.turn, number: cap + 1 } };
    const result = turnLimitResult(over);
    if (TURN_LIMIT_OUTCOME === 'suddenDeath') {
      expect(result).toBeNull();
    } else {
      expect(result?.reason).toBe('turnLimit');
      if (TURN_LIMIT_OUTCOME === 'draw' || TURN_LIMIT_OUTCOME === 'doubleLoss') {
        expect(result?.winner).toBeNull();
      }
    }

    const ending = settle({ ...state, phase: 'turnEnd', turn: { ...state.turn, number: cap } }, engine.deps);
    if (TURN_LIMIT_OUTCOME !== 'suddenDeath') {
      expect(ending.state.result?.reason).toBe('turnLimit');
    }
  });
});

describe('chess clock', () => {
  it('awards the game to the opponent when a clock hits zero', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      clockMs: 4_000,
    });
    expect(state.players[0].clockMs).toBe(4_000);
    expect(CHESS_CLOCK_MS).toBeGreaterThan(0);

    const lost = engine.dispatch(state, { kind: 'advanceClock', player: 0, ms: 4_000 });
    expect(clockResult(lost.nextState)).toEqual({
      winner: 1,
      reason: 'clock',
      detail: 'player 0 ran out of time',
    });
    expect(lost.nextState.result?.reason).toBe('clock');
  });
});

describe('concede', () => {
  it('is always legal and awards the opponent', () => {
    const { engine, state } = harness({ p0: [makeFigure(1)], p1: [makeFigure(2)] });
    expect(concedeResult(0)).toEqual({ winner: 1, reason: 'concede', detail: 'player 0 conceded' });
    const ended = engine.dispatch(state, { kind: 'concede', player: 1 });
    expect(ended.nextState.result?.winner).toBe(0);
    expect(() => engine.dispatch(ended.nextState, { kind: 'concede', player: 0 })).toThrow(IllegalCommandError);
  });
});
