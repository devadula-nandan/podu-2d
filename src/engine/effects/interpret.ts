/**
 * The action interpreter: one DSL action in, a list of events out.
 *
 * The division of labour that makes this tractable is that **not every action does
 * something here**. Five of them - `modifyDamage`, `prevent`, `nullify`,
 * `grantMovement`, `forceBattle` - are standing declarations rather than instructions.
 * They do not fire and finish; they are *true for a while*, and the rules layer asks
 * about them at the moment it matters ("how much damage is this, actually?", "may this
 * figure move?"). Executing them as events would mean writing a modifier onto the state
 * and then having to remember to take it off again, which is how duration bugs are
 * born. So they are answered by queries over live clauses in `bus.ts`, and are no-ops
 * here. The comment on each is the whole justification, and it is written down because
 * "this action does nothing" looks exactly like a missing implementation.
 *
 * Wait and the MP markers are also special-cased: the DSL models them as markers
 * because that is how the card text reads, but they are separate state layers with
 * different lifetimes, so they route to `wait` and `mpDelta` rather than to the single
 * marker slot. Letting Wait occupy the marker slot would mean a Curse could remove a
 * Wait, and a Wait could remove a Curse.
 */
import { MEGA_DURATION_TURNS, PC_CAPACITY } from '../../rules/constants.js';
import type { Action, Clause, CountSource, Duration, Preventable } from '../../content/dsl/effects.js';
import type { PokemonType, SegmentColor, SpecialCondition } from '../../content/dsl/primitives.js';
import type { Destination } from '../../content/dsl/effects.js';
import type { MarkerId, Zone } from '../../content/dsl/primitives.js';
import type { Chooser, Selector } from '../../content/dsl/selectors.js';
import { canonicalMarker, MP_MODIFIER_MARKER, WAIT_MARKER } from '../markers.js';
import type { BattleRole, GameEvent } from '../events.js';
import type { FigureUid, NodeId, PlayerId } from '../ids.js';
import { opponentOf } from '../ids.js';
import { Z_GAUGE_MAX } from '../constants.js';
import type { LingeringEffect } from '../state.js';
import { pcFigures } from '../state.js';
import {
  megaBlockedByOncePerDuel,
  megaStartEvents,
  resolveEvolutionTargets,
  resolveFormTargets,
  resolveMegaTargets,
  transformEvents,
} from '../forms.js';
import { usedPlateSlots } from '../plates.js';
import { maxMarkersPerFigure } from '../rulings.js';
import { DEPLOY_MP_COST } from '../../rules/constants.js';
import { connectedComponent, mpReachable, nodesExactlySteps, nodesToward, nodesWithinSteps, OPEN_MOVEMENT, straightLineBehind, straightLineDestinations } from '../board/graph.js';
import { pick } from '../rng.js';
import { figureContent } from '../content.js';
import { advanceClockwise, buildWheel, spinWheel } from '../rules/wheel.js';
import { changeZone, exclude as excludeFigure, knockOut as knockOutFigure, sendToPc } from '../rules/zones.js';
import type { EventBatch } from '../rules/zones.js';
import { concatBatches, emptyBatch, extend } from '../rules/zones.js';
import type { DecisionResume, GameState, PendingDecision, ResolvedSegment } from '../state.js';
import { figureOf } from '../state.js';
import type { EffectContext } from './context.js';
import { withAntecedent, withPreceding, withSpunResults, withState } from './context.js';
import { chooseCandidates, evaluateSelector, guardsPass, selectorNeedsChoice, typesOf } from './select.js';

export interface ActionResult {
  readonly batch: EventBatch;
  readonly ctx: EffectContext;
  readonly pending: PendingDecision | null;
}

/**
 * How nested clauses get run.
 *
 * `spinCheck` carries child clauses, and the thing that knows how to run a clause -
 * guards, layers, nullification - is the hook bus, which already imports this module.
 * Passing the runner in inverts that edge instead of creating a cycle.
 */
export type ClauseRunner = (ctx: EffectContext, clauses: readonly Clause[]) => ActionResult;

const noNestedClauses: ClauseRunner = (ctx) => ({ batch: emptyBatch(ctx.state), ctx, pending: null });

function waitReceivedBonus(ctx: EffectContext, uid: FigureUid): number {
  let bonus = 0;
  for (const figure of ctx.state.figures) {
    if (figure.zone !== 'field' && figure.zone !== 'ultraSpace') continue;
    for (const linger of figure.lingering ?? []) {
      if (linger.expiresOnTurn !== null && ctx.state.turn.number >= linger.expiresOnTurn) continue;
      const lingerCtx = { ...ctx, source: figure.uid, controller: linger.controller };
      if (!guardsPass(lingerCtx, linger.when ?? [])) continue;
      for (const action of linger.actions) {
        if (action.do !== 'modifyWaitReceived') continue;
        if (!evaluateSelector(lingerCtx, action.target).includes(uid)) continue;
        bonus += action.delta;
      }
    }
  }
  return bonus;
}

function lingerHolders(ctx: EffectContext, action: Action, fallback: () => FigureUid[]): FigureUid[] {
  if (!('target' in action) || typeof action.target === 'string') {
    return ctx.antecedent.length > 0 ? [...ctx.antecedent] : [ctx.source];
  }
  const kind = action.target.kind;
  if (kind === 'all' || kind === 'battleOpponent') {
    return ctx.antecedent.length > 0 ? [...ctx.antecedent] : [ctx.source];
  }
  const hit = fallback();
  return hit.length > 0 ? hit : (ctx.antecedent.length > 0 ? [...ctx.antecedent] : [ctx.source]);
}

const result = (ctx: EffectContext, batch: EventBatch, pending: PendingDecision | null = null): ActionResult => ({
  batch,
  ctx: withState(ctx, batch.state),
  pending,
});

function expiryTurn(stateTurn: number, duration: Duration): number | null {
  switch (duration.kind) {
    case 'instant':
      return stateTurn + 1;
    case 'untilEndOfTurn':
      return stateTurn + 1;
    case 'untilEndOfNextTurn':
      return stateTurn + 2;
    case 'untilEndOfDuel':
    case 'untilTrigger':
    case 'untilNamedLand':
    case 'untilFirstBattle':
      return null;
    case 'turns':
      return stateTurn + duration.count;
  }
}

function chooserPlayer(ctx: EffectContext, chooser: Chooser): PlayerId {
  return chooser === 'opponent' ? opponentOf(ctx.controller) : ctx.controller;
}

function randomChooseOf(selector: Selector): Extract<Selector, { kind: 'choose' }> | null {
  if (selector.kind === 'choose' && selector.chooser === 'random') return selector;
  if (selector.kind === 'except') return randomChooseOf(selector.from);
  return null;
}

function nextToken(ctx: EffectContext, kind: string, prompt: string): string {
  return `${kind}:${ctx.source}:${ctx.state.turn.number}:${prompt.slice(0, 24)}`;
}

function pendingDecision(
  ctx: EffectContext,
  kind: PendingDecision['kind'],
  prompt: string,
  opts: {
    chooser?: PlayerId;
    figures?: readonly FigureUid[];
    nodes?: readonly NodeId[];
    slots?: readonly number[];
    min?: number;
    max?: number;
    resume?: Partial<DecisionResume>;
  },
): PendingDecision {
  return {
    kind,
    chooser: opts.chooser ?? ctx.controller,
    prompt,
    figureOptions: opts.figures ?? [],
    nodeOptions: opts.nodes ?? [],
    minCount: opts.min ?? 0,
    maxCount: opts.max ?? 1,
    resumeToken: nextToken(ctx, kind, prompt),
    resume: {
      source: ctx.source,
      controller: ctx.controller,
      remaining: [],
      then: [],
      bind: 'none',
      ...opts.resume,
    },
    slotOptions: opts.slots ?? [],
  };
}

function preventMatches(
  ctx: EffectContext,
  action: Extract<Action, { do: 'prevent' }>,
  what: Preventable,
  detail?: SpecialCondition,
  extra?: { fromColor?: SegmentColor; fromTypes?: readonly PokemonType[]; koCause?: 'attackDamage' | 'attackEffect'; effectName?: string },
): boolean {
  if (action.what === 'namedEffect') {
    if (what !== 'namedEffect') return false;
    const named = extra?.effectName ?? ctx.activeMoveName ?? ctx.plateHint;
    return action.named !== undefined && named !== null && action.named.toLowerCase() === named.toLowerCase();
  }
  if (action.named !== undefined) {
    const current = extra?.effectName ?? ctx.activeMoveName;
    if (current === null || current.toLowerCase() !== action.named.toLowerCase()) return false;
  }
  if (action.conditions !== undefined && action.conditions.length > 0) {
    if (detail === undefined || !action.conditions.includes(detail)) return false;
  }
  if (action.fromColor !== undefined) {
    const color = extra?.fromColor ?? ctx.activeMoveColor;
    if (color !== action.fromColor) return false;
  }
  if (action.vsTypes !== undefined && action.vsTypes.length > 0) {
    const types = extra?.fromTypes ?? [];
    if (!action.vsTypes.some((type) => types.includes(type))) return false;
  }
  if (action.vsCause !== undefined) {
    if (extra?.koCause === undefined || extra.koCause !== action.vsCause) return false;
  }
  return action.what === what;
}

function surviveInstead(ctx: EffectContext, uid: FigureUid): boolean {
  if (koPreventionStripped(ctx, uid)) return false;
  for (const figure of ctx.state.figures) {
    if (figure.zone !== 'field' && figure.zone !== 'ultraSpace') continue;
    const content = figureContent(ctx.deps.content, figure.figureId);
    const inner = { ...ctx, source: figure.uid, controller: figure.owner };
    for (const clause of content.abilityClauses) {
      if (!guardsPass(inner, clause.when)) continue;
      for (const action of clause.actions) {
        if (action.do === 'surviveByClearing' && action.vs !== 'whiteDamage' && evaluateSelector(inner, action.target).includes(uid)) return true;
      }
    }
    for (const linger of figure.lingering ?? []) {
      if (linger.expiresOnTurn !== null && ctx.state.turn.number >= linger.expiresOnTurn) continue;
      const lingerCtx = { ...ctx, source: figure.uid, controller: linger.controller };
      for (const action of linger.actions) {
        if (action.do === 'surviveByClearing' && action.vs !== 'whiteDamage' && evaluateSelector(lingerCtx, action.target).includes(uid)) return true;
      }
    }
  }
  return false;
}

