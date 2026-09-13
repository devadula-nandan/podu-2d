/**
 * The README "Turn phase machine" graph, as a string the /dev Machine tab can render.
 * Keep in sync with README.md — `phase-machine.test.ts` asserts they match.
 */
import type { Phase } from './state.js';

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

/** Keep in sync with README.md "Turn phase machine". */
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
