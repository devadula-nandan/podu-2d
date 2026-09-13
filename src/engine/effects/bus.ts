/**
 * The hook bus: which clauses are live, which of them survive, and in what order.
 *
 * A plain event emitter would be wrong here, for three reasons that are all visible in
 * the corpus rather than hypothetical.
 *
 * 1. **174 clauses are `passive`** - "while this Pokemon is on the field". They are not
 *    subscriptions that fire; they are facts that hold. So the bus has two faces: a
 *    `runTrigger` that executes, and a set of *queries* that ask what is currently true.
 * 2. **48 clauses nullify other clauses.** A nullifier has to run before the thing it
 *    suppresses, which is impossible to guarantee if suppression is itself just another
 *    handler racing in the same queue. Hence pass one collects and cancels; pass two
 *    executes only the survivors.
 * 3. **"This effect does not stack."** Two copies of the same figure produce two
 *    identical clauses, and both firing would double an aura. `noStackKey` collapses
 *    them, and it has to happen before execution, not by de-duplicating the results.
 *
 * Ordering is `layer`, then the battle initiator's clauses, then figure id. The last of
 * those is not a rule - it is a tiebreak - but it is a *stable* tiebreak, which is what
 * determinism needs. Two abilities that genuinely race would be a content bug, and the
 * layer field exists to fix it when one turns up.
 */
import { BATTLE_RANGE_DEFAULT, BATTLE_RANGE_MAX } from '../../rules/constants.js';
import { initiatorTriggersFirst } from '../rulings.js';
import type { Action, Clause, DamageModifier, MovementGrant, Preventable, Trigger } from '../../content/dsl/effects.js';
import type { PokemonType } from '../../content/dsl/primitives.js';
import { figureContent } from '../content.js';
import type { GameEvent, KnockOutCause } from '../events.js';
import type { FigureUid, NodeId, PlayerId } from '../ids.js';
import { opponentOf } from '../ids.js';
import type { GameState } from '../state.js';
import { figureOf } from '../state.js';
import type { EventBatch } from '../rules/zones.js';
import { concatBatches, emptyBatch, extend, knockOut, returnExclusionsFor } from '../rules/zones.js';
import { resolveFormTargets, transformEvents } from '../forms.js';
import type { EffectContext, EngineDeps } from './context.js';
import { baseContext } from './context.js';
import { applyActions, isPrevented } from './interpret.js';
import type { ActionResult, ClauseRunner } from './interpret.js';
import { evaluateSelector, guardsPass, typesOf } from './select.js';
import { isPreSelectClause } from '../plates.js';
import { segmentAt } from '../rules/wheel.js';

export interface LiveClause {
  readonly clause: Clause;
  readonly source: FigureUid;
  readonly controller: PlayerId;
}

function clauseOnBench(clause: Clause): boolean {
  if (/on the bench/i.test(clause.source)) return true;
  return clause.when.some((condition) =>
    condition.kind === 'inZone' && condition.zones.includes('bench'),
  );
}

function contextFor(state: GameState, deps: EngineDeps, live: LiveClause): EffectContext {
  let battleOpponent: FigureUid | null = null;
  let activeMoveName: string | null = null;
  let activeMoveColor: EffectContext['activeMoveColor'] = null;
  const battle = state.battle;
  if (battle !== null) {
    if (battle.attacker.uid === live.source) {
      battleOpponent = battle.defender.uid;
      const landed = segmentAt(battle.attacker.wheel, battle.attacker.landedIndex);
      activeMoveName = landed?.moveName ?? null;
      activeMoveColor = landed?.color ?? null;
    } else if (battle.defender.uid === live.source) {
      battleOpponent = battle.attacker.uid;
      const landed = segmentAt(battle.defender.wheel, battle.defender.landedIndex);
      activeMoveName = landed?.moveName ?? null;
      activeMoveColor = landed?.color ?? null;
    }
  }
  return {
    state,
    deps,
    source: live.source,
    controller: live.controller,
    battleOpponent,
    antecedent: [],
    spunResults: new Map(),
    precedingActionTaken: false,
    activeMoveName,
    plateHint: null,
    plateId: null,
    lastPlayedPlate: null,
    clauseTrigger: live.clause.trigger,
    activeMoveColor,
    receivedCondition: null,
    conditionCauser: null,
  };
}

/**
 * Every clause with this trigger belonging to a figure currently on the field.
 *
 * Only field figures contribute. A benched figure's aura would be a rule nobody has
 * ever stated, and a knocked-out figure's `passive` continuing to fire is exactly the
 * bug that makes an aura look haunted.
 */
