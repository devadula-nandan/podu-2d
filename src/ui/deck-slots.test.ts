import { describe, expect, it } from 'vitest';
import {
  DECK_SLOT_COUNT,
  asStoredDeck,
  emptyDeckSlots,
  parseDeckSlots,
  parseDevDrafts,
  slotIsEmpty,
} from './deck-slots.js';

describe('deck slots', () => {
  it('starts with six empty wells', () => {
    const slots = emptyDeckSlots();
    expect(slots).toHaveLength(DECK_SLOT_COUNT);
    expect(slots.every(slotIsEmpty)).toBe(true);
  });

  it('keeps a saved roster and leaves other wells empty', () => {
    const saved = asStoredDeck({ figures: [1, 2, 3, 4, 5, 6], plates: [9] });
    const slots = parseDeckSlots([null, saved, { figures: 'nope' }]);
    expect(slotIsEmpty(slots[0] ?? null)).toBe(true);
    expect(slots[1]).toEqual(saved);
    expect(slotIsEmpty(slots[2] ?? null)).toBe(true);
    expect(slots[5] ?? null).toBeNull();
  });

  it('rejects junk drafts so a new visitor still boots starters', () => {
    expect(parseDevDrafts({ 0: { figures: [1], plates: [] } })).toBeNull();
    expect(parseDevDrafts({ 0: { figures: [1], plates: [] }, 1: { figures: [2], plates: [] } })).toEqual({
      0: { figures: [1], plates: [] },
      1: { figures: [2], plates: [] },
    });
  });
});
