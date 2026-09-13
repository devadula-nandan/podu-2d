/**
 * The engine's public surface.
 *
 * Everything a UI, an AI, a server or a test needs, and nothing that would let a caller
 * mutate state behind the reducers' backs. Content arrives through `createEngine`; the
 * engine never loads it.
 */
export { createEngine } from './dispatch.js';
export type { DispatchResult, Engine } from './dispatch.js';

export { createGame, setupGaps } from './setup.js';
export type { DeckSetup, GameSetup } from './setup.js';

export { reduce, applyEvents } from './reduce.js';
export { legalCommands, settle, execute, hasAnyAction, movementCommands } from './phases.js';
export { replayTo, rewind, timeTravelAftermath, timeTravelAvailable } from './rewind.js';
export {
  plateCostTowardBudget,
  plateDeckCost,
  plateDeckIssues,
  plateStandIn,
  isFormOnlyFigure,
  isDeckLimitExempt,
  figureDeckIssues,
  isInsteadOfMoveClause,
  isInsteadOfAttackClause,
  isActivableAbilityClause,
  isPreSelectClause,
  isTimeTravelClause,
} from './plates.js';
export {
  formSiblings,
  resolveFormTargets,
  resolveMegaTargets,
  resolveEvolutionTargets,
  namedFiguresInText,
  evolutionHookForAbility,
  megaBlockedByOncePerDuel,
  transformEvents,
  megaStartEvents,
  megaEndEvents,
} from './forms.js';
export { view } from './view.js';
export type { PlayerView } from './view.js';
export { hashState, canonicalJson, fnv1a } from './hash.js';

export { createRng, nextUint32, nextInt, pick, shuffle } from './rng.js';
export type { RngState } from './rng.js';

export { BOARD, buildBoardGraph, stepDistance, nodesExactlySteps, nodesWithinSteps, areAdjacent, mpReachable, connectedComponent, straightLineBehind, OPEN_MOVEMENT } from './board/graph.js';
export type { BoardGraph, BoardNode, NodeKind, MovementPermissions } from './board/graph.js';

export { indexContent, figureContent, plateContent, MissingContentError } from './content.js';
export type { ContentInput, EngineContent, FigureContent, PlateContent } from './content.js';

export { buildCoverageRegistry, coverageSummary, describeGaps, describePlateGaps, UnimplementedContentError } from './effects/registry.js';
export type { CoverageRegistry, CoverageTotals, FigureSupport, PlateSupport } from './effects/registry.js';

export { clauseGaps, isClauseSupported } from './effects/support.js';
export {
  runTrigger,
  liveClauses,
  survivingClauses,
  nullifiedFigures,
  damageModifiersFor,
  preventionsFor,
  movementGrantsFor,
  mustBattle,
  platesAllowed,
  runLiveList,
  battleRangeFor,
  leapStepsFor,
} from './effects/bus.js';

export { buildWheel, buildZMoveWheel, spinWheel, wheelTotal, advanceClockwise, segmentAt } from './rules/wheel.js';
export { computeDamage, resolveColors, knocksOut, battleTargets } from './rules/battle.js';
export type { DamageInput, DamageResult } from './rules/battle.js';
export { startBattle, performSpins, resolveBattle, useRespin, roleOfPlayer } from './rules/battle-flow.js';
export { findSurrounded, resolveSurrounds } from './rules/surround.js';
export {
  movementPoints,
  availableMp,
  turnMpPenalty,
  canTakeMovementAction,
  mpMoveOptions,
  deployOptions,
  tagTargets,
} from './rules/movement.js';
export {
  changeZone,
  sendToPc,
  knockOut,
  exclude,
  returnExpiredExclusions,
  tickTimers,
  timersRun,
} from './rules/zones.js';
export {
  goalOutcome,
  clockResult,
  turnLimitResult,
  waitVictoryResult,
  concedeResult,
} from './rules/win.js';

export { MARKER_DEFINITIONS, markerDefinition, isKnownMarker, UnknownMarkerError } from './markers.js';
export type { MarkerDefinition } from './markers.js';

export * from './ids.js';
export * from './commands.js';
export type * from './events.js';
export type * from './state.js';
export {
  EngineError,
  figureOf,
  playerOf,
  fieldFigures,
  occupancy,
  occupiedNodes,
  figureAt,
  pcFigures,
  isOver,
  stateProblems,
  assertStateInvariants,
} from './state.js';
export {
  PHASE_MACHINE_MERMAID,
  PHASES,
  WAITING_PHASES,
  isWaitingPhase,
} from './phase-machine.js';
export type { WaitingPhase } from './phase-machine.js';
