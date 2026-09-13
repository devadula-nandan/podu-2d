/**
 * `view(state, playerId)` - what one player is allowed to see.
 *
 * This exists from day one even though the first client is hotseat, because retrofitting
 * a view is a rewrite. The moment there is a server, the client must never receive the
 * full state, and if the UI has spent three months reading `GameState` directly then
 * every one of those reads is a leak to find.
 *
 * What is actually hidden today is the **PRNG state**. That is not a small thing: with
 * `rng` in hand a client can compute every future spin exactly, so shipping it would
 * turn a wheel-based game into a solved one. Everything else in a Duel is open
 * information - the board, both benches, both P.C.s, conditions, markers, Wait counts
 * are all visible to both players in the real game - so the view is deliberately not
 * redacting things merely because it could.
 *
 * The one exception is plates: a player sees their own plate deck and only the *count*
 * of the opponent's unused plates, since plate identities are hidden until played.
 */
import type { ContentPlateId, PlayerId } from './ids.js';
import { opponentOf } from './ids.js';
import type { GameState, PlateSlot } from './state.js';

export interface OpponentPlateView {
  /** How many plates the opponent still holds. Identities stay hidden until played. */
  readonly unused: number;
  readonly used: readonly ContentPlateId[];
}

export type PlayerView = Omit<GameState, 'rng' | 'players'> & {
  readonly you: PlayerId;
  readonly yourPlates: readonly PlateSlot[];
  readonly opponentPlates: OpponentPlateView;
  readonly clocks: Readonly<Record<PlayerId, number>>;
  readonly zGauges: Readonly<Record<PlayerId, number>>;
  readonly megaUsed: Readonly<Record<PlayerId, boolean>>;
};

export function view(state: GameState, playerId: PlayerId): PlayerView {
  const { rng: _rng, players, ...rest } = state;
  const them = players[opponentOf(playerId)];

  return {
    ...rest,
    you: playerId,
    yourPlates: players[playerId].plates,
    opponentPlates: {
      unused: them.plates.filter((slot) => !slot.used).length,
      used: them.plates.filter((slot) => slot.used).map((slot) => slot.plateId),
    },
    clocks: { 0: players[0].clockMs, 1: players[1].clockMs },
    zGauges: { 0: players[0].zGauge, 1: players[1].zGauge },
    megaUsed: { 0: players[0].megaUsed, 1: players[1].megaUsed },
  };
}
