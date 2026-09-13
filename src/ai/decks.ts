/**
 * Default AI decks: fully implemented, no-ability figures only.
 *
 * `createEngine` refuses unimplemented content unless `allowUnimplemented` is set.
 * These helpers never turn that flag on — they only emit ids the coverage registry
 * already marks as implemented, and they skip anything that still carries an ability
 * text (those 4 of the 128 implemented figures).
 */
import { AiError } from './error.js';
import type { ContentFigureId, Engine } from '../engine/index.js';

export function implementedNoAbilityFigureIds(engine: Engine): ContentFigureId[] {
  const ids: ContentFigureId[] = [];
  for (const [id, support] of engine.registry.figures) {
    if (!support.implemented) continue;
    const entry = engine.content.figures.get(id);
    if (entry === undefined || entry.figure.ability !== null) continue;
    ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}

/**
 * First `count` implemented no-ability figures with MP ≥ 2, so a default deck can
 * actually deploy on turn one (the starting player loses 1 MP).
 */
export function defaultAiDeck(engine: Engine, count = 6): ContentFigureId[] {
  const pool = implementedNoAbilityFigureIds(engine).filter((id) => {
    const entry = engine.content.figures.get(id);
    return entry !== undefined && entry.figure.mp >= 2;
  });
  if (pool.length < count) {
    throw new AiError(
      `need ${count} implemented no-ability figures with MP >= 2; the registry has ${pool.length}`,
    );
  }
  return pool.slice(0, count);
}
