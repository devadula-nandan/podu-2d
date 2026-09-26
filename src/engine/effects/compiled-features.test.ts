/**
 * Standing ability grants only work if they compile as live passives.
 *
 * `grantMovement` / `modifyMp` / `grantLeap` are queries over `passive` and
 * `duringBattle` clauses. An Arrow-style ability that compiles those verbs under
 * `onAttackResolve` looks implemented and does nothing on the field.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Action, Clause } from '../../content/dsl/effects.js';
import type { Ability, Figure, Plate } from '../../content/schema.js';
import { createEngine } from '../dispatch.js';
import { isFormOnlyFigure, isInsteadOfMoveClause } from '../plates.js';
import { harness, makeFigure, onField, uid } from '../test/helpers.js';
import { movementPoints } from '../rules/movement.js';
import { movementGrantsFor } from './bus.js';

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(`data/content/${name}.json`, 'utf8'));
}

const engine = createEngine({
  figures: loadJson('figures') as Figure[],
  plates: loadJson('plates') as Plate[],
  abilities: loadJson('abilities') as Ability[],
});

const LIVE = new Set(['passive', 'duringBattle']);

function standingActions(clause: Clause): Action[] {
  return clause.actions.filter((action) => {
    if (action.do === 'grantMovement' && action.grant !== 'extraStep') return true;
    if (action.do === 'grantLeap' || action.do === 'grantStraightMp') return true;
    if (action.do === 'modifyMp' || action.do === 'setMp' || action.do === 'floorMp') return true;
    return false;
  });
}

describe('compiled standing ability features', () => {
  it('keeps field movement and MP grants on a live trigger', () => {
    const dead: string[] = [];
    for (const entry of engine.content.figures.values()) {
      for (const clause of entry.abilityClauses) {
        if (isInsteadOfMoveClause(clause)) continue;
        if (standingActions(clause).length === 0) continue;
        if (LIVE.has(clause.trigger)) continue;
        dead.push(`${entry.figure.name} #${entry.figure.id}: ${clause.trigger} — ${clause.source}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('makes self-targeted movement grants visible to pathfinding', () => {
    const missed: string[] = [];
    const seen = new Set<string>();
    for (const entry of engine.content.figures.values()) {
      const text = entry.figure.ability?.text;
      if (text === undefined || seen.has(text)) continue;
      if (isFormOnlyFigure(entry.figure)) continue;
      const grants = entry.abilityClauses.filter((clause) =>
        !isInsteadOfMoveClause(clause)
        && clause.when.length === 0
        && LIVE.has(clause.trigger)
        && clause.actions.some((action) =>
          action.do === 'grantMovement'
          && action.grant !== 'extraStep'
          && action.target.kind === 'self'
        ),
      );
      if (grants.length === 0) continue;
      seen.add(text);
      const { engine: duel, state } = harness({
        p0: [makeFigure(1, { mp: 3, ability: entry.figure.ability })],
        p1: [makeFigure(2, { mp: 2 })],
        allowUnimplemented: true,
      });
      const placed = onField(state, [[0, 'r4c0']]);
      if (movementGrantsFor(placed, duel.deps, uid(0)).size === 0) {
        missed.push(`${entry.figure.name} #${entry.figure.id}: ${text}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it('applies unguarded self MP modifiers while the figure is on the field', () => {
    const missed: string[] = [];
    const seen = new Set<string>();
    for (const entry of engine.content.figures.values()) {
      const text = entry.figure.ability?.text;
      if (text === undefined || seen.has(text)) continue;
      if (isFormOnlyFigure(entry.figure)) continue;
      const bumps = entry.abilityClauses.filter((clause) =>
        clause.when.length === 0
        && LIVE.has(clause.trigger)
        && clause.actions.some((action) =>
          action.do === 'modifyMp'
          && action.delta > 0
          && action.of === undefined
          && action.target.kind === 'self'
        ),
      );
      if (bumps.length === 0) continue;
      seen.add(text);
      const base = Math.max(2, entry.figure.mp);
      const { engine: duel, state } = harness({
        p0: [makeFigure(1, { mp: base, ability: entry.figure.ability })],
        p1: [makeFigure(2, { mp: 2 })],
        allowUnimplemented: true,
      });
      const placed = onField(state, [[0, 'r4c1']]);
      if (movementPoints(placed, duel.deps, uid(0)) <= base) {
        missed.push(`${entry.figure.name} #${entry.figure.id}: ${text}`);
      }
    }
    expect(missed).toEqual([]);
  });
});
