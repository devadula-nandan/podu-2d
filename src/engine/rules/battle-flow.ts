/**
 * Sequencing a battle: start, spin, respin, resolve.
 *
 * The shape of this file is dictated by two things that are control flow rather than
 * arithmetic, and that both look like arithmetic if you only read the rules summary.
 *
 * **Repeat-until-miss is a loop.** "Spin again until Pin Missile does not land" means
 * the segment's damage is multiplied by the number of consecutive times it came up. It
 * consumes an unbounded number of PRNG draws, so it cannot be a damage modifier applied
 * after the fact - the draws have to happen, in order, inside the spin step, or the
 * replay diverges.
 *
 * **Respins stack.** Impermeable Mail and King Horn each add one, and a figure holding
 * both gets two. Modelling "may respin" as a boolean loses the second one silently.
 *
 * Triggers fire initiator-first, per `INITIATOR_TRIGGERS_FIRST`, which is why the
 * trigger calls are ordered rather than gathered.
 */
import type { Action, DamageModifier } from '../../content/dsl/effects.js';
import { winnerAdvances } from '../rulings.js';
import { MULTIPLIER_REPEAT_CAP, Z_GAUGE_MAX } from '../constants.js';
import { figureContent } from '../content.js';
import { abilityDamageIncreasesFor, damageModifiersFor, extraWheelRotationFor, invertAbilityIncreasesFor, knockOutOrSurvive, preventionsFor, respinGrantsFor, runLiveList, runTrigger } from '../effects/bus.js';
import type { LiveClause } from '../effects/bus.js';
import { baseContext } from '../effects/context.js';
import type { EngineDeps } from '../effects/context.js';
import { evaluateSelector, guardsPass, matchesSpin, typesOf } from '../effects/select.js';
import { evolveIfHooked } from '../forms.js';
import type { BattleRole, GameEvent } from '../events.js';
import type { FigureUid, PlayerId } from '../ids.js';
import type { BattleSide, GameState, ResolvedSegment } from '../state.js';
import { figureOf } from '../state.js';
import { computeDamage, knocksOut, resolveColors } from './battle.js';
import type { DamageResult } from './battle.js';
import { advanceClockwise, buildWheel, buildZMoveWheel, segmentAt, spinWheel } from './wheel.js';
import type { EventBatch } from './zones.js';
import { concatBatches, emptyBatch, extend, returnExclusionsFor } from './zones.js';

const sideOf = (state: GameState, role: BattleRole): BattleSide | null =>
  state.battle === null ? null : role === 'attacker' ? state.battle.attacker : state.battle.defender;

export function roleOfPlayer(state: GameState, player: PlayerId): BattleRole | null {
  if (state.battle === null) return null;
  if (figureOf(state, state.battle.attacker.uid).owner === player) return 'attacker';
  if (figureOf(state, state.battle.defender.uid).owner === player) return 'defender';
  return null;
}

/** Open a battle: build both wheels, announce it, then run the pre-battle hooks. */
export function startBattle(
  state: GameState,
  deps: EngineDeps,
  attacker: FigureUid,
  defender: FigureUid,
  initiator: PlayerId,
  zMoveIndex?: number,
): EventBatch {
  const attackerFigure = figureOf(state, attacker);
  const zMoves = figureContent(deps.content, attackerFigure.figureId).figure.zMoves;
  const zSegment = zMoveIndex === undefined ? undefined : zMoves[zMoveIndex];

  let batch = emptyBatch(state);
  let attackerWheel = buildWheel(state, deps, attacker, { extraRotation: extraWheelRotationFor(state, deps, attacker) });
  if (zSegment !== undefined && state.players[attackerFigure.owner].zGauge >= Z_GAUGE_MAX) {
    const from = state.players[attackerFigure.owner].zGauge;
    batch = extend(batch, [{ kind: 'zGaugeChanged', player: attackerFigure.owner, from, to: 0 }]);
    attackerWheel = buildZMoveWheel(zSegment);
  }
  const defenderWheel = buildWheel(batch.state, deps, defender, {
    extraRotation: extraWheelRotationFor(batch.state, deps, defender),
  });
  batch = extend(batch, [
    { kind: 'battleStarted', initiator, attacker, defender, attackerWheel, defenderWheel },
  ]);
  const attackerRespins = respinGrantsFor(batch.state, deps, attacker);
  const defenderRespins = respinGrantsFor(batch.state, deps, defender);
  if (attackerRespins > 0) {
    batch = extend(batch, [{ kind: 'respinGranted', role: 'attacker', count: attackerRespins }]);
  }
  if (defenderRespins > 0) {
    batch = extend(batch, [{ kind: 'respinGranted', role: 'defender', count: defenderRespins }]);
  }
  batch = concatBatches(batch, runTrigger(batch.state, deps, 'beforeBattle'));
  const beforeDodge = batch.state;
  batch = concatBatches(
    batch,
    runTrigger(
      batch.state,
      deps,
      'onAttacked',
      (live) => live.source === defender,
      { antecedent: [defender] },
    ),
  );
  if (batch.state.pending !== null) return batch;
  return abortBattleIfDefenderMoved(beforeDodge, batch);
}

