import { describe, expect, it } from 'vitest';
import { contentFigureId, contentPlateId, isFormOnlyFigure } from '../engine/index.js';
import { bootEngine, figureOfContent, plateOfContent } from '../ui/boot.js';
import { PLATE_COST_CAP, plateCost, validateDeck, deckHasErrors } from '../ui/model.js';
import { DECK_PRESETS, resolvedPresets, rivalStrategyDraft } from './presets.js';

describe('player presets', () => {
  it('resolves exactly six strategy decks under allowUnimplemented', async () => {
    const engine = await bootEngine();
    const rows = resolvedPresets(engine);
    expect(DECK_PRESETS).toHaveLength(6);
    expect(rows).toHaveLength(6);
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
      expect(preset.plates).toHaveLength(6);
      expect(draft.plates).toHaveLength(6);
    }
  });

  it('gives vs-AI a different strategy deck than the human pick', async () => {
    const engine = await bootEngine();
    const rows = resolvedPresets(engine);
    const human = rows.find((row) => row.preset.id === 'stone-guard');
    expect(human).toBeDefined();
    const rival = rivalStrategyDraft(engine, 5001, 'stone-guard');
    expect(rival.figures).toHaveLength(6);
    expect(rival.figures.join(',')).not.toBe(human?.draft.figures.join(','));

    for (const id of ['stone-guard', 'swift-pack'] as const) {
      const draft = rows.find((row) => row.preset.id === id)?.draft;
      expect(draft).toBeDefined();
      if (draft === undefined) continue;
      const opened = engine.createGame({
        seed: 5001,
        startingPlayer: 1,
        decks: {
          0: {
            figures: draft.figures.map(contentFigureId),
            plates: draft.plates.map(contentPlateId),
          },
          1: {
            figures: rival.figures.map(contentFigureId),
            plates: rival.plates.map(contentPlateId),
          },
        },
        allowUnimplemented: true,
      });
      expect(opened.nextState.pending).toBeNull();
      expect(opened.nextState.turn.player).toBe(1);
      const legal = engine.legalCommands(opened.nextState);
      expect(legal.some((command) => command.kind === 'deploy' && command.player === 1)).toBe(true);
    }

    const stone = rows.find((row) => row.preset.id === 'stone-guard');
    expect(stone).toBeDefined();
    if (stone === undefined) return;
    const opened = engine.createGame({
      seed: 5001,
      startingPlayer: 1,
      decks: {
        0: {
          figures: stone.draft.figures.map(contentFigureId),
          plates: stone.draft.plates.map(contentPlateId),
        },
        1: {
          figures: rival.figures.map(contentFigureId),
          plates: rival.plates.map(contentPlateId),
        },
      },
      allowUnimplemented: true,
    });
    expect(opened.nextState.pending).toBeNull();
  });
});
