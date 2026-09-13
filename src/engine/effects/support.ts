/**
 * What the effect runtime can actually execute - stated as data, so it can be counted.
 *
 * This module exists to make one thing impossible: an ability that looks implemented
 * and does nothing. The DSL compiles 83.9% of the corpus into real primitives, but
 * "compiles to a primitive" and "the engine executes that primitive" are different
 * claims, and only the second one matters at the table. So the supported vocabulary is
 * enumerated here by hand and the registry cross-references every clause against it.
 *
 * The rule for adding an entry is simple and worth stating: **a primitive goes in these
 * sets only when `interpret.ts` genuinely performs it.** Adding one to make a figure
 * loadable would convert a loud failure into a silent wrong answer, which is the exact
 * trade this project refuses.
 */
import type { Action, Clause, Condition, Destination, DamageModifier, Trigger } from '../../content/dsl/effects.js';
import type { Filter, Selector } from '../../content/dsl/selectors.js';
import { isKnownMarker } from '../markers.js';

export const SUPPORTED_TRIGGERS: ReadonlySet<Trigger> = new Set<Trigger>([
  'onAttackResolve',
  'onSelfKnockedOut',
  'onOpponentKnockedOut',
  'onAttacked',
  'afterBattle',
  'beforeBattle',
  'duringBattle',
  'startOfTurn',
  'endOfTurn',
  'afterMove',
  'onEnterField',
  'onPcToBench',
  'onFigureKnockedOut',
  'onPlatePlayed',
  'onSurrounded',
  'onLeaveField',
  'onNamedSpin',
  'onMegaStart',
  'onMegaEnd',
  'onConditionApplied',
  'passive',
  'usageRestriction',
]);

export const SUPPORTED_SELECTORS: ReadonlySet<Selector['kind']> = new Set<Selector['kind']>([
  'self',
  'battleOpponent',
  'antecedent',
  'spunResult',
  'all',
  'union',
  'except',
  'none',
  'choose',
]);

export const SUPPORTED_FILTERS: ReadonlySet<Filter['kind']> = new Set<Filter['kind']>([
  'inZone',
  'allegiance',
  'adjacentTo',
  'within',
  'stepsAway',
  'straightLineBehind',
  'succession',
  'hasType',
  'hasCondition',
  'hasMarker',
  'mp',
  'named',
  'isMegaEvolved',
  'movedThisTurn',
  'not',
  // Compiled `tag: ultraBeast` clauses are the flag; there is still no schema field.
  'isUltraBeast',
  'atEntryPoint',
  'ownedByEntryOf',
  'sameNameAs',
  'passedThroughBy',
  'hasMpReducer',
]);

export const SUPPORTED_CONDITIONS: ReadonlySet<Condition['kind']> = new Set<Condition['kind']>([
  'targetExists',
  'targetCount',
  'hasCondition',
  'hasType',
  'inZone',
  'mp',
  'spun',
  'isMegaEvolved',
  'precedingActionTaken',
  'not',
  'hasMarker',
  'hasWait',
  'mpCompare',
  'isEvolved',
  'hasChangedForm',
  'battleTied',
  'isTurnPlayer',
  'atEntryPoint',
  'entryPointsFilled',
  'usingPlate',
  'exclusiveType',
  'pcHasSpace',
  'goalOpen',
  'isBattleWinner',
  'anyOf',
  'allOf',
  'changedFormFrom',
  'plateJustPlayed',
  'antecedentNamed',
  'opponentDamageVsSelf',
  'passedThrough',
  'sameAttackBothTimes',
  'namedAttackSpun',
  'firstBattleAfterMoving',
  'appliedCondition',
  'canEvolve',
  'hasDamageIncrease',
  'attackMovedOpponent',
  'passedOverSelf',
]);

