import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PHASE_END_REASONS,
  PHASE_MACHINE_EDGES,
  PHASE_MACHINE_MERMAID,
  PHASE_MACHINE_NODES,
  PHASES,
  type PhaseGraphCoversAll,
} from './phase-machine.js';
import type { Phase } from './state.js';

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function readmeMermaid(): string {
  const readme = readFileSync('README.md', 'utf8');
  const match = /```mermaid\r?\n([\s\S]*?)```/.exec(readme);
  if (match?.[1] === undefined) throw new Error('README.md has no mermaid fence');
  return match[1];
}

describe('PHASE_MACHINE_MERMAID', () => {
  it('matches the README Turn phase machine graph', () => {
    expect(normalize(PHASE_MACHINE_MERMAID)).toBe(normalize(readmeMermaid()));
  });

  it('names every Phase', () => {
    const seen = new Set<Phase>(PHASES);
    const missing = (phase: Phase): string | null => (seen.has(phase) ? null : phase);
    const gaps = [
      missing('setup'),
      missing('turnStart'),
      missing('plateWindow'),
      missing('preSelect'),
      missing('action'),
      missing('surroundCheck'),
      missing('battleDecision'),
      missing('spin'),
      missing('respin'),
      missing('damageResolve'),
      missing('turnEnd'),
      missing('gameOver'),
    ].filter((row) => row !== null);
    expect(gaps).toEqual([]);
    const covers: PhaseGraphCoversAll = true;
    expect(covers).toBe(true);
    for (const phase of PHASES) {
      expect(PHASE_MACHINE_MERMAID).toContain(phase);
    }
  });
});

describe('PHASE_MACHINE_NODES', () => {
  it('shows every Phase, bookend, and ending reason', () => {
    const ids = new Set(PHASE_MACHINE_NODES.map((node) => node.id));
    for (const phase of PHASES) {
      expect(ids.has(phase)).toBe(true);
    }
    for (const reason of PHASE_END_REASONS) {
      expect(ids.has(reason)).toBe(true);
    }
    expect(ids.has('start')).toBe(true);
    expect(ids.has('end')).toBe(true);
    expect(PHASE_MACHINE_NODES).toHaveLength(19);
  });

  it('wires every settle hop and does not drop a node', () => {
    const ids = new Set(PHASE_MACHINE_NODES.map((node) => node.id));
    const mentioned = new Set<string>();
    for (const hop of PHASE_MACHINE_EDGES) {
      expect(ids.has(hop.from)).toBe(true);
      expect(ids.has(hop.to)).toBe(true);
      mentioned.add(hop.from);
      mentioned.add(hop.to);
    }
    expect([...ids].filter((id) => !mentioned.has(id))).toEqual([]);
    expect(PHASE_MACHINE_EDGES.some((hop) => hop.from === 'spin' && hop.to === 'turnEnd')).toBe(true);
    expect(PHASE_MACHINE_EDGES.some((hop) => hop.from === 'respin' && hop.to === 'turnEnd')).toBe(true);
    expect(PHASE_MACHINE_EDGES.some((hop) => hop.from === 'action' && hop.to === 'goal')).toBe(true);
    expect(PHASE_MACHINE_EDGES.some((hop) => hop.from === 'concede' && hop.to === 'gameOver')).toBe(true);
  });
});
