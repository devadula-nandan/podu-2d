import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../engine/events.js';
import { endReasonNode, phaseEdgeKey, phasePathOf } from './phase-machine-path.js';

describe('phasePathOf', () => {
  it('starts at setup from the entry hop', () => {
    const path = phasePathOf([], 'setup');
    expect(path.current).toBe('setup');
    expect(path.visited.has('start')).toBe(true);
    expect(path.visited.has('setup')).toBe(true);
    expect(path.taken.has(phaseEdgeKey('start', 'setup'))).toBe(true);
    expect(path.lastHop).toEqual({ from: 'start', to: 'setup' });
  });

  it('fills the opening settle when the caller log starts after createGame', () => {
    const path = phasePathOf([], 'plateWindow');
    expect(path.taken.has(phaseEdgeKey('setup', 'turnStart'))).toBe(true);
    expect(path.taken.has(phaseEdgeKey('turnStart', 'plateWindow'))).toBe(true);
    expect(path.current).toBe('plateWindow');
  });

  it('walks phaseChanged hops and keeps repeats as taken', () => {
    const events: GameEvent[] = [
      { kind: 'phaseChanged', from: 'setup', to: 'turnStart' },
      { kind: 'phaseChanged', from: 'turnStart', to: 'plateWindow' },
      { kind: 'phaseChanged', from: 'plateWindow', to: 'preSelect' },
      { kind: 'phaseChanged', from: 'preSelect', to: 'action' },
      { kind: 'phaseChanged', from: 'action', to: 'turnEnd' },
      { kind: 'phaseChanged', from: 'turnEnd', to: 'turnStart' },
      { kind: 'phaseChanged', from: 'turnStart', to: 'plateWindow' },
    ];
    const path = phasePathOf(events, 'plateWindow');
    expect(path.visited.has('action')).toBe(true);
    expect(path.visited.has('spin')).toBe(false);
    expect(path.taken.has(phaseEdgeKey('action', 'turnEnd'))).toBe(true);
    expect(path.taken.has(phaseEdgeKey('turnStart', 'plateWindow'))).toBe(true);
    expect(path.taken.has(phaseEdgeKey('action', 'surroundCheck'))).toBe(false);
    expect(path.lastHop).toEqual({ from: 'turnStart', to: 'plateWindow' });
    expect(path.current).toBe('plateWindow');
  });

  it('walks gameEnded through the reason node', () => {
    const events: GameEvent[] = [
      { kind: 'phaseChanged', from: 'setup', to: 'turnStart' },
      { kind: 'phaseChanged', from: 'turnStart', to: 'plateWindow' },
      { kind: 'gameEnded', result: { winner: 0, reason: 'concede', detail: 'seat 1 conceded' } },
    ];
    const path = phasePathOf(events, 'gameOver');
    expect(endReasonNode('concede')).toBe('concede');
    expect(path.visited.has('concede')).toBe(true);
    expect(path.visited.has('gameOver')).toBe(true);
    expect(path.taken.has(phaseEdgeKey('plateWindow', 'concede'))).toBe(true);
    expect(path.taken.has(phaseEdgeKey('concede', 'gameOver'))).toBe(true);
    expect(path.lastHop).toEqual({ from: 'concede', to: 'gameOver' });
  });
});
