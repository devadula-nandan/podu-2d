/**
 * The phase machine: what is legal now, and what happens without being asked.
 *
 * The engine is a *settling* machine. `dispatch` applies one command and then runs
 * `settle`, which keeps advancing until the game either needs a human decision or is
 * over. Everything that is not a decision - ticking Wait, expiring exclusions, running
 * start-of-turn abilities, checking surrounds, ending the turn - happens inside that
 * loop. So `legalCommands(state)` only ever describes real choices, and an AI or a
 * network client never has to know which phases are transient.
 *
 * The one rule that shapes the legal set more than any other is that **there is no
 * pass**. A plate and an MP-move are both available until someone actually walks;
 * Move → Plate is illegal (`moved` closes plates). Declining a battle is offered only
 * after a walk (or when the only remaining option is an optional fight). A figure may
 * stand and fight without moving; that is an `initiateBattle`, not a pass. Wait Victory
 * exists precisely because there is no voluntary pass.
 */
import { platesAllowedAfterMoving, taggingEndsTurn } from './rulings.js';
import type { Command } from './commands.js';
import { IllegalCommandError, sameCommand } from './commands.js';
import { Z_GAUGE_MAX } from './constants.js';
import { figureContent, plateContent } from './content.js';
import {
  battleRangeFor,
  deniedPassNodes,
  findAbilityClause,
  movementPassFor,
  noTransitNodes,
  mustBattle,
  mustBattleAgainst,
  platesAllowed,
  preventionsFor,
  runLiveActions,
  runMatching,
  runNested,
  runTrigger,
} from './effects/bus.js';
import { baseContext, withLastPlayedPlate, withPlateHint, withPlateId } from './effects/context.js';
import type { EngineDeps } from './effects/context.js';
import { resumeActions } from './effects/interpret.js';
import { guardsPass } from './effects/select.js';
import type { GameEvent } from './events.js';
import { megaEndEvents, resolveMegaTargets } from './forms.js';
import type { FigureUid, NodeId, PlayerId } from './ids.js';
import { opponentOf } from './ids.js';
import { OPEN_MOVEMENT } from './board/graph.js';
import type { MovementPermissions } from './board/graph.js';
import {
  isActivableAbilityClause,
  isInsteadOfAttackClause,
  isInsteadOfMoveClause,
  isPreSelectClause,
  isTimeTravelClause,
  plateStandIn,
} from './plates.js';
import { timeTravelAvailable } from './rewind.js';
import { battleTargets } from './rules/battle.js';
import { abortBattleIfDefenderMoved, performSpins, resolveBattle, roleOfPlayer, startBattle, useRespin } from './rules/battle-flow.js';
import {
  deployEvents,
  deployOptions,
  moveEvents,
  mpMoveOptions,
  tagEvents,
  tagTargets,
} from './rules/movement.js';
import { resolveSurrounds } from './rules/surround.js';
import {
  clockResult,
  concedeResult,
  goalDeniedBySurround,
  goalOutcome,
  turnLimitResult,
  waitVictoryResult,
} from './rules/win.js';
import { returnExpiredExclusions, tickTimers } from './rules/zones.js';
import type { EventBatch } from './rules/zones.js';
import { concatBatches, emptyBatch, extend } from './rules/zones.js';
import type { GameState, Phase } from './state.js';
import { figureOf, isOver } from './state.js';

/** A hard stop on the settle loop. Nothing legitimate needs anywhere near this many steps. */
const MAX_SETTLE_STEPS = 4096;

const goTo = (state: GameState, to: Phase): GameEvent[] =>
  state.phase === to ? [] : [{ kind: 'phaseChanged', from: state.phase, to }];

/** Pathfinding permissions a figure has right now, from its own and its allies' grants. */
export function permissionsFor(state: GameState, deps: EngineDeps, uid: FigureUid): MovementPermissions {
  const { unrestricted, passableOccupied } = movementPassFor(state, deps, uid);
  const forbidden = deniedPassNodes(state, deps, uid);
  const noTransit = noTransitNodes(state, deps, uid);
  if (!unrestricted && passableOccupied.size === 0 && forbidden.size === 0 && noTransit.size === 0) return OPEN_MOVEMENT;
  return {
    passThrough: unrestricted,
    ...(passableOccupied.size > 0 ? { passableOccupied } : {}),
    forbidden,
    ...(noTransit.size > 0 ? { noTransit } : {}),
  };
}