/**
 * Sandshrew / Corphish: if the defender left its square during `onAttacked`,
 * the battle does not occur — even when they are still adjacent on the far side.
 */
export function abortBattleIfDefenderMoved(before: GameState, batch: EventBatch): EventBatch {
  const battle = batch.state.battle;
  if (battle === null) return batch;
  const was = figureOf(before, battle.defender.uid);
  const now = figureOf(batch.state, battle.defender.uid);
  if (was.node === now.node && was.zone === now.zone) return batch;
  return extend(batch, [{ kind: 'battleEnded' }]);
}

function stripMoveStar(name: string): string {
  return name.replace(/\*+$/g, '').trim();
}

function landedSegmentClauses(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  wheel: readonly ResolvedSegment[],
  landedIndex: number | null,
): LiveClause[] {
  if (landedIndex === null) return [];
  const segment = segmentAt(wheel, landedIndex);
  if (segment === null || segment.sourceIndex < 0) return [];
  const figure = figureOf(state, uid);
  const printed = figureContent(deps.content, figure.figureId).segmentClauses[segment.sourceIndex] ?? [];
  const landedName = stripMoveStar(segment.moveName).toLowerCase();
  for (const linger of figure.lingering ?? []) {
    if (linger.expiresOnTurn !== null && state.turn.number >= linger.expiresOnTurn) continue;
    for (const action of linger.actions) {
      if (action.do !== 'replaceSegment' || action.then === undefined || action.then.length === 0) continue;
      if (stripMoveStar(action.moveName).toLowerCase() !== landedName) continue;
      return action.then.map((clause) => ({ clause, source: uid, controller: figure.owner }));
    }
  }
  return printed.map((clause) => ({ clause, source: uid, controller: figure.owner }));
}

function bothLandedClauses(state: GameState, deps: EngineDeps): LiveClause[] {
  const battle = state.battle;
  if (battle === null) return [];
  return [
    ...landedSegmentClauses(state, deps, battle.attacker.uid, battle.attacker.wheel, battle.attacker.landedIndex),
    ...landedSegmentClauses(state, deps, battle.defender.uid, battle.defender.wheel, battle.defender.landedIndex),
  ];
}

function modifiersFromSegment(
  state: GameState,
  deps: EngineDeps,
  ownerUid: FigureUid,
  segment: ResolvedSegment,
  applyTo: FigureUid,
): DamageModifier[] {
  const figure = figureOf(state, ownerUid);
  const clauses = figureContent(deps.content, figure.figureId).segmentClauses[segment.sourceIndex] ?? [];
  let battleOpponent: FigureUid | null = null;
  if (state.battle !== null) {
    if (state.battle.attacker.uid === ownerUid) battleOpponent = state.battle.defender.uid;
    else if (state.battle.defender.uid === ownerUid) battleOpponent = state.battle.attacker.uid;
  }
  const ctx = { ...baseContext(state, deps, ownerUid, figure.owner), battleOpponent };
  const found: DamageModifier[] = [];
  for (const clause of clauses) {
    if (!guardsPass(ctx, clause.when)) continue;
    for (const action of clause.actions) {
      if (action.do !== 'modifyDamage') continue;
      if (!evaluateSelector(ctx, action.target).includes(applyTo)) continue;
      found.push(action.modifier);
    }
  }
  return found;
}

