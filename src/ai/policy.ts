/**
 * What the search is allowed to try.
 *
 * `legalCommands` always includes `concede` for both seats, and `execute` will accept
 * `advanceClock` even though it is not enumerated. Neither belongs in a rollout:
 * conceding from the opening is a legal no-op of the game, and inventing clock ticks
 * would make the engine's chess clock a search artefact. Both stay available as a last
 * resort so the AI still returns *a* legal command when the real set is empty.
 */
import type { Command } from '../engine/index.js';
import { canonicalCommand, opponentOf } from '../engine/index.js';
import type { GameState, PlayerId } from '../engine/index.js';

const IGNORED: ReadonlySet<Command['kind']> = new Set(['advanceClock']);

export function playableCommands(legal: readonly Command[], player: PlayerId): Command[] {
  const mine = legal.filter((command) => command.player === player && !IGNORED.has(command.kind));
  const withoutResign = mine.filter((command) => command.kind !== 'concede');
  return sortCommands(withoutResign.length > 0 ? withoutResign : mine);
}

/** Seat that currently has a real decision. Prefers the turn player. */
export function actorToMove(state: GameState, legal: readonly Command[]): PlayerId {
  const turn = state.turn.player;
  if (playableCommands(legal, turn).length > 0) return turn;
  const other = opponentOf(turn);
  if (playableCommands(legal, other).length > 0) return other;
  return turn;
}

export function sortCommands(commands: readonly Command[]): Command[] {
  return [...commands].sort((a, b) => {
    const left = canonicalCommand(a);
    const right = canonicalCommand(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export function concedeFor(legal: readonly Command[], player: PlayerId): Command | null {
  for (const command of legal) {
    if (command.kind === 'concede' && command.player === player) return command;
  }
  return null;
}
