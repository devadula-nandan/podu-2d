import type { PlayerId } from '../engine/index.js';
import type { DeckDraft } from './model.js';

export const DECK_SLOT_COUNT = 6;
export const DECK_SLOTS_KEY = 'podu:deck-slots:v1';
export const DEV_DRAFTS_KEY = 'podu:dev-drafts:v1';

export interface StoredDeck {
  readonly figures: readonly number[];
  readonly plates: readonly number[];
}

export type DeckSlot = StoredDeck | null;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyDeckSlots(): DeckSlot[] {
  return Array.from({ length: DECK_SLOT_COUNT }, () => null);
}

export function asStoredDeck(draft: DeckDraft): StoredDeck {
  return { figures: [...draft.figures], plates: [...draft.plates] };
}

function isIdList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((id) => Number.isInteger(id) && id > 0);
}

function parseStoredDeck(value: unknown): StoredDeck | null {
  if (value === null || typeof value !== 'object') return null;
  const row = value as { figures?: unknown; plates?: unknown };
  if (!isIdList(row.figures) || !isIdList(row.plates)) return null;
  return { figures: row.figures, plates: row.plates };
}

export function parseDeckSlots(raw: unknown): DeckSlot[] {
  const slots = emptyDeckSlots();
  if (!Array.isArray(raw)) return slots;
  for (let i = 0; i < DECK_SLOT_COUNT; i++) {
    slots[i] = parseStoredDeck(raw[i]);
  }
  return slots;
}

export function parseDevDrafts(raw: unknown): Record<PlayerId, DeckDraft> | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as { 0?: unknown; 1?: unknown };
  const you = parseStoredDeck(row[0]);
  const rival = parseStoredDeck(row[1]);
  if (you === null || rival === null) return null;
  return { 0: you, 1: rival };
}

function browserLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: StorageLike | null, key: string): unknown {
  if (storage === null) return null;
  const raw = storage.getItem(key);
  if (raw === null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readDeckSlots(storage: StorageLike | null = browserLocalStorage()): DeckSlot[] {
  return parseDeckSlots(readJson(storage, DECK_SLOTS_KEY));
}

export function writeDeckSlots(
  slots: readonly DeckSlot[],
  storage: StorageLike | null = browserLocalStorage(),
): void {
  if (storage === null) return;
  storage.setItem(DECK_SLOTS_KEY, JSON.stringify(slots.slice(0, DECK_SLOT_COUNT)));
}

export function readDevDrafts(
  storage: StorageLike | null = browserLocalStorage(),
): Record<PlayerId, DeckDraft> | null {
  return parseDevDrafts(readJson(storage, DEV_DRAFTS_KEY));
}

export function writeDevDrafts(
  drafts: Record<PlayerId, DeckDraft>,
  storage: StorageLike | null = browserLocalStorage(),
): void {
  if (storage === null) return;
  storage.setItem(DEV_DRAFTS_KEY, JSON.stringify({ 0: asStoredDeck(drafts[0]), 1: asStoredDeck(drafts[1]) }));
}

export function slotIsEmpty(slot: DeckSlot): boolean {
  return slot === null || (slot.figures.length === 0 && slot.plates.length === 0);
}
