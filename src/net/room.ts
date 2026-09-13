import type { Difficulty } from '../ai/index.js';
import type { Command } from '../engine/index.js';
import type { LoggedCommand } from '../ui/replay.js';
import type { DeckDraft } from '../ui/model.js';
import type { DuelConfig, PlayMode } from '../ui/use-duel.js';
import { newClientId } from './ids.js';

export const STALE_MS = 16_000;
export const HEARTBEAT_MS = 5_000;

export type RoomPhase = 'lobby' | 'live' | 'over';
export type TableRole = 'home' | 'away' | 'spectator';

export interface SeatPublic {
  readonly connected: boolean;
  readonly ready: boolean;
  readonly ai: boolean;
  readonly deck: DeckDraft | null;
}

export interface SeatState {
  token: string;
  connected: boolean;
  ready: boolean;
  ai: boolean;
  deck: DeckDraft | null;
  lastSeen: number;
}

export interface RoomPublic {
  readonly phase: RoomPhase;
  readonly mode: PlayMode;
  readonly difficulty: Difficulty;
  readonly seats: readonly [SeatPublic | null, SeatPublic | null];
  readonly config: DuelConfig | null;
  readonly commands: readonly LoggedCommand[];
  readonly seq: number;
}

export interface RoomState {
  seed: number;
  phase: RoomPhase;
  mode: PlayMode;
  difficulty: Difficulty;
  seats: [SeatState | null, SeatState | null];
  config: DuelConfig | null;
  commands: LoggedCommand[];
  seq: number;
}

export interface ClaimResult {
  readonly seat: 0 | 1 | null;
  readonly token: string | null;
  readonly kickedToken: string | null;
}

export interface ConfigureInput {
  readonly deck: DeckDraft;
  readonly ready: boolean;
  readonly mode: PlayMode;
  readonly difficulty: Difficulty;
}

export function emptyRoom(seed: number): RoomState {
  return {
    seed: seed >>> 0,
    phase: 'lobby',
    mode: 'hotseat',
    difficulty: 'easy',
    seats: [null, null],
    config: null,
    commands: [],
    seq: 0,
  };
}

export function publicSeat(seat: SeatState | null): SeatPublic | null {
  if (seat === null) return null;
  return { connected: seat.connected, ready: seat.ready, ai: seat.ai, deck: seat.deck };
}

export function publicRoom(room: RoomState): RoomPublic {
  return {
    phase: room.phase,
    mode: room.mode,
    difficulty: room.difficulty,
    seats: [publicSeat(room.seats[0]), publicSeat(room.seats[1])],
    config: room.config,
    commands: [...room.commands],
    seq: room.seq,
  };
}

export function seatIndexOfToken(room: RoomState, token: string): 0 | 1 | null {
  if (room.seats[0]?.token === token) return 0;
  if (room.seats[1]?.token === token) return 1;
  return null;
}

export function roleOfSeat(seat: 0 | 1 | null): TableRole {
  if (seat === 0) return 'home';
  if (seat === 1) return 'away';
  return 'spectator';
}

export function viewingForRole(role: TableRole | null, config: DuelConfig): 0 | 1 {
  if (config.mode === 'vsAi') return config.humanSeat;
  return role === 'away' ? 1 : 0;
}

export function isSeatStale(seat: SeatState, now: number): boolean {
  if (seat.ai) return false;
  if (!seat.connected) return true;
  return now - seat.lastSeen > STALE_MS;
}

export function claimSeat(
  room: RoomState,
  now: number,
  token: string | null,
  reclaim: string | null,
): ClaimResult {
  if (token !== null) {
    const mine = seatIndexOfToken(room, token);
    if (mine !== null) {
      const held = room.seats[mine];
      if (held !== null && !held.ai) return occupy(room, mine, token, now);
    }
  }

  const vacant = room.seats[0] === null ? 0 : room.seats[1] === null ? 1 : null;
  if (vacant !== null) {
    const nextToken = token ?? newClientId();
    room.seats[vacant] = {
      token: nextToken,
      connected: true,
      ready: false,
      ai: false,
      deck: null,
      lastSeen: now,
    };
    return { seat: vacant, token: nextToken, kickedToken: null };
  }

  if (reclaim !== null) {
    const held = seatIndexOfToken(room, reclaim);
    if (held !== null) {
      const seat = room.seats[held];
      if (seat !== null && !seat.ai && isSeatStale(seat, now)) {
        return occupy(room, held, reclaim, now);
      }
    }
  }

  for (const index of [0, 1] as const) {
    const seat = room.seats[index];
    if (seat === null || seat.ai || !isSeatStale(seat, now)) continue;
    return occupy(room, index, newClientId(), now);
  }

  return { seat: null, token: null, kickedToken: null };
}

