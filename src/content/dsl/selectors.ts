import type {
  Allegiance, Comparison, MarkerId, PokemonType, SegmentColor, SpecialCondition, Zone,
} from './primitives.js';

/**
 * Target selection, modelled as an algebra rather than a flat enum.
 *
 * The card text composes targets freely - "The battle opponent and opposing Pokemon
 * within 2 steps of it", "Any Pokemon adjacent to the battle opponent other than this
 * Pokemon" - so a fixed list of 16 named selectors cannot express it. Union and
 * exclusion have to be first-class, and the spatial qualifiers have to be able to
 * anchor on another selector (`within 2 steps OF IT`).
 */
export type Selector =
  /** "this Pokemon" - 1,630 occurrences, by far the most common target. */
  | { readonly kind: 'self' }
  /** "the battle opponent" - 1,458 occurrences. */
  | { readonly kind: 'battleOpponent' }
  /** "it" / "that Pokemon" - refers back to the subject the enclosing clause established. */
  | { readonly kind: 'antecedent' }
  /**
   * "Those that spin White Attacks" - the set produced by the most recent spin check.
   * This is what makes the two-clause spin idiom expressible; see `SpinCheck`.
   */
  | { readonly kind: 'spunResult'; readonly match: SpinPredicate }
  /** Every figure matching all filters. "All opposing Pokemon on the field". */
  | { readonly kind: 'all'; readonly where: readonly Filter[] }
  /** A player picks. "Choose one of your Pokemon on the field", "A Pokemon on the field spins". */
  | {
      readonly kind: 'choose';
      readonly count: number;
      /** `true` when the text allows picking fewer, e.g. "up to 2". */
      readonly upTo: boolean;
      readonly chooser: Chooser;
      readonly where: readonly Filter[];
      /** When set, candidates are this set (union of Bug-on-field / within-N) then filtered. */
      readonly from?: Selector;
    }
  /** "A and B" - 81 clauses join a named target to a spatial set. */
  | { readonly kind: 'union'; readonly of: readonly Selector[] }
  /** "... other than this Pokemon" - appears on 80 clauses for the adjacency idiom alone. */
  | { readonly kind: 'except'; readonly from: Selector; readonly remove: Selector }
  /** Selects nothing. Lets the compiler emit a well-formed clause it can still flag. */
  | { readonly kind: 'none' };

export type Chooser = 'controller' | 'opponent' | 'random';

/**
 * Filters are AND-ed together within one selector. Each corresponds to a qualifier
 * observed in the text; the counts in comments are clause frequencies.
 */
