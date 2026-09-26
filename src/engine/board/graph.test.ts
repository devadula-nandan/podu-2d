import { describe, expect, it } from 'vitest';
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
} from '../../rules/constants.js';
import { findSurrounded } from '../rules/surround.js';
import { makeFigure, harness, nid, onField } from '../test/helpers.js';
import {
  BOARD,
  BoardError,
  areAdjacent,
  buildBoardGraph,
  connectedComponent,
  mpReachable,
  nodesExactlySteps,
  OPEN_MOVEMENT,
  stepDistance,
} from './graph.js';
import type { RawBoard } from './graph.js';
import rawBoard from './board-graph.json';

const raw = rawBoard as unknown as RawBoard;

function rotateId(id: string): string {
  const outer = /^r(\d)c(\d)$/.exec(id);
  if (outer?.[1] !== undefined && outer[2] !== undefined) {
    return `r${4 - Number(outer[1])}c${6 - Number(outer[2])}`;
  }
  const inner = /^i(\d)c(\d)$/.exec(id);
  if (inner?.[1] !== undefined && inner[2] !== undefined) {
    return `i${2 - Number(inner[1])}c${2 - Number(inner[2])}`;
  }
  throw new Error(`unrecognised node id ${id}`);
}

function mirrorId(id: string): string {
  const outer = /^r(\d)c(\d)$/.exec(id);
  if (outer?.[1] !== undefined && outer[2] !== undefined) {
    return `r${outer[1]}c${6 - Number(outer[2])}`;
  }
  const inner = /^i(\d)c(\d)$/.exec(id);
  if (inner?.[1] !== undefined && inner[2] !== undefined) {
    return `i${inner[1]}c${2 - Number(inner[2])}`;
  }
  throw new Error(`unrecognised node id ${id}`);
}

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const edgeSet = (edges: readonly (readonly [string, string])[]): Set<string> =>
  new Set(edges.map(([a, b]) => edgeKey(a, b)));

describe('board graph topology', () => {
  it('loads the shipped counts from the constants, not from a hardcoded 28/34', () => {
    expect(BOARD.nodes).toHaveLength(BOARD_NODE_COUNT);
    expect(BOARD.edges).toHaveLength(BOARD_EDGE_COUNT);
    expect(BOARD.nodes.filter((n) => n.kind === 'goal')).toHaveLength(GOAL_NODE_COUNT);
    expect(BOARD.nodes.filter((n) => n.kind === 'entry')).toHaveLength(ENTRY_POINT_COUNT);
  });

  it('gives every goal degree 2 and every entry degree 3', () => {
    for (const node of BOARD.nodes) {
      if (node.kind === 'goal') expect(node.neighbors).toHaveLength(GOAL_NODE_DEGREE);
      if (node.kind === 'entry') expect(node.neighbors).toHaveLength(ENTRY_POINT_DEGREE);
      expect(node.neighbors.length).toBeGreaterThanOrEqual(MIN_NODE_DEGREE);
      expect(node.neighbors.length).toBeLessThanOrEqual(MAX_NODE_DEGREE);
    }
  });

  it('is 180-degree rotationally symmetric and not mirror-symmetric', () => {
    const edges = edgeSet(BOARD.edges);
    for (const node of BOARD.nodes) {
      expect(BOARD.byId.has(nid(rotateId(node.id)))).toBe(true);
    }
    for (const [a, b] of BOARD.edges) {
      expect(edges.has(edgeKey(rotateId(a), rotateId(b)))).toBe(true);
    }

    const missing = BOARD.edges.filter(([a, b]) => !edges.has(edgeKey(mirrorId(a), mirrorId(b))));
    expect(missing.length).toBeGreaterThan(0);
  });

  it('attaches the goal-side diagonals according to the ruling', () => {
    const chosen = raw.goalSideDiagonals[GOAL_SIDE_DIAGONAL_ATTACHMENT];
    for (const pair of chosen) {
      const a = pair[0];
      const b = pair[1];
      if (a === undefined || b === undefined) continue;
      expect(areAdjacent(BOARD, nid(a), nid(b))).toBe(true);
    }
    if (GOAL_SIDE_DIAGONAL_ATTACHMENT === 'adjacentToGoal') {
      expect(areAdjacent(BOARD, nid('r4c4'), nid('i2c1'))).toBe(true);
      expect(areAdjacent(BOARD, nid('r0c2'), nid('i0c1'))).toBe(true);
      expect(areAdjacent(BOARD, nid('r4c5'), nid('i2c1'))).toBe(false);
    }
  });

  it('rejects a graph that violates the constants', () => {
    const broken: RawBoard = {
      ...raw,
      outerRing: raw.outerRing.slice(1),
    };
    expect(() => buildBoardGraph(broken)).toThrow(BoardError);
  });
});

