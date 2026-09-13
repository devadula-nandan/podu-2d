import { describe, expect, it } from 'vitest';
import { BOARD, nodeId } from '../engine/index.js';
import { hitNode, projectNode, visualUnit } from './draw-board.js';

const layout = { pad: 0, width: 100, height: 100 };

describe('board camera flip', () => {
  it('maps a node to its 180° partner in unit space and keeps the logical id on hit', () => {
    const homeEntry = BOARD.byId.get(nodeId('r4c0'));
    const awayEntry = BOARD.byId.get(nodeId('r0c6'));
    expect(homeEntry).toBeDefined();
    expect(awayEntry).toBeDefined();
    if (homeEntry === undefined || awayEntry === undefined) return;
    expect(visualUnit(homeEntry, true)).toEqual({ x: 1 - homeEntry.x, y: 1 - homeEntry.y });
    expect(visualUnit(homeEntry, true)).toEqual({ x: awayEntry.x, y: awayEntry.y });

    const drawn = projectNode(homeEntry, layout, true);
    expect(hitNode(BOARD, layout, drawn.x, drawn.y, true)).toBe('r4c0');
    expect(hitNode(BOARD, layout, drawn.x, drawn.y, false)).toBe('r0c6');
  });

  it('puts the away goal on the near edge after flip so the scoring goal stays far', () => {
    const myGoal = BOARD.byId.get(nodeId('r0c3'));
    const theirGoal = BOARD.byId.get(nodeId('r4c3'));
    expect(myGoal).toBeDefined();
    expect(theirGoal).toBeDefined();
    if (myGoal === undefined || theirGoal === undefined) return;
    expect(visualUnit(myGoal, true).y).toBe(1);
    expect(visualUnit(theirGoal, true).y).toBe(0);
  });
});
