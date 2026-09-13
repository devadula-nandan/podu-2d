/**
 * Engine-local numbers that are *not* rulings.
 *
 * `src/rules/constants.ts` is the place a ruling gets flipped, and this file is
 * deliberately not that place. Everything here is either an implementation safety valve
 * or a value a source states plainly but that the rules module does not currently
 * export. Each entry says which it is, because the distinction is the whole point: a
 * reader must be able to tell "somebody decided this" from "somebody measured this".
 *
 * If any of these turns out to be contested, it should move to `src/rules/constants.ts`
 * with a `RulingNote`, not stay here with a longer comment.
 */

/**
 * Wait applied to the figure the P.C. evicts when a third arrives.
 *
 * Sourced, not chosen: Smogon describes the ejected figure as returning "ready to be
 * used after a one-turn waiting delay", and the Amino guide independently says it
 * "will have to wait 1 extra turn". Not currently exported by `src/rules/constants.ts`,
 * which has `PC_CAPACITY` and `PC_OVERFLOW_IS_FIFO` but no duration; it arguably
 * belongs there.
 */
export const PC_OVERFLOW_WAIT_TURNS = 1;

/** Wait applied by an `attachMarker` clause whose text names no magnitude. */
export const DEFAULT_WAIT_TURNS = 1;

/**
 * Safety valve on the repeat-until-miss multiplier loop.
 *
 * "Spin again until Bullet Seed does not land" terminates only because every wheel has
 * a Miss - and `docs/RULES.md` section 9 is explicit that "every wheel has a Miss" is a
 * content *warning*, not a guaranteed invariant. An unbounded loop over a hypothetical
 * Miss-less wheel would hang the engine, the AI and the fuzz harness at once, so the
 * loop is capped. 96 is one full wheel's worth of units and is far beyond any real
 * multiplier chain, so the cap can only ever fire on malformed content.
 */
export const MULTIPLIER_REPEAT_CAP = 96;

/** Same reasoning, for stacked respins: a respin chain cannot exceed this many spins. */
export const RESPIN_CHAIN_CAP = 32;

/**
 * The Z-Move gauge's maximum.
 *
 * 51 clauses move the gauge and every one of them is expressed as a *fraction of max*
 * ("reduces the opponent's Z-Move gauge by two thirds of its max value"), so the corpus
 * fixes the shape of the mechanic while saying nothing about the scale. 100 is a
 * placeholder chosen so the fractions land on whole numbers; no source states a value.
 * A Z-Move is legal only at a full gauge and spends it to 0. Both the scale and
 * that spend rule are guesses: no source states either number.
 */
export const Z_GAUGE_MAX = 100;

/**
 * The flat damage each special condition costs its bearer.
 *
 * Measured, not chosen: the table in `docs/RULES.md` section 5 states Poisoned -20,
 * Noxious -40 and Burn -10, and gives the other four no damage effect at all. Noxious
 * is a separate rung from Poisoned rather than a synonym - Mega Beedrill's text branches
 * on both in one sentence - so the two entries are genuinely different numbers and not
 * a duplicate.
 *
 * Lives here rather than in `src/rules/constants.ts` only because that module does not
 * export it today. Nothing about it is contested.
 */
export const CONDITION_DAMAGE_MODIFIER = {
  poisoned: -20,
  noxious: -40,
  burned: -10,
  paralyzed: 0,
  asleep: 0,
  frozen: 0,
  confused: 0,
} as const;

/**
 * How many figures a deck holds. Stated by the official primer ("All six of each
 * player's Pokemon begin on the bench") and by every other source; not a ruling.
 */
export const DECK_FIGURE_COUNT = 6;

/**
 * Max copies of one printed name in a deck, unless the figure's ability says
 * the 3 Pokémon limit does not apply. Official primer / every source; not a ruling.
 */
export const FIGURE_COPY_LIMIT = 3;