export type Filter =
  /** "on the field" (677), "on the bench" (21), "in your P.C." (24), "in the Ultra Space" (27). */
  | { readonly kind: 'inZone'; readonly zones: readonly Zone[] }
  /** "your" vs "opposing"/"opponent's". Absent in text means `any`. */
  | { readonly kind: 'allegiance'; readonly of: Allegiance }
  /** "adjacent to the battle opponent" (62), "adjacent to this Pokemon" (21). */
  | { readonly kind: 'adjacentTo'; readonly of: Selector }
  /** "within 2 steps" (88) - path distance, ignoring occupancy. */
  | {
      readonly kind: 'within';
      readonly steps: number;
      readonly of: Selector;
      /** "within X+N steps, where X is the number of Pokémon in the Ultra Space". */
      readonly plusZone?: Zone;
    }
  /** Same printed name as the anchor (Phantom Energy surround wipe). */
  | { readonly kind: 'sameNameAs'; readonly of: Selector }
  /** "2 steps away" (114) - exactly N, not at most N. The distinction is load-bearing. */
  | { readonly kind: 'stepsAway'; readonly steps: number; readonly from: Selector }
  /** "in a straight line directly behind it" (104) - a ray, not a radius. */
  | { readonly kind: 'straightLineBehind'; readonly of: Selector }
  /**
   * "a succession of Pokemon adjacent to the battle opponent" (78) - a connected-component
   * walk outward from an anchor, where each step must satisfy the remaining filters.
   * This is a graph traversal, not a distance test, and it is the reason the engine needs
   * three separate board relations rather than one.
   */
  | { readonly kind: 'succession'; readonly from: Selector }
  /** "your Electric-type Pokemon", "your Ghost and Poison Pokemon" - matches ANY listed type. */
  | { readonly kind: 'hasType'; readonly types: readonly PokemonType[] }
  /** "all poisoned Pokemon" - matches ANY listed condition. */
  | { readonly kind: 'hasCondition'; readonly conditions: readonly SpecialCondition[] }
  | { readonly kind: 'hasMarker'; readonly marker: MarkerId }
  /** "if the battle opponent has MP3 or higher". */
  | { readonly kind: 'mp'; readonly op: Comparison; readonly value: number }
  /** "one of your Sceptile" - Mega Evolution and form change target figures by name. */
  | { readonly kind: 'named'; readonly names: readonly string[] }
  | { readonly kind: 'isUltraBeast' }
  | { readonly kind: 'isMegaEvolved'; readonly value: boolean }
  /** "newly moved", used by the Ultra Beast abilities. */
  | { readonly kind: 'movedThisTurn'; readonly value: boolean }
  /** "this Pokémon is at an entry point" / "on your entry point". */
  | { readonly kind: 'atEntryPoint'; readonly whose?: 'controller' | 'opponent' | 'any' }
  /** Figures owned by the player whose entry the anchor occupies. */
  | { readonly kind: 'ownedByEntryOf'; readonly of: Selector }
  /** Occupied figures this mover crossed on its last MP path. */
  | { readonly kind: 'passedThroughBy'; readonly of: Selector }
  /** MP-reducing markers live in `mpDelta`, not the named-marker slot. */
  | { readonly kind: 'hasMpReducer' }
  | { readonly kind: 'not'; readonly filter: Filter };

/**
 * A predicate over a spin outcome.
 *
 * The compound form matters: "a Miss or a White Attack of 120 damage or more" is 60
 * clauses on its own, and it is a disjunction where one branch carries a damage
 * threshold and the other does not. Flattening this to a colour list would lose the
 * threshold and silently knock out figures that should survive.
 */
export type SpinPredicate =
  | { readonly kind: 'color'; readonly colors: readonly SegmentColor[] }
  | {
      readonly kind: 'damage';
      readonly colors: readonly SegmentColor[];
      readonly op: Comparison;
      readonly value: number;
    }
  /** "an Attack other than Dragon Dance" - the respin loops key off the move's identity. */
  | { readonly kind: 'move'; readonly names: readonly string[] }
  | { readonly kind: 'anyOf'; readonly of: readonly SpinPredicate[] }
  | { readonly kind: 'not'; readonly of: SpinPredicate }
  /** Matches whatever was spun, for clauses that only care that a spin happened. */
  | { readonly kind: 'any' };

// --- constructors -----------------------------------------------------------
// Terse builders, so both the compiler and the hand-written content read cleanly.

export const self = (): Selector => ({ kind: 'self' });
export const battleOpponent = (): Selector => ({ kind: 'battleOpponent' });
export const antecedent = (): Selector => ({ kind: 'antecedent' });
export const all = (...where: Filter[]): Selector => ({ kind: 'all', where });
export const union = (...of: Selector[]): Selector => ({ kind: 'union', of });
export const except = (from: Selector, remove: Selector): Selector => ({ kind: 'except', from, remove });

export const onField = (): Filter => ({ kind: 'inZone', zones: ['field'] });
export const opposing = (): Filter => ({ kind: 'allegiance', of: 'opposing' });
export const ally = (): Filter => ({ kind: 'allegiance', of: 'ally' });
export const within = (steps: number, of: Selector): Filter => ({ kind: 'within', steps, of });
export const adjacentTo = (of: Selector): Filter => ({ kind: 'adjacentTo', of });
export const spunColor = (...colors: SegmentColor[]): SpinPredicate => ({ kind: 'color', colors });
