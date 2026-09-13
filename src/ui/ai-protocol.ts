import type { Difficulty } from '../ai/index.js';
import type { Command, GameState, PlayerId } from '../engine/index.js';

export interface AiChooseRequest {
  readonly id: number;
  readonly state: GameState;
  readonly playerId: PlayerId;
  readonly difficulty: Difficulty;
  readonly seed: number;
}

export type AiChooseResponse =
  | { readonly id: number; readonly ok: true; readonly command: Command }
  | { readonly id: number; readonly ok: false; readonly message: string };
