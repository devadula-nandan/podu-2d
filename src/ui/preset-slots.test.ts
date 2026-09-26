import { describe, expect, it } from 'vitest';
import { bootEngine } from './boot.js';
import { DECK_SLOT_COUNT, slotIsEmpty, type StorageLike } from './deck-slots.js';
import { loadInitialDrafts, loadInitialSlots, namedPresetSlots } from './preset-slots.js';
import { defaultSeatDrafts } from '../player/presets.js';
import { starterFigureIds } from './boot.js';

function memory(init: Record<string, string> = {}): StorageLike {
  const data = { ...init };
  return {
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe('preset slots', () => {
  it('seeds six named wells for a new visitor', async () => {
    const engine = await bootEngine();
    const slots = namedPresetSlots(engine);
    expect(slots).toHaveLength(DECK_SLOT_COUNT);
    expect(slots.every((slot) => !slotIsEmpty(slot))).toBe(true);
    expect(slots[0]?.name).toBe('Starter Squad');
    expect(slots[1]?.name).toBe('Stone Guard');
  });

  it('defaults You to preset 1 and Rival to preset 2', async () => {
    const engine = await bootEngine();
    const drafts = loadInitialDrafts(engine, memory());
    const seats = defaultSeatDrafts(engine);
    expect(drafts[0]).toEqual(seats[0]);
    expect(drafts[1]).toEqual(seats[1]);
  });

  it('does not overwrite a complete custom well', async () => {
    const engine = await bootEngine();
    const custom = { figures: [1, 2, 3, 4, 5, 6], plates: [10, 11, 12, 13, 14, 15], name: 'My Team' };
    const storage = memory({
      'podu:presets-rev': '4',
      'podu:deck-slots:v4': JSON.stringify([custom, null, null, null, null, null]),
    });
    const slots = loadInitialSlots(engine, storage);
    expect(slots[0]).toEqual(custom);
    expect(slots[1]?.name).toBe('Stone Guard');
  });

  it('resets stock slots when the preset revision bumps', async () => {
    const engine = await bootEngine();
    const storage = memory({
      'podu:presets-rev': '3',
      'podu:deck-slots:v4': JSON.stringify([
        { figures: [1, 2, 3, 4, 5, 6], plates: [10, 11, 12, 13, 14, 15], name: 'Night League' },
        null,
        null,
        null,
        null,
        null,
      ]),
    });
    const slots = loadInitialSlots(engine, storage);
    expect(slots[0]?.name).toBe('Starter Squad');
    expect(storage.getItem('podu:presets-rev')).toBe('4');
  });

  it('upgrades incomplete wells to complete presets', async () => {
    const engine = await bootEngine();
    const partial = { figures: [1, 2, 3, 4, 5, 6], plates: [] };
    const storage = memory({
      'podu:deck-slots:v2': JSON.stringify([partial, null, null, null, null, null]),
    });
    const slots = loadInitialSlots(engine, storage);
    expect(slots[0]?.name).toBe('Starter Squad');
    expect(slots[0]?.figures).toHaveLength(6);
    expect(slots[0]?.plates).toHaveLength(6);
  });

  it('upgrades old starter-six drafts', async () => {
    const engine = await bootEngine();
    const pack = starterFigureIds(engine);
    const storage = memory({
      'podu:dev-drafts:v1': JSON.stringify({
        0: { figures: [...pack[0]], plates: [] },
        1: { figures: [...pack[1]], plates: [] },
      }),
    });
    const drafts = loadInitialDrafts(engine, storage);
    expect(drafts).toEqual(defaultSeatDrafts(engine));
  });
});
