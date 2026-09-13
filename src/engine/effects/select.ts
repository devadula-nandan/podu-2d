/**
 * The selector evaluator: DSL target expressions to concrete figures.
 *
 * Targets in the card text compose freely - "The battle opponent and opposing Pokemon
 * within 2 steps of it", "Any Pokemon adjacent to the battle opponent other than this
 * Pokemon" - so this is an algebra walk, not a lookup table.
 *
 * Two things here are worth knowing before reading the code:
 *
 * - **Results are always sorted by instance id.** Every clause that iterates a target
 *   set must do so in the same order on every machine, or a replay diverges the first
 *   time two figures are hit in a different sequence.
 * - **`succession` is not a filter over figures, it is a walk.** When one appears in a
 *   filter list the remaining filters become the *step predicate* of a connected-
 *   component walk from the anchor, which is what "a succession of Pokemon adjacent to
 *   the battle opponent" actually means. Treating it as an ordinary conjunct would turn
 *   an unbroken chain across the board into "the ones next to it".
 */
import type { Comparison, PokemonType } from '../../content/dsl/primitives.js';
import type { Filter, Selector, SpinPredicate } from '../../content/dsl/selectors.js';
import type { Condition } from '../../content/dsl/effects.js';
import { connectedComponent, nodesExactlySteps, nodesWithinSteps, straightLineBehind } from '../board/graph.js';
import { figureContent } from '../content.js';
import { resolveEvolutionTargets } from '../forms.js';
import type { FigureUid, NodeId } from '../ids.js';
import { opponentOf } from '../ids.js';
import { PC_CAPACITY } from '../../rules/constants.js';
import type { FigureState, ResolvedSegment } from '../state.js';
import { figureOf, pcFigures } from '../state.js';
import type { EffectContext } from './context.js';

function compare(op: Comparison, left: number, right: number): boolean {
  switch (op) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    case 'gte': return left >= right;
    case 'lte': return left <= right;
    case 'gt': return left > right;
    case 'lt': return left < right;
  }
}

/** Base MP from content plus every modifier in force, floored at zero. */
export function effectiveMp(ctx: EffectContext, figure: FigureState): number {
  const base = figureContent(ctx.deps.content, figure.figureId).figure.mp;
  return Math.max(0, base + figure.mpDelta);
}

export function typesOf(ctx: EffectContext, figure: FigureState): readonly PokemonType[] {
  for (const holder of ctx.state.figures) {
    if (holder.zone !== 'field' && holder.zone !== 'ultraSpace') continue;
    for (const linger of holder.lingering ?? []) {
      if (linger.expiresOnTurn !== null && ctx.state.turn.number >= linger.expiresOnTurn) continue;
      const lingerCtx = { ...ctx, source: holder.uid, controller: linger.controller };
      for (const action of linger.actions) {
        if (action.do === 'setType' && evaluateSelector(lingerCtx, action.target).includes(figure.uid)) {
          return action.types;
        }
        if (action.do === 'copyType' && evaluateSelector(lingerCtx, action.target).includes(figure.uid)) {
          if (action.types !== undefined && action.types.length > 0) return action.types;
          const from = evaluateSelector(lingerCtx, action.from)[0];
          if (from !== undefined && from !== figure.uid) {
            return figureContent(ctx.deps.content, figureOf(ctx.state, from).figureId).figure.types;
          }
        }
      }
    }
  }
  return figureContent(ctx.deps.content, figure.figureId).figure.types;
}

export function nameOf(ctx: EffectContext, figure: FigureState): string {
  return figureContent(ctx.deps.content, figure.figureId).figure.name;
}

const sortUids = (uids: Iterable<FigureUid>): FigureUid[] => [...new Set(uids)].sort((a, b) => a - b);

function nodesOf(ctx: EffectContext, uids: readonly FigureUid[]): NodeId[] {
  const out: NodeId[] = [];
  for (const uid of uids) {
    const node = figureOf(ctx.state, uid).node;
    if (node !== null) out.push(node);
  }
  return out;
}

