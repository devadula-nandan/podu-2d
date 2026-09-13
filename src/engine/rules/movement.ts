/**
 * The movement action: MP moves, deploys, and tags.
 *
 * Four details here are the ones a from-memory implementation gets wrong:
 *
 * - **MP reaches 4, not 3.** Base MP is 0-3 and abilities push it to 4, so clamping at
 *   the printed maximum would silently delete a movement point.
 * - **MP may be partially spent**, so a 3 MP figure legally stops after one step. Every
 *   cheaper destination is a distinct legal command, not a truncation of the longest.
 * - **A deploy costs 1 MP and the remainder continues the same move.** A 3 MP figure
 *   deploys and then walks two more points in one action.
 * - **The first-turn penalty is the starting player's, on their first turn only.** It is
 *   not a first-round rule, and applying it to both players makes 1 MP figures
 *   undeployable for both openings instead of one.
 *
 * All figures block movement, friendly and enemy alike; pass-through is an ability, so
 * it arrives as a `MovementPermissions` override rather than as a default.
 */
import {
  DEPLOY_MP_COST,
  FIRST_TURN_MP_PENALTY,
  MP_EFFECTIVE_MAX,
  CONDITION_BLOCKS_MP_MOVE,
} from '../../rules/constants.js';
import { taggingEndsTurn } from '../rulings.js';
import { areAdjacent, mpPath, mpReachable, nodesExactlySteps, OPEN_MOVEMENT, straightLineDestinations } from '../board/graph.js';
import { denyDeployFor, extraDeployStepsFor, floorMpFor, forceFullMpFor, leapStepsFor, mpModifiersFor, preventionsFor, restrictDeployFor, straightMpStepsFor } from '../effects/bus.js';
import { markerDefinition } from '../markers.js';
import type { MovementPermissions } from '../board/graph.js';
import { figureContent } from '../content.js';
import type { EngineDeps } from '../effects/context.js';
import type { GameEvent } from '../events.js';
import type { FigureUid, NodeId, PlayerId } from '../ids.js';
import { opponentOf } from '../ids.js';
import type { AttachedMarker, GameState } from '../state.js';
import { figureOf, occupiedNodes } from '../state.js';

/**
 * A figure's movement points right now.
 *
 * The clamp is at `MP_EFFECTIVE_MAX`, above the printed 0-3 range, because the range
 * describes what is *printed on a figure* and not what a figure can have.
 */
export function movementPoints(state: GameState, deps: EngineDeps, uid: FigureUid): number {
  const figure = figureOf(state, uid);
  const base = figureContent(deps.content, figure.figureId).figure.mp;
  const ability = mpModifiersFor(state, deps, uid);
  const floor = floorMpFor(state, deps, uid);
  const floored = floor !== null ? Math.max(floor, base + ability) : base + ability;
  const raw = floored + figure.mpDelta;
  return Math.min(MP_EFFECTIVE_MAX, Math.max(0, raw));
}

/**
 * The MP penalty in force for this player this turn.
 *
 * `turn.number` counts individual player-turns, so the starting player's first turn is
 * turn 1 and nothing else is.
 */
export function turnMpPenalty(state: GameState, player: PlayerId): number {
  return player === state.startingPlayer && state.turn.number === 1 ? FIRST_TURN_MP_PENALTY : 0;
}

export const availableMp = (state: GameState, deps: EngineDeps, uid: FigureUid): number =>
  Math.max(0, movementPoints(state, deps, uid) - turnMpPenalty(state, mpController(figureOf(state, uid))));

/** Wait, conditions and the immobile 0 MP figures, in one predicate. */
function mpController(figure: { owner: PlayerId; marker: AttachedMarker | null }): PlayerId {
  if (figure.marker !== null && markerDefinition(figure.marker.id).opposingPlayerMp) {
    return opponentOf(figure.owner);
  }
  return figure.owner;
}

