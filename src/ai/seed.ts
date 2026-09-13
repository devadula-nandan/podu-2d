/**
 * Search-seed for `chooseCommand` when the HUD is driving a vs-AI duel.
 *
 * `chooseCommand` is deterministic in `(state, player, opts.seed)` and the engine is
 * deterministic in `(duelSeed, commands)`. Mixing the duel seed with the current turn
 * number is enough for "same seed + same human clicks ⇒ same AI replies" without
 * giving every decision on a long match the identical MCTS stream.
 *
 * Formula (documented for replays):
 *
 *   aiSeed = (duelSeed >>> 0) XOR (turnNumber * 0x9e3779b9)
 *
 * `0x9e3779b9` is the same golden-ratio word the engine RNG already uses to expand a
 * seed. Turn number is the 1-based player-turn on `GameState.turn.number`.
 */
export function aiSeedFrom(duelSeed: number, turnNumber: number): number {
  return ((duelSeed >>> 0) ^ (Math.imul(turnNumber, 0x9e3779b9) >>> 0)) >>> 0;
}