// ---------------------------------------------------------------------------
// The legal set
// ---------------------------------------------------------------------------

/**
 * Figures that may stand in for this plate: usage-legal first, then the matching Mega
 * target if the plate is a stone, then field over bench, then lowest uid.
 *
 * Lowest-uid-on-the-roster was the stand-in for every plate. That made X Attack buff
 * the first bench slot, Charizardite X mega the wrong field figure, and usage gates
 * fail because they evaluated `self` against a Pokémon that was not even a candidate.
 */
function plateHolders(state: GameState, deps: EngineDeps, player: PlayerId, slot: number): FigureUid[] {
  const entry = state.players[player].plates[slot];
  if (entry === undefined) return [];
  const content = plateContent(deps.content, entry.plateId);
  const restrictions = content.clauses.filter((clause) => clause.trigger === 'usageRestriction');
  const owned = state.figures.filter((figure) => figure.owner === player);
  const megaFits = (figureId: (typeof owned)[number]['figureId']): boolean =>
    resolveMegaTargets(deps.content, figureId, content.plate.name).length > 0;
  const ok = owned.filter((figure) => {
    const ctx = withPlateHint(baseContext(state, deps, figure.uid, player), content.plate.name);
    return restrictions.every((clause) => guardsPass(ctx, clause.when));
  });
  return [...ok]
    .sort((a, b) => {
      const mega = Number(megaFits(b.figureId)) - Number(megaFits(a.figureId));
      if (mega !== 0) return mega;
      const field = Number(b.zone === 'field') - Number(a.zone === 'field');
      if (field !== 0) return field;
      return a.uid - b.uid;
    })
    .map((figure) => figure.uid);
}

function plateUsageAllows(state: GameState, deps: EngineDeps, player: PlayerId, slot: number): boolean {
  return plateHolders(state, deps, player, slot).length > 0;
}

function playablePlates(state: GameState, deps: EngineDeps, player: PlayerId): number[] {
  if (state.turn.platePlayed) return [];
  // Closing the plate *window* is not the same as walking. Plates stay legal until
  // an MP-move / deploy / tag consumes the action (`moved`), matching "never Move → Plate".
  if (!platesAllowedAfterMoving && state.turn.moved) return [];
  if (!platesAllowed(state, deps, player)) return [];
  return state.players[player].plates.flatMap((slot, index) =>
    slot.used || !plateUsageAllows(state, deps, player, index) ? [] : [index],
  );
}

function abilityCommands(state: GameState, deps: EngineDeps, player: PlayerId): Command[] {
  const commands: Command[] = [];
  for (const figure of state.figures) {
    if (figure.owner !== player || figure.zone !== 'field') continue;
    const content = figureContent(deps.content, figure.figureId);
    for (const clause of content.abilityClauses) {
      const timeTravel = isTimeTravelClause(clause);
      if (!isActivableAbilityClause(clause) && !timeTravel) continue;
      if (timeTravel && !timeTravelAvailable(state)) continue;
      if (isInsteadOfMoveClause(clause) && state.phase !== 'action' && state.phase !== 'plateWindow') continue;
      if (
        isInsteadOfAttackClause(clause)
        && state.phase !== 'battleDecision'
        && state.phase !== 'action'
        && state.phase !== 'plateWindow'
      ) continue;
      commands.push({ kind: 'abilityAction', player, uid: figure.uid, clauseId: clause.id });
    }
  }
  return commands;
}

