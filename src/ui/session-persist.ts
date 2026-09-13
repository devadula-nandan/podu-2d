/**
 * Cheap refresh restore: seed + command list in sessionStorage.
 *
 * In-SPA navigation does not need this — the host lives above the route outlets.
 * Refresh of the same tab replays the stored commands onto a new `createGame`
 * (same fold extras undo already uses). A new tab has empty sessionStorage and
 * joins the table through the same-origin room (`/sync`), not this key.
 */
import type { PlayerId } from '../engine/index.js';
import type { LoggedCommand } from './replay.js';
import type { DuelConfig, PlayMode } from './use-duel.js';
import type { Difficulty } from '../ai/index.js';
import type { DeckDraft } from './model.js';

export const LIVE_SESSION_KEY = 'podu:live-duel:v1';

export interface LiveSnapshot {
  readonly config: DuelConfig;
  readonly commands: readonly LoggedCommand[];
  readonly viewing: PlayerId;
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const COMMAND_KINDS = new Set([
  'deploy',
  'mpMove',
  'tag',
  'abilityAction',
  'playPlate',
  'declinePlate',
  'declineWindow',
  'initiateBattle',
  'declineBattle',
  'spin',
  'useRespin',
  'declineRespin',
  'resolveDecision',
  'advanceClock',
  'concede',
]);

export function browserSessionStorage(): SessionStorageLike | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function writeLiveSession(snapshot: LiveSnapshot, storage: SessionStorageLike | null = browserSessionStorage()): void {
  if (storage === null) return;
  storage.setItem(LIVE_SESSION_KEY, JSON.stringify(snapshot));
}

export function clearLiveSession(storage: SessionStorageLike | null = browserSessionStorage()): void {
  if (storage === null) return;
  storage.removeItem(LIVE_SESSION_KEY);
}

export function readLiveSession(storage: SessionStorageLike | null = browserSessionStorage()): LiveSnapshot | null {
  if (storage === null) return null;
  const raw = storage.getItem(LIVE_SESSION_KEY);
  if (raw === null || raw === '') return null;
  try {
    return parseLiveSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Restore only when the URL seed matches (or the URL has no seed).
 * A share URL for a different seed is a new draft, not the leftover duel.
 */
export function snapshotForUrl(urlSeed: number | null, storage: SessionStorageLike | null = browserSessionStorage()): LiveSnapshot | null {
  const stored = readLiveSession(storage);
  if (stored === null) return null;
  if (urlSeed !== null && stored.config.seed !== urlSeed) {
    clearLiveSession(storage);
    return null;
  }
  return stored;
}

export function parseLiveSnapshot(raw: unknown): LiveSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const config = parseConfig(row['config']);
  const commands = parseCommands(row['commands']);
  const viewing = parsePlayerId(row['viewing']);
  if (config === null || commands === null || viewing === null) return null;
  return { config, commands, viewing };
}

export function parseConfig(raw: unknown): DuelConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const seed = asUint(row['seed']);
  const startingPlayer = parsePlayerId(row['startingPlayer']);
  const decks = parseDecks(row['decks']);
  const mode = parseMode(row['mode']);
  const humanSeat = parsePlayerId(row['humanSeat']);
  const difficulty = parseDifficulty(row['difficulty']);
  if (
    seed === null ||
    startingPlayer === null ||
    decks === null ||
    mode === null ||
    humanSeat === null ||
    difficulty === null
  ) {
    return null;
  }
  return {
    seed,
    startingPlayer,
    decks,
    allowUnimplemented: row['allowUnimplemented'] === true,
    mode,
    humanSeat,
    difficulty,
  };
}

function parseDecks(raw: unknown): Readonly<Record<PlayerId, DeckDraft>> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const zero = parseDraft(row['0']);
  const one = parseDraft(row['1']);
  if (zero === null || one === null) return null;
  return { 0: zero, 1: one };
}

export function parseDraft(raw: unknown): DeckDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const figures = parseIdList(row['figures']);
  const plates = parseIdList(row['plates']);
  if (figures === null || plates === null) return null;
  return { figures, plates };
}

function parseIdList(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const item of raw) {
    const n = asUint(item);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

export function parseCommands(raw: unknown): LoggedCommand[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LoggedCommand[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const row = item as Record<string, unknown>;
    const who = row['who'];
    const command = row['command'];
    if (who !== 'human' && who !== 'ai' && who !== 'clock') return null;
    if (typeof command !== 'object' || command === null) return null;
    const kind = (command as Record<string, unknown>)['kind'];
    if (typeof kind !== 'string' || !COMMAND_KINDS.has(kind)) return null;
    out.push({ command: command as LoggedCommand['command'], who });
  }
  return out;
}

function parsePlayerId(raw: unknown): PlayerId | null {
  return raw === 0 || raw === 1 ? raw : null;
}

function parseMode(raw: unknown): PlayMode | null {
  return raw === 'hotseat' || raw === 'vsAi' ? raw : null;
}

function parseDifficulty(raw: unknown): Difficulty | null {
  return raw === 'easy' || raw === 'normal' || raw === 'hard' ? raw : null;
}

function asUint(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw >>> 0;
}
