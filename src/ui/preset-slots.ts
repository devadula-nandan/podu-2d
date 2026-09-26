import type { Engine, PlayerId } from '../engine/index.js';
import { defaultSeatDrafts, resolvedPresets } from '../player/presets.js';
import { starterFigureIds } from './boot.js';
import {
  DECK_SLOT_COUNT,
  DECK_SLOTS_KEY_V1,
  DECK_SLOTS_KEY_V2,
  DECK_SLOTS_KEY_V3,
  DEV_DRAFTS_KEY_V1,
  DEV_DRAFTS_KEY_V2,
  PRESETS_REV,
  asStoredDeck,
  emptyDeckSlots,
  parseDeckSlots,
  parseDevDrafts,
  readDeckSlots,
  readDevDrafts,
  slotIsEmpty,
  writeDeckSlots,
  type DeckSlot,
  type StorageLike,
  type StoredDeck,
} from './deck-slots.js';
import { FIGURES_PER_DECK, PLATES_PER_DECK, type DeckDraft } from './model.js';

const PRESETS_REV_KEY = 'podu:presets-rev';

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw(storage: StorageLike | null, key: string): unknown {
  if (storage === null) return null;
  const raw = storage.getItem(key);
  if (raw === null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sameFigures(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function isStarterDraft(engine: Engine, draft: DeckDraft): boolean {
  const pack = starterFigureIds(engine);
  if (draft.plates.length !== 0) return false;
  return sameFigures(draft.figures, pack[0]) || sameFigures(draft.figures, pack[1]);
}

function isStarterSlot(engine: Engine, slot: DeckSlot): boolean {
  if (slotIsEmpty(slot) || slot === null) return true;
  return isStarterDraft(engine, { figures: slot.figures, plates: slot.plates });
}

export function namedPresetSlots(engine: Engine): DeckSlot[] {
  const slots = emptyDeckSlots();
  resolvedPresets(engine)
    .slice(0, DECK_SLOT_COUNT)
    .forEach(({ preset, draft }, index) => {
      slots[index] = asStoredDeck(draft, preset.name);
    });
  return slots;
}

function looksComplete(draft: { readonly figures: readonly number[]; readonly plates: readonly number[] }): boolean {
  return draft.figures.length === FIGURES_PER_DECK && draft.plates.length === PLATES_PER_DECK;
}

function fillIncomplete(
  existing: readonly DeckSlot[],
  presets: readonly DeckSlot[],
): DeckSlot[] {
  return Array.from({ length: DECK_SLOT_COUNT }, (_, i) => {
    const slot = existing[i] ?? null;
    return slot !== null && looksComplete(slot) ? slot : (presets[i] ?? null);
  });
}

function readLegacySlots(storage: StorageLike | null): DeckSlot[] {
  const v4 = readDeckSlots(storage);
  if (v4.some((slot) => !slotIsEmpty(slot))) return v4;
  const v3 = parseDeckSlots(readRaw(storage, DECK_SLOTS_KEY_V3));
  if (v3.some((slot) => !slotIsEmpty(slot))) return v3;
  const v2 = parseDeckSlots(readRaw(storage, DECK_SLOTS_KEY_V2));
  if (v2.some((slot) => !slotIsEmpty(slot))) return v2;
  return parseDeckSlots(readRaw(storage, DECK_SLOTS_KEY_V1));
}

function presetsRevStale(storage: StorageLike | null): boolean {
  if (storage === null) return false;
  const raw = storage.getItem(PRESETS_REV_KEY);
  return raw !== String(PRESETS_REV);
}

export function loadInitialSlots(
  engine: Engine,
  storage: StorageLike | null = browserStorage(),
): DeckSlot[] {
  const presets = namedPresetSlots(engine);
  if (presetsRevStale(storage)) {
    writeDeckSlots(presets, storage);
    storage?.setItem(PRESETS_REV_KEY, String(PRESETS_REV));
    return presets;
  }
  const existing = readLegacySlots(storage);
  if (existing.every((slot) => isStarterSlot(engine, slot))) {
    writeDeckSlots(presets, storage);
    storage?.setItem(PRESETS_REV_KEY, String(PRESETS_REV));
    return presets;
  }
  const filled = fillIncomplete(existing, presets);
  writeDeckSlots(filled, storage);
  storage?.setItem(PRESETS_REV_KEY, String(PRESETS_REV));
  return filled;
}

function keepDraft(engine: Engine, live: DeckDraft, fallback: DeckDraft): DeckDraft {
  if (isStarterDraft(engine, live) || !looksComplete(live)) return fallback;
  return live;
}

export function loadInitialDrafts(
  engine: Engine,
  storage: StorageLike | null = browserStorage(),
): Record<PlayerId, DeckDraft> {
  const defaults = defaultSeatDrafts(engine);
  const live =
    readDevDrafts(storage) ??
    parseDevDrafts(readRaw(storage, DEV_DRAFTS_KEY_V2)) ??
    parseDevDrafts(readRaw(storage, DEV_DRAFTS_KEY_V1));
  if (live === null) return defaults;
  if (isStarterDraft(engine, live[0]) && isStarterDraft(engine, live[1])) return defaults;
  return {
    0: keepDraft(engine, live[0], defaults[0]),
    1: keepDraft(engine, live[1], defaults[1]),
  };
}

export function slotLabel(slot: StoredDeck | null, index: number): string {
  if (slot?.name) return slot.name;
  return `Slot ${index + 1}`;
}