export function liveClauses(
  state: GameState,
  deps: EngineDeps,
  trigger: Trigger,
  offField: readonly FigureUid[] = [],
): LiveClause[] {
  const found: LiveClause[] = [];
  for (const figure of state.figures) {
    if (
      figure.zone !== 'field'
      && !offField.includes(figure.uid)
      && !(trigger === 'onNamedSpin' && figure.zone === 'pc')
      && !(trigger === 'startOfTurn' && figure.zone === 'bench')
      && !(trigger === 'onFigureKnockedOut' && figure.zone === 'pc')
    ) continue;
    const content = figureContent(deps.content, figure.figureId);
    for (const clause of content.abilityClauses) {
      if (clause.trigger !== trigger) continue;
      if (figure.zone === 'bench' && trigger === 'startOfTurn' && !clauseOnBench(clause)) continue;
      found.push({ clause, source: figure.uid, controller: figure.owner });
    }
  }
  found.push(...lingeringAsLive(state, deps, trigger));
  return found;
}

function lingeringAsLive(state: GameState, deps: EngineDeps, trigger: Trigger): LiveClause[] {
  const found: LiveClause[] = [];
  const offFieldOk =
    trigger === 'onFigureKnockedOut'
    || trigger === 'onPlatePlayed'
    || trigger === 'onPcToBench'
    || trigger === 'onSurrounded'
    || trigger === 'onAttacked'
    || trigger === 'duringBattle'
    || trigger === 'onLeaveField';
  for (const figure of state.figures) {
    if (figure.zone !== 'field' && figure.zone !== 'ultraSpace' && !offFieldOk) continue;
    for (const [index, linger] of (figure.lingering ?? []).entries()) {
      if (linger.expiresOnTurn !== null && state.turn.number >= linger.expiresOnTurn) continue;
      if (linger.untilFirstBattleOf !== undefined) {
        const tracked = state.figures.find((entry) => entry.uid === linger.untilFirstBattleOf);
        if (tracked !== undefined && (tracked.fieldBattles ?? 0) > 0) continue;
      }
      if (linger.plateId !== undefined) {
        const plateName = deps.content.plates.get(linger.plateId)?.plate.name ?? '';
        if (plateName !== '' && plateLingerSuppressed(state, deps, figure.uid, plateName)) continue;
      }
      const lingerTrigger = linger.trigger ?? 'passive';
      if (lingerTrigger !== trigger) continue;
      found.push({
        clause: {
          id: `lingering:${figure.uid}:${index}` as Clause['id'],
          trigger: lingerTrigger,
          when: linger.when ?? [],
          actions: linger.actions,
          layer: 0,
          noStackKey: null,
          source: 'lingering',
        },
        source: figure.uid,
        controller: linger.controller,
      });
    }
  }
  return found;
}

function orderKey(state: GameState, live: LiveClause): [number, number, number] {
  const initiator = state.battle?.initiator ?? null;
  const initiatorRank =
    initiatorTriggersFirst && initiator !== null && live.controller === initiator ? 0 : 1;
  return [live.clause.layer, initiatorRank, live.source];
}

function sortLive(state: GameState, clauses: readonly LiveClause[]): LiveClause[] {
  return [...clauses].sort((a, b) => {
    const ka = orderKey(state, a);
    const kb = orderKey(state, b);
    for (let i = 0; i < ka.length; i++) {
      const x = ka[i] ?? 0;
      const y = kb[i] ?? 0;
      if (x !== y) return x - y;
    }
    return a.clause.id < b.clause.id ? -1 : a.clause.id > b.clause.id ? 1 : 0;
  });
}

/**
 * Figures whose clauses are currently suppressed.
 *
 * Every nullifier is evaluated against the same pre-nullification snapshot, so two
 * nullifiers that target each other both land rather than the first one silencing the
 * second. That is a choice, and the alternative - sequential evaluation - would make
 * the outcome depend on figure id, which is a tiebreak and not a rule. Simultaneity at
 * least fails symmetrically.
 */
export function nullifiedFigures(state: GameState, deps: EngineDeps): Set<FigureUid> {
  const nullified = new Set<FigureUid>();
  for (const live of liveClauses(state, deps, 'passive')) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of live.clause.actions) {
      if (action.do !== 'nullify') continue;
      if (action.scope === 'damageModifiers' || action.plateNameIncludes !== undefined) continue;
      for (const uid of evaluateSelector(ctx, action.target)) nullified.add(uid);
    }
  }
  return nullified;
}

/**
 * Pass one: drop suppressed clauses, drop failed guards, collapse `noStack` groups.
 *
 * Returns the survivors in execution order together with the nullification events, so
 * the log records what was cancelled and by whom. A silently missing ability is the
 * single hardest thing to debug in a rules engine.
 */
