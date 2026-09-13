/**
 * MCTS opponent. Rollouts are the real engine: `legalCommands` + `dispatch` on an
 * immutable `GameState`. The AI returns a `Command`; it does not write the state.
 *
 *   chooseCommand(state, playerId, { engine, difficulty?, rollouts?, seed? })
 *
 * Budgets live in `DIFFICULTY`. Evaluation lives in `eval.ts` so it can be swapped.
 */
export { chooseCommand, DEFAULT_AI_SEED, DIFFICULTY } from './choose.js';
export type { ChooseOptions, Difficulty } from './choose.js';
export { commandPrior, evaluate } from './eval.js';
export { defaultAiDeck, implementedNoAbilityFigureIds } from './decks.js';
export { AiError } from './error.js';
export { actorToMove, playableCommands } from './policy.js';
export { aiSeedFrom } from './seed.js';
export type { EvaluateFn } from './types.js';
