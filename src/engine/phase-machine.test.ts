import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHASE_MACHINE_MERMAID, PHASES, type PhaseGraphCoversAll } from './phase-machine.js';
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
