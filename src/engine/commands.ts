/**
 * Commands: everything a player, an AI or the network may ask the engine to do.
 *
 * A command is a *request*; the engine decides whether it is legal. Nothing outside
 * `legalCommands(state)` is accepted, and rejection happens before any rule runs, so an
 * illegal request can never leave the state half-changed.
 *
 * Two things are deliberately commands rather than ambient behaviour:
 *
 * - **Time.** `advanceClock` is how milliseconds enter a pure engine. If the engine
 *   read a clock itself it would stop being reproducible, and the 5-minute chess clock
 *   is a win condition, so that would be a determinism hole in a win condition.
 * - **Spinning.** `spin` is a command, not an automatic step, because the UI needs a
 *   moment to animate a 96-segment wheel and because the AI wants to be the thing that
 *   asks for the draw.
 *
 * There is no `pass` command. `VOLUNTARY_PASS_ALLOWED` is `false`, and Wait Victory is
 * the reason: a player who could always pass could never be without a legal action, and
 * Wait Victory could never fire. Declining a *plate* or a *battle* is different - both
 * are explicitly optional steps - so those have their own commands.
 */
import type { FigureUid, NodeId, PlayerId } from './ids.js';

export type Command =
  /** Bench to field through an entry point. Costs `DEPLOY_MP_COST`; leftover MP continues the move, so `to` may be past the entry. */
  | { readonly kind: 'deploy'; readonly player: PlayerId; readonly uid: FigureUid; readonly entry: NodeId; readonly to: NodeId }
  | { readonly kind: 'mpMove'; readonly player: PlayerId; readonly uid: FigureUid; readonly to: NodeId }
  /** Touch an afflicted ally from an adjacent point. Cures it and ends your turn. */
  | { readonly kind: 'tag'; readonly player: PlayerId; readonly uid: FigureUid; readonly target: FigureUid }
  /**
   * "Instead of an MP move" - a first-class sibling of movement, not a modifier on it.
   * Over thirty abilities replace the movement action outright.
   */
  | { readonly kind: 'abilityAction'; readonly player: PlayerId; readonly uid: FigureUid; readonly clauseId: string }

  | { readonly kind: 'playPlate'; readonly player: PlayerId; readonly slot: number }
  | { readonly kind: 'declinePlate'; readonly player: PlayerId }
  /** Closes the "before using this Pokemon" window without using it. */
  | { readonly kind: 'declineWindow'; readonly player: PlayerId }

  | {
      readonly kind: 'initiateBattle';
      readonly player: PlayerId;
      readonly attacker: FigureUid;
      readonly defender: FigureUid;
      /** When set, the attacker spends a full Z-gauge to spin this Z-Move instead of its wheel. */
      readonly zMoveIndex?: number;
    }
  | { readonly kind: 'declineBattle'; readonly player: PlayerId }
  | { readonly kind: 'spin'; readonly player: PlayerId }
  | { readonly kind: 'useRespin'; readonly player: PlayerId }
  | { readonly kind: 'declineRespin'; readonly player: PlayerId }

  | {
      readonly kind: 'resolveDecision';
      readonly player: PlayerId;
      readonly resumeToken: string;
      readonly accept: boolean;
      readonly figures: readonly FigureUid[];
      readonly nodes: readonly NodeId[];
      readonly slots?: readonly number[];
    }

  | { readonly kind: 'advanceClock'; readonly player: PlayerId; readonly ms: number }
  | { readonly kind: 'concede'; readonly player: PlayerId };

export type CommandKind = Command['kind'];

/** Thrown by `dispatch` when a command is not in `legalCommands(state)`. */
export class IllegalCommandError extends Error {
  readonly command: Command;
  constructor(command: Command, reason: string) {
    super(`illegal command "${command.kind}": ${reason}`);
    this.name = 'IllegalCommandError';
    this.command = command;
  }
}

/**
 * Structural equality for commands.
 *
 * `legalCommands` enumerates the legal set and `dispatch` checks membership, so the
 * two have to agree on what "the same command" means. Comparing the canonical JSON is
 * enough because commands are flat records of primitives, and it cannot drift out of
 * sync the way a hand-written per-kind comparison would.
 */
export function sameCommand(a: Command, b: Command): boolean {
  return canonicalCommand(a) === canonicalCommand(b);
}

export function canonicalCommand(command: Command): string {
  const entries = Object.entries(command as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1));
  return JSON.stringify(entries);
}