/** Every movement action open to the player: deploys, MP moves and tags. */
export function movementCommands(state: GameState, deps: EngineDeps, player: PlayerId): Command[] {
  const commands: Command[] = [];
  for (const figure of state.figures) {
    const symbiont = figure.marker !== null
      && (figure.marker.id === 'symbiont');
    if (figure.owner !== player && !(symbiont && figure.owner !== player)) continue;
    if (figure.owner !== player && !symbiont) continue;
    if (figure.owner === player && symbiont) continue;
    const permissions = permissionsFor(state, deps, figure.uid);

    if (figure.zone === 'bench') {
      for (const [to, option] of deployOptions(state, deps, figure.uid, permissions)) {
        commands.push({ kind: 'deploy', player, uid: figure.uid, entry: option.entry, to });
      }
      continue;
    }
    if (figure.zone !== 'field') continue;
    for (const to of mpMoveOptions(state, deps, figure.uid, permissions).keys()) {
      commands.push({ kind: 'mpMove', player, uid: figure.uid, to });
    }
    for (const target of tagTargets(state, deps, figure.uid)) {
      commands.push({ kind: 'tag', player, uid: figure.uid, target });
    }
  }
  return commands;
}

function battleCommands(state: GameState, deps: EngineDeps, player: PlayerId): Command[] {
  const commands: Command[] = [];
  const zReady = state.players[player].zGauge >= Z_GAUGE_MAX;
  // An MP-walk locks initiation to that figure. No walk yet (or deploy-only)
  // means any of your field figures may stand and fight.
  const lockUid = state.turn.movedUid;
  for (const figure of state.figures) {
    if (figure.owner !== player || figure.zone !== 'field') continue;
    if (figure.wait > 0) continue;
    if (lockUid !== null && figure.uid !== lockUid) continue;
    if (preventionsFor(state, deps, figure.uid).has('attack')) continue;
    const zMoves = figureContent(deps.content, figure.figureId).figure.zMoves;
    const forcedDefender = mustBattleAgainst(state, deps, figure.uid);
    for (const defender of battleTargets(state, deps, figure.uid, battleRangeFor(state, deps, figure.uid))) {
      if (forcedDefender !== null && defender !== forcedDefender) continue;
      commands.push({ kind: 'initiateBattle', player, attacker: figure.uid, defender });
      if (zReady) {
        for (let index = 0; index < zMoves.length; index++) {
          commands.push({ kind: 'initiateBattle', player, attacker: figure.uid, defender, zMoveIndex: index });
        }
      }
    }
  }
  return commands;
}

/**
 * Whether this player has *anything* they could do this turn.
 *
 * This is the Wait Victory predicate, and it deliberately spans the whole turn rather
 * than the current window: a plate counts as an action, so a player holding a playable
 * plate is not out of options even with every figure immobile.
 */
export function hasAnyAction(state: GameState, deps: EngineDeps, player: PlayerId): boolean {
  if (playablePlates(state, deps, player).length > 0) return true;
  if (movementCommands(state, deps, player).length > 0) return true;
  if (abilityCommands(state, deps, player).length > 0) return true;
  return battleCommands(state, deps, player).length > 0;
}

/** Plate, walk, ability, or stand-and-fight — whatever is still open before `moved`. */
function turnChoiceCommands(state: GameState, deps: EngineDeps, player: PlayerId): Command[] {
  return [
    ...playablePlates(state, deps, player).map(
      (slot): Command => ({ kind: 'playPlate', player, slot }),
    ),
    ...movementCommands(state, deps, player),
    ...abilityCommands(state, deps, player),
    ...battleCommands(state, deps, player),
  ];
}

/**
 * The complete set of legal commands.
 *
 * `advanceClock` and `concede` are always available, because time passes regardless of
 * phase and a player may resign at any point. Everything else is phase-gated.
 */
function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const [head, ...tail] = items;
  if (head === undefined) return [];
  return [...combinations(tail, k - 1).map((rest) => [head, ...rest]), ...combinations(tail, k)];
}

