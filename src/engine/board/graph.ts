/**
 * The board as data, plus the three graph relations the rules need.
 *
 * The topology itself lives in `board-graph.json` and is documented there, including
 * how it was recovered and what is still uncertain. This module's job is to refuse to
 * load a graph that violates the counts in `src/rules/constants.ts`, and to expose the
 * relations - never the raw adjacency - so that a correction to the JSON cannot leave
 * a stale derived table behind.
 *
 * The three relations are genuinely different and collapsing them is a design error
 * the effect corpus rules out (docs/RULES.md section 1):
 *
 *   mpReachable        respects occupancy; used for legal movement
 *   stepDistance       ignores occupancy; used for "within N steps" and battle range
 *   connectedComponent a typed walk over occupied nodes; used for "succession" effects
 */
import {
  BOARD_EDGE_COUNT,
  BOARD_NODE_COUNT,
  ENTRY_POINT_COUNT,
  ENTRY_POINT_DEGREE,
  GOAL_NODE_COUNT,
  GOAL_NODE_DEGREE,
  GOAL_SIDE_DIAGONAL_ATTACHMENT,
  MAX_NODE_DEGREE,
  MIN_NODE_DEGREE,
  NON_GOAL_NODE_COUNT,
} from '../../rules/constants.js';
import type { PlayerId } from '../ids.js';
import { nodeId } from '../ids.js';
import type { NodeId } from '../ids.js';
import rawBoard from './board-graph.json';

export type NodeKind = 'point' | 'entry' | 'goal';

export interface BoardNode {
  readonly id: NodeId;
  /** Normalised render coordinates in the unit square. No rule reads these. */
  readonly x: number;
  readonly y: number;
  readonly kind: NodeKind;
  /** Which player owns this entry point or goal; `null` for ordinary points. */
  readonly owner: PlayerId | null;
  /** Sorted, so iteration order is deterministic and replay-stable. */
  readonly neighbors: readonly NodeId[];
}

export interface BoardGraph {
  readonly nodes: readonly BoardNode[];
  readonly byId: ReadonlyMap<NodeId, BoardNode>;
  readonly edges: readonly (readonly [NodeId, NodeId])[];
  /** Each player's two deployment corners. */
  readonly entryPoints: Readonly<Record<PlayerId, readonly NodeId[]>>;
  /** The goal a player *defends*. Reaching the opponent's is the win. */
  readonly goals: Readonly<Record<PlayerId, NodeId>>;
  /** All-pairs step distance, precomputed: 28 nodes makes this free and exact. */
  readonly distances: ReadonlyMap<NodeId, ReadonlyMap<NodeId, number>>;
}