function moveRestrictedBy(ctx: EffectContext, uid: FigureUid): FigureUid | null {
  for (const figure of ctx.state.figures) {
    if (figure.zone !== 'field') continue;
    const content = figureContent(ctx.deps.content, figure.figureId);
    const inner = { ...ctx, source: figure.uid, controller: figure.owner };
    for (const clause of content.abilityClauses) {
      if (!guardsPass(inner, clause.when)) continue;
      for (const action of clause.actions) {
        if (action.do === 'restrictMoves' && evaluateSelector(inner, action.target).includes(uid)) return figure.uid;
      }
    }
    for (const linger of figure.lingering ?? []) {
      if (linger.expiresOnTurn !== null && ctx.state.turn.number >= linger.expiresOnTurn) continue;
      const lingerCtx = { ...ctx, source: figure.uid, controller: linger.controller };
      for (const action of linger.actions) {
        if (action.do === 'restrictMoves' && evaluateSelector(lingerCtx, action.target).includes(uid)) return figure.uid;
      }
    }
  }
  return null;
}

function koPreventionStripped(ctx: EffectContext, uid: FigureUid): boolean {
  const figure = figureOf(ctx.state, uid);
  for (const linger of figure.lingering ?? []) {
    if (linger.expiresOnTurn !== null && ctx.state.turn.number >= linger.expiresOnTurn) continue;
    if (linger.actions.some((action) => action.do === 'tag' && action.tag === 'ignoreKoPrevention')) return true;
  }
  return false;
}

export function isPrevented(
  ctx: EffectContext,
  uid: FigureUid,
  what: Preventable,
  detail?: SpecialCondition,
  extra?: { fromColor?: SegmentColor; fromTypes?: readonly PokemonType[]; koCause?: 'attackDamage' | 'attackEffect'; effectName?: string },
): boolean {
  if ((what === 'beKnockedOut' || what === 'instantKoFromAttacks') && koPreventionStripped(ctx, uid)) return false;
  for (const figure of ctx.state.figures) {
    if (figure.zone !== 'field') continue;
    const content = figureContent(ctx.deps.content, figure.figureId);
    const inner = { ...ctx, source: figure.uid, controller: figure.owner };
    for (const clause of content.abilityClauses) {
      if (!guardsPass(inner, clause.when)) continue;
      for (const action of clause.actions) {
        if (action.do === 'prevent' && preventMatches(inner, action, what, detail, extra) && evaluateSelector(inner, action.target).includes(uid)) {
          return true;
        }
      }
    }
    for (const linger of figure.lingering ?? []) {
      if (linger.expiresOnTurn !== null && ctx.state.turn.number >= linger.expiresOnTurn) continue;
      const lingerCtx = { ...ctx, source: figure.uid, controller: linger.controller };
      for (const action of linger.actions) {
        if (action.do === 'prevent' && preventMatches(lingerCtx, action, what, detail, extra) && evaluateSelector(lingerCtx, action.target).includes(uid)) {
          return true;
        }
      }
    }
  }
  return false;
}

function namedLandFrom(duration: Duration): Pick<LingeringEffect, 'untilNamedLand' | 'untilNamedLandEndOfTurn'> {
  if (duration.kind !== 'untilNamedLand') return {};
  return {
    untilNamedLand: duration.name,
    ...(duration.endOfThatTurn === true ? { untilNamedLandEndOfTurn: true as const } : {}),
  };
}

function attackEffectScale(ctx: EffectContext, sourceUid: FigureUid): number {
  let scale = 1;
  for (const figure of ctx.state.figures) {
    if (figure.zone !== 'field' && figure.zone !== 'ultraSpace') continue;
    const content = figureContent(ctx.deps.content, figure.figureId);
    const inner = { ...ctx, source: figure.uid, controller: figure.owner };
    for (const clause of content.abilityClauses) {
      if (!guardsPass(inner, clause.when)) continue;
      for (const action of clause.actions) {
        if (action.do !== 'scaleAttackEffects') continue;
        if (!evaluateSelector(inner, action.target).includes(sourceUid)) continue;
        scale = Math.max(scale, countSourceValue(inner, action.of) + action.plus);
      }
    }
  }
  return scale;
}

function attachLingering(
  ctx: EffectContext,
  batch: EventBatch,
  action: Action,
  duration: Duration,
  uids: readonly FigureUid[],
  extra: Pick<LingeringEffect, 'trigger' | 'when'> = {},
): ActionResult {
  let scaled = duration;
  if (duration.kind === 'turns' && ctx.clauseTrigger === 'onAttackResolve') {
    const factor = attackEffectScale(ctx, ctx.source);
    if (factor !== 1) scaled = { kind: 'turns', count: duration.count * factor };
  }
  const expires = expiryTurn(batch.state.turn.number, scaled);
  if (duration.kind === 'instant' && ctx.plateHint === null && extra.trigger === undefined) return result(ctx, batch);
  let stored = action;
  if (action.do === 'modifyDamage' && action.modifier.kind === 'flat' && ctx.clauseTrigger === 'onAttackResolve') {
    const factor = attackEffectScale(ctx, ctx.source);
    if (factor !== 1) stored = { ...action, modifier: { ...action.modifier, amount: action.modifier.amount * factor } };
  }
  const named = namedLandFrom(scaled);
  const events: GameEvent[] = uids.map((uid) => ({
    kind: 'lingeringAttached' as const,
    uid,
    effect: {
      actions: [stored],
      expiresOnTurn: expires,
      controller: ctx.controller,
      ...named,
      ...extra,
      ...(ctx.plateId !== null ? { plateId: ctx.plateId } : {}),
      ...(scaled.kind === 'untilFirstBattle' ? { untilFirstBattleOf: ctx.source } : {}),
    } satisfies LingeringEffect,
  }));
  return result(ctx, extend(batch, events));
}

function redirectInflictionTo(ctx: EffectContext, uid: FigureUid): FigureUid | null {
  for (const figure of ctx.state.figures) {
    if (figure.zone !== 'field') continue;
    const content = figureContent(ctx.deps.content, figure.figureId);
    const inner = { ...ctx, source: figure.uid, controller: figure.owner };
    for (const clause of content.abilityClauses) {
      if (!guardsPass(inner, clause.when)) continue;
      for (const action of clause.actions) {
        if (action.do !== 'redirectInflictions') continue;
        if (!evaluateSelector(inner, action.target).includes(uid)) continue;
        return evaluateSelector(inner, action.to)[0] ?? null;
      }
    }
    for (const linger of figure.lingering ?? []) {
      if (linger.expiresOnTurn !== null && ctx.state.turn.number >= linger.expiresOnTurn) continue;
      const lingerCtx = { ...ctx, source: figure.uid, controller: linger.controller };
      for (const action of linger.actions) {
        if (action.do !== 'redirectInflictions') continue;
        if (!evaluateSelector(lingerCtx, action.target).includes(uid)) continue;
        return evaluateSelector(lingerCtx, action.to)[0] ?? null;
      }
    }
  }
  return null;
}

/**
 * Attach a marker, routing the two pseudo-markers to their real homes.
 *
 * `MAX_MARKERS_PER_FIGURE` is 1 and a new marker replaces the old one, so `replaced` is
 * recorded on the event: the log has to say what was lost, or a Curse silently
 * disappearing under a Cracked looks like a bug in whatever notices later.
 */
function attachMarker(
  ctx: EffectContext,
  uid: FigureUid,
  marker: MarkerId,
  value: number | null,
): GameEvent[] {
  marker = canonicalMarker(marker);
  const figure = figureOf(ctx.state, uid);

  if (marker === WAIT_MARKER) {
    const bonus = waitReceivedBonus(ctx, uid);
    return [{ kind: 'waitSet', uid, from: figure.wait, to: Math.max(0, (value ?? 1) + bonus) }];
  }
  if (marker === MP_MODIFIER_MARKER) {
    const to = figure.mpDelta + (value ?? 0);
    return [{ kind: 'mpDeltaChanged', uid, from: figure.mpDelta, to }];
  }
  if (figure.zone !== 'field' && figure.zone !== 'ultraSpace') return [];

  const replaced = maxMarkersPerFigure === 1 ? (figure.marker?.id ?? null) : null;
  return [{ kind: 'markerAttached', uid, marker, value, replaced }];
}

/**
 * Execute one action.
 *
 * Unsupported actions never reach here: the coverage registry refuses to field a figure
 * whose clauses contain one, so an unhandled case would be a registry bug rather than a
 * silent no-op. The `default` branch still returns cleanly, because throwing mid-batch
 * would leave the caller holding events it could not apply.
 */