export function survivingClauses(
  state: GameState,
  deps: EngineDeps,
  trigger: Trigger,
  candidates: readonly LiveClause[] = liveClauses(state, deps, trigger),
  extras: Partial<EffectContext> = {},
): { readonly clauses: LiveClause[]; readonly events: GameEvent[] } {
  const nullified = nullifiedFigures(state, deps);
  const events: GameEvent[] = [];
  const survivors: LiveClause[] = [];
  const seenNoStack = new Set<string>();

  for (const live of sortLive(state, candidates)) {
    if (nullified.has(live.source)) {
      events.push({
        kind: 'effectNullified',
        source: live.source,
        clauseId: live.clause.id,
        nullifier: live.source,
      });
      continue;
    }
    const key = live.clause.noStackKey;
    if (key !== null) {
      if (seenNoStack.has(key)) continue;
      seenNoStack.add(key);
    }
    if (/^just once\b/i.test(live.clause.source) && figureOf(state, live.source).onceSpent) continue;
    if (!guardsPass({ ...contextFor(state, deps, live), ...extras }, live.clause.when)) continue;
    survivors.push(live);
  }
  return { clauses: survivors, events };
}

/**
 * Pass two: execute the survivors.
 *
 * Guards are re-checked immediately before each clause runs, because an earlier clause
 * in the same batch may have knocked the target out. Checking only in pass one would
 * mean a dead figure's condition still lands on it.
 */
export function runTrigger(
  state: GameState,
  deps: EngineDeps,
  trigger: Trigger,
  include: (live: LiveClause) => boolean = () => true,
  extras: Partial<EffectContext> = {},
): EventBatch {
  const { clauses, events } = survivingClauses(
    state,
    deps,
    trigger,
    liveClauses(state, deps, trigger, extras.antecedent ?? []).filter(include),
    extras,
  );
  return runSurvivors(state, deps, clauses, events, extras, trigger);
}

/** Run ability clauses that match a predicate, regardless of trigger. */
export function runMatching(
  state: GameState,
  deps: EngineDeps,
  match: (clause: Clause) => boolean,
): EventBatch {
  const candidates: LiveClause[] = [];
  let allowBench = false;
  for (const figure of state.figures) {
    const fromBench = figure.zone === 'bench';
    if (figure.zone !== 'field' && !fromBench) continue;
    const content = figureContent(deps.content, figure.figureId);
    for (const clause of content.abilityClauses) {
      if (!match(clause)) continue;
      if (fromBench && !isPreSelectClause(clause)) continue;
      if (fromBench) allowBench = true;
      candidates.push({ clause, source: figure.uid, controller: figure.owner });
    }
  }
  const { clauses, events } = survivingClauses(state, deps, 'passive', candidates);
  return runSurvivors(state, deps, clauses, events, {}, 'passive', allowBench);
}

function runSurvivors(
  state: GameState,
  deps: EngineDeps,
  clauses: readonly LiveClause[],
  events: readonly GameEvent[],
  extras: Partial<EffectContext> = {},
  trigger: Trigger | null = null,
  allowBench = false,
): EventBatch {
  let batch = extend(emptyBatch(state), events);
  const offFieldOk = extras.antecedent !== undefined || extras.lastPlayedPlate !== undefined;
  for (const live of clauses) {
    const zone = figureOf(batch.state, live.source).zone;
    const namedSpinFromPc = (trigger === 'onNamedSpin' || trigger === 'onFigureKnockedOut') && zone === 'pc';
    const benchOk = allowBench && zone === 'bench' && isPreSelectClause(live.clause);
    const benchStart = trigger === 'startOfTurn' && zone === 'bench';
    if (zone !== 'field' && zone !== 'ultraSpace' && !offFieldOk && !namedSpinFromPc && !benchOk && !benchStart) continue;
    const ctx = { ...contextFor(batch.state, deps, live), ...extras };
    if (!guardsPass(ctx, live.clause.when)) continue;
    const step = applyActions(ctx, live.clause.actions, runNested(deps));
    batch = concatBatches(batch, step.batch);
    for (const event of step.batch.events) {
      if (event.kind === 'figureKnockedOut' && event.cause === 'effect') {
        batch = concatBatches(
          batch,
          runTrigger(batch.state, deps, 'onFigureKnockedOut', () => true, { antecedent: [event.uid] }),
        );
      }
      if (event.kind === 'zoneChanged' && event.from === 'field' && event.to !== 'field') {
        batch = concatBatches(
          batch,
          runTrigger(batch.state, deps, 'onLeaveField', () => true, { antecedent: [event.uid] }),
        );
        batch = concatBatches(batch, returnExclusionsFor(batch.state, event.uid));
      }
      if (event.kind === 'conditionApplied') {
        const extras = {
          antecedent: [event.uid],
          receivedCondition: event.condition,
          conditionCauser: ctx.source,
        };
        batch = concatBatches(
          batch,
          runTrigger(
            batch.state,
            deps,
            'onConditionApplied',
            (next) => next.source === event.uid || next.source === ctx.source,
            extras,
          ),
        );
      }
      if (event.kind === 'megaStarted') {
        batch = concatBatches(
          batch,
          runTrigger(batch.state, deps, 'onMegaStart', (next) => next.source === event.uid),
        );
      }
    }
    if (step.pending !== null) return batch;
  }
  return batch;
}

