import abilitiesJson from '../../data/content/abilities.json';
import figuresJson from '../../data/content/figures.json';
import platesJson from '../../data/content/plates.json';
import { abilitiesSchema, figuresSchema, parseOrThrow, platesSchema } from '../content/schema.js';
import type { Figure, Plate } from '../content/schema.js';
import { contentFigureId, contentPlateId, createEngine, isFormOnlyFigure } from '../engine/index.js';
import type { Engine } from '../engine/index.js';

export function bootEngine(): Engine {
  const figures = parseOrThrow('figure', figuresSchema, figuresJson);
  const plates = parseOrThrow('plate', platesSchema, platesJson);
  const abilities = parseOrThrow('ability', abilitiesSchema, abilitiesJson);
  return createEngine({ figures, plates, abilities });
}

export function figureOfContent(engine: Engine, id: number): Figure | null {
  return engine.content.figures.get(contentFigureId(id))?.figure ?? null;
}

export function plateOfContent(engine: Engine, id: number): Plate | null {
  return engine.content.plates.get(contentPlateId(id))?.plate ?? null;
}

/**
 * Six + six fully implemented, ability-less, MP≥2 figures. `createEngine` refuses
 * unimplemented content on the default path, and the first-turn MP−1 penalty makes
 * 1 MP figures undeployable for the starting player.
 */
export function starterFigureIds(engine: Engine): readonly [readonly number[], readonly number[]] {
  const preferred: number[] = [];
  const fallback: number[] = [];
  for (const support of engine.registry.figures.values()) {
    if (!support.implemented) continue;
    const figure = engine.content.figures.get(support.id)?.figure;
    if (figure === undefined) continue;
    if (figure.mp < 2) continue;
    if (isFormOnlyFigure(figure)) continue;
    if (figure.form !== null) {
      fallback.push(figure.id);
      continue;
    }
    if (figure.ability !== null) {
      fallback.push(figure.id);
      continue;
    }
    preferred.push(figure.id);
  }
  const pool = preferred.length >= 12 ? preferred : [...preferred, ...fallback];
  const sorted = [...pool].sort((a, b) => a - b);
  if (sorted.length < 12) {
    throw new Error(`need 12 fully implemented MP≥2 figures for starter decks; found ${sorted.length}`);
  }
  return [sorted.slice(0, 6), sorted.slice(6, 12)];
}