export function applyAction(
  ctx: EffectContext,
  action: Action,
  runClauses: ClauseRunner = noNestedClauses,
): ActionResult {
  let batch = emptyBatch(ctx.state);
  if (action.do !== 'select' && action.do !== 'optional') {
    const randomSel = 'target' in action && typeof action.target !== 'string'
      ? randomChooseOf(action.target)
      : null;
    if (randomSel !== null && ctx.antecedent.length === 0) {
      let options = chooseCandidates(ctx, randomSel);
      if ('target' in action && typeof action.target !== 'string' && action.target.kind === 'except') {
        const drop = new Set(evaluateSelector(ctx, action.target.remove));
        options = options.filter((uid) => !drop.has(uid));
      }
      const drawn = pick(batch.state.rng, options);
      batch = extend(batch, [{ kind: 'rngAdvanced', rng: drawn.rng }]);
      if (drawn.value !== null) ctx = withAntecedent(withState(ctx, batch.state), [drawn.value]);
    }
    const chooseTarget =
      'target' in action && typeof action.target !== 'string' && action.target.kind === 'choose'
        ? action.target
        : null;
    if (chooseTarget !== null && selectorNeedsChoice(ctx, chooseTarget)) {
      const decision = pendingDecision(ctx, 'chooseFigures', 'choose figures', {
        figures: chooseCandidates(ctx, chooseTarget),
        min: chooseTarget.upTo ? 0 : chooseTarget.count,
        max: chooseTarget.count,
        resume: { then: [action], bind: 'antecedent' },
      });
      return result(ctx, extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
    }
  }
  const targets = (): FigureUid[] =>
    'target' in action && typeof action.target !== 'string' ? evaluateSelector(ctx, action.target) : [];

  switch (action.do) {
    case 'applyCondition': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const dest = redirectInflictionTo(ctx, uid) ?? uid;
        const figure = figureOf(batch.state, dest);
        if (figure.zone !== 'field') continue;
        if (isPrevented(ctx, dest, 'gainConditions', action.condition)) {
          events.push({ kind: 'effectPrevented', uid: dest, what: 'gainConditions' });
          continue;
        }
        events.push({
          kind: 'conditionApplied',
          uid: dest,
          condition: action.condition,
          replaced: figure.condition,
        });
      }
      return result(ctx, extend(batch, events));
    }

    case 'cureConditions': {
      const events: GameEvent[] = [];
      const wanted = action.conditions;
      for (const uid of targets()) {
        const condition = figureOf(batch.state, uid).condition;
        if (condition === null) continue;
        if (wanted.length > 0 && !wanted.includes(condition)) continue;
        if (isPrevented(ctx, uid, 'loseConditions', condition)) {
          events.push({ kind: 'effectPrevented', uid, what: 'loseConditions' });
          continue;
        }
        events.push({ kind: 'conditionCleared', uid, condition });
      }
      return result(ctx, extend(batch, events));
    }

    case 'attachMarker': {
      const events: GameEvent[] = [];
      const what = action.marker === WAIT_MARKER ? 'gainWait' : 'gainMarkers';
      for (const uid of targets()) {
        const dest = redirectInflictionTo(ctx, uid) ?? uid;
        if (isPrevented(ctx, dest, what)) {
          events.push({ kind: 'effectPrevented', uid: dest, what });
          continue;
        }
        events.push(...attachMarker(ctx, dest, action.marker, action.value));
      }
      return result(ctx, extend(batch, events));
    }

    case 'removeMarker': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const figure = figureOf(batch.state, uid);
        if (action.marker === WAIT_MARKER) {
          if (figure.wait > 0) events.push({ kind: 'waitSet', uid, from: figure.wait, to: 0 });
        } else if (figure.marker?.id === action.marker) {
          events.push({ kind: 'markerCleared', uid, marker: action.marker });
        }
      }
      return result(ctx, extend(batch, events));
    }

    case 'knockOut': {
      for (const uid of targets()) {
        if (surviveInstead(ctx, uid)) {
          const figure = figureOf(batch.state, uid);
          const events: GameEvent[] = [];
          if (figure.marker !== null) events.push({ kind: 'markerCleared', uid, marker: figure.marker.id });
          if (figure.condition !== null) events.push({ kind: 'conditionCleared', uid, condition: figure.condition });
          batch = extend(batch, events);
          continue;
        }
        const attackKo = ctx.clauseTrigger === 'onAttackResolve';
        const extra = {
          fromTypes: typesOf(ctx, figureOf(ctx.state, ctx.source)),
          ...(attackKo ? { koCause: 'attackEffect' as const } : {}),
        };
        if (
          isPrevented(ctx, uid, 'beKnockedOut', undefined, extra)
          || (attackKo && isPrevented(ctx, uid, 'instantKoFromAttacks', undefined, extra))
        ) {
          batch = extend(batch, [{ kind: 'effectPrevented', uid, what: 'beKnockedOut' }]);
          continue;
        }
        batch = concatBatches(batch, knockOutFigure(batch.state, uid, 'effect'));
      }
      return result(ctx, batch);
    }

    case 'exclude': {
      for (const uid of targets()) {
        const dest = action.returnTo;
        const figure = figureOf(batch.state, uid);
        const opposingSource = figure.owner !== ctx.controller;
        if (dest === 'ultraSpace' && opposingSource && isPrevented(ctx, uid, 'moveToUltraSpace')) {
          batch = extend(batch, [{ kind: 'effectPrevented', uid, what: 'moveToUltraSpace' }]);
          continue;
        }
        if (figure.zone === 'ultraSpace' && dest === 'field' && isPrevented(ctx, uid, 'leaveUltraSpace')) {
          batch = extend(batch, [{ kind: 'effectPrevented', uid, what: 'leaveUltraSpace' }]);
          continue;
        }
        batch = concatBatches(
          batch,
          excludeFigure(
            batch.state,
            uid,
            action.returnAfterTurns,
            action.returnTo,
            action.returnWhenSourceLeaves === true ? ctx.source : null,
          ),
        );
      }
      return result(ctx, batch);
    }

    case 'move':
      return applyMove(ctx, batch, action);

    case 'modifyMp': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const figure = figureOf(batch.state, uid);
        events.push({
          kind: 'mpDeltaChanged',
          uid,
          from: figure.mpDelta,
          to: figure.mpDelta + action.delta,
        });
      }
      return result(ctx, extend(batch, events));
    }

    case 'rotateWheel': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const figure = figureOf(batch.state, uid);
        events.push({
          kind: 'wheelRotated',
          uid,
          from: figure.wheelRotation,
          to: figure.wheelRotation + action.segments,
        });
      }
      return result(ctx, extend(batch, events));
    }

    case 'adjustZGauge': {
      const player = action.target === 'controller' ? ctx.controller : opponentOf(ctx.controller);
      const current = batch.state.players[player].zGauge;
      const delta =
        action.flat ?? (action.fractionOfMax === null ? 0 : Math.trunc(Z_GAUGE_MAX * action.fractionOfMax));
      const to = Math.min(Z_GAUGE_MAX, Math.max(0, current + delta));
      if (to === current) return result(ctx, batch);
      return result(ctx, extend(batch, [{ kind: 'zGaugeChanged', player, from: current, to }]));
    }

    case 'spinCheck': {
      // Pass 1: everyone spins, against one state snapshot, so nobody's spin can be
      // changed by an earlier spinner's result. Pass 2: the follow-up clauses run once,
      // with every result already bound.
      const spun = new Map<FigureUid, ResolvedSegment>();
      for (const uid of targets()) {
        if (figureOf(batch.state, uid).zone === 'excluded') continue;
        if (ctx.clauseTrigger === 'onAttackResolve' && isPrevented(ctx, uid, 'spinFromAttacks')) {
          batch = extend(batch, [{ kind: 'effectPrevented', uid, what: 'spinFromAttacks' }]);
          continue;
        }
        const wheel = buildWheel(batch.state, ctx.deps, uid);
        const outcome = spinWheel(wheel, batch.state.rng);
        const segment = wheel[outcome.index];
        if (segment === undefined) continue;
        spun.set(uid, segment);
        batch = extend(batch, [
          { kind: 'rngAdvanced', rng: outcome.rng },
          { kind: 'checkSpun', uid, unit: outcome.unit, index: outcome.index, segment },
        ]);
      }
      const inner = withSpunResults(
        withAntecedent(withState(ctx, batch.state), [...spun.keys()]),
        spun,
      );
      const nested = runClauses(inner, action.then);
      return {
        batch: concatBatches(batch, nested.batch),
        ctx: withState(ctx, nested.batch.state),
        pending: nested.pending,
      };
    }

    case 'endTurn':
      return result(ctx, extend(batch, [{ kind: 'turnForcedEnd' }]));

    case 'forceNextTurn': {
      const player = action.player === 'controller' ? ctx.controller : opponentOf(ctx.controller);
      return result(ctx, extend(batch, [{ kind: 'nextTurnForced', player }]));
    }

    case 'respin': {
      if (action.oncePerTurn === true) {
        const figure = figureOf(batch.state, ctx.source);
        if (figure.forcedRespinOnTurn === batch.state.turn.number) return result(ctx, batch);
        batch = extend(batch, [{ kind: 'forcedRespinSpent', uid: ctx.source, turn: batch.state.turn.number }]);
      }
      if (action.forced === true && ctx.state.battle !== null) {
        const roles: BattleRole[] =
          action.who === 'both' ? ['attacker', 'defender']
            : action.who === 'opponent'
              ? (ctx.state.battle.attacker.uid === ctx.source ? ['defender'] : ['attacker'])
            : ctx.state.battle.attacker.uid === ctx.source ? ['attacker'] : ['defender'];
        const allowed: BattleRole[] = [];
        const blocked: GameEvent[] = [];
        for (const role of roles) {
          const uid = ctx.state.battle[role].uid;
          if (ctx.clauseTrigger === 'onAttackResolve' && isPrevented(ctx, uid, 'spinFromAttacks')) {
            blocked.push({ kind: 'effectPrevented', uid, what: 'spinFromAttacks' });
            continue;
          }
          allowed.push(role);
        }
        const next = blocked.length > 0 ? extend(batch, blocked) : batch;
        return result(ctx, allowed.length > 0 ? forceBattleRespins(next, allowed) : next);
      }
      // Outside a battle a respin is a grant for the next fight this turn.
      if (ctx.state.battle === null) {
        const uids = ctx.antecedent.length > 0 ? ctx.antecedent : [ctx.source];
        return attachLingering(ctx, batch, action, { kind: 'untilEndOfTurn' }, uids);
      }
      const role = ctx.state.battle.attacker.uid === ctx.source ? 'attacker' : 'defender';
      return result(ctx, extend(batch, [{ kind: 'respinGranted', role, count: action.max ?? 1 }]));
    }

    case 'grantMovement': {
      if (action.duration !== undefined && action.duration.kind !== 'instant') {
        return attachLingering(ctx, batch, action, action.duration, lingerHolders(ctx, action, targets));
      }
      const events: GameEvent[] = targets().map((uid) => ({
        kind: 'movementGranted',
        uid,
        spaces: action.grant === 'extraStep' ? 1 : 0,
      }));
      return result(ctx, extend(batch, events));
    }

    case 'modifyDamage':
    case 'prevent':
    case 'nullify':
    case 'forceBattle':
    case 'grantLeap':
    case 'grantStraightMp':
    case 'denyDeploy':
    case 'invertAbilityIncreases':
    case 'restrictMoves':
    case 'surviveByClearing':
    case 'surviveByForm':
    case 'setBattleRange':
    case 'floorMp':
    case 'seizeMoveEffects':
      return attachLingering(
        ctx,
        batch,
        action,
        'duration' in action ? action.duration : { kind: 'untilEndOfDuel' },
        lingerHolders(ctx, action, targets),
      );

    case 'tag':
    case 'noStack':
    case 'usageGate':
      return result(ctx, batch);

    case 'spendOnce':
      return result(ctx, extend(batch, [{ kind: 'onceSpent', uid: ctx.source }]));

    case 'grantExtraBattle':
      return result(ctx, extend(batch, [{ kind: 'extraBattleGranted' }]));

    case 'recolorAttacks': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        if (isPrevented(ctx, uid, 'recolorAttacks', undefined, { fromColor: action.from })) {
          events.push({ kind: 'effectPrevented', uid, what: 'recolorAttacks' });
          continue;
        }
        events.push({
          kind: 'wheelPatched' as const,
          uid,
          moveName: `*:${action.from}`,
          replacement: action.to,
          expiresOnTurn: expiryTurn(batch.state.turn.number, action.duration),
          fromColor: action.from,
          toColor: action.to,
          exceptMoveNames: action.except,
        });
      }
      return result(ctx, extend(batch, events));
    }

    case 'modifyStars': {
      const events: GameEvent[] = targets().map((uid) => ({
        kind: 'wheelPatched' as const,
        uid,
        moveName: '*:stars',
        replacement: '',
        expiresOnTurn: expiryTurn(batch.state.turn.number, action.duration),
        starDelta: action.delta,
      }));
      return result(ctx, extend(batch, events));
    }

    case 'adjustMegaTurns': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const figure = figureOf(batch.state, uid);
        if (figure.megaTurnsLeft === null) continue;
        const left = Math.max(1, figure.megaTurnsLeft + action.delta);
        events.push({ kind: 'megaTicked', uid, turnsLeft: left });
      }
      return result(ctx, extend(batch, events));
    }

    case 'consumePlate': {
      const players: PlayerId[] =
        action.player === 'both' ? [0, 1] : action.player === 'opponent' ? [opponentOf(ctx.controller)] : [ctx.controller];
      const events: GameEvent[] = [];
      for (const player of players) {
        const unused = batch.state.players[player].plates
          .map((slot, index) => {
            if (slot.used) return null;
            if (action.nameIncludes !== null) {
              const name = ctx.deps.content.plates.get(slot.plateId)?.plate.name ?? '';
              if (!name.toLowerCase().includes(action.nameIncludes.toLowerCase())) return null;
            }
            return index;
          })
          .filter((index): index is number => index !== null)
          .slice(0, action.count);
        for (const slot of unused) events.push({ kind: 'plateMarkedUsed' as const, player, slot });
      }
      if (events.length > 0) {
        const source = figureOf(batch.state, ctx.source);
        events.push({ kind: 'platesAccounted', uid: ctx.source, to: (source.platesConsumed ?? 0) + events.length });
      }
      return result(ctx, extend(batch, events));
    }

    case 'reorderPc': {
      const player = action.player === 'controller' ? ctx.controller : opponentOf(ctx.controller);
      const ordered = pcFigures(batch.state, player);
      if (ordered.length < 2) return result(ctx, batch);
      const first = ordered[0];
      const second = ordered[1];
      if (first === undefined || second === undefined) return result(ctx, batch);
      return result(
        ctx,
        extend(batch, [
          { kind: 'pcOrderChanged', uid: first.uid, from: first.pcOrder, to: second.pcOrder ?? 0 },
          { kind: 'pcOrderChanged', uid: second.uid, from: second.pcOrder, to: first.pcOrder ?? 0 },
        ]),
      );
    }

    case 'lockGoal': {
      const events: GameEvent[] = targets().map((uid) => ({ kind: 'goalLockSet' as const, uid, locked: action.locked }));
      return result(ctx, extend(batch, events));
    }

    case 'evolve':
      return applyEvolve(ctx, batch, action);

    case 'megaEvolve':
      return applyMega(ctx, batch, action);

    case 'changeForm':
      return applyForm(ctx, batch, action);

    case 'shiftSpinResult': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const effectName = ctx.activeMoveName ?? ctx.plateHint;
        if (isPrevented(ctx, uid, 'namedEffect', undefined, effectName !== null ? { effectName } : {})) {
          events.push({ kind: 'effectPrevented', uid, what: 'namedEffect' });
          continue;
        }
        events.push({
          kind: 'spinShiftArmed',
          uid,
          until: action.until,
          expiresOnTurn: expiryTurn(batch.state.turn.number, action.duration),
        });
      }
      return result(ctx, extend(batch, events));
    }

    case 'replaceSegment': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const spunHere = ctx.spunResults.get(uid);
        const spunAdopt = action.moveName === '*spun*'
          ? (spunHere ?? [...ctx.spunResults.values()][0])
          : undefined;
        const replacement = spunAdopt?.moveName ?? action.moveName;
        const moveName = action.replaces
          ?? (action.moveName === '*spun*'
            ? (ctx.activeMoveName ?? replacement)
            : (spunHere?.moveName ?? ctx.activeMoveName ?? action.moveName));
        const spun = spunAdopt ?? spunHere;
        events.push({
          kind: 'wheelPatched',
          uid,
          moveName,
          replacement,
          expiresOnTurn: expiryTurn(batch.state.turn.number, action.duration),
          ...(typeof spun?.damage === 'number' ? { damage: spun.damage }
            : action.damage !== undefined ? { damage: action.damage } : {}),
        });
        if (ctx.state.battle === null) continue;
        const role =
          ctx.state.battle.attacker.uid === uid ? 'attacker'
            : ctx.state.battle.defender.uid === uid ? 'defender'
            : null;
        if (role === null) continue;
        const color = spun?.color ?? (replacement.toLowerCase() === 'miss' ? 'miss' : undefined);
        if (color === undefined && spun === undefined) continue;
        events.push({
          kind: 'battleLandedRewritten',
          role,
          moveName: replacement,
          color: color ?? 'miss',
          damage: spun?.damage ?? null,
          stars: spun?.stars ?? null,
        });
      }
      if (action.then !== undefined && action.then.length > 0) {
        return attachLingering(ctx, extend(batch, events), action, action.duration, targets());
      }
      return result(ctx, extend(batch, events));
    }

    case 'setType': {
      const hit = evaluateSelector(ctx, action.target);
      const holders = hit.length > 0 ? hit : lingerHolders(ctx, action, () => []);
      return attachLingering(ctx, batch, { ...action, target: { kind: 'self' } }, action.duration, holders);
    }
    case 'denyPassThrough':
    case 'modifyWaitReceived':
      return attachLingering(ctx, batch, action, action.duration, ctx.antecedent.length > 0 ? ctx.antecedent : [ctx.source]);

    case 'resetToStart':
      return applyReset(ctx, batch, action);

    case 'fuse':
      return applyFuse(ctx, batch, action);

    case 'nullifyInUsePlate':
      return applyNullifyInUsePlate(ctx, batch, action);

    case 'refreshPlate': {
      const players: PlayerId[] =
        action.player === 'both' ? [0, 1] : action.player === 'opponent' ? [opponentOf(ctx.controller)] : [ctx.controller];
      const events: GameEvent[] = [];
      const count = action.accounted === true
        ? (figureOf(batch.state, ctx.source).platesConsumed ?? 0)
        : action.count;
      for (const player of players) {
        for (const slot of usedPlateSlots(batch.state, player, count, (entry) => {
          const plate = ctx.deps.content.plates.get(entry.plateId)?.plate;
          if (plate === undefined) return false;
          if (action.megaOnly === true && plate.cost !== null) return false;
          if (action.nameIncludes !== undefined && !plate.name.toLowerCase().includes(action.nameIncludes.toLowerCase())) {
            return false;
          }
          return true;
        })) {
          events.push({ kind: 'plateRefreshed', player, slot });
        }
      }
      if (action.accounted === true && count > 0) {
        events.push({ kind: 'platesAccounted', uid: ctx.source, to: 0 });
      }
      return result(ctx, extend(batch, events));
    }

    case 'optional': {
      const first = action.then[0];
      if (first?.do === 'respin' && first.oncePerTurn === true) {
        const figure = figureOf(ctx.state, ctx.source);
        if (figure.forcedRespinOnTurn === ctx.state.turn.number) return result(ctx, batch);
      }
      const decision = pendingDecision(ctx, 'optionalAction', action.then[0]?.do ?? 'optional action', {
        chooser: chooserPlayer(ctx, action.chooser),
        min: 0,
        max: 1,
        resume: { then: action.then, bind: 'none' },
      });
      return result(ctx, extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
    }

    case 'select':
      return applySelect(ctx, batch, action);

    case 'transferConditions':
      return applyTransferConditions(ctx, batch, action);

    case 'redirectInflictions':
      return attachLingering(ctx, batch, action, action.duration, targets());

    case 'claimSpot':
      return applyClaimSpot(ctx, batch, action);

    case 'armTrigger': {
      const expires = expiryTurn(batch.state.turn.number, action.duration);
      const events: GameEvent[] = targets().map((uid) => ({
        kind: 'lingeringAttached' as const,
        uid,
        effect: {
          actions: action.then,
          expiresOnTurn: expires,
          controller: ctx.controller,
          trigger: action.trigger,
          when: action.when,
          ...(ctx.plateId !== null ? { plateId: ctx.plateId } : {}),
        } satisfies LingeringEffect,
      }));
      return result(ctx, extend(batch, events));
    }

    case 'treatAsNewlyMoved': {
      const events: GameEvent[] = targets().map((uid) => ({
        kind: 'movedFlagSet' as const,
        uid,
        turn: batch.state.turn.number,
      }));
      return result(ctx, extend(batch, events));
    }

    case 'copyType': {
      const fromUid = evaluateSelector(ctx, action.from)[0];
      const types = fromUid === undefined
        ? action.types ?? []
        : [...typesOf({ ...ctx, state: batch.state }, figureOf(batch.state, fromUid))];
      const snapped = { ...action, types };
      return attachLingering(
        ctx,
        batch,
        snapped,
        action.duration,
        lingerHolders(ctx, action, targets),
      );
    }

    case 'repeatFor': {
      let current = result(ctx, batch);
      for (const uid of evaluateSelector(ctx, action.of)) {
        const inner = applyActions(withAntecedent(withState(ctx, current.batch.state), [uid]), action.then, runClauses);
        current = {
          batch: concatBatches(current.batch, inner.batch),
          ctx: withState(ctx, inner.batch.state),
          pending: inner.pending,
        };
        if (inner.pending !== null) return current;
      }
      return current;
    }

    case 'repeatTimes': {
      const times = countSourceValue(ctx, action.times);
      let current = result(ctx, batch);
      for (let i = 0; i < times; i++) {
        const inner = applyActions(withState(ctx, current.batch.state), action.then, runClauses);
        current = {
          batch: concatBatches(current.batch, inner.batch),
          ctx: withState(ctx, inner.batch.state),
          pending: inner.pending,
        };
        if (inner.pending !== null) return current;
      }
      return current;
    }

    case 'setMp':
      return attachLingering(
        ctx,
        batch,
        action,
        action.duration,
        lingerHolders(ctx, action, targets),
      );

    case 'copyPlateEffects': {
      const fromUids = evaluateSelector(ctx, action.from);
      const onto = lingerHolders(ctx, action, targets);
      const events: GameEvent[] = [];
      const expires = expiryTurn(batch.state.turn.number, action.duration);
      for (const fromUid of fromUids) {
        const holder = figureOf(batch.state, fromUid);
        for (const linger of holder.lingering ?? []) {
          if (linger.plateId === undefined) continue;
          const name = ctx.deps.content.plates.get(linger.plateId)?.plate.name ?? '';
          if (!name.toLowerCase().includes(action.nameIncludes.toLowerCase())) continue;
          for (const uid of onto) {
            events.push({
              kind: 'lingeringAttached',
              uid,
              effect: {
                actions: linger.actions,
                expiresOnTurn: expires,
                controller: ctx.controller,
                plateId: linger.plateId,
                ...(linger.trigger !== undefined ? { trigger: linger.trigger } : {}),
                ...(linger.when !== undefined ? { when: linger.when } : {}),
              },
            });
          }
        }
      }
      return result(ctx, extend(batch, events));
    }

    case 'restrictDeploy':
    case 'forceFullMp':
      return attachLingering(ctx, batch, action, { kind: 'untilEndOfDuel' }, lingerHolders(ctx, action, targets));

    case 'markBattled':
      return result(ctx, extend(batch, [{ kind: 'turnBattledSet' }]));

    case 'readyImmediately': {
      const events: GameEvent[] = targets().map((uid) => {
        const figure = figureOf(batch.state, uid);
        return { kind: 'waitSet' as const, uid, from: figure.wait, to: 0 };
      });
      return result(ctx, extend(batch, events));
    }

    case 'bonusRespin':
    case 'scaleAttackEffects':
    case 'denyNamedGrant':
    case 'denyAdjacentPass':
      return attachLingering(ctx, batch, action, { kind: 'untilEndOfDuel' }, lingerHolders(ctx, action, targets));

    case 'stripKoPrevention': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const figure = figureOf(batch.state, uid);
        if (figure.marker !== null) {
          events.push({ kind: 'markerCleared', uid, marker: figure.marker.id });
        }
        for (const linger of figure.lingering ?? []) {
          const strips = linger.actions.some((inner) =>
            (inner.do === 'prevent' && inner.what === 'beKnockedOut')
            || inner.do === 'surviveByClearing',
          );
          if (strips && linger.plateId !== undefined) {
            events.push({ kind: 'lingeringDropped', uid, plateId: linger.plateId });
          }
        }
        events.push({
          kind: 'lingeringAttached',
          uid,
          effect: {
            actions: [{ do: 'tag', tag: 'ignoreKoPrevention' }],
            expiresOnTurn: batch.state.turn.number + 1,
            controller: ctx.controller,
          },
        });
      }
      return result(ctx, extend(batch, events));
    }

    case 'revertForm': {
      const events: GameEvent[] = [];
      for (const uid of targets()) {
        const figure = figureOf(batch.state, uid);
        if (figure.figureId === figure.originFigureId) continue;
        events.push(...transformEvents(uid, figure.figureId, figure.originFigureId, 'form'));
      }
      return result(ctx, extend(batch, events));
    }

    case 'copyReceivedCondition': {
      const condition = ctx.receivedCondition ?? figureOf(ctx.state, ctx.source).condition;
      if (condition === null) return result(ctx, batch);
      const causer = ctx.conditionCauser;
      const dests = causer !== null && action.to.kind === 'battleOpponent'
        ? [causer]
        : evaluateSelector(ctx, action.to);
      const events: GameEvent[] = [];
      for (const dest of dests) {
        if (isPrevented(ctx, dest, 'gainConditions', condition)) {
          events.push({ kind: 'effectPrevented', uid: dest, what: 'gainConditions' });
          continue;
        }
        const figure = figureOf(batch.state, dest);
        if (figure.zone !== 'field') continue;
        events.push({ kind: 'conditionApplied', uid: dest, condition, replaced: figure.condition });
      }
      return result(ctx, extend(batch, events));
    }

    case 'unimplemented':
      return result(ctx, batch);
  }
}