/** Run an explicit candidate list (landed wheel-segment clauses). */
export function runLiveList(state: GameState, deps: EngineDeps, candidates: readonly LiveClause[]): EventBatch {
  const { clauses, events } = survivingClauses(state, deps, 'onAttackResolve', candidates);
  return runSurvivors(state, deps, clauses, events);
}

export function runLiveActions(
  state: GameState,
  deps: EngineDeps,
  live: LiveClause,
  extras: Partial<EffectContext> = {},
): EventBatch {
  const ctx = { ...contextFor(state, deps, live), ...extras };
  if (!guardsPass(ctx, live.clause.when)) return emptyBatch(state);
  return applyActions(ctx, live.clause.actions, runNested(deps)).batch;
}

export function findAbilityClause(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  clauseId: string,
): LiveClause | null {
  const figure = figureOf(state, uid);
  const content = figureContent(deps.content, figure.figureId);
  const clause = content.abilityClauses.find((entry) => entry.id === clauseId);
  if (clause === undefined) return null;
  return { clause, source: uid, controller: figure.owner };
}

/** The nested-clause runner handed to `spinCheck` and to `resumeActions`. */
export function runNested(deps: EngineDeps): ClauseRunner {
  return (ctx: EffectContext, clauses: readonly Clause[]): ActionResult => {
    let batch = emptyBatch(ctx.state);
    let current = ctx;
    for (const clause of clauses) {
      if (!guardsPass(current, clause.when)) continue;
      const step = applyActions(current, clause.actions, runNested(deps));
      batch = concatBatches(batch, step.batch);
      current = step.ctx;
      if (step.pending !== null) return { batch, ctx: current, pending: step.pending };
    }
    return { batch, ctx: current, pending: null };
  };
}

// ---------------------------------------------------------------------------
// Queries: what is currently true
// ---------------------------------------------------------------------------

function activeDeclarations(state: GameState, deps: EngineDeps): LiveClause[] {
  const candidates = [
    ...liveClauses(state, deps, 'passive'),
    ...liveClauses(state, deps, 'duringBattle'),
  ];
  return survivingClauses(state, deps, 'passive', candidates).clauses;
}

/**
 * Damage modifiers in force against a figure right now, in layer order.
 *
 * The order is the reason this returns a list rather than a folded number: the damage
 * pipeline applies every additive modifier before every multiplicative one, and it can
 * only do that if it can still tell them apart.
 */
function damageModNullified(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  for (const live of liveClauses(state, deps, 'passive')) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of live.clause.actions) {
      if (action.do !== 'nullify' || action.scope !== 'damageModifiers') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      if (action.onlyVsAllyTypes !== undefined && action.onlyVsAllyTypes.length > 0) {
        const battle = state.battle;
        if (battle === null) continue;
        const partner = battle.attacker.uid === uid
          ? battle.defender.uid
          : battle.defender.uid === uid
            ? battle.attacker.uid
            : null;
        if (partner === null) continue;
        const ally = figureOf(state, partner);
        if (ally.owner !== live.controller) continue;
        const types = typesOf(ctx, ally);
        if (!action.onlyVsAllyTypes.some((type) => types.includes(type))) continue;
      }
      return true;
    }
  }
  return false;
}

