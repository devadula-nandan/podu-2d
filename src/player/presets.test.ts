import { describe, expect, it } from 'vitest';
import { isFormOnlyFigure } from '../engine/index.js';
import { bootEngine, figureOfContent, plateOfContent } from '../ui/boot.js';
import { PLATE_COST_CAP, plateCost, validateDeck, deckHasErrors } from '../ui/model.js';
import { DECK_PRESETS, resolvedPresets } from './presets.js';

describe('player presets', () => {
  it('resolves six legal six-figure decks under allowUnimplemented', () => {
    const engine = bootEngine();
    const rows = resolvedPresets(engine);
    expect(rows).toHaveLength(DECK_PRESETS.length);
    const names = new Set(rows.map((row) => row.preset.id));
    expect(names.size).toBe(6);
    for (const { draft, preset } of rows) {
      expect(draft.figures).toHaveLength(6);
      expect(deckHasErrors(validateDeck(engine, draft, true))).toBe(false);
      const cost = draft.plates.reduce((sum, id) => {
        const plate = plateOfContent(engine, id);
        return sum + (plate === null ? 99 : plateCost(plate));
      }, 0);
      expect(cost).toBeLessThanOrEqual(PLATE_COST_CAP);
      for (const id of draft.figures) {
        const figure = figureOfContent(engine, id);
        expect(figure).not.toBeNull();
        if (figure === null) continue;
        expect(isFormOnlyFigure(figure)).toBe(false);
      }
      expect(preset.figures).toHaveLength(6);
    }
  });
});