function countSourceValue(ctx: EffectContext, source: CountSource): number {
  switch (source.kind) {
    case 'spinRepeats':
      return Math.max(ctx.state.battle?.attacker.repeatCount ?? 0, ctx.state.battle?.defender.repeatCount ?? 0);
    case 'figures':
      return evaluateSelector(ctx, source.of).length;
    case 'evolutionCount':
      return evaluateSelector(ctx, source.of).reduce(
        (sum, uid) => sum + (figureOf(ctx.state, uid).evolutionCount ?? 0),
        0,
      );
  }
}

function sourceText(ctx: EffectContext, uid: FigureUid): string {
  return figureContent(ctx.deps.content, figureOf(ctx.state, uid).figureId).figure.ability?.text ?? '';
}

function applyEvolve(
  ctx: EffectContext,
  batch: EventBatch,
  action: Extract<Action, { do: 'evolve' }>,
): ActionResult {
  const events: GameEvent[] = [];
  for (const uid of evaluateSelector(ctx, action.target)) {
    const figure = figureOf(batch.state, uid);
    if (action.onlyNamed !== undefined) {
      const printed = figureContent(ctx.deps.content, figure.figureId).figure.name;
      if (!action.onlyNamed.some((name) => name.toLowerCase() === printed.toLowerCase())) continue;
    }
    const targets = resolveEvolutionTargets(ctx.deps.content, figure.figureId, sourceText(ctx, uid));
    const to = targets[0];
    if (to === undefined) continue;
    events.push(...transformEvents(uid, figure.figureId, to, 'evolve'));
  }
  return result(ctx, extend(batch, events));
}