export class BoardError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid board graph:\n  ${problems.join('\n  ')}`);
    this.name = 'BoardError';
    this.problems = problems;
  }
}

export interface RawBoardNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: string;
  readonly owner: number | null;
}

export interface RawBoard {
  readonly nodes: readonly RawBoardNode[];
  readonly outerRing: readonly (readonly string[])[];
  readonly innerRing: readonly (readonly string[])[];
  readonly cornerDiagonals: readonly (readonly string[])[];
  readonly goalSideDiagonals: {
    readonly adjacentToGoal: readonly (readonly string[])[];
    readonly oneNodeOut: readonly (readonly string[])[];
  };
}

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Build and validate a graph.
 *
 * Exported taking raw data rather than reading the bundled JSON directly, so tests can
 * feed it a deliberately broken board and prove the validator actually fires. A
 * validator nobody has seen fail is indistinguishable from no validator.
 */
export function buildBoardGraph(
  raw: RawBoard,
  attachment: 'adjacentToGoal' | 'oneNodeOut' = GOAL_SIDE_DIAGONAL_ATTACHMENT,
): BoardGraph {
  const problems: string[] = [];

  const declaredIds = new Set<string>();
  for (const node of raw.nodes) {
    if (declaredIds.has(node.id)) problems.push(`duplicate node id "${node.id}"`);
    declaredIds.add(node.id);
    if (node.kind !== 'point' && node.kind !== 'entry' && node.kind !== 'goal') {
      problems.push(`node "${node.id}" has unknown kind "${node.kind}"`);
    }
    if (node.owner !== null && node.owner !== 0 && node.owner !== 1) {
      problems.push(`node "${node.id}" has owner ${String(node.owner)}; expected 0, 1 or null`);
    }
  }

  const rawEdges = [
    ...raw.outerRing,
    ...raw.innerRing,
    ...raw.cornerDiagonals,
    ...raw.goalSideDiagonals[attachment],
  ];

  const adjacency = new Map<string, Set<string>>();
  for (const id of declaredIds) adjacency.set(id, new Set());
  const seenEdges = new Set<string>();
  const edges: (readonly [NodeId, NodeId])[] = [];

  for (const pair of rawEdges) {
    const a = pair[0];
    const b = pair[1];
    if (a === undefined || b === undefined || pair.length !== 2) {
      problems.push(`edge ${JSON.stringify(pair)} is not a pair`);
      continue;
    }
    if (a === b) {
      problems.push(`self-loop on "${a}"`);
      continue;
    }
    if (!declaredIds.has(a) || !declaredIds.has(b)) {
      problems.push(`edge ${a}--${b} names a node that does not exist`);
      continue;
    }
    const key = edgeKey(a, b);
    if (seenEdges.has(key)) {
      problems.push(`duplicate edge ${a}--${b}`);
      continue;
    }
    seenEdges.add(key);
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
    edges.push([nodeId(a), nodeId(b)]);
  }

  const nodes: BoardNode[] = raw.nodes.map((node) => ({
    id: nodeId(node.id),
    x: node.x,
    y: node.y,
    kind: node.kind as NodeKind,
    owner: node.owner === 0 || node.owner === 1 ? node.owner : null,
    neighbors: [...(adjacency.get(node.id) ?? [])].sort().map(nodeId),
  }));

  // --- counts and degrees, straight from the constants module -----------------
  if (nodes.length !== BOARD_NODE_COUNT) {
    problems.push(`${nodes.length} nodes; BOARD_NODE_COUNT is ${BOARD_NODE_COUNT}`);
  }
  if (edges.length !== BOARD_EDGE_COUNT) {
    problems.push(`${edges.length} edges; BOARD_EDGE_COUNT is ${BOARD_EDGE_COUNT}`);
  }

  const goals = nodes.filter((n) => n.kind === 'goal');
  const entries = nodes.filter((n) => n.kind === 'entry');
  if (goals.length !== GOAL_NODE_COUNT) {
    problems.push(`${goals.length} goal nodes; GOAL_NODE_COUNT is ${GOAL_NODE_COUNT}`);
  }
  if (nodes.length - goals.length !== NON_GOAL_NODE_COUNT) {
    problems.push(
      `${nodes.length - goals.length} non-goal nodes; NON_GOAL_NODE_COUNT is ${NON_GOAL_NODE_COUNT}`,
    );
  }
  if (entries.length !== ENTRY_POINT_COUNT) {
    problems.push(`${entries.length} entry points; ENTRY_POINT_COUNT is ${ENTRY_POINT_COUNT}`);
  }
  for (const node of goals) {
    if (node.neighbors.length !== GOAL_NODE_DEGREE) {
      problems.push(
        `goal "${node.id}" has degree ${node.neighbors.length}; GOAL_NODE_DEGREE is ${GOAL_NODE_DEGREE}. ` +
          'A goal that is not degree 2 breaks the goal clamp, which is a bug and not a variant layout.',
      );
    }
  }
  for (const node of entries) {
    if (node.neighbors.length !== ENTRY_POINT_DEGREE) {
      problems.push(`entry "${node.id}" has degree ${node.neighbors.length}; expected ${ENTRY_POINT_DEGREE}`);
    }
  }
  for (const node of nodes) {
    if (node.neighbors.length < MIN_NODE_DEGREE || node.neighbors.length > MAX_NODE_DEGREE) {
      problems.push(
        `node "${node.id}" has degree ${node.neighbors.length}, outside ${MIN_NODE_DEGREE}..${MAX_NODE_DEGREE}`,
      );
    }
  }

  for (const player of [0, 1] as const) {
    const owned = goals.filter((n) => n.owner === player);
    if (owned.length !== 1) problems.push(`player ${player} owns ${owned.length} goals; expected 1`);
    const ownedEntries = entries.filter((n) => n.owner === player);
    if (ownedEntries.length !== ENTRY_POINT_COUNT / 2) {
      problems.push(`player ${player} owns ${ownedEntries.length} entry points; expected ${ENTRY_POINT_COUNT / 2}`);
    }
  }

  // --- connectivity -----------------------------------------------------------
  const first = nodes[0];
  if (first !== undefined) {
    const seen = new Set<NodeId>([first.id]);
    const queue: NodeId[] = [first.id];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const next of byId.get(current)?.neighbors ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    if (seen.size !== nodes.length) {
      problems.push(`graph is disconnected: ${seen.size} of ${nodes.length} nodes reachable`);
    }
  }

  if (problems.length > 0) throw new BoardError(problems);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const goalOf = (player: PlayerId): NodeId => {
    const node = goals.find((n) => n.owner === player);
    if (node === undefined) throw new BoardError([`player ${player} has no goal`]);
    return node.id;
  };

  return {
    nodes,
    byId,
    edges,
    entryPoints: {
      0: entries.filter((n) => n.owner === 0).map((n) => n.id),
      1: entries.filter((n) => n.owner === 1).map((n) => n.id),
    },
    goals: { 0: goalOf(0), 1: goalOf(1) },
    distances: allPairsDistances(nodes, byId),
  };
}

function allPairsDistances(
  nodes: readonly BoardNode[],
  byId: ReadonlyMap<NodeId, BoardNode>,
): ReadonlyMap<NodeId, ReadonlyMap<NodeId, number>> {
  const out = new Map<NodeId, ReadonlyMap<NodeId, number>>();
  for (const start of nodes) {
    const dist = new Map<NodeId, number>([[start.id, 0]]);
    const queue: NodeId[] = [start.id];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      if (current === undefined) break;
      const d = dist.get(current) ?? 0;
      for (const next of byId.get(current)?.neighbors ?? []) {
        if (!dist.has(next)) {
          dist.set(next, d + 1);
          queue.push(next);
        }
      }
    }
    out.set(start.id, dist);
  }
  return out;
}

/** The board this build ships with, validated at module load. */
export const BOARD: BoardGraph = buildBoardGraph(rawBoard);

// ---------------------------------------------------------------------------
// Relation 1: step distance - ignores occupancy
// ---------------------------------------------------------------------------

/**
 * Hop count between two points, ignoring every figure on the board.
 *
 * This is what "within N steps", "N steps away" and battle range mean. It is *not*
 * movement: a figure standing between the two nodes changes `mpReachable` and does not
 * change this.
 */
export function stepDistance(graph: BoardGraph, from: NodeId, to: NodeId): number {
  const d = graph.distances.get(from)?.get(to);
  return d ?? Number.POSITIVE_INFINITY;
}

/** Every node exactly `steps` away. "2 steps away" is exact, not "at most 2". */
export function nodesExactlySteps(graph: BoardGraph, from: NodeId, steps: number): NodeId[] {
  const dist = graph.distances.get(from);
  if (dist === undefined) return [];
  return [...dist.entries()].filter(([, d]) => d === steps).map(([id]) => id);
}

/** Every node within `steps`, excluding the origin. */
export function nodesWithinSteps(graph: BoardGraph, from: NodeId, steps: number): NodeId[] {
  const dist = graph.distances.get(from);
  if (dist === undefined) return [];
  return [...dist.entries()].filter(([, d]) => d > 0 && d <= steps).map(([id]) => id);
}

/**
 * Empty-or-not: nodes `min`..`max` steps along a shortest path toward `toward`.
 * Occupancy is the caller's problem; this only walks the step metric.
 */
export function nodesToward(
  graph: BoardGraph,
  from: NodeId,
  toward: NodeId,
  minSteps: number,
  maxSteps: number,
): NodeId[] {
  const goal = graph.distances.get(toward);
  if (goal === undefined) return [];
  const startDist = goal.get(from);
  if (startDist === undefined || startDist === 0) return [];
  const found = new Set<NodeId>();
  const queue: { node: NodeId; steps: number }[] = [{ node: from, steps: 0 }];
  const seen = new Set<NodeId>([from]);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === undefined || current.steps >= maxSteps) continue;
    const here = goal.get(current.node) ?? Number.POSITIVE_INFINITY;
    for (const next of graph.byId.get(current.node)?.neighbors ?? []) {
      if (seen.has(next)) continue;
      const nextDist = goal.get(next);
      if (nextDist === undefined || nextDist >= here) continue;
      seen.add(next);
      const steps = current.steps + 1;
      if (steps >= minSteps && steps <= maxSteps) found.add(next);
      queue.push({ node: next, steps });
    }
  }
  return [...found].sort();
}

export function areAdjacent(graph: BoardGraph, a: NodeId, b: NodeId): boolean {
  return graph.byId.get(a)?.neighbors.includes(b) ?? false;
}

// ---------------------------------------------------------------------------
// Relation 2: MP reachability - respects occupancy
// ---------------------------------------------------------------------------

/**
 * What a figure may walk through.
 *
 * Every figure blocks movement by default, friendly and enemy alike; passing is an
 * ability, not a rule. `passThrough` is the "moves through other Pokemon" family
 * (Fly, Fly Away, Soar, Barbed Horns...). `blockedNodes` covers effects that forbid a
 * specific destination without a figure standing there.
 */
export interface MovementPermissions {
  /** May traverse a node occupied by another figure (but not stop on it). */
  readonly passThrough: boolean;
  /** Occupied nodes that may be crossed even when `passThrough` is false. */
  readonly passableOccupied?: ReadonlySet<NodeId>;
  /** Nodes this figure may not enter at all, whatever the occupancy. */
  readonly forbidden: ReadonlySet<NodeId>;
  /** Empty nodes that may be landed on but not walked through. */
  readonly noTransit?: ReadonlySet<NodeId>;
}

export const OPEN_MOVEMENT: MovementPermissions = { passThrough: false, forbidden: new Set() };

/**
 * Legal MP destinations and their cost.
 *
 * Returns every node reachable with at most `mp` steps, mapped to the cheapest cost -
 * MP may be spent partially, so a 3 MP figure may legally stop at 1 or 2 steps. The
 * origin is excluded because standing still is not a move (see `VOLUNTARY_PASS_ALLOWED`).
 *
 * `occupied` is the set of nodes holding *any* figure. A blocked node can never be a
 * destination; whether it can be crossed depends on `permissions.passThrough`.
 */
export function mpReachable(
  graph: BoardGraph,
  from: NodeId,
  mp: number,
  occupied: ReadonlySet<NodeId>,
  permissions: MovementPermissions = OPEN_MOVEMENT,
): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  if (mp <= 0) return out;

  const cost = new Map<NodeId, number>([[from, 0]]);
  const queue: NodeId[] = [from];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === undefined) break;
    const spent = cost.get(current) ?? 0;
    if (spent >= mp) continue;
    for (const next of graph.byId.get(current)?.neighbors ?? []) {
      if (cost.has(next)) continue;
      if (permissions.forbidden.has(next)) continue;
      const blocked = occupied.has(next);
      const mayCross = permissions.passThrough || (permissions.passableOccupied?.has(next) ?? false);
      if (blocked && !mayCross) continue;
      cost.set(next, spent + 1);
      if (!blocked) out.set(next, spent + 1);
      if (permissions.noTransit?.has(next)) continue;
      queue.push(next);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Relation 3: connected component - a typed walk over occupied nodes
// ---------------------------------------------------------------------------

/**
 * The "succession" relation: walk outward from a node through *occupied* neighbours
 * that satisfy a predicate, and return everything the walk touches.
 *
 * This is what "every Electric-type Pokemon it is connected to" and the succession
 * clauses in Invisible Wall, Cosmic Surfer and Forest Leap mean. It is neither a
 * distance test nor a reachability test: an unbroken chain of qualifying figures can
 * run the length of the board, and a single gap ends it one step out.
 *
 * The anchor is included in the result only if it satisfies the predicate itself,
 * which matches "every X it is connected to" counting the source when the source is
 * an X and not otherwise.
 */
export function connectedComponent(
  graph: BoardGraph,
  from: NodeId,
  occupantMatches: (node: NodeId) => boolean,
): Set<NodeId> {
  const seen = new Set<NodeId>();
  const queue: NodeId[] = [];
  if (occupantMatches(from)) {
    seen.add(from);
    queue.push(from);
  } else {
    // Start the walk from qualifying neighbours, so a non-matching anchor still has a
    // succession running off it.
    for (const next of graph.byId.get(from)?.neighbors ?? []) {
      if (occupantMatches(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === undefined) break;
    for (const next of graph.byId.get(current)?.neighbors ?? []) {
      if (!seen.has(next) && occupantMatches(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  seen.delete(from);
  return seen;
}

/**
 * "in a straight line directly behind it" - a ray, not a radius.
 *
 * "Behind" is defined relative to the attacker: the ray leaves `origin`, passes through
 * `through`, and continues in the same geometric direction for as long as the next node
 * along keeps that direction. The board is not a lattice everywhere (the diagonals cut
 * across it), so direction is measured against the render coordinates with a tolerance
 * rather than by integer arithmetic.
 */
export function straightLineBehind(graph: BoardGraph, origin: NodeId, through: NodeId): NodeId[] {
  const a = graph.byId.get(origin);
  const b = graph.byId.get(through);
  if (a === undefined || b === undefined) return [];

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  const ux = dx / length;
  const uy = dy / length;

  const out: NodeId[] = [];
  let current = b;
  const visited = new Set<NodeId>([a.id, b.id]);
  for (;;) {
    let best: BoardNode | null = null;
    let bestAlignment = 0.95; // cos of ~18 degrees; anything slacker is a different route
    for (const id of current.neighbors) {
      if (visited.has(id)) continue;
      const candidate = graph.byId.get(id);
      if (candidate === undefined) continue;
      const cdx = candidate.x - current.x;
      const cdy = candidate.y - current.y;
      const clen = Math.hypot(cdx, cdy);
      if (clen === 0) continue;
      const alignment = (cdx / clen) * ux + (cdy / clen) * uy;
      if (alignment > bestAlignment) {
        bestAlignment = alignment;
        best = candidate;
      }
    }
    if (best === null) break;
    out.push(best.id);
    visited.add(best.id);
    current = best;
  }
  return out;
}

/**
 * Empty nodes along every geometric ray from `from`, up to `maxSteps`.
 *
 * Reckless Charge is this, not `nodesExactlySteps`: a 2-step leap would include
 * around-the-corner landings that are not a straight line.
 */
export function straightLineDestinations(
  graph: BoardGraph,
  from: NodeId,
  maxSteps: number,
  occupied: ReadonlySet<NodeId>,
  permissions: MovementPermissions = OPEN_MOVEMENT,
): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  if (maxSteps <= 0) return out;
  for (const neighbor of graph.byId.get(from)?.neighbors ?? []) {
    const ray = [neighbor, ...straightLineBehind(graph, from, neighbor)];
    for (let i = 0; i < Math.min(maxSteps, ray.length); i++) {
      const node = ray[i];
      if (node === undefined) break;
      if (permissions.forbidden.has(node)) break;
      const blocked = occupied.has(node);
      const mayCross = permissions.passThrough || (permissions.passableOccupied?.has(node) ?? false);
      if (blocked && !mayCross) break;
      if (!blocked) out.set(node, i + 1);
      if (permissions.noTransit?.has(node)) break;
    }
  }
  return out;
}

/** Cheapest MP path from `from` to `to`, or empty if unreachable. */
export function mpPath(
  graph: BoardGraph,
  from: NodeId,
  to: NodeId,
  mp: number,
  occupied: ReadonlySet<NodeId>,
  permissions: MovementPermissions = OPEN_MOVEMENT,
): NodeId[] {
  if (from === to || mp <= 0) return [];
  const parent = new Map<NodeId, NodeId | null>([[from, null]]);
  const cost = new Map<NodeId, number>([[from, 0]]);
  const queue: NodeId[] = [from];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === undefined) break;
    const spent = cost.get(current) ?? 0;
    if (spent >= mp) continue;
    for (const next of graph.byId.get(current)?.neighbors ?? []) {
      if (parent.has(next)) continue;
      if (permissions.forbidden.has(next)) continue;
      const blocked = occupied.has(next);
      const mayCross = permissions.passThrough || (permissions.passableOccupied?.has(next) ?? false);
      if (blocked && !mayCross && next !== to) continue;
      if (permissions.noTransit?.has(next) && next !== to) continue;
      parent.set(next, current);
      cost.set(next, spent + 1);
      queue.push(next);
      if (next === to) {
        const path: NodeId[] = [];
        let cursor: NodeId | null = to;
        while (cursor !== null && cursor !== from) {
          path.push(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        path.reverse();
        return path;
      }
    }
  }
  return [];
}