function decisionCommands(state: GameState): Command[] {
  const pending = state.pending;
  if (pending === null) return [];
  const player = pending.chooser;
  const commands: Command[] = [];
  if (pending.minCount === 0 || pending.kind === 'optionalAction') {
    commands.push({
      kind: 'resolveDecision',
      player,
      resumeToken: pending.resumeToken,
      accept: false,
      figures: [],
      nodes: [],
    });
  }
  if (pending.kind === 'optionalAction') {
    commands.push({
      kind: 'resolveDecision',
      player,
      resumeToken: pending.resumeToken,
      accept: true,
      figures: [],
      nodes: [],
    });
    return commands;
  }
  if (pending.kind === 'chooseNode') {
    for (const node of pending.nodeOptions) {
      commands.push({
        kind: 'resolveDecision',
        player,
        resumeToken: pending.resumeToken,
        accept: true,
        figures: [],
        nodes: [node],
      });
    }
    return commands;
  }
  if (pending.kind === 'choosePlate') {
    for (const slot of pending.slotOptions) {
      commands.push({
        kind: 'resolveDecision',
        player,
        resumeToken: pending.resumeToken,
        accept: true,
        figures: [],
        nodes: [],
        slots: [slot],
      });
    }
    return commands;
  }
  for (let count = pending.minCount; count <= pending.maxCount; count++) {
    if (count === 0) continue;
    for (const figures of combinations(pending.figureOptions, count)) {
      commands.push({
        kind: 'resolveDecision',
        player,
        resumeToken: pending.resumeToken,
        accept: true,
        figures,
        nodes: [],
      });
    }
  }
  return commands;
}

function decisionLegal(state: GameState, command: Extract<Command, { kind: 'resolveDecision' }>): boolean {
  const pending = state.pending;
  if (pending === null) return false;
  if (command.resumeToken !== pending.resumeToken || command.player !== pending.chooser) return false;
  if (!command.accept) return pending.minCount === 0 || pending.kind === 'optionalAction';
  if (command.figures.some((uid) => !pending.figureOptions.includes(uid))) return false;
  if (command.nodes.some((node) => !pending.nodeOptions.includes(node))) return false;
  if (pending.kind === 'chooseNode') return command.nodes.length === 1;
  if (pending.kind === 'choosePlate') {
    const slot = command.slots?.[0];
    return slot !== undefined && pending.slotOptions.includes(slot) && (command.slots?.length ?? 0) === 1;
  }
  if (pending.kind === 'chooseFigures') {
    const count = command.figures.length;
    return count >= pending.minCount && count <= pending.maxCount && command.nodes.length === 0;
  }
  return true;
}

export function legalCommands(state: GameState, deps: EngineDeps): Command[] {
  if (isOver(state)) return [];
  const player = state.turn.player;
  const always: Command[] = [
    { kind: 'concede', player },
    { kind: 'concede', player: opponentOf(player) },
  ];

  if (state.pending !== null) return [...decisionCommands(state), ...always];

  switch (state.phase) {
    case 'plateWindow':
      return [
        ...turnChoiceCommands(state, deps, player),
        { kind: 'declinePlate', player },
        ...always,
      ];

    case 'action':
      return [...turnChoiceCommands(state, deps, player), ...always];

    case 'battleDecision': {
      const battles = battleCommands(state, deps, player);
      const lockUid = state.turn.movedUid;
      const forced = lockUid !== null
        && mustBattle(state, deps, lockUid)
        && battles.length > 0;
      return [
        ...battles,
        ...abilityCommands(state, deps, player),
        ...(forced ? [] : [{ kind: 'declineBattle' as const, player }]),
        ...always,
      ];
    }

    case 'spin':
      return [{ kind: 'spin', player }, ...always];

    case 'respin': {
      // Both players are offered these, not just the turn player: a stacked respin
      // belongs to the figure that granted it, and the defender's Impermeable Mail is
      // the commonest source of one.
      const commands: Command[] = [...always];
      for (const who of [player, opponentOf(player)] as const) {
        const role = roleOfPlayer(state, who);
        if (role === null || (state.battle?.[role].respinsRemaining ?? 0) <= 0) continue;
        commands.push({ kind: 'useRespin', player: who }, { kind: 'declineRespin', player: who });
      }
      return commands;
    }

    case 'setup':
    case 'turnStart':
    case 'preSelect':
    case 'surroundCheck':
    case 'damageResolve':
    case 'turnEnd':
    case 'gameOver':
      return always;
  }
}