function applyMega(
  ctx: EffectContext,
  batch: EventBatch,
  action: Extract<Action, { do: 'megaEvolve' }>,
): ActionResult {
  const events: GameEvent[] = [];
  const turns = action.turns > 0 ? action.turns : MEGA_DURATION_TURNS;
  const hint = ctx.plateHint ?? '';
  for (const uid of evaluateSelector(ctx, action.target)) {
    if (megaBlockedByOncePerDuel(batch.state, uid)) continue;
    const figure = figureOf(batch.state, uid);
    const options = resolveMegaTargets(ctx.deps.content, figure.figureId, hint);
    const to = options[0];
    if (to === undefined) continue;
    events.push(...megaStartEvents(batch.state, uid, figure.owner, to, turns));
  }
  return result(ctx, extend(batch, events));
}

function applyForm(
  ctx: EffectContext,
  batch: EventBatch,
  action: Extract<Action, { do: 'changeForm' }>,
): ActionResult {
  const events: GameEvent[] = [];
  for (const uid of evaluateSelector(ctx, action.target)) {
    if (isPrevented(ctx, uid, 'changeForm')) {
      events.push({ kind: 'effectPrevented', uid, what: 'changeForm' });
      continue;
    }
    const figure = figureOf(batch.state, uid);
    const options = resolveFormTargets(ctx.deps.content, figure.figureId, action.into);
    const to = options[0];
    if (to === undefined) continue;
    events.push(...transformEvents(uid, figure.figureId, to, 'form'));
  }
  return result(ctx, extend(batch, events));
}

function applyTransferConditions(
  ctx: EffectContext,
  batch: EventBatch,
  action: Extract<Action, { do: 'transferConditions' }>,
): ActionResult {
  const events: GameEvent[] = [];
  const destinations = evaluateSelector(ctx, action.to);
  for (const uid of evaluateSelector(ctx, action.from)) {
    const condition = figureOf(batch.state, uid).condition;
    if (condition === null) continue;
    for (const dest of destinations) {
      if (dest === uid) continue;
      if (isPrevented(ctx, dest, 'gainConditions', condition)) {
        events.push({ kind: 'effectPrevented', uid: dest, what: 'gainConditions' });
        continue;
      }
      const destFigure = figureOf(batch.state, dest);
      if (destFigure.zone !== 'field') continue;
      events.push({ kind: 'conditionApplied', uid: dest, condition, replaced: destFigure.condition });
    }
    events.push({ kind: 'conditionCleared', uid, condition });
  }
  return result(ctx, extend(batch, events));
}

function applyClaimSpot(
  ctx: EffectContext,
  start: EventBatch,
  action: Extract<Action, { do: 'claimSpot' }>,
): ActionResult {
  const knocked = evaluateSelector(ctx, action.knock)[0];
  const claimer = evaluateSelector(ctx, action.claim)[0];
  if (knocked === undefined || claimer === undefined) return result(ctx, start);
  const vacated = figureOf(start.state, knocked).node;
  const knockedMove = applyMove(ctx, start, {
    do: 'move',
    target: action.knock,
    to: { kind: 'knockBack', steps: action.steps, chooser: 'opponent' },
  });
  if (knockedMove.pending !== null) return knockedMove;
  if (vacated === null) return knockedMove;
  const occupant = knockedMove.ctx.state.figures.find((figure) => figure.zone === 'field' && figure.node === vacated);
  if (occupant !== undefined) return knockedMove;
  const claimerFigure = figureOf(knockedMove.ctx.state, claimer);
  if (claimerFigure.zone !== 'field' || claimerFigure.node === null) return knockedMove;
  return result(
    knockedMove.ctx,
    extend(knockedMove.batch, [{ kind: 'figureMoved', uid: claimer, from: claimerFigure.node, to: vacated, mpSpent: 0 }]),
  );
}

