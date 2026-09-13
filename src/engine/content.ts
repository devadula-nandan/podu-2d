/**
 * Content, injected.
 *
 * The engine never reads a file. `src/content/load.ts` produces a parsed bundle and the
 * host hands it here; `indexContent` turns it into the lookup shape the rules want and
 * compiles every effect text to DSL clauses once, up front. `src/engine/**` is
 * lint-forbidden from importing the loader precisely so this stays the only door.
 *
 * Three data facts drive the shape, all of them learned the hard way:
 *
 * - **`figure.ability` is an embedded object, not an id.** For 24 figures the inlined
 *   text differs slightly from `abilities.json`, so this module compiles the figure's
 *   *own* inlined text and uses the name only as an identity label. That sidesteps the
 *   join problem completely rather than picking a side in it.
 * - **Figure names are not unique.** Three different figures are called "Dawn Wings
 *   Necrozma". Everything here is keyed by id.
 * - **A wheel segment's effect text lives in `notes`**, so segment clauses are compiled
 *   per segment and kept parallel to the wheel array.
 */
import { compileEffect } from '../content/dsl/compile.js';
import type { Clause } from '../content/dsl/effects.js';
import type { Ability, Figure, Plate } from '../content/schema.js';
import type { ContentFigureId, ContentPlateId } from './ids.js';
import { contentFigureId, contentPlateId } from './ids.js';

export interface FigureContent {
  readonly id: ContentFigureId;
  readonly figure: Figure;
  /** Compiled from the figure's own inlined ability text. Empty when it has no ability. */
  readonly abilityClauses: readonly Clause[];
  /** Parallel to `figure.wheel`: `segmentClauses[i]` belongs to `figure.wheel[i]`. */
  readonly segmentClauses: readonly (readonly Clause[])[];
}

export interface PlateContent {
  readonly id: ContentPlateId;
  readonly plate: Plate;
  readonly clauses: readonly Clause[];
}

export interface EngineContent {
  readonly figures: ReadonlyMap<ContentFigureId, FigureContent>;
  readonly plates: ReadonlyMap<ContentPlateId, PlateContent>;
  /** Kept for provenance and the rules inspector; not a join key for behaviour. */
  readonly abilitiesByName: ReadonlyMap<string, Ability>;
}

export interface ContentInput {
  readonly figures: readonly Figure[];
  readonly plates: readonly Plate[];
  readonly abilities: readonly Ability[];
}

export function indexContent(input: ContentInput): EngineContent {
  const figures = new Map<ContentFigureId, FigureContent>();
  for (const figure of input.figures) {
    figures.set(contentFigureId(figure.id), {
      id: contentFigureId(figure.id),
      figure,
      abilityClauses: figure.ability ? compileEffect(figure.ability.text) : [],
      segmentClauses: figure.wheel.map((segment) => (segment.notes ? compileEffect(segment.notes) : [])),
    });
  }

  const plates = new Map<ContentPlateId, PlateContent>();
  for (const plate of input.plates) {
    plates.set(contentPlateId(plate.id), {
      id: contentPlateId(plate.id),
      plate,
      clauses: compileEffect(plate.effect),
    });
  }

  return {
    figures,
    plates,
    abilitiesByName: new Map(input.abilities.map((ability) => [ability.name, ability])),
  };
}

export class MissingContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingContentError';
  }
}

export function figureContent(content: EngineContent, id: ContentFigureId): FigureContent {
  const found = content.figures.get(id);
  if (found === undefined) throw new MissingContentError(`no figure with content id ${id}`);
  return found;
}

export function plateContent(content: EngineContent, id: ContentPlateId): PlateContent {
  const found = content.plates.get(id);
  if (found === undefined) throw new MissingContentError(`no plate with content id ${id}`);
  return found;
}
