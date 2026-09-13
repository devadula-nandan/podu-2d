import { describe, expect, it } from 'vitest';
import { figureUid, nodeId, type Command } from '../engine/index.js';
import type { DuelConfig } from '../ui/use-duel.js';
import {
  applyFullStart,
  applyPropose,
  claimSeat,
  configureSeat,
  disconnectToken,
  emptyRoom,
  isSeatStale,
  persistableRoom,
  publicRoom,
  roleOfSeat,
  STALE_MS,
  sweepStale,
  viewingForRole,
} from './room.js';

const deckA = { figures: [1, 2, 3, 4, 5, 6], plates: [] };
const deckB = { figures: [7, 8, 9, 10, 11, 12], plates: [] };

const vsAi: DuelConfig = {
  seed: 2,
  startingPlayer: 0,
  decks: { 0: deckA, 1: deckB },
  allowUnimplemented: false,
  mode: 'vsAi',
  humanSeat: 0,
  difficulty: 'easy',
};

const deploy: Command = {
  kind: 'deploy',
  player: 0,
  uid: figureUid(0),
  entry: nodeId('r4c0'),
  to: nodeId('r4c0'),
};

describe('room seats', () => {
  it('gives seat 0 then seat 1, then spectator, and never a third seat', () => {
    const room = emptyRoom(4242);
    const a = claimSeat(room, 0, null, null);
    const b = claimSeat(room, 0, null, null);
    const c = claimSeat(room, 0, null, null);
    expect(a.seat).toBe(0);
    expect(b.seat).toBe(1);
    expect(c.seat).toBeNull();
    expect(roleOfSeat(c.seat)).toBe('spectator');
    expect(room.seats.filter(Boolean)).toHaveLength(2);
  });

  it('reclaims a session token even while that seat still looks connected', () => {
    const room = emptyRoom(1);
    const first = claimSeat(room, 0, null, null);
    expect(first.token).toBeTruthy();
    const again = claimSeat(room, 10, first.token, null);
    expect(again.seat).toBe(0);
    expect(again.token).toBe(first.token);
    expect(again.kickedToken).toBeNull();
  });

  it('ignores a live reclaim token so a second tab can take the vacant seat', () => {
    const room = emptyRoom(1);
    const first = claimSeat(room, 0, null, null);
    const second = claimSeat(room, 1, null, first.token);
    expect(second.seat).toBe(1);
    expect(second.token).not.toBe(first.token);
  });

  it('lets a new client take a disconnected seat and keeps the deck', () => {
    const room = emptyRoom(1);
    const first = claimSeat(room, 0, null, null);
    const second = claimSeat(room, 0, null, null);
    expect(first.token).toBeTruthy();
    expect(second.token).toBeTruthy();
    if (first.token === null || second.token === null) throw new Error('tokens');
    configureSeat(room, first.token, { deck: deckA, ready: true, mode: 'hotseat', difficulty: 'easy' });
    configureSeat(room, second.token, { deck: deckB, ready: true, mode: 'hotseat', difficulty: 'easy' });
    expect(room.phase).toBe('live');
    disconnectToken(room, first.token);
    expect(room.seats[0]?.connected).toBe(false);
    expect(room.seats[0]?.deck).toEqual(deckA);

    const walker = claimSeat(room, 50, null, null);
    expect(walker.seat).toBe(0);
    expect(walker.token).not.toBe(first.token);
    expect(room.seats[0]?.deck).toEqual(deckA);
    expect(room.config?.decks[0]).toEqual(deckA);
    expect(room.commands).toEqual([]);
  });

  it('treats a heartbeat timeout as stale', () => {
    const room = emptyRoom(1);
    claimSeat(room, 0, null, null);
    const seat = room.seats[0];
    expect(seat).toBeTruthy();
    if (seat === null) throw new Error('seat');
    expect(isSeatStale(seat, STALE_MS)).toBe(false);
    expect(isSeatStale(seat, STALE_MS + 1)).toBe(true);
    expect(sweepStale(room, STALE_MS + 1)).toEqual([seat.token]);
    expect(seat.connected).toBe(false);
  });

  it('does not let a stranger steal a live seat', () => {
    const room = emptyRoom(1);
    claimSeat(room, 0, null, null);
    claimSeat(room, 0, null, null);
    const third = claimSeat(room, 100, null, null);
    expect(third.seat).toBeNull();
    expect(publicRoom(room).seats[0]?.connected).toBe(true);
  });
});

describe('room start + commands', () => {
  it('starts hotseat only when both seats are ready with decks', () => {
    const room = emptyRoom(4);
    const a = claimSeat(room, 0, null, null);
    const b = claimSeat(room, 0, null, null);
    if (a.token === null || b.token === null) throw new Error('tokens');
    expect(
      configureSeat(room, a.token, { deck: deckA, ready: true, mode: 'hotseat', difficulty: 'easy' }),
    ).toBe(false);
    expect(room.phase).toBe('lobby');
    expect(
      configureSeat(room, b.token, { deck: deckB, ready: true, mode: 'hotseat', difficulty: 'easy' }),
    ).toBe(true);
    expect(room.phase).toBe('live');
    expect(room.config?.decks[1]).toEqual(deckB);
    expect(room.config?.startingPlayer).toBe(0);
  });

  it('fills seat 1 with AI on a full start and refuses a third human seat', () => {
    const room = emptyRoom(2);
    const a = claimSeat(room, 0, null, null);
    if (a.token === null) throw new Error('token');
    expect(applyFullStart(room, a.token, vsAi)).toBe(true);
    expect(room.seats[1]?.ai).toBe(true);
    expect(claimSeat(room, 1, null, null).seat).toBeNull();
    expect(viewingForRole('home', vsAi)).toBe(0);
    expect(viewingForRole('away', { ...vsAi, mode: 'hotseat' })).toBe(1);
  });

  it('lets a seated client overwrite a live room', () => {
    const room = emptyRoom(2);
    const a = claimSeat(room, 0, null, null);
    if (a.token === null) throw new Error('token');
    expect(applyFullStart(room, a.token, vsAi)).toBe(true);
    applyPropose(room, a.token, deploy, 'human');
    expect(room.seq).toBe(1);
    expect(applyFullStart(room, a.token, { ...vsAi, difficulty: 'hard' })).toBe(true);
    expect(room.commands).toEqual([]);
    expect(room.seq).toBe(0);
    expect(room.phase).toBe('live');
    expect(room.config?.difficulty).toBe('hard');
  });

  it('appends a proposed command onto the persisted log', () => {
    const room = emptyRoom(2);
    const a = claimSeat(room, 0, null, null);
    if (a.token === null) throw new Error('token');
    applyFullStart(room, a.token, vsAi);
    const row = applyPropose(room, a.token, deploy, 'human');
    expect(row?.command).toEqual(deploy);
    expect(room.seq).toBe(1);
    expect(persistableRoom(room).commands).toHaveLength(1);
    expect(persistableRoom(room).seats[0]?.connected).toBe(false);
  });
});