function applyCollideKnockback(
  ctx: EffectContext,
  start: EventBatch,
  targets: readonly FigureUid[],
): ActionResult {
  const origin = figureOf(ctx.state, ctx.source).node;
  if (origin === null) return result(ctx, start);
  const occupants = new Set<FigureUid>(targets);
  for (const uid of targets) {
    const node = figureOf(start.state, uid).node;
    if (node === null) continue;
    const ray = [node, ...straightLineBehind(ctx.deps.board, origin, node)];
    for (const figure of start.state.figures) {
      if (figure.zone !== 'field' || figure.node === null) continue;
      if (figure.uid === ctx.source) continue;
      if (ray.includes(figure.node)) occupants.add(figure.uid);
    }
  }
  const ordered = [...occupants].sort((a, b) => {
    const an = figureOf(start.state, a).node;
    const bn = figureOf(start.state, b).node;
    if (an === null || bn === null) return a - b;
    const ad = ctx.deps.board.distances.get(origin)?.get(an) ?? 0;
    const bd = ctx.deps.board.distances.get(origin)?.get(bn) ?? 0;
    return bd - ad || a - b;
  });
  let batch = start;
  for (const uid of ordered) {
    const node = figureOf(batch.state, uid).node;
    if (node === null) continue;
    const ray = straightLineBehind(ctx.deps.board, origin, node);
    const occupied = occupiedSet(batch.state);
    occupied.delete(node);
    let landing: NodeId | undefined;
    for (let i = ray.length - 1; i >= 0; i--) {
      const candidate = ray[i];
      if (candidate !== undefined && !occupied.has(candidate)) {
        landing = candidate;
        break;
      }
    }
    if (landing === undefined) continue;
    batch = extend(batch, [{ kind: 'figureMoved', uid, from: node, to: landing, mpSpent: 0 }]);
  }
  return result(ctx, batch);
}

function applyReset(
  ctx: EffectContext,
  batch: EventBatch,
  action: Extract<Action, { do: 'resetToStart' }>,
): ActionResult {
  const events: GameEvent[] = [];
  for (const uid of evaluateSelector(ctx, action.target)) {
    const figure = figureOf(batch.state, uid);
    let toId = figure.originFigureId;
    if (action.keepEvolution && figure.evolved) {
      toId = figure.megaRevertsTo ?? figure.figureId;
    } else if (figure.megaRevertsTo !== null) {
      toId = figure.megaRevertsTo;
    }
    events.push({
      kind: 'figureReset',
      uid,
      keepEvolution: action.keepEvolution,
      keepConditions: action.keepConditions,
      toId,
    });
  }
  return result(ctx, extend(batch, events));
}

function forceBattleRespins(batch: EventBatch, roles: readonly BattleRole[]): EventBatch {
  let next = batch;
  for (const role of roles) {
    const battle = next.state.battle;
    if (battle === null) break;
    const side = role === 'attacker' ? battle.attacker : battle.defender;
    const first = spinWheel(side.wheel, next.state.rng);
    let index = first.index;
    let shiftedFrom: number | null = null;
    if (figureOf(next.state, side.uid).condition === 'confused') {
      shiftedFrom = index;
      index = advanceClockwise(side.wheel, index);
    }
    next = extend(next, [
      { kind: 'rngAdvanced', rng: first.rng },
      { kind: 'spun', role, uid: side.uid, unit: first.unit, index, shiftedFrom },
    ]);
  }
  return next;
}

