import { aiSeedFrom, playableCommands, type Difficulty } from '../ai/index.js';
import type { Command, Engine, GameState, PlayerId } from '../engine/index.js';
import { actorOf } from './model.js';
import type { ChooseFn } from './ai-client.js';

export const AI_STEP_CAP = 80;

export function aiShouldAct(state: GameState, legal: readonly Command[], humanSeat: PlayerId): boolean {
  if (state.result !== null) return false;
  return actorOf(state, legal) !== humanSeat;
}

/** Never send `concede` for the AI unless that is the only playable command. */
export function rejectNeedlessConcede(legal: readonly Command[], player: PlayerId, chosen: Command): Command {
  if (chosen.kind !== 'concede') return chosen;
  const playable = playableCommands(legal, player);
  const other = playable.find((command) => command.kind !== 'concede');
  return other ?? chosen;
}

export interface DrainAiOptions {
  readonly engine: Engine;
  readonly getState: () => GameState | null;
  readonly apply: (command: Command) => boolean;
  readonly choose: ChooseFn;
  readonly humanSeat: PlayerId;
  readonly difficulty: Difficulty;
  readonly duelSeed: number;
  readonly isCancelled: () => boolean;
  readonly afterCommand?: (command: Command) => Promise<void>;
  readonly maxSteps?: number;
}

export async function drainAi(options: DrainAiOptions): Promise<Command[]> {
  const issued: Command[] = [];
  const cap = options.maxSteps ?? AI_STEP_CAP;
  for (let steps = 0; steps < cap; steps += 1) {
    if (options.isCancelled()) break;
    const state = options.getState();
    if (state === null || state.result !== null) break;
    const legal = options.engine.legalCommands(state);
    if (!aiShouldAct(state, legal, options.humanSeat)) break;
    const actor = actorOf(state, legal);
    const seed = aiSeedFrom(options.duelSeed, state.turn.number);
    const raw = await options.choose(state, actor, seed, options.difficulty);
    if (options.isCancelled()) break;
    const command = rejectNeedlessConcede(legal, actor, raw);
    if (!options.apply(command)) break;
    issued.push(command);
    if (options.afterCommand !== undefined) await options.afterCommand(command);
  }
  return issued;
}