export const SUPPORTED_ACTIONS: ReadonlySet<Action['do']> = new Set<Action['do']>([
  'applyCondition',
  'cureConditions',
  'attachMarker',
  'removeMarker',
  'knockOut',
  'exclude',
  'move',
  'spinCheck',
  'respin',
  'modifyDamage',
  'modifyMp',
  'grantMovement',
  'prevent',
  'nullify',
  'endTurn',
  'forceBattle',
  'forceNextTurn',
  'rotateWheel',
  'adjustZGauge',
  'tag',
  'noStack',
  'usageGate',
  'evolve',
  'megaEvolve',
  'changeForm',
  'refreshPlate',
  'shiftSpinResult',
  'replaceSegment',
  'optional',
  'select',
  'recolorAttacks',
  'modifyStars',
  'setBattleRange',
  'adjustMegaTurns',
  'grantLeap',
  'consumePlate',
  'reorderPc',
  'lockGoal',
  'transferConditions',
  'redirectInflictions',
  'claimSpot',
  'armTrigger',
  'resetToStart',
  'fuse',
  'setType',
  'denyPassThrough',
  'nullifyInUsePlate',
  'modifyWaitReceived',
  'grantStraightMp',
  'denyDeploy',
  'invertAbilityIncreases',
  'restrictMoves',
  'surviveByClearing',
  'surviveByForm',
  'treatAsNewlyMoved',
  'copyType',
  'repeatFor',
  'repeatTimes',
  'setMp',
  'copyPlateEffects',
  'restrictDeploy',
  'markBattled',
  'forceFullMp',
  'floorMp',
  'seizeMoveEffects',
  'spendOnce',
  'grantExtraBattle',
  'readyImmediately',
  'bonusRespin',
  'scaleAttackEffects',
  'stripKoPrevention',
  'revertForm',
  'denyNamedGrant',
  'denyAdjacentPass',
  'copyReceivedCondition',
]);

export const SUPPORTED_DESTINATIONS: ReadonlySet<Destination['kind']> = new Set<Destination['kind']>([
  'zone',
  'swapWith',
  'entryPoint',
  'pointStepsAway',
  'knockBack',
  'jumpOver',
  'openSpotAdjacentTo',
  'goal',
  'adjacentToOwnEntry',
  'beyond',
  'pointWithinSteps',
  'drawCloser',
  'withinMpRange',
  'vacatedBy',
  'anyOpenField',
  'route',
  'respectiveEntry',
  'beyondSuccession',
]);

export const SUPPORTED_DAMAGE_MODIFIERS: ReadonlySet<DamageModifier['kind']> = new Set<DamageModifier['kind']>([
  'flat',
  'multiply',
  'multiplyByCount',
  'flatByCount',
  'none',
  'copyAbilityIncreases',
]);

// ---------------------------------------------------------------------------
// Gap analysis
// ---------------------------------------------------------------------------

function selectorGaps(selector: Selector, out: string[]): void {
  if (!SUPPORTED_SELECTORS.has(selector.kind)) {
    out.push(`selector:${selector.kind}`);
    return;
  }
  switch (selector.kind) {
    case 'all':
      for (const filter of selector.where) filterGaps(filter, out);
      break;
    case 'union':
      for (const inner of selector.of) selectorGaps(inner, out);
      break;
    case 'except':
      selectorGaps(selector.from, out);
      selectorGaps(selector.remove, out);
      break;
    case 'self':
    case 'battleOpponent':
    case 'antecedent':
    case 'spunResult':
    case 'none':
      break;
    case 'choose':
      for (const filter of selector.where) filterGaps(filter, out);
      if (selector.from !== undefined) selectorGaps(selector.from, out);
      break;
  }
}

function filterGaps(filter: Filter, out: string[]): void {
  if (!SUPPORTED_FILTERS.has(filter.kind)) {
    out.push(`filter:${filter.kind}`);
    return;
  }
  switch (filter.kind) {
    case 'adjacentTo':
    case 'within':
    case 'sameNameAs':
      selectorGaps(filter.of, out);
      break;
    case 'stepsAway':
      selectorGaps(filter.from, out);
      break;
    case 'straightLineBehind':
      selectorGaps(filter.of, out);
      break;
    case 'succession':
      selectorGaps(filter.from, out);
      break;
    case 'passedThroughBy':
      selectorGaps(filter.of, out);
      break;
    case 'hasMarker':
      if (!isKnownMarker(filter.marker)) out.push(`marker:${filter.marker}`);
      break;
    case 'not':
      filterGaps(filter.filter, out);
      break;
    case 'mp':
    case 'inZone':
    case 'allegiance':
    case 'hasType':
    case 'hasCondition':
    case 'named':
    case 'isUltraBeast':
    case 'isMegaEvolved':
    case 'movedThisTurn':
    case 'atEntryPoint':
    case 'hasMpReducer':
      break;
    case 'ownedByEntryOf':
      selectorGaps(filter.of, out);
      break;
  }
}