function applyFuse(
  ctx: EffectContext,
  batch: EventBatch,
  action: Extract<Action, { do: 'fuse' }>,
): ActionResult {
  const hostOpts = action.host.kind === 'choose' ? chooseCandidates(ctx, action.host) : evaluateSelector(ctx, action.host);
  const matOpts = action.material.kind === 'choose'
    ? chooseCandidates(ctx, action.material)
    : evaluateSelector(ctx, action.material);
  const pickedHost = ctx.antecedent.find((uid) => hostOpts.includes(uid));
  const pickedMat = ctx.antecedent.find((uid) => uid !== pickedHost && matOpts.includes(uid));
  if (pickedHost === undefined && hostOpts.length > 1) {
    const decision = pendingDecision(ctx, 'chooseFigures', 'choose fusion host', {
      figures: hostOpts,
      min: 1,
      max: 1,
      resume: { then: [action], bind: 'antecedent', bound: ctx.antecedent },
    });
    return result(ctx, extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
  }
  const host = pickedHost ?? hostOpts[0];
  const remainingMats = matOpts.filter((uid) => uid !== host);
  if (host !== undefined && pickedMat === undefined && remainingMats.length > 1) {
    const decision = pendingDecision(ctx, 'chooseFigures', 'choose fusion material', {
      figures: remainingMats,
      min: 1,
      max: 1,
      resume: { then: [action], bind: 'antecedent', bound: [...ctx.antecedent, host] },
    });
    return result(ctx, extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
  }
  const material = pickedMat ?? remainingMats[0];
  if (host === undefined || material === undefined) return result(ctx, batch);
  let next = batch;
  if (action.materialTo === 'ultraSpace') {
    next = concatBatches(next, changeZone(next.state, material, 'ultraSpace', null));
  } else {
    next = concatBatches(next, excludeFigure(next.state, material, null, null));
  }
  const materialName = figureContent(ctx.deps.content, figureOf(next.state, material).figureId).figure.name;
  const pair = action.intoByMaterial.find(([from]) => materialName.toLowerCase().includes(from.toLowerCase()));
  const into = pair?.[1] !== undefined ? [pair[1]] : [];
  const options = resolveFormTargets(ctx.deps.content, figureOf(next.state, host).figureId, into);
  const to = options[0];
  if (to !== undefined) {
    const hostFigure = figureOf(next.state, host);
    next = extend(next, transformEvents(host, hostFigure.figureId, to, 'form'));
  }
  return result(ctx, next);
}

function applyNullifyInUsePlate(
  ctx: EffectContext,
  batch: EventBatch,
  action: Extract<Action, { do: 'nullifyInUsePlate' }>,
): ActionResult {
  const player = action.player === 'opponent' ? opponentOf(ctx.controller) : ctx.controller;
  const slots = batch.state.players[player].plates
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => {
      if (!slot.used) return false;
      if (action.nameIncludes !== undefined) {
        const name = ctx.deps.content.plates.get(slot.plateId)?.plate.name ?? '';
        if (!name.toLowerCase().includes(action.nameIncludes.toLowerCase())) return false;
      }
      if (!action.exceptMega) return true;
      return ctx.deps.content.plates.get(slot.plateId)?.plate.cost !== null;
    });
  const chosen = action.slot !== undefined
    ? slots.find((entry) => entry.index === action.slot)
    : slots.length > 1
      ? undefined
      : slots[0];
  if (chosen === undefined && slots.length > 1) {
    const decision = pendingDecision(ctx, 'choosePlate', 'choose an in-use plate', {
      slots: slots.map((entry) => entry.index),
      min: 1,
      max: 1,
      resume: { then: [action], bind: 'none' },
    });
    return result(ctx, extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
  }
  if (chosen === undefined) return result(ctx, batch);
  const events: GameEvent[] = [];
  for (const figure of batch.state.figures) {
    if (!(figure.lingering ?? []).some((linger) => linger.plateId === chosen.slot.plateId)) continue;
    events.push({ kind: 'lingeringDropped', uid: figure.uid, plateId: chosen.slot.plateId });
  }
  return result(ctx, extend(batch, events));
}

function applySelect(
  ctx: EffectContext,
  batch: EventBatch,
  action: Extract<Action, { do: 'select' }>,
): ActionResult {
  if (selectorNeedsChoice(ctx, action.target) && action.target.kind === 'choose') {
    const options = chooseCandidates(ctx, action.target);
    const decision = pendingDecision(ctx, 'chooseFigures', 'choose figures', {
      chooser: chooserPlayer(ctx, action.chooser),
      figures: options,
      min: action.target.upTo ? 0 : action.target.count,
      max: action.target.count,
      resume: { bind: 'antecedent' },
    });
    return result(ctx, extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
  }
  const picked = evaluateSelector(ctx, action.target);
  return { batch, ctx: withAntecedent(withState(ctx, batch.state), picked), pending: null };
}

function occupiedSet(state: GameState): Set<NodeId> {
  return new Set(
    state.figures
      .filter((figure) => figure.zone === 'field' && figure.node !== null)
      .map((figure) => figure.node as NodeId),
  );
}

function landingSpots(ctx: EffectContext, destination: Destination, movers: readonly FigureUid[]): NodeId[] {
  const occupied = occupiedSet(ctx.state);
  const spots = new Set<NodeId>();

  if (destination.kind === 'pointStepsAway') {
    for (const uid of movers) {
      const node = figureOf(ctx.state, uid).node;
      if (node === null) continue;
      for (const candidate of nodesExactlySteps(ctx.deps.board, node, destination.steps)) {
        if (!occupied.has(candidate)) spots.add(candidate);
      }
    }
  } else if (destination.kind === 'knockBack') {
    const origin = figureOf(ctx.state, ctx.source).node;
    for (const uid of movers) {
      const node = figureOf(ctx.state, uid).node;
      if (node === null || origin === null) continue;
      const ray = straightLineBehind(ctx.deps.board, origin, node);
      const steps = destination.steps === Number.MAX_SAFE_INTEGER ? ray.length : destination.steps;
      const landing = ray[Math.min(steps, ray.length) - 1];
      if (landing !== undefined && !occupied.has(landing)) spots.add(landing);
      else if (ray.length > 0) {
        for (let i = Math.min(steps, ray.length) - 1; i >= 0; i--) {
          const candidate = ray[i];
          if (candidate !== undefined && !occupied.has(candidate)) {
            spots.add(candidate);
            break;
          }
        }
      }
    }
  } else if (destination.kind === 'jumpOver') {
    const overs = evaluateSelector(ctx, destination.over);
    for (const over of overs) {
      const node = figureOf(ctx.state, over).node;
      if (node === null) continue;
      const within = nodesWithinSteps(ctx.deps.board, node, destination.maxSteps);
      const tooClose =
        destination.minSteps <= 1
          ? new Set<NodeId>([node])
          : new Set(nodesWithinSteps(ctx.deps.board, node, destination.minSteps - 1));
      for (const candidate of within) {
        if (occupied.has(candidate) || tooClose.has(candidate)) continue;
        spots.add(candidate);
      }
    }
  } else if (destination.kind === 'beyond') {
    const origin = figureOf(ctx.state, ctx.source).node;
    const overs = evaluateSelector(ctx, destination.over);
    for (const over of overs) {
      const node = figureOf(ctx.state, over).node;
      if (node === null || origin === null) continue;
      for (const candidate of straightLineBehind(ctx.deps.board, origin, node)) {
        if (!occupied.has(candidate)) {
          spots.add(candidate);
          break;
        }
      }
    }
  } else if (destination.kind === 'openSpotAdjacentTo') {
    const anchors = evaluateSelector(ctx, destination.of);
    for (const anchor of anchors) {
      const node = figureOf(ctx.state, anchor).node;
      if (node === null) continue;
      for (const neighbor of ctx.deps.board.byId.get(node)?.neighbors ?? []) {
        if (!occupied.has(neighbor)) spots.add(neighbor);
      }
    }
  } else if (destination.kind === 'goal') {
    const goal = ctx.deps.board.goals[ctx.controller];
    if (!occupied.has(goal)) spots.add(goal);
  } else if (destination.kind === 'pointWithinSteps') {
    for (const anchorUid of evaluateSelector(ctx, destination.of)) {
      const anchor = figureOf(ctx.state, anchorUid).node;
      if (anchor === null) continue;
      const tooClose = destination.min <= 1
        ? new Set<NodeId>()
        : new Set(nodesWithinSteps(ctx.deps.board, anchor, destination.min - 1));
      for (const candidate of nodesWithinSteps(ctx.deps.board, anchor, destination.max)) {
        if (candidate === anchor || occupied.has(candidate) || tooClose.has(candidate)) continue;
        spots.add(candidate);
      }
    }
  } else if (destination.kind === 'drawCloser') {
    const towardNodes = evaluateSelector(ctx, destination.toward)
      .map((uid) => figureOf(ctx.state, uid).node)
      .filter((node): node is NodeId => node !== null);
    for (const uid of movers) {
      const node = figureOf(ctx.state, uid).node;
      if (node === null) continue;
      for (const toward of towardNodes) {
        for (const candidate of nodesToward(ctx.deps.board, node, toward, destination.min, destination.max)) {
          if (!occupied.has(candidate)) spots.add(candidate);
        }
      }
    }
  } else if (destination.kind === 'withinMpRange') {
    for (const uid of movers) {
      const figure = figureOf(ctx.state, uid);
      const mp = Math.max(0, figureContent(ctx.deps.content, figure.figureId).figure.mp + figure.mpDelta);
      if (figure.zone === 'field' && figure.node !== null) {
        for (const [candidate] of mpReachable(ctx.deps.board, figure.node, mp, occupied, OPEN_MOVEMENT)) {
          spots.add(candidate);
        }
      } else {
        const entries = ctx.deps.board.entryPoints[figure.owner];
        const remain = Math.max(0, mp - DEPLOY_MP_COST);
        for (const entry of entries) {
          if (!occupied.has(entry)) spots.add(entry);
          if (remain <= 0) continue;
          for (const [candidate] of mpReachable(ctx.deps.board, entry, remain, occupied, OPEN_MOVEMENT)) {
            spots.add(candidate);
          }
        }
      }
    }
  } else if (destination.kind === 'adjacentToOwnEntry') {
    for (const entry of ctx.deps.board.entryPoints[ctx.controller]) {
      for (const neighbor of ctx.deps.board.byId.get(entry)?.neighbors ?? []) {
        if (!occupied.has(neighbor)) spots.add(neighbor);
      }
      if (!occupied.has(entry)) spots.add(entry);
    }
  } else if (destination.kind === 'vacatedBy') {
    for (const uid of evaluateSelector(ctx, destination.of)) {
      const figure = figureOf(ctx.state, uid);
      const node = figure.node ?? figure.lastFieldNode;
      if (node !== undefined && !occupied.has(node)) spots.add(node);
    }
  } else if (destination.kind === 'anyOpenField') {
    for (const node of ctx.deps.board.nodes) {
      if (!occupied.has(node.id)) spots.add(node.id);
    }
  } else if (destination.kind === 'route') {
    for (const uid of movers) {
      const node = figureOf(ctx.state, uid).node;
      if (node === null) continue;
      let candidates: NodeId[] = [];
      if (destination.straight) {
        for (const [id, steps] of straightLineDestinations(ctx.deps.board, node, destination.maxSteps, occupied)) {
          if (steps >= destination.minSteps) candidates.push(id);
        }
      } else {
        for (let steps = destination.minSteps; steps <= destination.maxSteps; steps++) {
          for (const id of nodesExactlySteps(ctx.deps.board, node, steps)) {
            if (!occupied.has(id)) candidates.push(id);
          }
        }
      }
      if (destination.adjacentTo !== undefined) {
        const anchors = evaluateSelector(ctx, destination.adjacentTo)
          .map((id) => figureOf(ctx.state, id).node)
          .filter((anchor): anchor is NodeId => anchor !== null);
        candidates = candidates.filter((id) =>
          anchors.some((anchor) => ctx.deps.board.byId.get(anchor)?.neighbors.includes(id) === true),
        );
      }
      for (const id of candidates) spots.add(id);
    }
  } else if (destination.kind === 'respectiveEntry') {
    for (const uid of movers) {
      const owner = figureOf(ctx.state, uid).owner;
      for (const entry of ctx.deps.board.entryPoints[owner]) {
        if (!occupied.has(entry)) spots.add(entry);
      }
    }
  } else if (destination.kind === 'beyondSuccession') {
    const wanted = new Set(destination.types);
    const occupantMatches = (node: NodeId): boolean => {
      const occupant = ctx.state.figures.find((figure) => figure.zone === 'field' && figure.node === node);
      return occupant !== undefined && typesOf(ctx, occupant).some((type) => wanted.has(type));
    };
    for (const uid of movers) {
      const node = figureOf(ctx.state, uid).node;
      if (node === null) continue;
      for (const chainNode of connectedComponent(ctx.deps.board, node, occupantMatches)) {
        for (const neighbor of ctx.deps.board.byId.get(chainNode)?.neighbors ?? []) {
          if (!occupied.has(neighbor)) spots.add(neighbor);
        }
      }
    }
  }

  return [...spots].sort();
}

/** Swap into a zone. If the partner is leaving that same P.C., do not FIFO-evict them. */
function swapIntoZone(state: GameState, uid: FigureUid, zone: Zone, partner: FigureUid): EventBatch {
  if (zone !== 'pc') return changeZone(state, uid, zone, null);
  const mover = figureOf(state, uid);
  const other = figureOf(state, partner);
  if (other.owner === mover.owner && other.zone === 'pc') {
    return changeZone(state, uid, 'pc', null);
  }
  if (pcFigures(state, mover.owner).length < PC_CAPACITY) return changeZone(state, uid, 'pc', null);
  return sendToPc(state, uid);
}

function battlePartner(state: GameState, uid: FigureUid): FigureUid | null {
  const battle = state.battle;
  if (battle === null) return null;
  if (battle.attacker.uid === uid) return battle.defender.uid;
  if (battle.defender.uid === uid) return battle.attacker.uid;
  return null;
}

function withDestinationChooser(destination: Destination, chooser: Chooser): Destination {
  if (
    destination.kind === 'pointStepsAway'
    || destination.kind === 'knockBack'
    || destination.kind === 'openSpotAdjacentTo'
    || destination.kind === 'adjacentToOwnEntry'
    || destination.kind === 'beyond'
    || destination.kind === 'pointWithinSteps'
    || destination.kind === 'drawCloser'
    || destination.kind === 'withinMpRange'
    || destination.kind === 'anyOpenField'
    || destination.kind === 'route'
    || destination.kind === 'beyondSuccession'
  ) {
    return { ...destination, chooser };
  }
  return destination;
}

/** Figure whose ability seizes moves that would relocate its current battle opponent. */
function seizerForMove(ctx: EffectContext, targets: readonly FigureUid[]): FigureUid | null {
  if (targets.length === 0) return null;
  for (const figure of ctx.state.figures) {
    if (figure.zone !== 'field') continue;
    const partner = battlePartner(ctx.state, figure.uid);
    if (partner === null || !targets.includes(partner)) continue;
    const content = figureContent(ctx.deps.content, figure.figureId);
    const inner = { ...ctx, source: figure.uid, controller: figure.owner };
    for (const clause of content.abilityClauses) {
      if (!guardsPass(inner, clause.when)) continue;
      for (const action of clause.actions) {
        if (action.do === 'seizeMoveEffects' && evaluateSelector(inner, action.target).includes(figure.uid)) {
          return figure.uid;
        }
      }
    }
    for (const linger of figure.lingering ?? []) {
      if (linger.expiresOnTurn !== null && ctx.state.turn.number >= linger.expiresOnTurn) continue;
      const lingerCtx = { ...ctx, source: figure.uid, controller: linger.controller };
      for (const action of linger.actions) {
        if (action.do === 'seizeMoveEffects' && evaluateSelector(lingerCtx, action.target).includes(figure.uid)) {
          return figure.uid;
        }
      }
    }
  }
  return null;
}

function destinationChooser(destination: Destination): Chooser | null {
  if (
    destination.kind === 'pointStepsAway' ||
    destination.kind === 'knockBack' ||
    destination.kind === 'openSpotAdjacentTo' ||
    destination.kind === 'adjacentToOwnEntry' ||
    destination.kind === 'beyond' ||
    destination.kind === 'pointWithinSteps' ||
    destination.kind === 'drawCloser' ||
    destination.kind === 'withinMpRange' ||
    destination.kind === 'anyOpenField' ||
    destination.kind === 'route' ||
    destination.kind === 'beyondSuccession'
  ) {
    return destination.chooser;
  }
  return null;
}

/**
 * Move destinations: zones, swaps, entry points, and the geometric landings.
 *
 * When several empty nodes are legal, the chooser named on the destination is asked.
 * A single legal node is taken without a decision. Zero legal nodes is a no-op.
 */
function applyMove(ctx: EffectContext, start: EventBatch, action: Extract<Action, { do: 'move' }>): ActionResult {
  let batch = start;
  const destination = action.to;
  const initialTargets = evaluateSelector(ctx, action.target);
  const seizer = seizerForMove(ctx, initialTargets);
  if (seizer !== null && ctx.source !== seizer) {
    const owner = figureOf(ctx.state, seizer).owner;
    const seizedCtx = { ...ctx, source: seizer, controller: owner };
    const decision = pendingDecision(seizedCtx, 'optionalAction', 'use the move effect', {
      chooser: owner,
      min: 0,
      max: 1,
      resume: {
        source: seizer,
        controller: owner,
        then: [{
          do: 'move',
          target: {
            kind: 'choose',
            count: 1,
            upTo: false,
            chooser: 'controller',
            where: [{ kind: 'inZone', zones: ['field'] }],
          },
          to: withDestinationChooser(destination, 'controller'),
        }],
        bind: 'none',
      },
    });
    return result(ctx, extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
  }
  const targets = initialTargets.filter((uid) => {
    const allowed = moveRestrictedBy(ctx, uid);
    if (allowed !== null && allowed !== ctx.source) {
      batch = extend(batch, [{ kind: 'effectPrevented', uid, what: 'beMoved' }]);
      return false;
    }
    if (!isPrevented(ctx, uid, 'beMoved')) return true;
    batch = extend(batch, [{ kind: 'effectPrevented', uid, what: 'beMoved' }]);
    return false;
  }).filter((uid) => {
    const figure = figureOf(batch.state, uid);
    const opposing = figure.owner !== ctx.controller;
    if (destination.kind === 'zone' && destination.zone === 'ultraSpace' && opposing && isPrevented(ctx, uid, 'moveToUltraSpace')) {
      batch = extend(batch, [{ kind: 'effectPrevented', uid, what: 'moveToUltraSpace' }]);
      return false;
    }
    const leavingUs = figure.zone === 'ultraSpace'
      && (destination.kind !== 'zone' || destination.zone === 'field');
    if (leavingUs && isPrevented(ctx, uid, 'leaveUltraSpace')) {
      batch = extend(batch, [{ kind: 'effectPrevented', uid, what: 'leaveUltraSpace' }]);
      return false;
    }
    return true;
  });

  if (ctx.clauseTrigger === 'onAttackResolve' && targets.length > 0) {
    batch = extend(batch, targets.map((uid) => ({ kind: 'attackEffectMoved' as const, uid })));
  }

  if (destination.kind === 'zone') {
    for (const uid of targets) {
      batch = concatBatches(
        batch,
        destination.zone === 'pc' ? sendToPc(batch.state, uid) : changeZone(batch.state, uid, destination.zone, null),
      );
    }
    return result(withAntecedent(withState(ctx, batch.state), targets), batch);
  }

  if (destination.kind === 'respectiveEntry') {
    const taken = new Set(
      batch.state.figures.filter((figure) => figure.zone === 'field' && figure.node !== null).map((figure) => figure.node as NodeId),
    );
    for (const uid of targets) {
      const owner = figureOf(batch.state, uid).owner;
      const node = ctx.deps.board.entryPoints[owner].find((entry) => !taken.has(entry));
      if (node === undefined) continue;
      taken.add(node);
      batch = concatBatches(batch, changeZone(batch.state, uid, 'field', node));
    }
    return result(withAntecedent(withState(ctx, batch.state), targets), batch);
  }

  if (destination.kind === 'entryPoint') {
    const free = ctx.deps.board.entryPoints[ctx.controller].filter(
      (node) => !batch.state.figures.some((f) => f.zone === 'field' && f.node === node),
    );
    let cursor = 0;
    for (const uid of targets) {
      const node = free[cursor++];
      if (node === undefined) break;
      batch = concatBatches(batch, changeZone(batch.state, uid, 'field', node));
    }
    return result(withAntecedent(withState(ctx, batch.state), targets), batch);
  }

  if (destination.kind === 'swapWith') {
    if (destination.with.kind === 'choose' && selectorNeedsChoice(ctx, destination.with)) {
      const decision = pendingDecision(ctx, 'chooseFigures', 'choose a swap partner', {
        figures: chooseCandidates(ctx, destination.with).filter((uid) => !targets.includes(uid)),
        min: destination.with.upTo ? 0 : destination.with.count,
        max: destination.with.count,
        resume: { then: [action], bind: 'antecedent' },
      });
      return result(ctx, extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
    }
    const partners = evaluateSelector(ctx, destination.with).filter((uid) => !targets.includes(uid));
    for (const [index, uid] of targets.entries()) {
      const partner = partners[index];
      if (partner === undefined || partner === uid) continue;
      const a = figureOf(batch.state, uid);
      const b = figureOf(batch.state, partner);
      if (a.zone === 'field' && b.zone === 'field' && a.node !== null && b.node !== null) {
        batch = extend(batch, [
          { kind: 'figureMoved', uid, from: a.node, to: b.node, mpSpent: 0 },
          { kind: 'figureMoved', uid: partner, from: b.node, to: a.node, mpSpent: 0 },
        ]);
        continue;
      }
      if (a.zone === 'field' && a.node !== null && b.zone !== 'field') {
        const node = a.node;
        batch = concatBatches(batch, swapIntoZone(batch.state, uid, b.zone, partner));
        batch = concatBatches(batch, changeZone(batch.state, partner, 'field', node));
        continue;
      }
      if (b.zone === 'field' && b.node !== null && a.zone !== 'field') {
        const node = b.node;
        batch = concatBatches(batch, swapIntoZone(batch.state, partner, a.zone, uid));
        batch = concatBatches(batch, changeZone(batch.state, uid, 'field', node));
      }
    }
    return result(withAntecedent(withState(ctx, batch.state), targets), batch);
  }

  if (destination.kind === 'knockBack' && destination.collide) {
    return applyCollideKnockback(ctx, batch, targets);
  }

  const spots = landingSpots(ctx, destination, targets);
  if (spots.length === 0 || targets.length === 0) return result(ctx, batch);
  const chooser = destinationChooser(destination);
  if (spots.length > 1 && chooser !== null) {
    const hijack = seizer !== null ? figureOf(ctx.state, seizer).owner : chooserPlayer(ctx, chooser);
    const decision = pendingDecision(ctx, 'chooseNode', 'choose a landing point', {
      chooser: hijack,
      figures: targets,
      nodes: spots,
      min: 1,
      max: 1,
      resume: { bind: 'nodes' },
    });
    return result(withAntecedent(withState(ctx, batch.state), targets), extend(batch, [{ kind: 'decisionRequested', decision }]), decision);
  }

  const landing = spots[0];
  if (landing === undefined) return result(ctx, batch);
  for (const uid of targets) {
    const figure = figureOf(batch.state, uid);
    if (figure.zone === 'field' && figure.node !== null) {
      batch = extend(batch, [{ kind: 'figureMoved', uid, from: figure.node, to: landing, mpSpent: 0 }]);
    } else {
      batch = concatBatches(batch, changeZone(batch.state, uid, 'field', landing));
    }
  }
  return result(withAntecedent(withState(ctx, batch.state), targets), batch);
}

/** Resume an interrupted clause after `resolveDecision`. */
export function resumeActions(
  ctx: EffectContext,
  resume: DecisionResume,
  accept: boolean,
  figures: readonly FigureUid[],
  nodes: readonly NodeId[],
  runClauses: ClauseRunner = noNestedClauses,
): ActionResult {
  let current =
    resume.bind === 'antecedent'
      ? withAntecedent(ctx, [...(resume.bound ?? []), ...figures])
      : resume.bind === 'nodes'
        ? ctx
        : ctx;
  current = withPreceding(current, accept);
  const followUp = accept || resume.bind === 'antecedent' ? [...resume.then, ...resume.remaining] : resume.remaining;
  if (resume.bind === 'nodes') {
    current = withAntecedent(current, figures.length > 0 ? figures : current.antecedent);
    const landing = nodes[0];
    if (landing !== undefined && accept) {
      let batch = emptyBatch(current.state);
      for (const uid of figures.length > 0 ? figures : [current.source]) {
        const figure = figureOf(batch.state, uid);
        if (figure.zone === 'field' && figure.node !== null) {
          batch = extend(batch, [{ kind: 'figureMoved', uid, from: figure.node, to: landing, mpSpent: 0 }]);
        } else {
          batch = concatBatches(batch, changeZone(batch.state, uid, 'field', landing));
        }
      }
      current = withState(current, batch.state);
      const rest = applyActions(current, resume.remaining, runClauses);
      return { batch: concatBatches(batch, rest.batch), ctx: rest.ctx, pending: rest.pending };
    }
    return applyActions(current, resume.remaining, runClauses);
  }
  return applyActions(current, followUp, runClauses);
}

/** Run a list of actions in order, threading state and context through. */
export function applyActions(
  ctx: EffectContext,
  actions: readonly Action[],
  runClauses: ClauseRunner = noNestedClauses,
): ActionResult {
  let batch = emptyBatch(ctx.state);
  let current = ctx;
  for (const [index, action] of actions.entries()) {
    const step = applyAction(current, action, runClauses);
    batch = concatBatches(batch, step.batch);
    current = step.ctx;
    if (step.pending !== null) {
      const remaining = actions.slice(index + 1);
      const pending: PendingDecision = {
        ...step.pending,
        resume: { ...step.pending.resume, remaining },
      };
      const events = batch.events.map((event) =>
        event.kind === 'decisionRequested' && event.decision.resumeToken === pending.resumeToken
          ? { ...event, decision: pending }
          : event,
      );
      return {
        batch: { events, state: { ...step.batch.state, pending } },
        ctx: withState(current, { ...step.batch.state, pending }),
        pending,
      };
    }
  }
  return { batch, ctx: current, pending: null };
}
