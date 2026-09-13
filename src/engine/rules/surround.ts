/**
 * Surround: a figure is knocked out when every node adjacent to it holds an enemy.
 *
 * Two properties of this rule are structural rather than incidental.
 *
 * **Arity is per node.** Degrees on this board are 2 or 3, so "surrounded" costs two
 * figures at a goal and three in the middle of the outer ring. A hardcoded arity would
 * make the goal clamp - the entire reason goals have degree 2 - either impossible or
 * free.
 *
 * **Resolution is simultaneous.** The set of surrounded figures is computed against one
 * occupancy snapshot and then applied, so two figures that surround each other both
 * fall. Knocking them out one at a time would let the first removal rescue the second,
 * and which one survived would depend on iteration order.
 */
import { MAX_SURROUNDS_PER_TURN } from '../../rules/constants.js';
import { surroundCheckedAtEndOfMovement } from '../rulings.js';
import type { GameEvent } from '../events.js';
import type { EngineDeps } from '../effects/context.js';
import type { FigureUid } from '../ids.js';
import { opponentOf } from '../ids.js';
import type { GameState } from '../state.js';
import { figureOf, occupancy } from '../state.js';
import type { EventBatch } from './zones.js';
import { evolveIfHooked } from '../forms.js';
import { knockOutOrSurvive, preventionsFor, runTrigger } from '../effects/bus.js';
import { figureContent } from '../content.js';
import { concatBatches, emptyBatch, extend } from './zones.js';

export interface SurroundFinding {
  readonly uid: FigureUid;
  readonly by: readonly FigureUid[];
}

/** Every figure currently surrounded, against a single occupancy snapshot. */
export function findSurrounded(state: GameState, deps: EngineDeps): SurroundFinding[] {
  const where = occupancy(state);
  const findings: SurroundFinding[] = [];

  for (const figure of state.figures) {
    if (figure.zone !== 'field' || figure.node === null) continue;
    const prevented = preventionsFor(state, deps, figure.uid);
    if (prevented.has('beSurrounded')) continue;
    const node = deps.board.byId.get(figure.node);
    if (node === undefined || node.neighbors.length === 0) continue;

    const enemy = opponentOf(figure.owner);
    const by: FigureUid[] = [];
    let sealed = true;
    for (const neighbor of node.neighbors) {
      const occupant = where.get(neighbor);
      if (occupant === undefined || figureOf(state, occupant).owner !== enemy) {
        sealed = false;
        break;
      }
      const sealer = preventionsFor(state, deps, occupant);
      if (sealer.has('surround')) {
        sealed = false;
        break;
      }
      if (prevented.has('beSurroundedByUltraBeasts')) {
        const ultra = figureContent(deps.content, figureOf(state, occupant).figureId).abilityClauses.some((clause) =>
          clause.actions.some((action) => action.do === 'tag' && /ultra\s*beast/i.test(action.tag)),
        );
        if (ultra) {
          sealed = false;
          break;
        }
      }
      by.push(occupant);
    }
    if (sealed) findings.push({ uid: figure.uid, by: by.sort((a, b) => a - b) });
  }
  return findings.sort((a, b) => a.uid - b.uid);
}

/**
 * Resolve the surround check.
 *
 * `MAX_SURROUNDS_PER_TURN` is `null` today, and the cap is read rather than assumed
 * because it is [Ruling 6](docs/RULES.md) at medium confidence. If it ever becomes a
 * number, the slice below is the whole implementation of it - the surviving figures are
 * simply not knocked out, since surround is a board-state check with no player decision
 * attached to choose *which* one to take.
 */
export function resolveSurrounds(
  state: GameState,
  deps: EngineDeps,
  opts: { readonly skipEscape?: boolean } = {},
): EventBatch {
  if (!surroundCheckedAtEndOfMovement) return emptyBatch(state);

  const all = findSurrounded(state, deps);
  const findings = MAX_SURROUNDS_PER_TURN === null ? all : all.slice(0, MAX_SURROUNDS_PER_TURN);
  if (findings.length === 0) return emptyBatch(state);

  const announce: GameEvent[] = findings.map((finding) => ({
    kind: 'surrounded',
    uid: finding.uid,
    by: finding.by,
  }));
  let batch = extend(emptyBatch(state), announce);
  for (const finding of findings) {
    if (!opts.skipEscape) {
      batch = concatBatches(
        batch,
        runTrigger(
          batch.state,
          deps,
          'onSurrounded',
          (live) =>
            /would be surrounded/i.test(live.clause.source) ? live.source === finding.uid : true,
          { antecedent: [finding.uid] },
        ),
      );
      if (batch.state.pending !== null) return batch;
    }
    const still = findSurrounded(batch.state, deps).some((entry) => entry.uid === finding.uid);
    if (!still) continue;
    batch = concatBatches(batch, knockOutOrSurvive(batch.state, deps, finding.uid, 'surround'));
    batch = concatBatches(
      batch,
      runTrigger(batch.state, deps, 'onFigureKnockedOut', () => true, { antecedent: [finding.uid] }),
    );
    batch = concatBatches(
      batch,
      runTrigger(batch.state, deps, 'onLeaveField', () => true, { antecedent: [finding.uid] }),
    );
    batch = extend(batch, evolveIfHooked(batch.state, deps.content, finding.uid, 'surround'));
    batch = extend(batch, evolveIfHooked(batch.state, deps.content, finding.uid, 'knockedOut'));
  }
  return batch;
}