export function matchesSpin(predicate: SpinPredicate, segment: ResolvedSegment): boolean {
  switch (predicate.kind) {
    case 'any':
      return true;
    case 'color':
      return predicate.colors.includes(segment.color);
    case 'damage':
      return (
        predicate.colors.includes(segment.color) &&
        segment.damage !== null &&
        compare(predicate.op, segment.damage, predicate.value)
      );
    case 'move':
      return predicate.names.some((name) => name.toLowerCase() === segment.moveName.toLowerCase());
    case 'anyOf':
      return predicate.of.some((inner) => matchesSpin(inner, segment));
    case 'not':
      return !matchesSpin(predicate.of, segment);
  }
}

/**
 * Filters other than `succession`, evaluated as a plain conjunction.
 *
 * Split out so `succession` can reuse it as its step predicate rather than duplicating
 * the logic - the two must agree exactly or a chain will include figures the plain
 * conjunction would have rejected.
 */
function matchesFilter(ctx: EffectContext, figure: FigureState, filter: Filter): boolean {
  switch (filter.kind) {
    case 'inZone':
      return filter.zones.includes(figure.zone);
    case 'allegiance':
      switch (filter.of) {
        case 'ally': return figure.owner === ctx.controller;
        case 'opposing': return figure.owner === opponentOf(ctx.controller);
        case 'any': return true;
      }
      return true;
    case 'adjacentTo': {
      if (figure.node === null) return false;
      const anchors = nodesOf(ctx, evaluateSelector(ctx, filter.of));
      return anchors.some(
        (anchor) => anchor !== figure.node && (ctx.deps.board.byId.get(anchor)?.neighbors.includes(figure.node as NodeId) ?? false),
      );
    }
    case 'within': {
      if (figure.node === null) return false;
      const extra = filter.plusZone === undefined
        ? 0
        : ctx.state.figures.filter((entry) => entry.zone === filter.plusZone).length;
      const anchors = nodesOf(ctx, evaluateSelector(ctx, filter.of));
      return anchors.some((anchor) =>
        nodesWithinSteps(ctx.deps.board, anchor, filter.steps + extra).includes(figure.node as NodeId),
      );
    }
    case 'sameNameAs': {
      const anchors = evaluateSelector(ctx, filter.of);
      return anchors.some((uid) => nameOf(ctx, figureOf(ctx.state, uid)).toLowerCase() === nameOf(ctx, figure).toLowerCase());
    }
    case 'stepsAway': {
      if (figure.node === null) return false;
      const anchors = nodesOf(ctx, evaluateSelector(ctx, filter.from));
      return anchors.some((anchor) => nodesExactlySteps(ctx.deps.board, anchor, filter.steps).includes(figure.node as NodeId));
    }
    case 'straightLineBehind': {
      if (figure.node === null) return false;
      const anchors = nodesOf(ctx, evaluateSelector(ctx, filter.of));
      const origin = figureOf(ctx.state, ctx.source).node;
      if (origin === null) return false;
      return anchors.some((anchor) => straightLineBehind(ctx.deps.board, origin, anchor).includes(figure.node as NodeId));
    }
    case 'hasType': {
      const types = typesOf(ctx, figure);
      return filter.types.some((type) => types.includes(type));
    }
    case 'hasCondition':
      return figure.condition !== null && filter.conditions.includes(figure.condition);
    case 'hasMarker':
      if (filter.marker === 'wait') return figure.wait > 0;
      return figure.marker?.id === filter.marker;
    case 'mp':
      return compare(filter.op, effectiveMp(ctx, figure), filter.value);
    case 'named': {
      const printed = nameOf(ctx, figure).toLowerCase();
      const form = (figureContent(ctx.deps.content, figure.figureId).figure.form ?? '').toLowerCase();
      return filter.names.some((name) => {
        const token = name.toLowerCase();
        return token === printed || token === form;
      });
    }
    case 'isMegaEvolved':
      return (figure.megaTurnsLeft !== null) === filter.value;
    case 'movedThisTurn':
      return (figure.movedOnTurn === ctx.state.turn.number) === filter.value;
    case 'not':
      return !matchesFilter(ctx, figure, filter.filter);
    case 'succession':
      // Handled by `evaluateAll`; reaching here means it was nested inside a `not`,
      // where a walk has no sensible meaning.
      return false;
    case 'isUltraBeast':
      return figureContent(ctx.deps.content, figure.figureId).abilityClauses.some((clause) =>
        clause.actions.some((action) => action.do === 'tag' && /ultra\s*beast/i.test(action.tag)),
      );
    case 'atEntryPoint': {
      if (figure.node === null) return false;
      const whose = filter.whose ?? 'any';
      if (whose === 'controller') return ctx.deps.board.entryPoints[ctx.controller].includes(figure.node);
      if (whose === 'opponent') return ctx.deps.board.entryPoints[opponentOf(ctx.controller)].includes(figure.node);
      return ctx.deps.board.entryPoints[0].includes(figure.node) || ctx.deps.board.entryPoints[1].includes(figure.node);
    }
    case 'ownedByEntryOf': {
      const anchors = evaluateSelector(ctx, filter.of);
      return anchors.some((uid) => {
        const node = figureOf(ctx.state, uid).node;
        if (node === null) return false;
        if (ctx.deps.board.entryPoints[0].includes(node)) return figure.owner === 0;
        if (ctx.deps.board.entryPoints[1].includes(node)) return figure.owner === 1;
        return false;
      });
    }
    case 'passedThroughBy': {
      const movers = evaluateSelector(ctx, filter.of);
      if (movers.length === 0) return false;
      const crossed = ctx.state.turn.lastPassedThrough ?? [];
      return crossed.includes(figure.uid) && movers.includes(ctx.source);
    }
    case 'hasMpReducer':
      return figure.mpDelta < 0;
  }
}