// ---------------------------------------------------------------------------
// Applying a command
// ---------------------------------------------------------------------------

/**
 * Play a plate.
 *
 * A plate is not a figure, so `self` still needs a stand-in. That figure is the first
 * `plateHolders` uid — usage-legal, Mega-stone match, field before bench — not the
 * lowest uid on the roster. Immediate clauses run; `select` / `modifyDamage` / `move`
 * go through the interpreter so a "choose one Pokémon" plate pending-chooses instead of
 * hanging the whole text on the stand-in as a lingering that never fires from the bench.
 */
function playPlate(state: GameState, deps: EngineDeps, player: PlayerId, slot: number): EventBatch {
  const entry = state.players[player].plates[slot];
  if (entry === undefined) return emptyBatch(state);

  let batch = extend(emptyBatch(state), [
    { kind: 'platePlayed', player, slot, plateId: entry.plateId },
  ]);

  const content = plateContent(deps.content, entry.plateId);
  const stand = plateHolders(batch.state, deps, player, slot)[0] ?? plateStandIn(batch.state, player);
  if (stand !== null) {
    for (const clause of content.clauses) {
      if (clause.trigger === 'usageRestriction') continue;
      const ctx = withPlateId(
        withPlateHint(baseContext(batch.state, deps, stand, player), content.plate.name),
        entry.plateId,
      );
      const step = runLiveActions(batch.state, deps, { clause, source: stand, controller: player }, ctx);
      batch = concatBatches(batch, step);
      if (batch.state.pending !== null) break;
    }
  }

  const opponent = opponentOf(player);
  batch = concatBatches(
    batch,
    runTrigger(
      batch.state,
      deps,
      'onPlatePlayed',
      (live) => live.controller === opponent,
      withLastPlayedPlate(baseContext(batch.state, deps, stand ?? 0 as FigureUid, opponent), content.plate.name),
    ),
  );

  if (content.plate.endsTurn || content.clauses.some((clause) => clause.actions.some((action) => action.do === 'endTurn'))) {
    batch = extend(batch, [{ kind: 'turnForcedEnd' }]);
  }
  return batch;
}

/**
 * Everything that happens after a figure finishes moving.
 *
 * Surround first, then the goal - `SURROUND_GOAL_PRIORITY`. A mover that both reached
 * the goal and got clamped is dead and did not score, and the denial is logged so the
 * two readings of that ruling stay distinguishable in a replay.
 */
function afterMovement(
  state: GameState,
  deps: EngineDeps,
  uid: FigureUid,
  landedOn: NodeId | null,
  skipEscape = false,
): EventBatch {
  let batch = concatBatches(emptyBatch(state), resolveSurrounds(state, deps, { skipEscape }));
  if (batch.state.pending !== null) {
    return extend(batch, [{ kind: 'surroundResumeSet', uid, node: landedOn }]);
  }
  const survived = figureOf(batch.state, uid).zone === 'field';

  if (!survived) {
    batch = extend(batch, goalDeniedBySurround(uid, landedOn));
  } else {
    batch = extend(batch, goalOutcome(batch.state, deps, uid, true));
  }
  if (isOver(batch.state)) return batch;
  return concatBatches(batch, runTrigger(batch.state, deps, 'afterMove'));
}