function segmentDamageModifiers(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  segment: ResolvedSegment,
): DamageModifier[] {
  const own = modifiersFromSegment(state, deps, uid, segment, uid);
  const battle = state.battle;
  if (battle === null) return own;
  const otherSide = battle.attacker.uid === uid ? battle.defender : battle.attacker;
  const otherSegment = segmentAt(otherSide.wheel, otherSide.landedIndex);
  if (otherSegment === null) return own;
  return [...own, ...modifiersFromSegment(state, deps, otherSide.uid, otherSegment, uid)];
}

interface SpinOutcome {
  readonly events: GameEvent[];
  readonly rng: GameState['rng'];
  readonly index: number;
  readonly repeats: number;
}

/**
 * One side's spin, including Confusion's shift and the repeat-until-miss loop.
 *
 * The cap is a safety valve, not a rule. Every complete wheel contains a Miss, so the
 * loop terminates with probability one - but "with probability one" is not "always",
 * and an infinite loop inside a deterministic engine would be unrecoverable rather than
 * merely wrong.
 */
function spinSide(state: GameState, _deps: EngineDeps, role: BattleRole, side: BattleSide): SpinOutcome {
  const events: GameEvent[] = [];
  let rng = state.rng;

  const first = spinWheel(side.wheel, rng);
  rng = first.rng;
  events.push({ kind: 'rngAdvanced', rng });

  let index = first.index;
  let shiftedFrom: number | null = null;
  if (figureOf(state, side.uid).condition === 'confused') {
    shiftedFrom = index;
    index = advanceClockwise(side.wheel, index);
  }
  const shifted = applySpinShifts(state, side.uid, side.wheel, index);
  if (shifted !== index) {
    if (shiftedFrom === null) shiftedFrom = index;
    index = shifted;
  }
  events.push({ kind: 'spun', role, uid: side.uid, unit: first.unit, index, shiftedFrom });

  let repeats = 1;
  const landed = segmentAt(side.wheel, index);
  if (landed !== null && landed.isMultiplier) {
    while (repeats < MULTIPLIER_REPEAT_CAP) {
      const again = spinWheel(side.wheel, rng);
      rng = again.rng;
      events.push({ kind: 'rngAdvanced', rng });
      if (again.index !== index) break;
      repeats += 1;
      events.push({ kind: 'multiplierAdvanced', role, repeats });
    }
  }
  return { events, rng, index, repeats };
}

function applySpinShifts(
  state: GameState,
  uid: FigureUid,
  wheel: readonly ResolvedSegment[],
  index: number,
): number {
  const figure = figureOf(state, uid);
  let current = index;
  for (const shift of figure.spinShifts) {
    if (shift.expiresOnTurn !== null && state.turn.number >= shift.expiresOnTurn) continue;
    let guard = 0;
    while (guard < wheel.length) {
      const segment = segmentAt(wheel, current);
      if (segment !== null && matchesSpin(shift.until, segment)) break;
      current = advanceClockwise(wheel, current);
      guard += 1;
    }
  }
  return current;
}

/** Spin every side that has not spun yet. Attacker first, so the log reads in order. */
export function performSpins(state: GameState, deps: EngineDeps): EventBatch {
  let batch = emptyBatch(state);
  for (const role of ['attacker', 'defender'] as const) {
    const side = sideOf(batch.state, role);
    if (side === null || side.landedIndex !== null) continue;
    batch = extend(batch, spinSide(batch.state, deps, role, side).events);
  }
  const battle = batch.state.battle;
  if (battle !== null && battle.attacker.landedIndex !== null && battle.defender.landedIndex !== null) {
    batch = concatBatches(batch, expireNamedLandBoosts(batch.state));
    const spun = new Map([
      [battle.attacker.uid, segmentAt(battle.attacker.wheel, battle.attacker.landedIndex)],
      [battle.defender.uid, segmentAt(battle.defender.wheel, battle.defender.landedIndex)],
    ]);
    const spunResults = new Map(
      [...spun.entries()].filter((entry): entry is [FigureUid, NonNullable<(typeof entry)[1]>] => entry[1] !== null),
    );
    batch = concatBatches(
      batch,
      runTrigger(batch.state, deps, 'duringBattle', () => true, { spunResults }),
    );
    batch = concatBatches(
      batch,
      runTrigger(batch.state, deps, 'onNamedSpin', () => true, { spunResults }),
    );
    batch = concatBatches(
      batch,
      runLiveList(
        batch.state,
        deps,
        bothLandedClauses(batch.state, deps).filter((live) => live.clause.trigger === 'duringBattle'),
      ),
    );
  }
  return batch;
}