function conditionGaps(condition: Condition, out: string[]): void {
  if (!SUPPORTED_CONDITIONS.has(condition.kind)) {
    out.push(`condition:${condition.kind}`);
    return;
  }
  switch (condition.kind) {
    case 'targetExists':
      selectorGaps(condition.selector, out);
      break;
    case 'targetCount':
      selectorGaps(condition.selector, out);
      break;
    case 'hasCondition':
    case 'hasType':
    case 'inZone':
    case 'mp':
    case 'spun':
    case 'isMegaEvolved':
      selectorGaps(condition.target, out);
      break;
    case 'not':
      conditionGaps(condition.of, out);
      break;
    case 'hasMarker':
      if (!isKnownMarker(condition.marker)) out.push(`marker:${condition.marker}`);
      selectorGaps(condition.target, out);
      break;
    case 'hasWait':
    case 'isEvolved':
    case 'hasChangedForm':
    case 'atEntryPoint':
      selectorGaps(condition.target, out);
      break;
    case 'mpCompare':
      selectorGaps(condition.left, out);
      selectorGaps(condition.right, out);
      break;
    case 'unimplemented':
    case 'precedingActionTaken':
    case 'battleTied':
    case 'isTurnPlayer':
    case 'entryPointsFilled':
    case 'usingPlate':
    case 'pcHasSpace':
    case 'goalOpen':
    case 'isBattleWinner':
      break;
    case 'exclusiveType':
      selectorGaps(condition.target, out);
      break;
    case 'anyOf':
    case 'allOf':
      for (const inner of condition.of) conditionGaps(inner, out);
      break;
    case 'changedFormFrom':
      selectorGaps(condition.target, out);
      break;
    case 'plateJustPlayed':
    case 'antecedentNamed':
    case 'opponentDamageVsSelf':
    case 'passedThrough':
    case 'sameAttackBothTimes':
      if (condition.kind === 'sameAttackBothTimes') selectorGaps(condition.target, out);
      break;
    case 'namedAttackSpun':
      break;
    case 'firstBattleAfterMoving':
      selectorGaps(condition.target, out);
      break;
    case 'canEvolve':
    case 'hasDamageIncrease':
      selectorGaps(condition.target, out);
      break;
    case 'appliedCondition':
    case 'attackMovedOpponent':
    case 'passedOverSelf':
      break;
  }
}

