import { describe, expect, it } from 'vitest';
import { ACTIVE_PHASE_CLASS, isPhaseName, phaseNameOf } from './phase-machine-mark.js';

describe('phaseNameOf', () => {
  it('reads mermaid data-id, id prefixes, and label text', () => {
    expect(phaseNameOf({ id: '', dataId: 'action', text: '' })).toBe('action');
    expect(phaseNameOf({ id: 'plateWindow', dataId: '', text: '' })).toBe('plateWindow');
    expect(phaseNameOf({ id: 'state-battleDecision-4', dataId: '', text: '' })).toBe('battleDecision');
    expect(phaseNameOf({ id: 'turnStart-12', dataId: '', text: '' })).toBe('turnStart');
    expect(phaseNameOf({ id: 'node-1', dataId: '', text: '  gameOver  ' })).toBe('gameOver');
    expect(phaseNameOf({ id: 'start', dataId: '', text: '[*]' })).toBeNull();
  });

  it('accepts only Phase names', () => {
    expect(isPhaseName('action')).toBe(true);
    expect(isPhaseName('pass')).toBe(false);
    expect(ACTIVE_PHASE_CLASS).toBe('is-active');
  });
});