function evaluateAll(ctx: EffectContext, where: readonly Filter[]): FigureUid[] {
  const succession = where.find((f) => f.kind === 'succession');
  const rest = where.filter((f) => f !== succession);
  const base = ctx.state.figures.filter((figure) => rest.every((filter) => matchesFilter(ctx, figure, filter)));

  if (succession === undefined) {
    return sortUids(base.map((f) => f.uid));
  }

  const qualifying = new Set(base.filter((f) => f.zone === 'field' && f.node !== null).map((f) => f.node));
  const found = new Set<FigureUid>();
  for (const anchor of nodesOf(ctx, evaluateSelector(ctx, succession.from))) {
    for (const node of connectedComponent(ctx.deps.board, anchor, (candidate) => qualifying.has(candidate))) {
      const occupant = base.find((f) => f.node === node);
      if (occupant !== undefined) found.add(occupant.uid);
    }
  }
  return sortUids(found);
}

/** Every figure a `choose` selector could pick, before the player answers. */
export function chooseCandidates(ctx: EffectContext, selector: Extract<Selector, { kind: 'choose' }>): FigureUid[] {
  if (selector.from === undefined) return evaluateAll(ctx, selector.where);
  const from = evaluateSelector(ctx, selector.from);
  if (selector.where.length === 0) return from;
  return sortUids(
    from.filter((uid) => selector.where.every((filter) => matchesFilter(ctx, figureOf(ctx.state, uid), filter))),
  );
}

export function selectorNeedsChoice(ctx: EffectContext, selector: Selector): boolean {
  if (selector.kind !== 'choose') return false;
  if (selector.chooser === 'random') return false;
  if (ctx.antecedent.length > 0) return false;
  const matches = chooseCandidates(ctx, selector);
  return matches.length > selector.count;
}

