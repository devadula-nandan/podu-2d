import type { Command, PlayerId } from '../engine/index.js';

/**
 * Whether the host should keep sending `advanceClock`.
 *
 * Time enters the engine only via that command. AI thinking is *not* a pause: the
 * seat whose turn it is is still on the clock, and a 5-minute chess clock that
 * freezes for every search is a product bug. Hotseat hand-off and a finished
 * duel are the only host-side pauses.
 */
export function shouldRunChessClock(input: {
  readonly hasHost: boolean;
  readonly gameOver: boolean;
  readonly handover: boolean;
  readonly scrubbing?: boolean;
}): boolean {
  return input.hasHost && !input.gameOver && !input.handover && input.scrubbing !== true;
}

/** Measured wall-clock milliseconds → the command the host must send. */
export function clockAdvanceCommand(player: PlayerId, elapsedMs: number): Command {
  return { kind: 'advanceClock', player, ms: Math.max(1, Math.round(elapsedMs)) };
}
