/**
 * The complete turn phase machine: every `Phase`, every settle/command hop, and
 * every game-ending reason. README mermaid is a short documented subset — the
 * /dev Machine tab renders `PHASE_MACHINE_NODES` / `PHASE_MACHINE_EDGES`.
 */
import type { Phase, WinReason } from './state.js';

export const PHASES = [
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
] as const satisfies readonly Phase[];

/** `true` only when every `Phase` appears in `PHASES`. */
export type PhaseGraphCoversAll = [Exclude<Phase, (typeof PHASES)[number]>] extends [never] ? true : false;

/** Phases that `settle` stops on for a player decision. */
export const WAITING_PHASES = [
  'plateWindow',
  'action',
  'battleDecision',
  'spin',
  'respin',
] as const satisfies readonly Phase[];

export type WaitingPhase = (typeof WAITING_PHASES)[number];

export function isWaitingPhase(phase: Phase): phase is WaitingPhase {
  return (WAITING_PHASES as readonly Phase[]).includes(phase);
}

/** Win reasons that actually emit `gameEnded`. */
export const PHASE_END_REASONS = [
  'waitVictory',
  'goal',
  'turnLimit',
  'concede',
  'clock',
] as const satisfies readonly WinReason[];

export type PhaseEndReason = (typeof PHASE_END_REASONS)[number];

export type PhaseMachineNodeId = Phase | 'start' | 'end' | PhaseEndReason;

export type PhaseMachineNodeKind = 'start' | 'end' | 'phase' | 'wait' | 'reason' | 'terminal';

export interface PhaseMachineNode {
  readonly id: PhaseMachineNodeId;
  readonly kind: PhaseMachineNodeKind;
  readonly label: string;
}

export interface PhaseMachineEdge {
  readonly id: string;
  readonly from: PhaseMachineNodeId;
  readonly to: PhaseMachineNodeId;
  readonly label: string;
}

function edge(from: PhaseMachineNodeId, to: PhaseMachineNodeId, label: string): PhaseMachineEdge {
  return { id: `${from}>${to}`, from, to, label };
}

export const PHASE_MACHINE_NODES = [
  { id: 'start', kind: 'start', label: 'start' },
  { id: 'setup', kind: 'phase', label: 'setup' },
  { id: 'turnStart', kind: 'phase', label: 'turnStart' },
  { id: 'plateWindow', kind: 'wait', label: 'plateWindow' },
  { id: 'preSelect', kind: 'phase', label: 'preSelect' },
  { id: 'action', kind: 'wait', label: 'action' },
  { id: 'surroundCheck', kind: 'phase', label: 'surroundCheck' },
  { id: 'battleDecision', kind: 'wait', label: 'battleDecision' },
  { id: 'spin', kind: 'wait', label: 'spin' },
  { id: 'respin', kind: 'wait', label: 'respin' },
  { id: 'damageResolve', kind: 'phase', label: 'damageResolve' },
  { id: 'turnEnd', kind: 'phase', label: 'turnEnd' },
  { id: 'gameOver', kind: 'terminal', label: 'gameOver' },
  { id: 'end', kind: 'end', label: 'end' },
  { id: 'waitVictory', kind: 'reason', label: 'waitVictory' },
  { id: 'goal', kind: 'reason', label: 'goal' },
  { id: 'turnLimit', kind: 'reason', label: 'turnLimit' },
  { id: 'concede', kind: 'reason', label: 'concede' },
  { id: 'clock', kind: 'reason', label: 'clock' },
] as const satisfies readonly PhaseMachineNode[];

/** Every hop `settle` / `execute` can take, including interrupts. */
export const PHASE_MACHINE_EDGES: readonly PhaseMachineEdge[] = [
  edge('start', 'setup', ''),
  edge('setup', 'turnStart', 'start'),
  edge('turnStart', 'plateWindow', 'continue'),
  edge('turnStart', 'waitVictory', 'no legal action'),
  edge('waitVictory', 'gameOver', ''),
  edge('plateWindow', 'preSelect', 'play or skip'),
  edge('plateWindow', 'turnEnd', 'plate ends turn'),
  edge('preSelect', 'action', 'auto if none'),
  edge('action', 'surroundCheck', 'mpMove or deploy'),
  edge('action', 'battleDecision', 'no move left'),
  edge('action', 'spin', 'initiateBattle'),
  edge('action', 'turnEnd', 'tag / forced'),
  edge('action', 'goal', 'goal'),
  edge('goal', 'gameOver', ''),
  edge('surroundCheck', 'battleDecision', 'auto'),
  edge('surroundCheck', 'goal', 'goal after surround'),
  edge('battleDecision', 'spin', 'initiateBattle'),
  edge('battleDecision', 'turnEnd', 'decline or no target'),
  edge('spin', 'respin', 'both landed'),
  edge('spin', 'turnEnd', 'battle aborted'),
  edge('respin', 'damageResolve', 'no respins'),
  edge('respin', 'turnEnd', 'battle aborted'),
  edge('damageResolve', 'battleDecision', 'extra battle'),
  edge('damageResolve', 'turnEnd', 'resolve'),
  edge('turnEnd', 'turnStart', 'other player'),
  edge('turnEnd', 'turnLimit', 'turn cap'),
  edge('turnLimit', 'gameOver', ''),
  edge('plateWindow', 'concede', 'resign'),
  edge('action', 'concede', 'resign'),
  edge('battleDecision', 'concede', 'resign'),
  edge('spin', 'concede', 'resign'),
  edge('respin', 'concede', 'resign'),
  edge('concede', 'gameOver', 'any phase'),
  edge('plateWindow', 'clock', 'flag'),
  edge('action', 'clock', 'flag'),
  edge('battleDecision', 'clock', 'flag'),
  edge('spin', 'clock', 'flag'),
  edge('respin', 'clock', 'flag'),
  edge('clock', 'gameOver', 'any phase'),
  edge('gameOver', 'end', ''),
];

export function phaseMachineEdgeKey(from: PhaseMachineNodeId, to: PhaseMachineNodeId): string {
  return `${from}>${to}`;
}

export function isPhaseEndReason(value: string): value is PhaseEndReason {
  return (PHASE_END_REASONS as readonly string[]).includes(value);
}

export function isPhaseMachineNodeId(value: string): value is PhaseMachineNodeId {
  return PHASE_MACHINE_NODES.some((node) => node.id === value);
}

/** Keep in sync with README.md "Turn phase machine" (documented subset). */
export const PHASE_MACHINE_MERMAID = `stateDiagram-v2
    [*] --> setup
    setup --> turnStart: start
    turnStart --> gameOver: Wait Victory
    turnStart --> plateWindow: continue
    plateWindow --> turnEnd: plate ends turn
    plateWindow --> preSelect: play or skip
    preSelect --> action: auto if none
    action --> spin: initiateBattle
    action --> turnEnd: tag / forced
    action --> surroundCheck: mpMove or deploy
    action --> battleDecision: no move left
    action --> gameOver: goal
    surroundCheck --> battleDecision: auto
    battleDecision --> spin: initiateBattle
    battleDecision --> turnEnd: decline or no target
    spin --> respin: both landed
    respin --> damageResolve: no respins
    damageResolve --> battleDecision: extra battle
    damageResolve --> turnEnd: resolve
    turnEnd --> turnStart: other player
    turnEnd --> gameOver: turn cap
    gameOver --> [*]
`;