export function evaluateSelector(ctx: EffectContext, selector: Selector): FigureUid[] {
  switch (selector.kind) {
    case 'self':
      return [ctx.source];
    case 'battleOpponent':
      return ctx.battleOpponent === null ? [] : [ctx.battleOpponent];
    case 'antecedent':
      return sortUids(ctx.antecedent);
    case 'spunResult':
      return sortUids(
        [...ctx.spunResults.entries()].filter(([, segment]) => matchesSpin(selector.match, segment)).map(([uid]) => uid),
      );
    case 'all':
      return evaluateAll(ctx, selector.where);
    case 'union':
      return sortUids(selector.of.flatMap((inner) => evaluateSelector(ctx, inner)));
    case 'except': {
      const remove = new Set(evaluateSelector(ctx, selector.remove));
      return evaluateSelector(ctx, selector.from).filter((uid) => !remove.has(uid));
    }
    case 'choose': {
      const matches = chooseCandidates(ctx, selector);
      if (ctx.antecedent.length > 0 && ctx.antecedent.every((uid) => matches.includes(uid))) {
        return sortUids(ctx.antecedent.filter((uid) => matches.includes(uid)).slice(0, selector.count));
      }
      if (matches.length <= selector.count) return matches;
      return matches.slice(0, selector.count);
    }
    case 'none':
      return [];
  }
}

