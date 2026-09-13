import type { GameState, PlayerId } from '../engine/index.js';

export type EvaluateFn = (state: GameState, player: PlayerId) => number;