export function plateLingerSuppressed(state: GameState, deps: EngineDeps, uid: FigureUid, plateName: string): boolean {
  for (const figure of state.figures) {
    if (figure.zone !== 'field' && figure.zone !== 'ultraSpace') continue;
    for (const linger of figure.lingering ?? []) {
      if (linger.expiresOnTurn !== null && state.turn.number >= linger.expiresOnTurn) continue;
      const ctx = contextFor(state, deps, {
        clause: {
          id: 'frost' as Clause['id'],
          trigger: 'passive',
          when: linger.when ?? [],
          actions: linger.actions,
          layer: 0,
          noStackKey: null,
          source: 'lingering',
        },
        source: figure.uid,
        controller: linger.controller,
      });
      if (!guardsPass(ctx, linger.when ?? [])) continue;
      for (const action of linger.actions) {
        if (action.do !== 'nullify' || action.plateNameIncludes === undefined) continue;
        if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
        if (action.exceptPlate !== undefined && plateName.toLowerCase().includes(action.exceptPlate.toLowerCase())) {
          continue;
        }
        if (plateName.toLowerCase().includes(action.plateNameIncludes.toLowerCase())) return true;
      }
    }
  }
  return false;
}

export function damageModifiersFor(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  moveName: string | null = null,
): DamageModifier[] {
  const found: DamageModifier[] = [];
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    if (damageModNullified(state, deps, live.source)) continue;
    for (const action of live.clause.actions) {
      if (action.do !== 'modifyDamage') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      if (action.named !== undefined) {
        if (moveName === null || action.named.toLowerCase() !== moveName.toLowerCase()) continue;
      }
      found.push(action.modifier);
    }
  }
  return found;
}

export function invertAbilityIncreasesFor(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of live.clause.actions) {
      if (action.do !== 'invertAbilityIncreases') continue;
      if (evaluateSelector(ctx, action.target).includes(uid)) return true;
    }
  }
  return false;
}

export function straightMpStepsFor(state: GameState, deps: EngineDeps, uid: FigureUid): number | null {
  let steps: number | null = null;
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'grantStraightMp') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      steps = Math.max(steps ?? 0, action.steps);
    }
  }
  return steps;
}

export function abilityDamageIncreasesFor(state: GameState, deps: EngineDeps, uid: FigureUid): number {
  const figure = figureOf(state, uid);
  const content = figureContent(deps.content, figure.figureId);
  const ctx = contextFor(state, deps, {
    clause: {
      id: 'ability-inc' as Clause['id'],
      trigger: 'passive',
      when: [],
      actions: [],
      layer: 0,
      noStackKey: null,
      source: 'ability-inc',
    },
    source: uid,
    controller: figure.owner,
  });
  let sum = 0;
  for (const clause of content.abilityClauses) {
    if (!guardsPass(ctx, clause.when)) continue;
    for (const action of clause.actions) {
      if (action.do !== 'modifyDamage') continue;
      if (action.modifier.kind === 'flat' && action.modifier.amount > 0) sum += action.modifier.amount;
      if (
        action.modifier.kind === 'flatByCount'
        && action.modifier.amount > 0
        && action.modifier.of.kind === 'figures'
      ) {
        sum += action.modifier.amount * evaluateSelector(ctx, action.modifier.of.of).length;
      }
    }
  }
  return sum;
}

export function restrictDeployFor(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  const figure = figureOf(state, uid);
  const content = figureContent(deps.content, figure.figureId);
  const ctx = contextFor(state, deps, {
    clause: {
      id: 'restrict-deploy' as Clause['id'],
      trigger: 'passive',
      when: [],
      actions: [],
      layer: 0,
      noStackKey: null,
      source: 'restrict-deploy',
    },
    source: uid,
    controller: figure.owner,
  });
  for (const clause of content.abilityClauses) {
    if (!guardsPass(ctx, clause.when)) continue;
    for (const action of clause.actions) {
      if (action.do === 'restrictDeploy' && evaluateSelector(ctx, action.target).includes(uid)) return true;
    }
  }
  for (const live of activeDeclarations(state, deps)) {
    const liveCtx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do === 'restrictDeploy' && evaluateSelector(liveCtx, action.target).includes(uid)) return true;
    }
  }
  return false;
}

/** Bench-side extra walk after the deploy cost. Own text only — auras do not see the bench. */
export function extraDeployStepsFor(state: GameState, deps: EngineDeps, uid: FigureUid): number {
  const figure = figureOf(state, uid);
  const content = figureContent(deps.content, figure.figureId);
  const ctx = contextFor(state, deps, {
    clause: {
      id: 'extra-deploy' as Clause['id'],
      trigger: 'passive',
      when: [],
      actions: [],
      layer: 0,
      noStackKey: null,
      source: 'extra-deploy',
    },
    source: uid,
    controller: figure.owner,
  });
  let extra = 0;
  for (const clause of content.abilityClauses) {
    if (!guardsPass(ctx, clause.when)) continue;
    for (const action of clause.actions) {
      if (action.do !== 'grantMovement' || action.grant !== 'extraStep') continue;
      if (evaluateSelector(ctx, action.target).includes(uid)) extra += 1;
    }
  }
  return extra;
}

