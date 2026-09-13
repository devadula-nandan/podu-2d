/**
 * Aggregate a batch of walks into the histogram the CLI and the CI test print.
 */
import type { Command } from '../commands.js';
import type { Phase, WinReason } from '../state.js';
import { FuzzInvariantError } from './invariants.js';
import type { EndKind, GameWalk } from './walk.js';

export const WIN_REASON_KEYS: readonly EndKind[] = [
  'goal',
  'surroundGoalDenied',
  'waitVictory',
  'turnLimit',
  'clock',
  'concede',
  'unfinished',
];

export interface FuzzFailure {
  readonly seed: number;
  readonly step: number;
  readonly message: string;
}

export interface FuzzReport {
  readonly games: number;
  readonly commands: number;
  readonly finished: number;
  readonly unfinished: number;
  readonly invariantFailures: number;
  readonly failures: readonly FuzzFailure[];
  readonly wins: Readonly<Record<EndKind, number>>;
  readonly surroundKos: number;
  readonly uniqueFinishedSeeds: readonly number[];
  readonly phasesSeen: readonly Phase[];
  readonly commandKindsSeen: readonly Command['kind'][];
  readonly elapsedMs: number;
}

const EMPTY_WINS = (): Record<EndKind, number> => ({
  goal: 0,
  surroundGoalDenied: 0,
  waitVictory: 0,
  turnLimit: 0,
  clock: 0,
  concede: 0,
  unfinished: 0,
});

export function accumulate(
  walks: readonly GameWalk[],
  failures: readonly FuzzFailure[],
  elapsedMs: number,
): FuzzReport {
  const wins = EMPTY_WINS();
  const phases = new Set<Phase>();
  const kinds = new Set<Command['kind']>();
  const finishedSeeds: number[] = [];
  let commands = 0;
  let surroundKos = 0;

  for (const walk of walks) {
    wins[walk.end] += 1;
    commands += walk.commandCount;
    surroundKos += walk.surroundKos;
    for (const phase of walk.phases) phases.add(phase);
    for (const kind of walk.commandKinds) kinds.add(kind);
    if (walk.end !== 'unfinished') finishedSeeds.push(walk.seed);
  }

  return {
    games: walks.length + failures.length,
    commands,
    finished: finishedSeeds.length,
    unfinished: wins.unfinished,
    invariantFailures: failures.length,
    failures,
    wins,
    surroundKos,
    uniqueFinishedSeeds: [...new Set(finishedSeeds)].sort((a, b) => a - b),
    phasesSeen: [...phases].sort(),
    commandKindsSeen: [...kinds].sort(),
    elapsedMs,
  };
}

export function failureFromError(error: unknown): FuzzFailure {
  if (error instanceof FuzzInvariantError) {
    return { seed: error.seed, step: error.step, message: error.message };
  }
  if (error instanceof Error) {
    return { seed: -1, step: -1, message: error.message };
  }
  return { seed: -1, step: -1, message: String(error) };
}

const ALL_PHASES: readonly Phase[] = [
  'setup',
  'turnStart',
  'plateWindow',
  'preSelect',
  'action',
  'surroundCheck',
  'battleDecision',
  'spin',
  'respin',
  'damageResolve',
  'turnEnd',
  'gameOver',
];

export function missingPhases(seen: readonly Phase[]): Phase[] {
  const have = new Set(seen);
  return ALL_PHASES.filter((phase) => !have.has(phase));
}

export function formatReport(report: FuzzReport): string {
  const perSec = report.elapsedMs > 0 ? ((report.games / report.elapsedMs) * 1000).toFixed(1) : 'n/a';
  const wins = WIN_REASON_KEYS.map((key) => `${friendlyWinReason(key)}=${report.wins[key]}`).join('  ');
  const holes = missingPhases(report.phasesSeen);
  const seedNote =
    report.uniqueFinishedSeeds.length <= 48
      ? report.uniqueFinishedSeeds.join(', ')
      : `${report.uniqueFinishedSeeds.length} seeds (first ${report.uniqueFinishedSeeds.slice(0, 8).join(', ')} …)`;

  return [
    `fuzz: ${report.games} games, ${report.commands} commands, ${report.elapsedMs} ms (${perSec} games/s)`,
    `  finished=${report.finished}  unfinished=${report.unfinished}  invariantFailures=${report.invariantFailures}`,
    `  wins: ${wins}`,
    `  surround KOs (not a win reason): ${report.surroundKos}`,
    `  phases seen: ${report.phasesSeen.join(', ') || '(none)'}`,
    `  phases never reached: ${holes.join(', ') || '(none)'}`,
    `  command kinds: ${report.commandKindsSeen.join(', ') || '(none)'}`,
    `  unique finished seeds: ${seedNote}`,
    ...report.failures
      .slice(0, 8)
      .map((failure) => `  FAIL seed=${failure.seed} step=${failure.step}: ${failure.message}`),
  ].join('\n');
}

export function friendlyWinReason(reason: WinReason | 'unfinished'): string {
  switch (reason) {
    case 'waitVictory':
      return 'wait';
    case 'surroundGoalDenied':
      return 'surround';
    case 'goal':
    case 'clock':
    case 'turnLimit':
    case 'concede':
    case 'unfinished':
      return reason;
  }
}