function applyCommand(state: GameState, deps: EngineDeps, command: Command): EventBatch {
  switch (command.kind) {
    case 'concede':
      return extend(emptyBatch(state), [{ kind: 'gameEnded', result: concedeResult(command.player) }]);

    case 'advanceClock': {
      const remaining = state.players[command.player].clockMs - command.ms;
      const batch = extend(emptyBatch(state), [
        { kind: 'clockAdvanced', player: command.player, ms: command.ms, remaining },
      ]);
      const result = clockResult(batch.state);
      return result === null ? batch : extend(batch, [{ kind: 'gameEnded', result }]);
    }

    case 'playPlate':
      return playPlate(state, deps, command.player, command.slot);

    case 'declinePlate':
      return extend(emptyBatch(state), [{ kind: 'plateWindowClosed' }, ...goTo(state, 'preSelect')]);

    case 'declineWindow':
      return extend(emptyBatch(state), goTo(state, 'action'));

    case 'deploy': {
      let batch = extend(
        emptyBatch(state),
        deployEvents(state, deps, command.uid, command.entry, command.to, permissionsFor(state, deps, command.uid)),
      );
      batch = concatBatches(batch, runTrigger(batch.state, deps, 'onEnterField'));
      return concatBatches(batch, afterMovement(batch.state, deps, command.uid, command.to));
    }

    case 'mpMove': {
      const batch = extend(
        emptyBatch(state),
        moveEvents(state, deps, command.uid, command.to, permissionsFor(state, deps, command.uid)),
      );
      return concatBatches(batch, afterMovement(batch.state, deps, command.uid, command.to));
    }

    case 'tag': {
      const batch = extend(emptyBatch(state), tagEvents(state, deps, command.uid, command.target));
      // Tagging ends the turn, so there is no surround check to run: nothing moved.
      return taggingEndsTurn ? extend(batch, [{ kind: 'turnForcedEnd' }]) : batch;
    }

    case 'initiateBattle': {
      const batch = startBattle(
        state,
        deps,
        command.attacker,
        command.defender,
        command.player,
        command.zMoveIndex,
      );
      if (batch.state.pending !== null) return batch;
      if (batch.state.battle === null) return extend(batch, goTo(batch.state, 'turnEnd'));
      return extend(batch, goTo(batch.state, 'spin'));
    }

    case 'declineBattle':
      return extend(emptyBatch(state), [{ kind: 'battleDeclined', player: command.player }]);

    case 'spin':
      return performSpins(state, deps);

    case 'useRespin': {
      const role = roleOfPlayer(state, command.player);
      return role === null ? emptyBatch(state) : useRespin(state, deps, role);
    }

    case 'declineRespin': {
      const role = roleOfPlayer(state, command.player);
      return role === null
        ? emptyBatch(state)
        : extend(emptyBatch(state), [{ kind: 'respinDeclined', role }]);
    }

    case 'abilityAction':
      return applyAbilityAction(state, deps, command.player, command.uid, command.clauseId);

    case 'resolveDecision':
      return applyResolveDecision(state, deps, command);
  }
}

function applyAbilityAction(
  state: GameState,
  deps: EngineDeps,
  player: PlayerId,
  uid: FigureUid,
  clauseId: string,
): EventBatch {
  const live = findAbilityClause(state, deps, uid, clauseId);
  if (live === null) return emptyBatch(state);

  if (isTimeTravelClause(live.clause)) {
    // The log is caller-owned. We record the request and consume the action; the
    // caller applies `rewind` + `timeTravelAftermath` to their snapshot.
    return extend(emptyBatch(state), [
      { kind: 'timeTravelRequested', uid },
      { kind: 'actionTaken', player, uid },
      { kind: 'turnForcedEnd' },
    ]);
  }

  let batch = runLiveActions(state, deps, live);
  batch = extend(batch, [{ kind: 'actionTaken', player, uid }]);
  return batch;
}

