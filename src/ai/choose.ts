/**
 * `chooseCommand(state, playerId, opts) -> Command`
 *
 * The AI never mutates `state`. The caller dispatches the returned command. Every
 * returned command is taken from `legalCommands` (or is the seat's `concede` when that
 * is the only option). The engine clock is not advanced here — time only moves if the
 * caller later sends `advanceClock`.
 *
 * Information: rollouts need the real `GameState` because `dispatch` draws the PRNG
 * stored in it. Anything the heuristic is allowed to know goes through `view`.
 *
 * Typical think time on the opening action of a 2v2 no-ability duel (measured in
 * `choose.test.ts`, Windows):
 *
 *   Easy   10 rollouts / depth 24  → ~50 ms
 *   Normal 50 rollouts / depth 32  → ~260 ms
 *   Hard  200 rollouts / depth 40  → ~1.2 s
 *
 * A busier board (more figures, plates, battles) costs more per rollout.
 *
 * The HUD passes `opts.seed` from `aiSeedFrom(duelSeed, turnNumber)` so the same
 * duel seed plus the same human commands replay the same AI replies.
 */
import { evaluate } from './eval.js';
import { AiError } from './error.js';
import { search } from './mcts.js';
import { concedeFor, playableCommands } from './policy.js';
import type { EvaluateFn } from './types.js';
import type { Command, Engine, GameState, PlayerId } from '../engine/index.js';
import { sameCommand } from '../engine/index.js';

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Named rollout budgets. The numbers are what still finish in a reasonable time for
 * one turn of a simple duel; raise them only after measuring.
 */
export const DIFFICULTY = {
  easy: { rollouts: 10, maxDepth: 24 },
  normal: { rollouts: 50, maxDepth: 32 },
  hard: { rollouts: 200, maxDepth: 40 },
} as const satisfies Record<Difficulty, { rollouts: number; maxDepth: number }>;

export const DEFAULT_AI_SEED = 0;

export interface ChooseOptions {
  readonly engine: Engine;
  readonly difficulty?: Difficulty;
  readonly rollouts?: number;
  readonly maxDepth?: number;
  readonly seed?: number;
  readonly evaluate?: EvaluateFn;
}

export function chooseCommand(state: GameState, playerId: PlayerId, opts: ChooseOptions): Command {
  const engine = opts.engine;
  const legal = engine.legalCommands(state);
  const playable = playableCommands(legal, playerId);
  if (playable.length === 0) {
    const resign = concedeFor(legal, playerId);
    if (resign !== null) return resign;
    throw new AiError(`player ${playerId} has no legal command in phase "${state.phase}"`);
  }
  if (playable.length === 1) {
    const only = playable[0];
    if (only === undefined) throw new AiError('unreachable: a singleton move list was empty');
    return only;
  }

  const difficulty = opts.difficulty ?? 'normal';
  const preset = DIFFICULTY[difficulty];
  const chosen = search(engine, state, playerId, {
    rollouts: opts.rollouts ?? preset.rollouts,
    maxDepth: opts.maxDepth ?? preset.maxDepth,
    seed: opts.seed ?? DEFAULT_AI_SEED,
    evaluate: opts.evaluate ?? ((next, who) => evaluate(next, who, engine.deps.board)),
  });

  if (!legal.some((candidate) => sameCommand(candidate, chosen))) {
    const fallback = playable[0];
    if (fallback === undefined) throw new AiError('search returned an illegal command and had no fallback');
    return fallback;
  }
  return chosen;
}