function expireNamedLandBoosts(state: GameState): EventBatch {
  if (state.battle === null) return emptyBatch(state);
  const events: GameEvent[] = [];
  for (const side of [state.battle.attacker, state.battle.defender]) {
    if (side.landedIndex === null) continue;
    const landed = segmentAt(side.wheel, side.landedIndex);
    if (landed === null) continue;
    const hit = (figureOf(state, side.uid).lingering ?? []).some(
      (linger) => linger.untilNamedLand?.toLowerCase() === landed.moveName.toLowerCase(),
    );
    if (!hit) continue;
    events.push({
      kind: 'lingeringNamedLand',
      uid: side.uid,
      name: landed.moveName,
      turn: state.turn.number,
    });
  }
  return extend(emptyBatch(state), events);
}

/** Spend one stacked respin and spin that side again. */
export function useRespin(state: GameState, deps: EngineDeps, role: BattleRole): EventBatch {
  const side = sideOf(state, role);
  if (side === null || side.respinsRemaining <= 0) return emptyBatch(state);
  const batch = extend(emptyBatch(state), [
    { kind: 'respinUsed', role, remaining: side.respinsRemaining - 1 },
  ]);
  const fresh = sideOf(batch.state, role);
  if (fresh === null) return batch;
  return extend(batch, spinSide(batch.state, deps, role, { ...fresh, landedIndex: null }).events);
}

function damageFor(
  state: GameState,
  deps: EngineDeps,
  side: BattleSide,
  segment: ResolvedSegment | null,
): DamageResult {
  if (segment === null) return { stages: [], final: null };
  let modifiers = [
    ...damageModifiersFor(state, deps, side.uid, segment.moveName),
    ...segmentDamageModifiers(state, deps, side.uid, segment),
  ];
  const figure = figureOf(state, side.uid);
  let battleOpponent: FigureUid | null = null;
  if (state.battle !== null) {
    if (state.battle.attacker.uid === side.uid) battleOpponent = state.battle.defender.uid;
    else if (state.battle.defender.uid === side.uid) battleOpponent = state.battle.attacker.uid;
  }
  const copyCtx = { ...baseContext(state, deps, side.uid, figure.owner), battleOpponent };
  modifiers = modifiers.flatMap((modifier) => {
    if (modifier.kind !== 'copyAbilityIncreases') return [modifier];
    const from = evaluateSelector(copyCtx, modifier.from)[0];
    if (from === undefined) return [];
    const amount = abilityDamageIncreasesFor(state, deps, from);
    return amount > 0 ? [{ kind: 'flat' as const, amount }] : [];
  });
  if (invertAbilityIncreasesFor(state, deps, side.uid)) {
    modifiers = modifiers.map((modifier) => {
      if (modifier.kind === 'flat' && modifier.amount > 0) return { ...modifier, amount: -modifier.amount };
      if (modifier.kind === 'flatByCount' && modifier.amount > 0) return { ...modifier, amount: -modifier.amount };
      return modifier;
    });
  }
  return computeDamage({
    segment,
    repeats: side.repeatCount > 0 ? side.repeatCount : 1,
    chainLevel: figure.chainLevel,
    condition: figure.condition,
    modifiers,
    counts: countFactors(state, deps, side.uid, modifiers),
  });
}

