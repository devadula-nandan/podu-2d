import { describe, expect, it } from 'vitest';
import { aiSeedFrom, chooseCommand } from '../ai/index.js';
import type { Command } from '../engine/index.js';
import { contentFigureId, hashState } from '../engine/index.js';
import { bootEngine, starterFigureIds } from './boot.js';
import { actorOf } from './model.js';
import { aiShouldAct, drainAi, rejectNeedlessConcede } from './ai-loop.js';

describe('ai loop helpers', () => {
  it('refuses concede when another command is legal', () => {
    const legal: Command[] = [
      { kind: 'declinePlate', player: 1 },
      { kind: 'concede', player: 1 },
    ];
    expect(rejectNeedlessConcede(legal, 1, { kind: 'concede', player: 1 }).kind).toBe('declinePlate');
    expect(rejectNeedlessConcede(legal, 1, { kind: 'declinePlate', player: 1 }).kind).toBe('declinePlate');
  });

  it('replays the same Easy replies for the same seed and human commands', async () => {
    const engine = bootEngine();
    const starters = starterFigureIds(engine);
    const setup = {
      seed: 2,
      startingPlayer: 0 as const,
      decks: {
        0: { figures: starters[0].map(contentFigureId), plates: [] },
        1: { figures: starters[1].map(contentFigureId), plates: [] },
      },
    };

    const play = async (): Promise<{ labels: string[]; hash: string }> => {
      let state = engine.createGame(setup).nextState;
      const labels: string[] = [];
      const choose = (
        current: typeof state,
        playerId: 0 | 1,
        seed: number,
      ): Promise<Command> => Promise.resolve(chooseCommand(current, playerId, { engine, difficulty: 'easy', seed }));

      await drainAi({
        engine,
        getState: () => state,
        apply: (command) => {
          state = engine.dispatch(state, command).nextState;
          labels.push(`${command.kind}:${aiSeedFrom(2, state.turn.number)}`);
          return true;
        },
        choose,
        humanSeat: 0,
        difficulty: 'easy',
        duelSeed: 2,
        isCancelled: () => false,
        maxSteps: 8,
      });

      const humanLegal = engine.legalCommands(state);
      const human = humanLegal.find((command) => command.kind === 'declinePlate' && command.player === 0);
      if (human !== undefined) {
        state = engine.dispatch(state, human).nextState;
        await drainAi({
          engine,
          getState: () => state,
          apply: (command) => {
            state = engine.dispatch(state, command).nextState;
            labels.push(command.kind);
            return true;
          },
          choose,
          humanSeat: 0,
          difficulty: 'easy',
          duelSeed: 2,
          isCancelled: () => false,
          maxSteps: 8,
        });
      }

      expect(aiShouldAct(state, engine.legalCommands(state), 0)).toBe(actorOf(state, engine.legalCommands(state)) !== 0);
      return { labels, hash: hashState(state) };
    };

    const a = await play();
    const b = await play();
    expect(a.labels).toEqual(b.labels);
    expect(a.hash).toBe(b.hash);
  }, 30_000);
});