export function canTakeMovementAction(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  const figure = figureOf(state, uid);
  if (mpController(figure) !== state.turn.player) return false;
  if (figure.wait > 0) return false;
  if (preventionsFor(state, deps, uid).has('mpMove')) return false;
  if (figure.condition !== null && CONDITION_BLOCKS_MP_MOVE[figure.condition]) return false;
  return availableMp(state, deps, uid) > 0;
}

// ---------------------------------------------------------------------------
// MP moves
// ---------------------------------------------------------------------------

/** Destination to cost, for a figure already on the field. */
export function mpMoveOptions(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  permissions: MovementPermissions = OPEN_MOVEMENT,
): Map<NodeId, number> {
  const figure = figureOf(state, uid);
  if (figure.zone !== 'field' || figure.node === null) return new Map();
  if (!canTakeMovementAction(state, deps, uid)) return new Map();
  const reachable = mpReachable(deps.board, figure.node, availableMp(state, deps, uid), occupiedNodes(state), permissions);
  const occupied = occupiedNodes(state);
  const leap = leapStepsFor(state, deps, uid);
  if (leap !== null) {
    for (const node of nodesExactlySteps(deps.board, figure.node, leap)) {
      if (occupied.has(node) || reachable.has(node)) continue;
      reachable.set(node, Math.min(availableMp(state, deps, uid), leap));
    }
  }
  const straight = straightMpStepsFor(state, deps, uid);
  if (straight !== null) {
    for (const [node, steps] of straightLineDestinations(deps.board, figure.node, straight, occupied, permissions)) {
      if (reachable.has(node)) continue;
      reachable.set(node, Math.min(availableMp(state, deps, uid), steps));
    }
  }
  if (!forceFullMpFor(state, deps, uid)) return reachable;
  const full = availableMp(state, deps, uid);
  const onlyFull = new Map<NodeId, number>();
  for (const [node, cost] of reachable) {
    if (cost === full) onlyFull.set(node, cost);
  }
  return onlyFull;
}

export function moveEvents(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  to: NodeId,
  permissions: MovementPermissions = OPEN_MOVEMENT,
): GameEvent[] {
  const figure = figureOf(state, uid);
  const cost = mpMoveOptions(state, deps, uid, permissions).get(to);
  if (cost === undefined || figure.node === null) return [];
  const through = crossedOnPath(state, deps, uid, figure.node, to, availableMp(state, deps, uid), permissions);
  return [
    { kind: 'figureMoved', uid, from: figure.node, to, mpSpent: cost },
    ...(through.length > 0 ? [{ kind: 'pathCrossed' as const, uid, through }] : []),
    { kind: 'actionTaken', player: state.turn.player, uid },
  ];
}