function countFactors(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  modifiers: readonly DamageModifier[],
): number[] {
  const figure = figureOf(state, uid);
  let battleOpponent: FigureUid | null = null;
  if (state.battle !== null) {
    if (state.battle.attacker.uid === uid) battleOpponent = state.battle.defender.uid;
    else if (state.battle.defender.uid === uid) battleOpponent = state.battle.attacker.uid;
  }
  const ctx = { ...baseContext(state, deps, uid, figure.owner), battleOpponent };
  const counts: number[] = [];
  for (const modifier of modifiers) {
    if (
      (modifier.kind === 'multiplyByCount' || modifier.kind === 'flatByCount') &&
      modifier.of.kind === 'figures'
    ) {
      counts.push(evaluateSelector(ctx, modifier.of.of).length);
    }
  }
  return counts;
}

/**
 * Compare the two results and apply the consequences.
 *
 * `WINNER_ADVANCES` is `false`: the survivor stays put. That is a rule an implementation
 * gets wrong by analogy with other games, and it changes the board after every single
 * battle, so it is read from the constant rather than assumed either way.
 */
export function resolveBattle(state: GameState, deps: EngineDeps): EventBatch {
  const battle = state.battle;
  if (battle === null) return emptyBatch(state);

  const attackerSegment = segmentAt(battle.attacker.wheel, battle.attacker.landedIndex);
  const defenderSegment = segmentAt(battle.defender.wheel, battle.defender.landedIndex);

  const attackerDamage = damageFor(state, deps, battle.attacker, attackerSegment);
  const defenderDamage = damageFor(state, deps, battle.defender, defenderSegment);

  let batch = extend(emptyBatch(state), [
    { kind: 'damageComputed', role: 'attacker', stages: attackerDamage.stages, final: attackerDamage.final },
    { kind: 'damageComputed', role: 'defender', stages: defenderDamage.stages, final: defenderDamage.final },
  ]);

  const missSegment: ResolvedSegment = {
    size: 0,
    moveName: 'Miss',
    color: 'miss',
    damage: null,
    stars: null,
    isMultiplier: false,
    sourceIndex: -1,
    notes: ['no segment resolved'],
  };
  const outcome = resolveColors(
    attackerSegment ?? missSegment,
    defenderSegment ?? missSegment,
    attackerDamage.final,
    defenderDamage.final,
  );
  batch = extend(batch, [{ kind: 'battleResolved', outcome }]);

  if (outcome.winner !== null) {
    const winnerUid = outcome.winner === 'attacker' ? battle.attacker.uid : battle.defender.uid;
    const winnerSide = outcome.winner === 'attacker' ? battle.attacker : battle.defender;
    batch = concatBatches(
      batch,
      runTrigger(batch.state, deps, 'onAttackResolve', (live) => live.source === winnerUid),
    );
    batch = concatBatches(
      batch,
      runLiveList(
        batch.state,
        deps,
        landedSegmentClauses(
          batch.state,
          deps,
          winnerUid,
          winnerSide.wheel,
          winnerSide.landedIndex,
        ).filter((live) => live.clause.trigger === 'onAttackResolve'),
      ),
    );
  }

  const winnerSegment = outcome.winner === 'attacker' ? attackerSegment : defenderSegment;
  const winnerDamage = outcome.winner === 'attacker' ? attackerDamage.final : defenderDamage.final;
  const loserUid = outcome.winner === 'attacker' ? battle.defender.uid : battle.attacker.uid;

  const goldKoBlocked =
    winnerSegment?.color === 'gold'
    && preventionsFor(batch.state, deps, loserUid).has('goldAttackKo');
  if (outcome.winner !== null && winnerSegment !== null && knocksOut(outcome, winnerSegment, winnerDamage)) {
    if (goldKoBlocked) {
      batch = extend(batch, [{ kind: 'effectPrevented', uid: loserUid, what: 'goldAttackKo' }]);
    } else {
      const winnerUid = outcome.winner === 'attacker' ? battle.attacker.uid : battle.defender.uid;
      const fromTypes = typesOf(baseContext(batch.state, deps, winnerUid, figureOf(batch.state, winnerUid).owner), figureOf(batch.state, winnerUid));
      batch = concatBatches(
        batch,
        knockOutOrSurvive(batch.state, deps, loserUid, 'battle', { fromTypes, koCause: 'attackDamage' }),
      );
      batch = concatBatches(
        batch,
        runTrigger(batch.state, deps, 'onFigureKnockedOut', () => true, { antecedent: [loserUid] }),
      );
      batch = concatBatches(batch, runTrigger(batch.state, deps, 'onSelfKnockedOut'));
      batch = concatBatches(batch, runTrigger(batch.state, deps, 'onOpponentKnockedOut', () => true, { antecedent: [loserUid] }));
      const landed = bothLandedClauses(batch.state, deps);
      batch = concatBatches(
        batch,
        runLiveList(
          batch.state,
          deps,
          landed.filter((live) => live.clause.trigger === 'onSelfKnockedOut' || live.clause.trigger === 'onOpponentKnockedOut'),
        ),
      );
    }
  }

  batch = concatBatches(batch, clearFrozen(batch.state, battle.attacker.uid, battle.defender.uid));
  batch = concatBatches(batch, runTrigger(batch.state, deps, 'afterBattle'));
  batch = concatBatches(
    batch,
    runLiveList(
      batch.state,
      deps,
      bothLandedClauses(batch.state, deps).filter((live) => live.clause.trigger === 'afterBattle'),
    ),
  );
  for (const uid of [battle.attacker.uid, battle.defender.uid]) {
    batch = extend(batch, evolveIfHooked(batch.state, deps.content, uid, 'afterBattle'));
  }
  for (const uid of [battle.attacker.uid, battle.defender.uid]) {
    if (tracksFirstBattle(batch.state, deps, uid)) {
      batch = extend(batch, [{ kind: 'fieldBattled', uid }]);
    }
  }
  if (
    outcome.winner !== null
    && winnerSegment !== null
    && knocksOut(outcome, winnerSegment, winnerDamage)
    && !goldKoBlocked
  ) {
    batch = extend(batch, evolveIfHooked(batch.state, deps.content, loserUid, 'knockedOut'));
  }
  batch = applyPcToBenchHooks(batch, deps);

  if (winnerAdvances) {
    // Intentionally unimplemented. The constant is `false`, so writing the advance now
    // would be untested code guarding a branch nothing takes; the flag is checked so
    // that flipping it fails loudly here rather than doing nothing.
    throw new Error('WINNER_ADVANCES is enabled but the advance is not implemented');
  }

  return extend(batch, [{ kind: 'battleEnded' }]);
}