function applyResolveDecision(
  state: GameState,
  deps: EngineDeps,
  command: Extract<Command, { kind: 'resolveDecision' }>,
): EventBatch {
  const pending = state.pending;
  if (pending === null) return emptyBatch(state);
  const held = pending.resume.afterSurround;

  const batch = extend(emptyBatch(state), [{ kind: 'decisionResolved', resumeToken: command.resumeToken }]);
  const movers = pending.kind === 'chooseNode' ? pending.figureOptions : command.figures;
  const ctx = baseContext(batch.state, deps, pending.resume.source, pending.resume.controller);
  const slot = command.slots?.[0];
  const resume = slot !== undefined
    ? {
        ...pending.resume,
        then: pending.resume.then.map((action) =>
          action.do === 'nullifyInUsePlate' ? { ...action, slot } : action,
        ),
      }
    : pending.resume;
  const resumed = resumeActions(
    ctx,
    resume,
    command.accept,
    movers,
    command.nodes,
    runNested(deps),
  );
  const combined = concatBatches(batch, resumed.batch);
  if (combined.state.pending !== null) {
    if (held === undefined) return combined;
    return extend(combined, [{ kind: 'surroundResumeSet', uid: held.uid, node: held.node }]);
  }
  let finished = abortBattleIfDefenderMoved(state, combined);
  if (held !== undefined) {
    finished = concatBatches(
      finished,
      afterMovement(finished.state, deps, held.uid, held.node, true),
    );
  }
  return finished;
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

function beginTurn(state: GameState, deps: EngineDeps, player: PlayerId, number: number): EventBatch {
  let batch = extend(emptyBatch(state), [
    ...goTo(state, 'turnStart'),
    { kind: 'turnBegan', player, number },
  ]);
  const skipMega = new Set(
    batch.state.figures
      .filter((figure) => preventionsFor(batch.state, deps, figure.uid).has('megaTick'))
      .map((figure) => figure.uid),
  );
  batch = concatBatches(batch, tickTimers(batch.state, skipMega));
  batch = concatBatches(batch, expireMegas(batch.state, deps));
  batch = concatBatches(batch, returnExpiredExclusions(batch.state));
  batch = concatBatches(
    batch,
    runTrigger(
      batch.state,
      deps,
      'startOfTurn',
      (live) =>
        !isInsteadOfMoveClause(live.clause) &&
        !isPreSelectClause(live.clause) &&
        !isTimeTravelClause(live.clause),
    ),
  );
  if (batch.state.pending !== null) return batch;
  if (isOver(batch.state)) return batch;

  const waitLoss = waitVictoryResult(player, hasAnyAction(batch.state, deps, player));
  if (waitLoss !== null) return extend(batch, [{ kind: 'gameEnded', result: waitLoss }]);

  return extend(batch, goTo(batch.state, 'plateWindow'));
}

function endTurn(state: GameState, deps: EngineDeps): EventBatch {
  let batch = concatBatches(emptyBatch(state), runTrigger(state, deps, 'endOfTurn'));
  batch = extend(batch, [{ kind: 'turnEnded', player: batch.state.turn.player }]);
  if (isOver(batch.state)) return batch;

  const next = batch.state.forcedNextPlayer ?? opponentOf(batch.state.turn.player);
  const number = batch.state.turn.number + 1;

  // The cap is evaluated against the turn that is about to start, so a duel that
  // reaches it ends instead of playing one more turn past it.
  const capped = turnLimitResult({ ...batch.state, turn: { ...batch.state.turn, number } });
  if (capped !== null) return extend(batch, [{ kind: 'gameEnded', result: capped }]);

  return concatBatches(batch, beginTurn(batch.state, deps, next, number));
}

/**
 * One transient step, or `null` if the machine is waiting for a player.
 *
 * Returning `null` rather than looping internally is what keeps `settle` a plain loop
 * with a step cap, and the cap is what turns a rule bug into a thrown error instead of
 * a hung process.
 */
function expireMegas(state: GameState, deps: EngineDeps): EventBatch {
  let batch = emptyBatch(state);
  for (const figure of state.figures) {
    if (figure.megaTurnsLeft !== null || figure.megaRevertsTo === null) continue;
    batch = concatBatches(
      batch,
      runTrigger(batch.state, deps, 'onMegaEnd', (live) => live.source === figure.uid),
    );
    batch = extend(batch, megaEndEvents(batch.state, figure.uid));
  }
  return batch;
}

function step(state: GameState, deps: EngineDeps): EventBatch | null {
  if (isOver(state)) return null;
  if (state.pending !== null) return null;

  switch (state.phase) {
    case 'setup':
      return concatBatches(
        extend(emptyBatch(state), [{ kind: 'gameStarted', startingPlayer: state.startingPlayer }]),
        beginTurn(state, deps, state.startingPlayer, 1),
      );

    case 'turnStart':
      return extend(emptyBatch(state), goTo(state, 'plateWindow'));

    case 'plateWindow':
      if (state.turn.forcedEnd) return extend(emptyBatch(state), goTo(state, 'turnEnd'));
      if (playablePlates(state, deps, state.turn.player).length > 0) return null;
      return extend(emptyBatch(state), [{ kind: 'plateWindowClosed' }, ...goTo(state, 'preSelect')]);

    case 'preSelect': {
      if (state.turn.preSelectClosed === true) {
        return extend(emptyBatch(state), goTo(state, 'action'));
      }
      const batch = runMatching(state, deps, isPreSelectClause);
      const offered = batch.state.pending !== null || batch.events.length > 0;
      const closed = offered ? extend(batch, [{ kind: 'preSelectClosed' }]) : batch;
      if (closed.state.pending !== null) return closed;
      return extend(closed, goTo(closed.state, 'action'));
    }

    case 'action': {
      if (state.turn.forcedEnd) return extend(emptyBatch(state), goTo(state, 'turnEnd'));
      if (state.turn.moved) return extend(emptyBatch(state), goTo(state, 'surroundCheck'));
      if (playablePlates(state, deps, state.turn.player).length > 0) return null;
      if (movementCommands(state, deps, state.turn.player).length > 0) return null;
      // No plate or movement left. This is not a pass and not a loss - the player
      // had something to do this turn, or `beginTurn` would already have ended it.
      return extend(emptyBatch(state), goTo(state, 'battleDecision'));
    }

    case 'surroundCheck':
      return extend(emptyBatch(state), goTo(state, 'battleDecision'));

    case 'battleDecision':
      if (state.turn.forcedEnd || state.turn.battled) return extend(emptyBatch(state), goTo(state, 'turnEnd'));
      if (battleCommands(state, deps, state.turn.player).length > 0) return null;
      return extend(emptyBatch(state), [
        { kind: 'battleDeclined', player: state.turn.player },
        ...goTo(state, 'turnEnd'),
      ]);

    case 'spin': {
      if (state.battle === null) return extend(emptyBatch(state), goTo(state, 'turnEnd'));
      const spun = state.battle.attacker.landedIndex !== null && state.battle.defender.landedIndex !== null;
      return spun ? extend(emptyBatch(state), goTo(state, 'respin')) : null;
    }

    case 'respin': {
      if (state.battle === null) return extend(emptyBatch(state), goTo(state, 'turnEnd'));
      const available =
        state.battle.attacker.respinsRemaining + state.battle.defender.respinsRemaining;
      return available > 0 ? null : extend(emptyBatch(state), goTo(state, 'damageResolve'));
    }

    case 'damageResolve': {
      if (state.battle === null) return extend(emptyBatch(state), goTo(state, 'turnEnd'));
      const resolved = resolveBattle(state, deps);
      if (resolved.state.turn.extraBattle === true) {
        return extend(resolved, [{ kind: 'extraBattleOpened' }, ...goTo(resolved.state, 'battleDecision')]);
      }
      return extend(resolved, goTo(resolved.state, 'turnEnd'));
    }

    case 'turnEnd':
      return endTurn(state, deps);

    case 'gameOver':
      return null;
  }
}

/** Advance until a player decision is required or the duel is over. */
export function settle(state: GameState, deps: EngineDeps): EventBatch {
  let batch = emptyBatch(state);
  for (let i = 0; i < MAX_SETTLE_STEPS; i++) {
    const next = step(batch.state, deps);
    if (next === null || next.events.length === 0) return batch;
    batch = concatBatches(batch, next);
  }
  throw new Error(`the phase machine did not settle within ${MAX_SETTLE_STEPS} steps`);
}

/** Reject anything not in the legal set, then apply it and settle. */
export function execute(state: GameState, deps: EngineDeps, command: Command): EventBatch {
  const legal = legalCommands(state, deps);
  const allowed =
    command.kind === 'advanceClock' ||
    (command.kind === 'resolveDecision' && decisionLegal(state, command)) ||
    legal.some((candidate) => sameCommand(candidate, command));
  if (!allowed) {
    throw new IllegalCommandError(command, `not legal in phase "${state.phase}"`);
  }
  const applied = applyCommand(state, deps, command);
  return concatBatches(applied, settle(applied.state, deps));
}