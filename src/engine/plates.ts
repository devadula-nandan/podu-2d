/**
 * Plate economy: deck validation, playability, and the stand-in a plate uses for `self`.
 *
 * Mega Stones carry `cost: null` and do not count toward the budget of 8; they still
 * occupy one of the six slots. Resettable plates are the ones whose compiled text
 * emits `refreshPlate` — Recycle, Gracidea, Meteoric Teachings — not a curated flag.
 */
import { PLATE_COST_BUDGET, PLATE_DECK_SLOTS } from '../rules/constants.js';
import type { Clause } from '../content/dsl/effects.js';
import type { Figure, Plate } from '../content/schema.js';
import { FIGURE_COPY_LIMIT } from './constants.js';
import type { FigureUid, PlayerId } from './ids.js';
import type { GameState, PlateSlot } from './state.js';

/** A Mega Stone's `null` cost is zero toward the budget, not a missing 1|2|3. */
export const plateCostTowardBudget = (plate: Plate): number => plate.cost ?? 0;

export function plateDeckCost(plates: readonly Plate[]): number {
  return plates.reduce((sum, plate) => sum + plateCostTowardBudget(plate), 0);
}

/** Problems that make a plate list illegal as a deck. Empty means the list is legal. */
export function plateDeckIssues(plates: readonly Plate[]): string[] {
  const issues: string[] = [];
  if (plates.length > PLATE_DECK_SLOTS) {
    issues.push(`${plates.length} plates; the deck has ${PLATE_DECK_SLOTS} slots`);
  }
  const cost = plateDeckCost(plates);
  if (cost > PLATE_COST_BUDGET) {
    issues.push(`plate cost ${cost} exceeds the budget of ${PLATE_COST_BUDGET}`);
  }
  return issues;
}

/**
 * Figures whose ability says they can only be set as a form.
 *
 * Derived from the printed text, not a schema field — there is no `formOnly` flag.
 */
export function isFormOnlyFigure(figure: Figure): boolean {
  return /can only be set as a form/i.test(figure.ability?.text ?? '');
}

/** Printed exemption: this copy does not count toward `FIGURE_COPY_LIMIT`. */
export function isDeckLimitExempt(figure: Figure): boolean {
  return /the \d+-?\s*pok[eé]mon limit does not apply/i.test(figure.ability?.text ?? '');
}

/**
 * Copy-limit problems for a figure list. Does not enforce a six-figure size —
 * tests and the harness legally field fewer.
 */
export function figureDeckIssues(figures: readonly Figure[]): string[] {
  const limited = new Map<string, number>();
  for (const figure of figures) {
    if (isDeckLimitExempt(figure)) continue;
    limited.set(figure.name, (limited.get(figure.name) ?? 0) + 1);
  }
  const issues: string[] = [];
  for (const [name, count] of [...limited.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (count > FIGURE_COPY_LIMIT) {
      issues.push(`${count} copies of ${name}; the ${FIGURE_COPY_LIMIT} Pokémon limit allows ${FIGURE_COPY_LIMIT}`);
    }
  }
  return issues;
}

export function isInsteadOfMoveClause(clause: Clause): boolean {
  return /instead of (?:using |making )?(?:an )?mp move/i.test(clause.source);
}

export function isInsteadOfAttackClause(clause: Clause): boolean {
  return /instead of attacking/i.test(clause.source);
}

export function isVoluntaryFormClause(clause: Clause): boolean {
  return /may change (its )?form/i.test(clause.source) && !/before using this pok/i.test(clause.source);
}

export function isPreSelectClause(clause: Clause): boolean {
  return /before using this pok/i.test(clause.source);
}

export function isActivableAbilityClause(clause: Clause): boolean {
  return isInsteadOfMoveClause(clause) || isInsteadOfAttackClause(clause) || isVoluntaryFormClause(clause);
}

export function isTimeTravelClause(clause: Clause): boolean {
  return /return the duel to the start of your previous turn/i.test(clause.source);
}

/**
 * The figure a plate's `self` selector resolves against.
 *
 * Lowest-uid field figure of the controller, then any owned figure. Plates must still
 * execute when nobody is on the field — that was the stub this replaces.
 */
export function plateStandIn(state: GameState, player: PlayerId): FigureUid | null {
  const owned = state.figures.filter((figure) => figure.owner === player);
  const field = owned.filter((figure) => figure.zone === 'field');
  const pool = field.length > 0 ? field : owned;
  const stand = [...pool].sort((a, b) => a.uid - b.uid)[0];
  return stand?.uid ?? null;
}

/** First `count` used plate slots, in slot order — the plates `refreshPlate` restores. */
export function usedPlateSlots(
  state: GameState,
  player: PlayerId,
  count: number,
  filter?: (slot: PlateSlot, index: number) => boolean,
): number[] {
  const slots: number[] = [];
  state.players[player].plates.forEach((slot, index) => {
    if (slot.used && (filter === undefined || filter(slot, index))) slots.push(index);
  });
  return slots.slice(0, Math.max(0, count));
}
