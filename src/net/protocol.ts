import type { Command } from '../engine/index.js';
import type { LoggedCommand } from '../ui/replay.js';
import { parseCommands, parseConfig, parseDraft } from '../ui/session-persist.js';
import type { DeckDraft } from '../ui/model.js';
import type { DuelConfig, PlayMode } from '../ui/use-duel.js';
import type { Difficulty } from '../ai/index.js';
import type { RoomPublic, RoomPhase, SeatPublic } from './room.js';

export type NetMessage =
  | { readonly type: 'hello'; readonly seed: number; readonly token?: string; readonly reclaim?: string }
  | {
      readonly type: 'welcome';
      readonly seed: number;
      readonly to: string;
      readonly seat: 0 | 1 | null;
      readonly room: RoomPublic;
    }
  | { readonly type: 'presence'; readonly seed: number; readonly room: RoomPublic }
  | { readonly type: 'rejected'; readonly seed: number; readonly reason: 'full' }
  | { readonly type: 'kicked'; readonly seed: number; readonly reason: 'replaced' }
  | { readonly type: 'heartbeat'; readonly seed: number; readonly token: string }
  | {
      readonly type: 'configure';
      readonly seed: number;
      readonly token: string;
      readonly deck: DeckDraft;
      readonly ready: boolean;
      readonly mode: PlayMode;
      readonly difficulty: Difficulty;
    }
  | { readonly type: 'start'; readonly seed: number; readonly token: string; readonly config: DuelConfig }
  | {
      readonly type: 'propose';
      readonly seed: number;
      readonly token: string;
      readonly command: Command;
      readonly who: LoggedCommand['who'];
    }
  | {
      readonly type: 'commit';
      readonly seed: number;
      readonly seq: number;
      readonly command: Command;
      readonly who: LoggedCommand['who'];
    }
  | { readonly type: 'leave'; readonly seed: number; readonly token: string };

export function parseRoomPublic(raw: unknown): RoomPublic | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const phase = parsePhase(row['phase']);
  const mode = parseMode(row['mode']);
  const difficulty = parseDifficulty(row['difficulty']);
  const seats = parseSeats(row['seats']);
  const seq = asUint(row['seq']);
  const commands = parseCommands(row['commands']);
  if (phase === null || mode === null || difficulty === null || seats === null || seq === null || commands === null) {
    return null;
  }
  const configRaw = row['config'];
  const config = configRaw === null || configRaw === undefined ? null : parseConfig(configRaw);
  if (configRaw !== null && configRaw !== undefined && config === null) return null;
  return { phase, mode, difficulty, seats, config, commands, seq };
}

export function parseNetMessage(raw: unknown): NetMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const type = row['type'];
  const seed = asUint(row['seed']);
  if (seed === null) return null;
  switch (type) {
    case 'hello': {
      const token = asOptionalId(row['token']);
      const reclaim = asOptionalId(row['reclaim']);
      return {
        type,
        seed,
        ...(token !== null ? { token } : {}),
        ...(reclaim !== null ? { reclaim } : {}),
      };
    }
    case 'welcome': {
      const to = asId(row['to']);
      const seat = parseSeatIndex(row['seat']);
      const room = parseRoomPublic(row['room']);
      if (to === null || seat === undefined || room === null) return null;
      return { type, seed, to, seat, room };
    }
    case 'presence': {
      const room = parseRoomPublic(row['room']);
      if (room === null) return null;
      return { type, seed, room };
    }
    case 'rejected':
      return { type, seed, reason: 'full' };
    case 'kicked':
      return { type, seed, reason: 'replaced' };
    case 'heartbeat': {
      const token = asId(row['token']);
      if (token === null) return null;
      return { type, seed, token };
    }
    case 'configure': {
      const token = asId(row['token']);
      const deck = parseDraft(row['deck']);
      const mode = parseMode(row['mode']);
      const difficulty = parseDifficulty(row['difficulty']);
      if (token === null || deck === null || mode === null || difficulty === null) return null;
      if (row['ready'] !== true && row['ready'] !== false) return null;
      return { type, seed, token, deck, ready: row['ready'], mode, difficulty };
    }
    case 'start': {
      const token = asId(row['token']);
      const config = parseConfig(row['config']);
      if (token === null || config === null) return null;
      return { type, seed, token, config };
    }
    case 'propose': {
      const token = asId(row['token']);
      const who = parseWho(row['who']);
      if (token === null || who === null) return null;
      const parsed = parseCommands([{ command: row['command'], who }]);
      const command = parsed?.[0]?.command;
      if (command === undefined) return null;
      return { type, seed, token, command, who };
    }
    case 'commit': {
      const seq = asUint(row['seq']);
      const who = parseWho(row['who']);
      if (seq === null || who === null) return null;
      const parsed = parseCommands([{ command: row['command'], who }]);
      const command = parsed?.[0]?.command;
      if (command === undefined) return null;
      return { type, seed, seq, command, who };
    }
    case 'leave': {
      const token = asId(row['token']);
      if (token === null) return null;
      return { type, seed, token };
    }
    default:
      return null;
  }
}

function parseSeats(raw: unknown): readonly [SeatPublic | null, SeatPublic | null] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const a = parseSeatPublic(raw[0]);
  const b = parseSeatPublic(raw[1]);
  if (a === undefined || b === undefined) return null;
  return [a, b];
}

function parseSeatPublic(raw: unknown): SeatPublic | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  if (row['connected'] !== true && row['connected'] !== false) return undefined;
  if (row['ready'] !== true && row['ready'] !== false) return undefined;
  if (row['ai'] !== true && row['ai'] !== false) return undefined;
  const deckRaw = row['deck'];
  const deck = deckRaw === null || deckRaw === undefined ? null : parseDraft(deckRaw);
  if (deckRaw !== null && deckRaw !== undefined && deck === null) return undefined;
  return { connected: row['connected'], ready: row['ready'], ai: row['ai'], deck };
}

function parsePhase(raw: unknown): RoomPhase | null {
  return raw === 'lobby' || raw === 'live' || raw === 'over' ? raw : null;
}

function parseMode(raw: unknown): PlayMode | null {
  return raw === 'hotseat' || raw === 'vsAi' ? raw : null;
}

function parseDifficulty(raw: unknown): Difficulty | null {
  return raw === 'easy' || raw === 'normal' || raw === 'hard' ? raw : null;
}

function parseWho(raw: unknown): LoggedCommand['who'] | null {
  return raw === 'human' || raw === 'ai' || raw === 'clock' ? raw : null;
}

function parseSeatIndex(raw: unknown): 0 | 1 | null | undefined {
  if (raw === null) return null;
  if (raw === 0 || raw === 1) return raw;
  return undefined;
}

function asId(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

function asOptionalId(raw: unknown): string | null {
  if (raw === undefined) return null;
  return asId(raw);
}

function asUint(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw >>> 0;
}