function occupy(room: RoomState, index: 0 | 1, token: string, now: number): ClaimResult {
  const seat = room.seats[index];
  if (seat === null) return { seat: null, token: null, kickedToken: null };
  const kickedToken = seat.token !== token ? seat.token : null;
  seat.token = token;
  seat.connected = true;
  seat.lastSeen = now;
  return { seat: index, token, kickedToken };
}

export function touchSeat(room: RoomState, token: string, now: number): boolean {
  const index = seatIndexOfToken(room, token);
  if (index === null) return false;
  const seat = room.seats[index];
  if (seat === null || seat.ai) return false;
  seat.connected = true;
  seat.lastSeen = now;
  return true;
}

export function disconnectToken(room: RoomState, token: string): boolean {
  const index = seatIndexOfToken(room, token);
  if (index === null) return false;
  const seat = room.seats[index];
  if (seat === null || seat.ai) return false;
  if (room.phase === 'lobby') {
    room.seats[index] = null;
    return true;
  }
  seat.connected = false;
  return true;
}

export function sweepStale(room: RoomState, now: number): string[] {
  const dropped: string[] = [];
  for (const seat of room.seats) {
    if (seat === null || seat.ai || !seat.connected) continue;
    if (now - seat.lastSeen <= STALE_MS) continue;
    seat.connected = false;
    dropped.push(seat.token);
  }
  return dropped;
}

export function configureSeat(room: RoomState, token: string, input: ConfigureInput): boolean {
  const index = seatIndexOfToken(room, token);
  if (index === null) return false;
  const seat = room.seats[index];
  if (seat === null || seat.ai || room.phase !== 'lobby') return false;
  seat.deck = input.deck;
  seat.ready = input.ready;
  room.mode = input.mode;
  room.difficulty = input.difficulty;
  if (input.mode === 'vsAi') return false;
  return tryStartHotseat(room);
}

export function tryStartHotseat(room: RoomState): boolean {
  if (room.phase !== 'lobby' || room.mode === 'vsAi') return false;
  const a = room.seats[0];
  const b = room.seats[1];
  if (a === null || b === null || a.deck === null || b.deck === null || !a.ready || !b.ready) {
    return false;
  }
  room.config = {
    seed: room.seed,
    startingPlayer: room.seed % 2 === 0 ? 0 : 1,
    decks: { 0: a.deck, 1: b.deck },
    allowUnimplemented: true,
    mode: 'hotseat',
    humanSeat: 0,
    difficulty: room.difficulty,
  };
  room.phase = 'live';
  room.commands = [];
  room.seq = 0;
  return true;
}

export function applyFullStart(room: RoomState, token: string, config: DuelConfig): boolean {
  const index = seatIndexOfToken(room, token);
  if (index === null) return false;
  if (config.mode === 'vsAi' && index !== 0) return false;
  room.mode = config.mode;
  room.difficulty = config.difficulty;
  room.config = config;
  room.phase = 'live';
  room.commands = [];
  room.seq = 0;
  const home = room.seats[0];
  if (home !== null) {
    home.deck = config.decks[0];
    home.ready = true;
  }
  if (config.mode === 'vsAi') {
    room.seats[1] = {
      token: 'ai',
      connected: true,
      ready: true,
      ai: true,
      deck: config.decks[1],
      lastSeen: 0,
    };
  } else if (room.seats[1]?.ai === true) {
    room.seats[1] = null;
  } else if (room.seats[1] !== null) {
    room.seats[1].deck = config.decks[1];
    room.seats[1].ready = true;
  }
  return true;
}

export function applyPropose(
  room: RoomState,
  token: string,
  command: Command,
  who: LoggedCommand['who'],
): LoggedCommand | null {
  if (room.phase !== 'live' && room.phase !== 'over') return null;
  const index = seatIndexOfToken(room, token);
  if (index === null) return null;
  const seat = room.seats[index];
  if (seat === null || seat.ai) return null;
  const row: LoggedCommand = { command, who };
  room.commands.push(row);
  room.seq += 1;
  return row;
}

export function persistableRoom(room: RoomState): RoomState {
  const a = room.seats[0];
  const b = room.seats[1];
  return {
    seed: room.seed,
    phase: room.phase,
    mode: room.mode,
    difficulty: room.difficulty,
    seats: [
      a === null ? null : { ...a, connected: false },
      b === null ? null : { ...b, connected: b.ai },
    ],
    config: room.config,
    commands: room.commands,
    seq: room.seq,
  };
}