/** Bench-side: liveClauses only sees the field, so this reads the figure's own text. */
export function denyDeployFor(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  const figure = figureOf(state, uid);
  const content = figureContent(deps.content, figure.figureId);
  const ctx = contextFor(state, deps, {
    clause: {
      id: 'deny-deploy' as Clause['id'],
      trigger: 'passive',
      when: [],
      actions: [],
      layer: 0,
      noStackKey: null,
      source: 'deny-deploy',
    },
    source: uid,
    controller: figure.owner,
  });
  for (const clause of content.abilityClauses) {
    if (!guardsPass(ctx, clause.when)) continue;
    for (const action of clause.actions) {
      if (action.do !== 'denyDeploy') continue;
      if (evaluateSelector(ctx, action.target).includes(uid)) return true;
    }
  }
  return false;
}

/** "Must MP move as far as its MP range will allow." Queried into pathfinding. */
export function forceFullMpFor(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  const figure = figureOf(state, uid);
  const content = figureContent(deps.content, figure.figureId);
  const ctx = contextFor(state, deps, {
    clause: {
      id: 'force-full-mp' as Clause['id'],
      trigger: 'passive',
      when: [],
      actions: [],
      layer: 0,
      noStackKey: null,
      source: 'force-full-mp',
    },
    source: uid,
    controller: figure.owner,
  });
  for (const clause of content.abilityClauses) {
    if (!guardsPass(ctx, clause.when)) continue;
    for (const action of clause.actions) {
      if (action.do === 'forceFullMp' && evaluateSelector(ctx, action.target).includes(uid)) return true;
    }
  }
  for (const live of activeDeclarations(state, deps)) {
    const liveCtx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do === 'forceFullMp' && evaluateSelector(liveCtx, action.target).includes(uid)) return true;
    }
  }
  return false;
}

export function restrictMovesFor(state: GameState, deps: EngineDeps, uid: FigureUid): FigureUid | null {
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of live.clause.actions) {
      if (action.do !== 'restrictMoves') continue;
      if (evaluateSelector(ctx, action.target).includes(uid)) return live.source;
    }
  }
  return null;
}

export function surviveByClearingFor(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  cause: KnockOutCause = 'effect',
): boolean {
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of live.clause.actions) {
      if (action.do !== 'surviveByClearing') continue;
      if (action.vs === 'whiteDamage' && cause !== 'battle') continue;
      if (evaluateSelector(ctx, action.target).includes(uid)) return true;
    }
  }
  return false;
}

function walkSurviveByForm(actions: readonly Action[]): Extract<Action, { do: 'surviveByForm' }>[] {
  const found: Extract<Action, { do: 'surviveByForm' }>[] = [];
  for (const action of actions) {
    if (action.do === 'surviveByForm') found.push(action);
    if (action.do === 'optional') found.push(...walkSurviveByForm(action.then));
  }
  return found;
}

export function surviveByFormFor(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  cause: KnockOutCause,
): readonly string[] | null {
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of walkSurviveByForm(live.clause.actions)) {
      if (action.vs === 'battleDamage' && cause !== 'battle') continue;
      if (evaluateSelector(ctx, action.target).includes(uid)) return action.into;
    }
  }
  return null;
}

export function knockOutOrSurvive(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  cause: KnockOutCause,
  extra?: { fromTypes?: readonly PokemonType[]; koCause?: 'attackDamage' | 'attackEffect' },
): EventBatch {
  const figure = figureOf(state, uid);
  const ctx = baseContext(state, deps, uid, figure.owner);
  const stripped = (figure.lingering ?? []).some((linger) =>
    linger.actions.some((action) => action.do === 'tag' && action.tag === 'ignoreKoPrevention'),
  );
  const attackKo = cause === 'effect';
  if (
    isPrevented(ctx, uid, 'beKnockedOut', undefined, extra)
    || (attackKo && isPrevented(ctx, uid, 'instantKoFromAttacks', undefined, extra))
  ) {
    return extend(emptyBatch(state), [{ kind: 'effectPrevented', uid, what: 'beKnockedOut' }]);
  }
  if (!stripped && surviveByClearingFor(state, deps, uid, cause)) {
    const figure = figureOf(state, uid);
    const events: GameEvent[] = [];
    if (figure.marker !== null) events.push({ kind: 'markerCleared', uid, marker: figure.marker.id });
    if (figure.condition !== null) events.push({ kind: 'conditionCleared', uid, condition: figure.condition });
    return extend(emptyBatch(state), events);
  }
  const formInto = surviveByFormFor(state, deps, uid, cause);
  if (!stripped && formInto !== null) {
    const figure = figureOf(state, uid);
    const options = resolveFormTargets(deps.content, figure.figureId, formInto);
    const to = options[0];
    if (to !== undefined) {
      return extend(emptyBatch(state), transformEvents(uid, figure.figureId, to, 'form'));
    }
  }
  return knockOut(state, uid, cause);
}

