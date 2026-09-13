/**
 * The closed vocabularies of the effect DSL.
 *
 * Everything here was enumerated from the 3,863 atomic clauses in the real card text
 * (see `tools/dsl-vocab.mjs`), not from guesswork. Where the data showed an open set,
 * it is modelled as an open registry instead of a union - that distinction is the
 * difference between a schema that accepts the corpus and one that rejects a third
 * of it.
 */

/** The 18 Pokemon types present on the 596 figures. */
export const POKEMON_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;
export type PokemonType = (typeof POKEMON_TYPES)[number];

/**
 * Wheel segment colours. `miss` is the engine's name for what the card text calls a
 * Red segment, because every rule that references it says "spins a Miss".
 */
export const SEGMENT_COLORS = ['white', 'gold', 'purple', 'blue', 'miss'] as const;
export type SegmentColor = (typeof SEGMENT_COLORS)[number];

/**
 * Exactly seven special conditions. `noxious` is genuinely distinct from `poisoned`
 * rather than a synonym - Mega Beedrill's text proves it by branching on both in one
 * sentence: "If the battle opponent is noxious, exclude it from the duel. If it's not
 * noxious, the battle opponent becomes poisoned."
 */
export const SPECIAL_CONDITIONS = [
  'asleep', 'burned', 'confused', 'frozen', 'paralyzed', 'poisoned', 'noxious',
] as const;
export type SpecialCondition = (typeof SPECIAL_CONDITIONS)[number];

/**
 * Markers are an OPEN set, which is the single most important schema decision here.
 * An early draft modelled them as a 7-member union; the corpus actually contains at
 * least 19 named kinds, many appearing once or twice (Symbiont, Forest Mischief,
 * Clinging Gas, Weak Armor, Pumpkin, Disguise...). A union would have silently
 * rejected the long tail, so markers are string ids resolved against a registry that
 * fails loudly on an unknown name.
 *
 * `wait` and the MP markers are called out only because engine rules reference them
 * directly - they are ordinary registry entries, not special cases.
 */
export type MarkerId = string & { readonly __brand: 'MarkerId' };
export const marker = (id: string): MarkerId => id as MarkerId;

export const WAIT = marker('wait');
export const MP_MODIFIER = marker('mpModifier');

/** Where a figure can be. The board is only one of several places a figure lives. */
export const ZONES = ['field', 'bench', 'pc', 'ultraSpace', 'excluded'] as const;
export type Zone = (typeof ZONES)[number];

/** Whose figures a selector is allowed to match. */
export const ALLEGIANCES = ['ally', 'opposing', 'any'] as const;
export type Allegiance = (typeof ALLEGIANCES)[number];

export type Comparison = 'eq' | 'ne' | 'gte' | 'lte' | 'gt' | 'lt';

/** Branded ids, so a FigureId can never be passed where an AbilityId is wanted. */
export type FigureId = number & { readonly __brand: 'FigureId' };
export type AbilityId = string & { readonly __brand: 'AbilityId' };
export type PlateId = number & { readonly __brand: 'PlateId' };
export type ClauseId = string & { readonly __brand: 'ClauseId' };
