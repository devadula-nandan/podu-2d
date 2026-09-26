import type { PhaseMachineNode, PhaseMachineNodeId } from '../engine/phase-machine.js';

const MAIN_X = 16;
const SIDE_X = 196;
const STEP = 38;

const MAIN = [
  'start',
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
  'end',
] as const satisfies readonly PhaseMachineNodeId[];

const SIDE_ALIGN: Record<
  Exclude<PhaseMachineNodeId, (typeof MAIN)[number]>,
  PhaseMachineNodeId | number
> = {
  waitVictory: 'turnStart',
  goal: 'action',
  turnLimit: 'turnEnd',
  concede: 11.45,
  clock: 'gameOver',
};

function mainY(id: PhaseMachineNodeId): number {
  const index = (MAIN as readonly PhaseMachineNodeId[]).indexOf(id);
  return index === -1 ? 0 : index * STEP;
}

export function phaseMachineNodeSize(node: PhaseMachineNode): { width: number; height: number } {
  if (node.kind === 'start' || node.kind === 'end') return { width: 72, height: 26 };
  if (node.kind === 'reason') return { width: 132, height: 28 };
  return { width: 148, height: 30 };
}

export function phaseMachinePosition(id: PhaseMachineNodeId): { x: number; y: number } {
  const mainIndex = (MAIN as readonly PhaseMachineNodeId[]).indexOf(id);
  if (mainIndex !== -1) return { x: MAIN_X, y: mainY(id) };
  const align = SIDE_ALIGN[id as keyof typeof SIDE_ALIGN];
  const y = typeof align === 'number' ? align * STEP : mainY(align);
  return { x: SIDE_X, y };
}