/** Everything a figure is currently forbidden from doing. */
export function preventionsFor(state: GameState, deps: EngineDeps, uid: FigureUid): Set<Preventable> {
  const found = new Set<Preventable>();
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'prevent') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      found.add(action.what);
    }
  }
  return found;
}

/** Occupied nodes this figure still cannot cross even with a pass-through grant. */
export function deniedPassNodes(state: GameState, deps: EngineDeps, uid: FigureUid): Set<NodeId> {
  const blocked = new Set<NodeId>();
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'denyPassThrough') continue;
      if (!evaluateSelector(ctx, action.movers).includes(uid)) continue;
      for (const blocker of evaluateSelector(ctx, action.blockers)) {
        const node = figureOf(state, blocker).node;
        if (node !== null) blocked.add(node);
      }
    }
  }
  return blocked;
}

/** Empty adjacent points that may be landed on but not used as waypoints. */
export function noTransitNodes(state: GameState, deps: EngineDeps, uid: FigureUid): Set<NodeId> {
  const blocked = new Set<NodeId>();
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'denyAdjacentPass') continue;
      if (!evaluateSelector(ctx, action.movers).includes(uid)) continue;
      for (const around of evaluateSelector(ctx, action.around)) {
        const node = figureOf(state, around).node;
        if (node === null) continue;
        for (const neighbor of deps.board.byId.get(node)?.neighbors ?? []) {
          const occupied = state.figures.some((figure) => figure.zone === 'field' && figure.node === neighbor);
          if (!occupied) blocked.add(neighbor);
        }
      }
    }
  }
  return blocked;
}

function livePlateName(state: GameState, deps: EngineDeps, live: LiveClause): string {
  const match = /^lingering:(\d+):(\d+)$/.exec(live.clause.id);
  if (match === null) return '';
  const holder = Number(match[1]);
  const index = Number(match[2]);
  if (!Number.isFinite(holder) || !Number.isFinite(index)) return '';
  const linger = figureOf(state, holder as FigureUid).lingering?.[index];
  if (linger?.plateId === undefined) return '';
  return deps.content.plates.get(linger.plateId)?.plate.name ?? '';
}

function grantDenied(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  grant: MovementGrant,
  live: LiveClause,
): boolean {
  const plateName = livePlateName(state, deps, live);
  if (plateName === '') return false;
  for (const other of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, other);
    for (const action of other.clause.actions) {
      if (action.do !== 'denyNamedGrant') continue;
      if (action.grant !== grant) continue;
      if (!evaluateSelector(ctx, action.movers).includes(uid)) continue;
      if (plateName.toLowerCase().includes(action.nameIncludes.toLowerCase())) return true;
    }
  }
  return false;
}

/** Pathfinding permissions a figure currently has. Pass-through is an ability, not a default. */
export function movementGrantsFor(state: GameState, deps: EngineDeps, uid: FigureUid): Set<MovementGrant> {
  const found = new Set<MovementGrant>();
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'grantMovement') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      found.add(action.grant);
    }
  }
  return found;
}

/** Occupied nodes this figure may cross, and whether every occupied node is legal. */
export function movementPassFor(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
): { unrestricted: boolean; passableOccupied: Set<NodeId> } {
  let unrestricted = false;
  const passableOccupied = new Set<NodeId>();
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'grantMovement') continue;
      if (action.grant === 'extraStep') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      if (grantDenied(state, deps, uid, action.grant, live)) continue;
      if (action.over === undefined) {
        unrestricted = true;
        continue;
      }
      for (const other of evaluateSelector(ctx, action.over)) {
        const node = figureOf(state, other).node;
        if (node !== null) passableOccupied.add(node);
      }
    }
  }
  return { unrestricted, passableOccupied };
}

/** "This Pokemon must battle if possible after making an MP move." */
export function mustBattle(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  return mustBattleAgainst(state, deps, uid) !== null || mustBattleAny(state, deps, uid);
}

function mustBattleAny(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'forceBattle') continue;
      if (evaluateSelector(ctx, action.target).includes(uid)) return true;
    }
  }
  return false;
}

/** Specific defender a forced battle must target, or `null` if any legal target is fine. */
export function mustBattleAgainst(state: GameState, deps: EngineDeps, uid: FigureUid): FigureUid | null {
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'forceBattle' || action.against === undefined) continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      return evaluateSelector(ctx, action.against)[0] ?? null;
    }
  }
  return null;
}