function actionGaps(action: Action, out: string[]): void {
  if (!SUPPORTED_ACTIONS.has(action.do)) {
    out.push(action.do === 'unimplemented' ? `unimplemented:${action.text.slice(0, 60)}` : `action:${action.do}`);
    return;
  }
  // `adjustZGauge` also carries a `target`, but it is a player and not a selector, so
  // the string form is skipped rather than handed to the selector walker.
  if ('target' in action && typeof action.target !== 'string') selectorGaps(action.target, out);
  switch (action.do) {
    case 'move':
      if (!SUPPORTED_DESTINATIONS.has(action.to.kind)) out.push(`destination:${action.to.kind}`);
      else if (action.to.kind === 'swapWith') selectorGaps(action.to.with, out);
      else if (action.to.kind === 'jumpOver' || action.to.kind === 'beyond') selectorGaps(action.to.over, out);
      else if (action.to.kind === 'openSpotAdjacentTo' || action.to.kind === 'pointWithinSteps') {
        selectorGaps(action.to.of, out);
      } else if (action.to.kind === 'drawCloser') {
        selectorGaps(action.to.toward, out);
      }       else if (action.to.kind === 'vacatedBy') {
        selectorGaps(action.to.of, out);
      } else if (action.to.kind === 'route' && action.to.adjacentTo !== undefined) {
        selectorGaps(action.to.adjacentTo, out);
      }
      break;
    case 'modifyDamage':
      if (!SUPPORTED_DAMAGE_MODIFIERS.has(action.modifier.kind)) out.push(`damage:${action.modifier.kind}`);
      else if (
        (action.modifier.kind === 'multiplyByCount' || action.modifier.kind === 'flatByCount') &&
        action.modifier.of.kind === 'figures'
      ) {
        selectorGaps(action.modifier.of.of, out);
      } else if (action.modifier.kind === 'copyAbilityIncreases') {
        selectorGaps(action.modifier.from, out);
      }
      break;
    case 'attachMarker':
    case 'removeMarker':
      if (!isKnownMarker(action.marker)) out.push(`marker:${action.marker}`);
      break;
    case 'spinCheck':
      for (const child of action.then) for (const gap of clauseGaps(child)) out.push(gap);
      break;
    case 'tag':
    case 'applyCondition':
    case 'cureConditions':
    case 'knockOut':
    case 'exclude':
    case 'respin':
    case 'modifyMp':
      break;
    case 'grantMovement':
      if (action.over !== undefined) selectorGaps(action.over, out);
      break;
    case 'prevent':
    case 'nullify':
    case 'evolve':
    case 'megaEvolve':
    case 'changeForm':
    case 'endTurn':
    case 'forceNextTurn':
    case 'adjustZGauge':
    case 'rotateWheel':
    case 'shiftSpinResult':
    case 'refreshPlate':
    case 'recolorAttacks':
    case 'modifyStars':
    case 'setBattleRange':
    case 'adjustMegaTurns':
    case 'grantLeap':
    case 'consumePlate':
    case 'reorderPc':
    case 'lockGoal':
      break;
    case 'transferConditions':
      selectorGaps(action.from, out);
      selectorGaps(action.to, out);
      break;
    case 'redirectInflictions':
      selectorGaps(action.to, out);
      break;
    case 'claimSpot':
      selectorGaps(action.knock, out);
      selectorGaps(action.claim, out);
      break;
    case 'armTrigger':
      for (const cond of action.when) conditionGaps(cond, out);
      for (const child of action.then) actionGaps(child, out);
      break;
    case 'replaceSegment':
      if (action.then !== undefined) {
        for (const child of action.then) for (const gap of clauseGaps(child)) out.push(gap);
      }
      break;
    case 'resetToStart':
    case 'setType':
    case 'nullifyInUsePlate':
    case 'modifyWaitReceived':
      break;
    case 'fuse':
      selectorGaps(action.host, out);
      selectorGaps(action.material, out);
      break;
    case 'denyPassThrough':
      selectorGaps(action.movers, out);
      selectorGaps(action.blockers, out);
      break;
    case 'copyType':
      selectorGaps(action.from, out);
      break;
    case 'repeatFor':
      selectorGaps(action.of, out);
      for (const child of action.then) actionGaps(child, out);
      break;
    case 'repeatTimes':
      if (action.times.kind === 'figures') selectorGaps(action.times.of, out);
      else if (action.times.kind === 'evolutionCount') selectorGaps(action.times.of, out);
      for (const child of action.then) actionGaps(child, out);
      break;
    case 'copyPlateEffects':
      selectorGaps(action.from, out);
      break;
    case 'setMp':
    case 'restrictDeploy':
    case 'forceFullMp':
    case 'floorMp':
    case 'seizeMoveEffects':
    case 'markBattled':
      break;
    case 'forceBattle':
      if (action.against !== undefined) selectorGaps(action.against, out);
      break;
    case 'grantStraightMp':
    case 'denyDeploy':
    case 'invertAbilityIncreases':
    case 'restrictMoves':
    case 'surviveByClearing':
    case 'surviveByForm':
    case 'treatAsNewlyMoved':
      break;
    case 'optional':
      for (const child of action.then) actionGaps(child, out);
      break;
    case 'select':
    case 'noStack':
    case 'usageGate':
    case 'spendOnce':
    case 'grantExtraBattle':
    case 'readyImmediately':
    case 'bonusRespin':
    case 'stripKoPrevention':
    case 'revertForm':
    case 'unimplemented':
      break;
    case 'scaleAttackEffects':
      if (action.of.kind === 'figures') selectorGaps(action.of.of, out);
      break;
    case 'denyNamedGrant':
      selectorGaps(action.movers, out);
      break;
    case 'denyAdjacentPass':
      selectorGaps(action.movers, out);
      selectorGaps(action.around, out);
      break;
    case 'copyReceivedCondition':
      selectorGaps(action.to, out);
      break;
  }
}

/** Every reason this clause cannot be executed. Empty means the engine really runs it. */
export function clauseGaps(clause: Clause): string[] {
  const out: string[] = [];
  if (!SUPPORTED_TRIGGERS.has(clause.trigger)) out.push(`trigger:${clause.trigger}`);
  for (const condition of clause.when) conditionGaps(condition, out);
  for (const action of clause.actions) actionGaps(action, out);
  return [...new Set(out)];
}

export const isClauseSupported = (clause: Clause): boolean => clauseGaps(clause).length === 0;