function crossedOnPath(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  from: NodeId,
  to: NodeId,
  mp: number,
  permissions: MovementPermissions,
): FigureUid[] {
  const occupied = occupiedNodes(state);
  const path = mpPath(deps.board, from, to, mp, occupied, permissions);
  const nodes = new Set(path.filter((node) => node !== to));
  return state.figures
    .filter((figure) => figure.uid !== uid && figure.zone === 'field' && figure.node !== null && nodes.has(figure.node))
    .map((figure) => figure.uid)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Deploys
// ---------------------------------------------------------------------------

/**
 * Where a benched figure may land, entry point by entry point.
 *
 * An occupied entry point cannot be deployed onto and *either* player's figure blocks
 * it, which is why the check is against total occupancy and not against enemies.
 */
export function deployOptions(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  permissions: MovementPermissions = OPEN_MOVEMENT,
): Map<NodeId, { readonly entry: NodeId; readonly cost: number }> {
  const options = new Map<NodeId, { entry: NodeId; cost: number }>();
  const figure = figureOf(state, uid);
  if (figure.zone !== 'bench') return options;
  if (figure.owner !== state.turn.player || figure.wait > 0) return options;
  if (denyDeployFor(state, deps, uid)) return options;

  const mp = availableMp(state, deps, uid);
  if (mp < DEPLOY_MP_COST) return options;

  const occupied = occupiedNodes(state);
  const adjacentOnly = restrictDeployFor(state, deps, uid);
  const extra = extraDeployStepsFor(state, deps, uid);
  for (const entry of deps.board.entryPoints[figure.owner]) {
    if (occupied.has(entry)) continue;
    if (!adjacentOnly) options.set(entry, { entry, cost: DEPLOY_MP_COST });
    const remaining = mp - DEPLOY_MP_COST + extra;
    if (remaining <= 0) continue;
    // Leftover MP continues the same move, walking out from the entry point. The
    // entry itself is not in `occupied` yet, which is correct: the figure is standing
    // there, so nothing else can be.
    const neighbors = new Set(deps.board.byId.get(entry)?.neighbors ?? []);
    for (const [node, cost] of mpReachable(deps.board, entry, remaining, occupied, permissions)) {
      if (adjacentOnly && !neighbors.has(node)) continue;
      const existing = options.get(node);
      const total = DEPLOY_MP_COST + cost;
      if (existing === undefined || total < existing.cost) options.set(node, { entry, cost: total });
    }
  }
  if (!forceFullMpFor(state, deps, uid)) return options;
  const full = availableMp(state, deps, uid);
  for (const [node, option] of [...options]) {
    if (option.cost !== full) options.delete(node);
  }
  return options;
}

export function deployEvents(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  entry: NodeId,
  to: NodeId,
  permissions: MovementPermissions = OPEN_MOVEMENT,
): GameEvent[] {
  const figure = figureOf(state, uid);
  const option = deployOptions(state, deps, uid, permissions).get(to);
  if (option === undefined || option.entry !== entry) return [];
  return [
    { kind: 'figureDeployed', uid, entry, to, mpSpent: option.cost },
    { kind: 'actionTaken', player: figure.owner, uid },
  ];
}

// ---------------------------------------------------------------------------
// Tagging
// ---------------------------------------------------------------------------

/**
 * Allies this figure may tag: adjacent, on the field, and actually afflicted.
 *
 * Tagging is a cure, so tagging a healthy ally is not a legal move that does nothing -
 * it is not a legal move. Making it unavailable rather than a no-op matters because a
 * no-op tag would be a legal action, and a legal action postpones Wait Victory.
 */
export function tagTargets(state: GameState, deps: EngineDeps, uid: FigureUid): FigureUid[] {
  const figure = figureOf(state, uid);
  if (figure.zone !== 'field' || figure.node === null) return [];
  if (figure.owner !== state.turn.player || figure.wait > 0) return [];
  const from = figure.node;
  return state.figures
    .filter(
      (other) =>
        other.uid !== uid &&
        other.owner === figure.owner &&
        other.zone === 'field' &&
        other.node !== null &&
        (other.condition !== null || (other.marker !== null && markerDefinition(other.marker.id).removedByTag)) &&
        !preventionsFor(state, deps, other.uid).has('beTagged') &&
        areAdjacent(deps.board, from, other.node),
    )
    .map((other) => other.uid)
    .sort((a, b) => a - b);
}

export function tagEvents(state: GameState, deps: EngineDeps, uid: FigureUid, target: FigureUid): GameEvent[] {
  if (!tagTargets(state, deps, uid).includes(target)) return [];
  const figure = figureOf(state, uid);
  const victim = figureOf(state, target);
  const events: GameEvent[] = [{ kind: 'tagged', uid, target }];
  if (victim.condition !== null) {
    events.push({ kind: 'conditionCleared', uid: target, condition: victim.condition });
  }
  if (victim.marker !== null && markerDefinition(victim.marker.id).removedByTag) {
    events.push({ kind: 'markerCleared', uid: target, marker: victim.marker.id });
  }
  events.push({ kind: 'actionTaken', player: figure.owner, uid });
  if (taggingEndsTurn) events.push({ kind: 'battleDeclined', player: figure.owner });
  return events;
}
