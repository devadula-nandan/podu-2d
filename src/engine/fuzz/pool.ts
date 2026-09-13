/**
 * Implemented-only figure and plate pools, and seeded deck construction.
 *
 * `allowUnimplemented` stays off. A deck that the coverage registry cannot fully run
 * is a setup bug in this file, not a game the walker should have to tolerate.
 */
import { PLATE_COST_BUDGET, PLATE_DECK_SLOTS } from '../../rules/constants.js';
import { DECK_FIGURE_COUNT } from '../constants.js';
import type { Engine } from '../dispatch.js';
import type { ContentFigureId, ContentPlateId, PlayerId } from '../ids.js';
import { FIGURE_COPY_LIMIT } from '../constants.js';
import { isDeckLimitExempt, isFormOnlyFigure, plateCostTowardBudget } from '../plates.js';
import { createRng, nextInt, pick, shuffle } from '../rng.js';
import type { RngState } from '../rng.js';
import type { DeckSetup, GameSetup } from '../setup.js';

export type FigureMix = 'noAbility' | 'withAbility' | 'mixed';

export interface FuzzPools {
  readonly noAbility: readonly ContentFigureId[];
  readonly withAbility: readonly ContentFigureId[];
  readonly plates: readonly ContentPlateId[];
}

export interface BuiltDecks {
  readonly setup: GameSetup;
  readonly mix: readonly [FigureMix, FigureMix];
}

const MIXES: readonly FigureMix[] = ['noAbility', 'withAbility', 'mixed'];

export function fuzzPools(engine: Engine): FuzzPools {
  const noAbility: ContentFigureId[] = [];
  const withAbility: ContentFigureId[] = [];
  for (const [id, support] of engine.registry.figures) {
    if (!support.implemented) continue;
    const entry = engine.content.figures.get(id);
    if (entry === undefined) continue;
    if (isFormOnlyFigure(entry.figure)) continue;
    if (entry.figure.ability === null) noAbility.push(id);
    else withAbility.push(id);
  }
  noAbility.sort((a, b) => a - b);
  withAbility.sort((a, b) => a - b);

  const plates: ContentPlateId[] = [];
  for (const [id, support] of engine.registry.plates) {
    if (support.implemented) plates.push(id);
  }
  plates.sort((a, b) => a - b);

  return { noAbility, withAbility, plates };
}

function takeFigures(
  rng: RngState,
  engine: Engine,
  pool: readonly ContentFigureId[],
  count: number,
): { ids: ContentFigureId[]; rng: RngState } {
  if (pool.length < count) {
    throw new Error(`need ${count} implemented figures in this pool; have ${pool.length}`);
  }
  const shuffled = shuffle(rng, pool);
  const ids: ContentFigureId[] = [];
  const limited = new Map<string, number>();
  for (const id of shuffled.value) {
    if (ids.length >= count) break;
    const figure = engine.content.figures.get(id)?.figure;
    if (figure === undefined) continue;
    if (!isDeckLimitExempt(figure)) {
      const have = limited.get(figure.name) ?? 0;
      if (have >= FIGURE_COPY_LIMIT) continue;
      limited.set(figure.name, have + 1);
    }
    ids.push(id);
  }
  if (ids.length < count) {
    throw new Error(`need ${count} figures under the ${FIGURE_COPY_LIMIT}-copy limit; have ${ids.length}`);
  }
  return { ids, rng: shuffled.rng };
}

function figurePoolFor(mix: FigureMix, pools: FuzzPools): ContentFigureId[] {
  switch (mix) {
    case 'noAbility':
      return [...pools.noAbility];
    case 'withAbility':
      return pools.withAbility.length >= DECK_FIGURE_COUNT
        ? [...pools.withAbility]
        : [...pools.withAbility, ...pools.noAbility];
    case 'mixed':
      return [...pools.noAbility, ...pools.withAbility];
  }
}

function pickMix(rng: RngState, pools: FuzzPools): { mix: FigureMix; rng: RngState } {
  const usable = MIXES.filter((mix) => {
    if (mix === 'withAbility') return pools.withAbility.length >= 1;
    if (mix === 'noAbility') return pools.noAbility.length >= DECK_FIGURE_COUNT;
    return pools.noAbility.length + pools.withAbility.length >= DECK_FIGURE_COUNT;
  });
  const drawn = pick(rng, usable);
  if (drawn.value === null) throw new Error('no implemented figures available for a six-figure deck');
  return { mix: drawn.value, rng: drawn.rng };
}

function pickPlates(
  rng: RngState,
  engine: Engine,
  pools: FuzzPools,
): { plates: ContentPlateId[]; rng: RngState } {
  const want = nextInt(rng, PLATE_DECK_SLOTS + 1);
  if (want.value === 0 || pools.plates.length === 0) return { plates: [], rng: want.rng };
  const shuffled = shuffle(want.rng, pools.plates);
  const picked: ContentPlateId[] = [];
  let cost = 0;
  for (const id of shuffled.value) {
    if (picked.length >= want.value) break;
    const plate = engine.content.plates.get(id)?.plate;
    if (plate === undefined) continue;
    const add = plateCostTowardBudget(plate);
    if (cost + add > PLATE_COST_BUDGET) continue;
    picked.push(id);
    cost += add;
  }
  return { plates: picked, rng: shuffled.rng };
}

function oneDeck(
  rng: RngState,
  engine: Engine,
  pools: FuzzPools,
  mix: FigureMix,
): { deck: DeckSetup; rng: RngState } {
  const figures = takeFigures(rng, engine, figurePoolFor(mix, pools), DECK_FIGURE_COUNT);
  const plates = pickPlates(figures.rng, engine, pools);
  return {
    deck: { figures: figures.ids, plates: plates.plates },
    rng: plates.rng,
  };
}

/**
 * Build two legal six-figure decks from the implemented pools.
 *
 * The walker RNG is a *different* stream (see `walk.ts`); this generator is only for
 * deck construction and the starting player so a seed still reproduces the pairing.
 */
export function buildDecks(engine: Engine, seed: number, pools: FuzzPools = fuzzPools(engine)): BuiltDecks {
  let rng = createRng(seed);
  const start = nextInt(rng, 2);
  rng = start.rng;
  const startingPlayer: PlayerId = start.value === 0 ? 0 : 1;

  const mix0 = pickMix(rng, pools);
  rng = mix0.rng;
  const mix1 = pickMix(rng, pools);
  rng = mix1.rng;

  const d0 = oneDeck(rng, engine, pools, mix0.mix);
  rng = d0.rng;
  const d1 = oneDeck(rng, engine, pools, mix1.mix);

  return {
    mix: [mix0.mix, mix1.mix],
    setup: {
      seed,
      startingPlayer,
      decks: { 0: d0.deck, 1: d1.deck },
    },
  };
}