function applyPcToBenchHooks(batch: EventBatch, deps: EngineDeps): EventBatch {
  let next = batch;
  for (const event of batch.events) {
    if (event.kind === 'zoneChanged' && event.from === 'field' && event.to !== 'field') {
      next = concatBatches(
        next,
        runTrigger(next.state, deps, 'onLeaveField', () => true, { antecedent: [event.uid] }),
      );
      next = concatBatches(next, returnExclusionsFor(next.state, event.uid));
    }
    if (event.kind === 'zoneChanged' && event.from === 'pc' && event.to === 'bench') {
      next = concatBatches(
        next,
        runTrigger(next.state, deps, 'onPcToBench', () => true, { antecedent: [event.uid] }),
      );
      next = extend(next, evolveIfHooked(next.state, deps.content, event.uid, 'pcToBench'));
    }
  }
  return next;
}

function actionsTrackFirstBattle(actions: readonly Action[]): boolean {
  return actions.some((action) => {
    if (action.do === 'optional' || action.do === 'armTrigger') return actionsTrackFirstBattle(action.then);
    return 'duration' in action && action.duration.kind === 'untilFirstBattle';
  });
}

function tracksFirstBattle(state: GameState, deps: EngineDeps, uid: FigureUid): boolean {
  const figure = figureOf(state, uid);
  const content = figureContent(deps.content, figure.figureId);
  return content.abilityClauses.some((clause) =>
    clause.when.some((condition) => condition.kind === 'firstBattleAfterMoving')
    || actionsTrackFirstBattle(clause.actions),
  );
}

/** Frozen clears after a battle - the one condition with a natural expiry. */
function clearFrozen(state: GameState, ...uids: readonly FigureUid[]): EventBatch {
  const events: GameEvent[] = [];
  for (const uid of uids) {
    const figure = figureOf(state, uid);
    if (figure.condition === 'frozen') events.push({ kind: 'conditionCleared', uid, condition: 'frozen' });
  }
  return extend(emptyBatch(state), events);
}