export function evaluateCondition(ctx: EffectContext, condition: Condition): boolean {
  switch (condition.kind) {
    case 'targetExists':
      return evaluateSelector(ctx, condition.selector).length > 0;
    case 'targetCount':
      return compare(condition.op, evaluateSelector(ctx, condition.selector).length, condition.value);
    case 'hasCondition':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const c = figureOf(ctx.state, uid).condition;
        return c !== null && condition.conditions.includes(c);
      });
    case 'hasType':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const types = typesOf(ctx, figureOf(ctx.state, uid));
        return condition.types.some((type) => types.includes(type));
      });
    case 'inZone':
      return evaluateSelector(ctx, condition.target).some((uid) =>
        condition.zones.includes(figureOf(ctx.state, uid).zone),
      );
    case 'mp':
      return evaluateSelector(ctx, condition.target).some((uid) =>
        compare(condition.op, effectiveMp(ctx, figureOf(ctx.state, uid)), condition.value),
      );
    case 'spun':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const segment = ctx.spunResults.get(uid);
        return segment !== undefined && matchesSpin(condition.match, segment);
      });
    case 'isMegaEvolved':
      return evaluateSelector(ctx, condition.target).some(
        (uid) => (figureOf(ctx.state, uid).megaTurnsLeft !== null) === condition.value,
      );
    case 'not':
      return !evaluateCondition(ctx, condition.of);
    case 'precedingActionTaken':
      return ctx.precedingActionTaken;
    case 'hasMarker':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const figure = figureOf(ctx.state, uid);
        if (condition.marker === 'wait') return figure.wait > 0;
        return figure.marker?.id === condition.marker;
      });
    case 'hasWait':
      return evaluateSelector(ctx, condition.target).some((uid) => figureOf(ctx.state, uid).wait > 0);
    case 'mpCompare': {
      const left = evaluateSelector(ctx, condition.left)[0];
      const right = evaluateSelector(ctx, condition.right)[0];
      if (left === undefined || right === undefined) return false;
      return compare(condition.op, effectiveMp(ctx, figureOf(ctx.state, left)), effectiveMp(ctx, figureOf(ctx.state, right)));
    }
    case 'isEvolved':
      return evaluateSelector(ctx, condition.target).some(
        (uid) => figureOf(ctx.state, uid).evolved === condition.value,
      );
    case 'hasChangedForm':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const figure = figureOf(ctx.state, uid);
        return figure.figureId !== figure.originFigureId;
      });
    case 'battleTied':
      return ctx.state.battle?.outcome?.winner === null;
    case 'isTurnPlayer':
      return condition.who === 'controller'
        ? ctx.state.turn.player === ctx.controller
        : ctx.state.turn.player === opponentOf(ctx.controller);
    case 'atEntryPoint':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const node = figureOf(ctx.state, uid).node;
        if (node === null) return false;
        return ctx.deps.board.entryPoints[0].includes(node) || ctx.deps.board.entryPoints[1].includes(node);
      });
    case 'firstBattleAfterMoving':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const battles = figureOf(ctx.state, uid).fieldBattles ?? 0;
        const inBattle = ctx.state.battle !== null
          && (ctx.state.battle.attacker.uid === uid || ctx.state.battle.defender.uid === uid);
        switch (condition.phase) {
          case 'untilEngage':
            return battles === 0 && !inBattle;
          case 'during':
            return battles === 0 && inBattle;
          case 'untilEnd':
            return battles === 0;
          case 'after':
            return battles === 0 && ctx.clauseTrigger === 'afterBattle';
        }
      });
    case 'entryPointsFilled': {
      const owner = condition.whose === 'controller' ? ctx.controller : opponentOf(ctx.controller);
      const entries = ctx.deps.board.entryPoints[owner];
      const wanted = condition.by === 'ally' ? ctx.controller : opponentOf(ctx.controller);
      return entries.every((node) =>
        ctx.state.figures.some((figure) => figure.zone === 'field' && figure.node === node && figure.owner === wanted),
      );
    }
    case 'usingPlate': {
      if (ctx.plateHint !== null && ctx.plateHint.toLowerCase().includes(condition.name.toLowerCase())) return true;
      return ctx.state.players[ctx.controller].plates.some((slot) => {
        if (!slot.used) return false;
        const name = ctx.deps.content.plates.get(slot.plateId)?.plate.name ?? '';
        return name.toLowerCase().includes(condition.name.toLowerCase());
      });
    }
    case 'exclusiveType':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const types = typesOf(ctx, figureOf(ctx.state, uid));
        return types.length === 1 && types[0] === condition.type;
      });
    case 'pcHasSpace': {
      const owner = condition.whose === 'controller' ? ctx.controller : opponentOf(ctx.controller);
      return pcFigures(ctx.state, owner).length < PC_CAPACITY;
    }
    case 'goalOpen': {
      const owner = condition.whose === 'controller' ? ctx.controller : opponentOf(ctx.controller);
      const goal = ctx.deps.board.goals[owner];
      return !ctx.state.figures.some((figure) => figure.zone === 'field' && figure.node === goal);
    }
    case 'isBattleWinner': {
      const battle = ctx.state.battle;
      if (battle === null) return false;
      const outcome = battle.outcome;
      if (outcome === null || outcome.winner === null) return false;
      const winnerUid = outcome.winner === 'attacker' ? battle.attacker.uid : battle.defender.uid;
      return winnerUid === ctx.source;
    }
    case 'anyOf':
      return condition.of.some((inner) => evaluateCondition(ctx, inner));
    case 'allOf':
      return condition.of.every((inner) => evaluateCondition(ctx, inner));
    case 'changedFormFrom':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const figure = figureOf(ctx.state, uid);
        if (figure.figureId === figure.originFigureId) return false;
        const origin = figureContent(ctx.deps.content, figure.originFigureId).figure.name.toLowerCase();
        return condition.names.some((name) => name.toLowerCase() === origin);
      });
    case 'plateJustPlayed': {
      const played = ctx.lastPlayedPlate?.toLowerCase() ?? '';
      if (played.length === 0) return false;
      const hit = played.includes(condition.name.toLowerCase());
      return condition.match === 'eq' ? hit : !hit;
    }
    case 'antecedentNamed':
      return ctx.antecedent.some((uid) => {
        const printed = nameOf(ctx, figureOf(ctx.state, uid)).toLowerCase();
        return condition.names.some((name) => name.toLowerCase() === printed || printed.includes(name.toLowerCase()));
      });
    case 'opponentDamageVsSelf': {
      const battle = ctx.state.battle;
      if (battle === null) return false;
      const selfUid = ctx.source;
      const selfSide = battle.attacker.uid === selfUid ? battle.attacker : battle.defender.uid === selfUid ? battle.defender : null;
      const oppSide = battle.attacker.uid === selfUid ? battle.defender : battle.defender.uid === selfUid ? battle.attacker : null;
      if (selfSide === null || oppSide === null) return false;
      if (selfSide.finalDamage === null || oppSide.finalDamage === null) return false;
      return compare(condition.op, oppSide.finalDamage, selfSide.finalDamage * condition.fraction);
    }
    case 'passedThrough': {
      const crossed = ctx.state.turn.lastPassedThrough ?? [];
      return crossed.some((uid) => {
        const cond = figureOf(ctx.state, uid).condition;
        return cond !== null && condition.conditions.includes(cond);
      });
    }
    case 'sameAttackBothTimes': {
      const battle = ctx.state.battle;
      if (battle === null) return false;
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const side = battle.attacker.uid === uid ? battle.attacker
          : battle.defender.uid === uid ? battle.defender : null;
        if (side === null || side.landedIndex === null || side.priorLandedIndex === null) return false;
        const a = side.wheel[side.priorLandedIndex];
        const b = side.wheel[side.landedIndex];
        if (a === undefined || b === undefined) return false;
        return a.moveName.replace(/\*+$/g, '').toLowerCase() === b.moveName.replace(/\*+$/g, '').toLowerCase();
      });
    }
    case 'namedAttackSpun':
      return [...ctx.spunResults.values()].some((segment) =>
        condition.names.some((name) => name.toLowerCase() === segment.moveName.toLowerCase()),
      );
    case 'appliedCondition':
      return ctx.receivedCondition !== null && condition.conditions.includes(ctx.receivedCondition);
    case 'canEvolve':
      return evaluateSelector(ctx, condition.target).some((uid) => {
        const figure = figureOf(ctx.state, uid);
        const text = figureContent(ctx.deps.content, figure.figureId).figure.ability?.text ?? '';
        const found = resolveEvolutionTargets(ctx.deps.content, figure.figureId, text).length > 0;
        return condition.value === found;
      });
    case 'hasDamageIncrease':
      return evaluateSelector(ctx, condition.target).some((uid) => figureHasDamageIncrease(ctx, uid));
    case 'attackMovedOpponent': {
      const moved = ctx.state.turn.attackMovedUids ?? [];
      if (ctx.battleOpponent !== null) return moved.includes(ctx.battleOpponent);
      return moved.length > 0;
    }
    case 'passedOverSelf':
      return (ctx.state.turn.lastPassedThrough ?? []).includes(ctx.source);
    case 'unimplemented':
      return false;
  }
}