describe('graph relations', () => {
  it('treats the outer ring as adjacent along its edges and not across the board', () => {
    expect(areAdjacent(BOARD, nid('r4c0'), nid('r4c1'))).toBe(true);
    expect(areAdjacent(BOARD, nid('r4c0'), nid('r3c0'))).toBe(true);
    expect(areAdjacent(BOARD, nid('r4c0'), nid('i2c0'))).toBe(true);
    expect(areAdjacent(BOARD, nid('r4c0'), nid('r4c2'))).toBe(false);
    expect(areAdjacent(BOARD, nid('r4c3'), nid('r0c3'))).toBe(false);
  });

  it('computes step distance ignoring occupancy', () => {
    expect(stepDistance(BOARD, nid('r4c0'), nid('r4c0'))).toBe(0);
    expect(stepDistance(BOARD, nid('r4c0'), nid('r4c1'))).toBe(1);
    expect(stepDistance(BOARD, nid('r4c0'), nid('r4c2'))).toBe(2);
    expect(stepDistance(BOARD, nid('r4c3'), nid('r0c3'))).toBeGreaterThan(2);

    const occupied = new Set([nid('r4c1')]);
    const blocked = mpReachable(BOARD, nid('r4c0'), 2, occupied);
    expect(blocked.has(nid('r4c2'))).toBe(false);
    expect(stepDistance(BOARD, nid('r4c0'), nid('r4c2'))).toBe(2);
  });

  it('lists exact-N-step nodes without including the origin', () => {
    const one = nodesExactlySteps(BOARD, nid('r4c0'), 1);
    expect(one).toEqual([...one].sort());
    expect(one).toHaveLength(BOARD.byId.get(nid('r4c0'))?.neighbors.length ?? 0);
    expect(one).not.toContain('r4c0');
  });

  it('mpReachable respects occupancy and will not land on a blocked node', () => {
    const empty = mpReachable(BOARD, nid('r4c0'), 2, new Set());
    expect(empty.get(nid('r4c1'))).toBe(1);
    expect(empty.get(nid('r4c2'))).toBe(2);
    expect(empty.has(nid('r4c0'))).toBe(false);

    const occupied = new Set([nid('r4c1')]);
    const blocked = mpReachable(BOARD, nid('r4c0'), 2, occupied);
    expect(blocked.has(nid('r4c1'))).toBe(false);
    expect(blocked.has(nid('r4c2'))).toBe(false);

    const through = mpReachable(BOARD, nid('r4c0'), 2, occupied, { passThrough: true, forbidden: new Set() });
    expect(through.has(nid('r4c1'))).toBe(false);
    expect(through.get(nid('r4c2'))).toBe(2);

    const conditioned = mpReachable(BOARD, nid('r4c0'), 2, occupied, {
      passThrough: false,
      passableOccupied: new Set([nid('r4c1')]),
      forbidden: new Set(),
    });
    expect(conditioned.get(nid('r4c2'))).toBe(2);
    const blockedCondition = mpReachable(BOARD, nid('r4c0'), 2, occupied, {
      passThrough: false,
      passableOccupied: new Set(),
      forbidden: new Set(),
    });
    expect(blockedCondition.has(nid('r4c2'))).toBe(false);
  });

  it('returns no destinations when MP is 0', () => {
    expect(mpReachable(BOARD, nid('r4c0'), 0, new Set(), OPEN_MOVEMENT).size).toBe(0);
  });

  it('walks a connected component only through matching occupied nodes', () => {
    const occupied = new Set([nid('r4c0'), nid('r4c1'), nid('r4c2'), nid('r0c0')]);
    const chain = connectedComponent(BOARD, nid('r4c0'), (node) => occupied.has(node));
    expect(chain.has(nid('r4c1'))).toBe(true);
    expect(chain.has(nid('r4c2'))).toBe(true);
    expect(chain.has(nid('r4c0'))).toBe(false);
    expect(chain.has(nid('r0c0'))).toBe(false);
  });
});

describe('surround arity', () => {
  it('requires every neighbour, so arity follows the node degree', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2), makeFigure(3), makeFigure(4)],
    });

    const goal = onField(state, [
      [0, 'r0c1'],
      [1, 'r0c0'],
      [2, 'r0c2'],
    ]);
    const goalNode = engine.deps.board.byId.get(nid('r0c1'));
    expect(goalNode?.neighbors).toHaveLength(2);
    expect(findSurrounded(goal, engine.deps).map((f) => f.uid)).toEqual([0]);

    const open = onField(state, [
      [0, 'r4c0'],
      [1, 'r4c1'],
      [2, 'r3c0'],
    ]);
    const entry = engine.deps.board.byId.get(nid('r4c0'));
    expect(entry?.neighbors).toHaveLength(3);
    expect(findSurrounded(open, engine.deps)).toEqual([]);

    const sealed = onField(state, [
      [0, 'r4c0'],
      [1, 'r4c1'],
      [2, 'r3c0'],
      [3, 'i2c0'],
    ]);
    expect(findSurrounded(sealed, engine.deps).map((f) => f.uid)).toEqual([0]);
  });
});
