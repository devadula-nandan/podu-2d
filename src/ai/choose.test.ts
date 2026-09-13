import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { actorToMove, chooseCommand, defaultAiDeck, DIFFICULTY, playableCommands } from './index.js';
import type { Ability, Figure, Plate } from '../content/schema.js';
import type { Command } from '../engine/index.js';
import { createEngine, isOver, sameCommand } from '../engine/index.js';
import { harness, makeFigure } from '../engine/test/helpers.js';

const TINY = { rollouts: 4, maxDepth: 12, seed: 0x61 } as const;
const SELF_PLAY_TURN_CAP = 60;
const SELF_PLAY_STEP_CAP = 400;

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(`data/content/${name}.json`, 'utf8'));
}

function opening() {
  return harness({
    p0: [makeFigure(1, { mp: 3, name: 'Alpha' }), makeFigure(2, { mp: 3, name: 'Beta' })],
    p1: [makeFigure(3, { mp: 3, name: 'Gamma' }), makeFigure(4, { mp: 3, name: 'Delta' })],
    seed: 0x706f6475,
  });
}

describe('chooseCommand', () => {
  it('is deterministic: same seed + state + budget → same command', () => {
    const { engine, state } = opening();
    const a = chooseCommand(state, 0, { engine, ...TINY });
    const b = chooseCommand(state, 0, { engine, ...TINY });
    expect(sameCommand(a, b)).toBe(true);
    expect(sameCommand(a, chooseCommand(state, 0, { engine, rollouts: 4, maxDepth: 12, seed: 0x61 }))).toBe(
      true,
    );
  });

  it('only returns a command from legalCommands', () => {
    const { engine, state } = opening();
    const legal = engine.legalCommands(state);
    const chosen = chooseCommand(state, 0, { engine, ...TINY });
    expect(legal.some((command) => sameCommand(command, chosen))).toBe(true);
    expect(playableCommands(legal, 0).some((command) => sameCommand(command, chosen))).toBe(true);
  });

  it('Easy and Hard both return legal moves (no claim that Hard always wins)', () => {
    const { engine, state } = opening();
    const legal = engine.legalCommands(state);
    const easy = chooseCommand(state, 0, { engine, difficulty: 'easy', seed: 7 });
    const hard = chooseCommand(state, 0, { engine, difficulty: 'hard', seed: 7 });
    expect(legal.some((command) => sameCommand(command, easy))).toBe(true);
    expect(legal.some((command) => sameCommand(command, hard))).toBe(true);
    expect(easy.kind).not.toBe('advanceClock');
    expect(hard.kind).not.toBe('advanceClock');
  });

  it('self-play of two tiny AIs on no-ability figures reaches game over or the turn cap', () => {
    const { engine, state: start } = opening();
    let state = start;
    let steps = 0;
    const seen: Command[] = [];

    while (!isOver(state) && state.turn.number <= SELF_PLAY_TURN_CAP && steps < SELF_PLAY_STEP_CAP) {
      const legal = engine.legalCommands(state);
      expect(legal.length).toBeGreaterThan(0);
      const actor = actorToMove(state, legal);
      const command = chooseCommand(state, actor, { engine, ...TINY, seed: 0x11 + steps });
      expect(legal.some((candidate) => sameCommand(candidate, command))).toBe(true);
      seen.push(command);
      state = engine.dispatch(state, command).nextState;
      steps += 1;
    }

    expect(steps).toBeGreaterThan(0);
    expect(seen.length).toBe(steps);
    expect(isOver(state) || state.turn.number > SELF_PLAY_TURN_CAP || steps >= SELF_PLAY_STEP_CAP).toBe(true);
  });

  it('never invents an advanceClock command', () => {
    const { engine, state } = opening();
    const chosen = chooseCommand(state, 0, { engine, difficulty: 'easy', seed: 1 });
    expect(chosen.kind).not.toBe('advanceClock');
  });
});

describe('default decks', () => {
  it('picks fully implemented no-ability figures the engine will accept without allowUnimplemented', () => {
    const figures = loadJson('figures') as Figure[];
    const plates = loadJson('plates') as Plate[];
    const abilities = loadJson('abilities') as Ability[];
    const engine = createEngine({ figures, plates, abilities });
    expect(engine.registry.totals.figuresImplemented).toBeGreaterThanOrEqual(1);

    const deck = defaultAiDeck(engine, 6);
    expect(deck).toHaveLength(6);
    for (const id of deck) {
      const support = engine.registry.figures.get(id);
      const entry = engine.content.figures.get(id);
      expect(support?.implemented).toBe(true);
      expect(entry?.figure.ability).toBeNull();
    }

    const opened = engine.createGame({
      seed: 1,
      startingPlayer: 0,
      decks: {
        0: { figures: deck, plates: [] },
        1: { figures: deck, plates: [] },
      },
    });
    expect(opened.nextState.unimplementedClauses).toEqual([]);
    const legal = engine.legalCommands(opened.nextState);
    const command = chooseCommand(opened.nextState, opened.nextState.turn.player, {
      engine,
      rollouts: 2,
      maxDepth: 8,
      seed: 3,
    });
    expect(legal.some((candidate) => sameCommand(candidate, command))).toBe(true);
  });
});

describe('difficulty budgets', () => {
  it('exposes the named Easy / Normal / Hard rollout counts', () => {
    expect(DIFFICULTY.easy.rollouts).toBe(10);
    expect(DIFFICULTY.normal.rollouts).toBe(50);
    expect(DIFFICULTY.hard.rollouts).toBe(200);
  });

  it('logs typical think time on the opening action (documentation, not an assertion)', () => {
    const { engine, state } = opening();
    const samples = ['easy', 'normal'] as const;
    for (const name of samples) {
      const started = performance.now();
      chooseCommand(state, 0, { engine, difficulty: name, seed: 9 });
      const ms = performance.now() - started;
      console.log(`ai ${name}: ${ms.toFixed(1)} ms/turn (${DIFFICULTY[name].rollouts} rollouts)`);
    }
  });
});