function figureHasDamageIncrease(ctx: EffectContext, uid: FigureUid): boolean {
  for (const holder of ctx.state.figures) {
    for (const linger of holder.lingering ?? []) {
      const lingerCtx = { ...ctx, source: holder.uid, controller: linger.controller };
      for (const action of linger.actions) {
        if (action.do !== 'modifyDamage') continue;
        if (!evaluateSelector(lingerCtx, action.target).includes(uid)) continue;
        if (action.modifier.kind === 'flat' && action.modifier.amount > 0) return true;
        if (action.modifier.kind === 'multiply' && action.modifier.factor > 1) return true;
      }
    }
  }
  const figure = figureOf(ctx.state, uid);
  const inner = { ...ctx, source: uid, controller: figure.owner };
  for (const clause of figureContent(ctx.deps.content, figure.figureId).abilityClauses) {
    for (const action of clause.actions) {
      if (action.do !== 'modifyDamage') continue;
      if (!evaluateSelector(inner, action.target).includes(uid)) continue;
      if (action.modifier.kind === 'flat' && action.modifier.amount > 0) return true;
      if (action.modifier.kind === 'multiply' && action.modifier.factor > 1) return true;
    }
  }
  return false;
}

export function guardsPass(ctx: EffectContext, conditions: readonly Condition[]): boolean {
  return conditions.every((condition) => evaluateCondition(ctx, condition));
}