/** Whether a player may currently play plates at all. */
export function platesAllowed(state: GameState, deps: EngineDeps, player: PlayerId): boolean {
  const locked = state.players[player].platesLockedUntilTurn;
  if (locked !== null && state.turn.number < locked) return false;
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'prevent' || action.what !== 'usePlates') continue;
      const targets = evaluateSelector(ctx, action.target);
      if (targets.some((uid) => figureOf(state, uid).owner === player)) return false;
      // A prevention aimed at nobody in particular still belongs to whoever it opposes.
      if (targets.length === 0 && live.controller === opponentOf(player)) return false;
    }
  }
  return true;
}

export function battleRangeFor(state: GameState, deps: EngineDeps, uid: FigureUid): number {
  let range = BATTLE_RANGE_DEFAULT;
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'setBattleRange') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      range = Math.max(range, action.range);
    }
  }
  return Math.min(BATTLE_RANGE_MAX, range);
}

export function respinGrantsFor(state: GameState, deps: EngineDeps, uid: FigureUid): number {
  let count = 0;
  let bonus = 0;
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do === 'respin' && action.forced !== true && live.source === uid) {
        count += action.max ?? 1;
      }
      if (action.do === 'bonusRespin' && evaluateSelector(ctx, action.target).includes(uid)) {
        bonus += action.delta;
      }
    }
  }
  return count === 0 ? 0 : count + bonus;
}

/** Live `modifyMp` auras. Queried, not executed — a field MP bonus must not mutate `mpDelta`. */
export function mpModifiersFor(state: GameState, deps: EngineDeps, uid: FigureUid): number {
  let delta = 0;
  let setTo: number | null = null;
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of live.clause.actions) {
      if (action.do === 'setMp' && evaluateSelector(ctx, action.target).includes(uid)) {
        const base = figureContent(deps.content, figureOf(state, uid).figureId).figure.mp;
        setTo = action.value - base - figureOf(state, uid).mpDelta;
        continue;
      }
      if (action.do !== 'modifyMp') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      let add = action.delta;
      if (action.of !== undefined && action.of.kind === 'figures') {
        add *= evaluateSelector(ctx, action.of.of).length;
      }
      delta += add;
      if (action.cap !== undefined) {
        const base = figureContent(deps.content, figureOf(state, uid).figureId).figure.mp;
        delta = Math.min(delta, action.cap - base - figureOf(state, uid).mpDelta);
      }
    }
  }
  return setTo !== null ? setTo : delta;
}

/** Ability MP floor. Markers (`mpDelta`) are applied after this in `movementPoints`. */
export function floorMpFor(state: GameState, deps: EngineDeps, uid: FigureUid): number | null {
  let floor: number | null = null;
  const consider = (ctx: EffectContext, action: Action): void => {
    if (action.do !== 'floorMp') return;
    if (!evaluateSelector(ctx, action.target).includes(uid)) return;
    floor = Math.max(floor ?? action.min, action.min);
  };
  const figure = figureOf(state, uid);
  const content = figureContent(deps.content, figure.figureId);
  const own = contextFor(state, deps, {
    clause: {
      id: 'floor-mp' as Clause['id'],
      trigger: 'passive',
      when: [],
      actions: [],
      layer: 0,
      noStackKey: null,
      source: 'floor-mp',
    },
    source: uid,
    controller: figure.owner,
  });
  for (const clause of content.abilityClauses) {
    if (!guardsPass(own, clause.when)) continue;
    for (const action of clause.actions) consider(own, action);
  }
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of live.clause.actions) consider(ctx, action);
  }
  return floor;
}

/** Live `rotateWheel` auras. Queried into `buildWheel` extraRotation, not executed. */
export function extraWheelRotationFor(state: GameState, deps: EngineDeps, uid: FigureUid): number {
  let extra = 0;
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    if (!guardsPass(ctx, live.clause.when)) continue;
    for (const action of live.clause.actions) {
      if (action.do !== 'rotateWheel') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      extra += action.segments;
    }
  }
  return extra;
}

export function leapStepsFor(state: GameState, deps: EngineDeps, uid: FigureUid): number | null {
  let steps: number | null = null;
  for (const live of activeDeclarations(state, deps)) {
    const ctx = contextFor(state, deps, live);
    for (const action of live.clause.actions) {
      if (action.do !== 'grantLeap') continue;
      if (!evaluateSelector(ctx, action.target).includes(uid)) continue;
      steps = Math.max(steps ?? 0, action.steps);
    }
  }
  return steps;
}
