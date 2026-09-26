/**
 * `(state, event) => state`. Pure, total, and content-free.
 *
 * "Content-free" is the load-bearing property: no reducer imports the card database or
 * looks anything up. Every number a reducer needs was computed by the rules layer and
 * written onto the event. That is what makes a stored event log a complete replay, and
 * it is what stops a content patch from silently changing the outcome of a saved duel.
 *
 * The switch is exhaustive and ESLint enforces it, so adding an event kind without
 * handling it is a compile-time failure rather than a silently ignored mutation.
 */
import type { GameEvent } from './events.js';
import type { FigureUid, PlayerId } from './ids.js';
import type { BattleSide, FigureState, GameState, PlayerState, TurnState } from './state.js';

function updateFigure(
  state: GameState,
  uid: FigureUid,
  change: (figure: FigureState) => FigureState,
): GameState {
  const figures = state.figures.map((figure) => (figure.uid === uid ? change(figure) : figure));
  return { ...state, figures };
}

function updateTurn(state: GameState, change: Partial<TurnState>): GameState {
  return { ...state, turn: { ...state.turn, ...change } };
}

/**
 * `players` is a fixed-length tuple, and a `.map` over it widens to an array, so the
 * rebuild is written out. Every per-player update goes through here rather than
 * repeating the cast at eight call sites.
 */
function updatePlayer(state: GameState, id: PlayerId, change: Partial<PlayerState>): GameState {
  const players: readonly [PlayerState, PlayerState] = [
    id === 0 ? { ...state.players[0], ...change } : state.players[0],
    id === 1 ? { ...state.players[1], ...change } : state.players[1],
  ];
  return { ...state, players };
}

function updateBattleSide(
  state: GameState,
  role: 'attacker' | 'defender',
  change: (side: BattleSide) => BattleSide,
): GameState {
  if (state.battle === null) return state;
  const battle =
    role === 'attacker'
      ? { ...state.battle, attacker: change(state.battle.attacker) }
      : { ...state.battle, defender: change(state.battle.defender) };
  return { ...state, battle };
}

export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.kind) {
    case 'gameStarted':
      return { ...state, startingPlayer: event.startingPlayer };

    case 'phaseChanged':
      return { ...state, phase: event.to };

    case 'turnBegan':
      return {
        ...state,
        // Consumed here: a forced next turn steers exactly one transition and then
        // normal alternation resumes.
        forcedNextPlayer: null,
        figures: state.figures.map((figure) => {
          if (figure.lingering === undefined) return figure;
          const next = figure.lingering.filter(
            (effect) => effect.expiresOnTurn === null || event.number < effect.expiresOnTurn,
          );
          if (next.length === figure.lingering.length) return figure;
          if (next.length === 0) {
            const { lingering: _dropped, ...rest } = figure;
            return rest;
          }
          return { ...figure, lingering: next };
        }),
        turn: {
          player: event.player,
          number: event.number,
          platePlayed: false,
          plateWindowClosed: false,
          moved: false,
          battled: false,
          movedUid: null,
          forcedEnd: false,
        },
      };

    case 'turnEnded':
      return state;

    case 'rngAdvanced':
      return { ...state, rng: event.rng };

    case 'clockAdvanced':
      return updatePlayer(state, event.player, { clockMs: event.remaining });

    // --- movement and zones ---------------------------------------------------
    case 'figureDeployed':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        zone: 'field',
        node: event.to,
        movedOnTurn: state.turn.number,
      }));

    case 'figureMoved':
      return updateTurn(
        updateFigure(state, event.uid, (figure) => ({
          ...figure,
          node: event.to,
          movedOnTurn: state.turn.number,
        })),
        { movedUid: event.uid },
      );

    case 'pathCrossed':
      return updateTurn(state, { lastPassedThrough: event.through });

    case 'movedFlagSet':
      return updateFigure(state, event.uid, (figure) => {
        const { fieldBattles: _reset, ...rest } = figure;
        return { ...rest, movedOnTurn: event.turn };
      });

    case 'fieldBattled':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        fieldBattles: (figure.fieldBattles ?? 0) + 1,
      }));

    case 'zoneChanged': {
      const next = updateFigure(state, event.uid, (figure) => {
        const lastFieldNode = figure.zone === 'field' && figure.node !== null
          ? figure.node
          : figure.lastFieldNode;
        const leavingField = figure.zone === 'field' && event.to !== 'field';
        const enteringField = event.to === 'field';
        let lingering = figure.lingering;
        if (leavingField) {
          const kept = (figure.lingering ?? []).filter((linger) =>
            !linger.actions.some((action) => action.do === 'setType' || action.do === 'copyType'),
          );
          lingering = kept.length > 0 ? kept : undefined;
        }
        const { fieldBattles, lingering: _oldLinger, ...rest } = figure;
        return {
          ...rest,
          zone: event.to,
          node: event.to === 'field' ? event.node : null,
          pcOrder: event.to === 'pc' ? event.pcOrder : null,
          // Markers persist on the field and in Ultra Space. The rules layer also emits
          // an explicit `markerCleared` when leaving those zones, so the log reads
          // honestly; this is the belt to that braces.
          marker: event.to === 'field' || event.to === 'ultraSpace' ? figure.marker : null,
          ...(lastFieldNode !== undefined ? { lastFieldNode } : {}),
          ...(!enteringField && fieldBattles !== undefined ? { fieldBattles } : {}),
          ...(lingering !== undefined && lingering.length > 0 ? { lingering } : {}),
        };
      });
      const pcOrder = event.pcOrder;
      return pcOrder === null ? next : { ...next, pcCounter: Math.max(next.pcCounter, pcOrder + 1) };
    }

    case 'figureKnockedOut':
      return state;

    case 'figureExcluded':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        returnOnTurn: event.returnOnTurn,
        returnZone: event.returnZone,
        ...(event.returnWhenUid !== undefined ? { returnWhenUid: event.returnWhenUid } : {}),
      }));

    case 'figureReturned':
      return updateFigure(state, event.uid, (figure) => {
        const { returnWhenUid: _dropped, ...rest } = figure;
        return { ...rest, returnOnTurn: null, returnZone: null };
      });

    case 'attackEffectMoved': {
      const prev = state.turn.attackMovedUids ?? [];
      if (prev.includes(event.uid)) return state;
      return updateTurn(state, { attackMovedUids: [...prev, event.uid] });
    }

    // --- the three state layers -----------------------------------------------
    case 'conditionApplied':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, condition: event.condition }));

    case 'conditionCleared':
      return updateFigure(state, event.uid, (figure) =>
        figure.condition === event.condition ? { ...figure, condition: null } : figure,
      );

    case 'markerAttached':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        marker: { id: event.marker, value: event.value },
      }));

    case 'markerCleared':
      return updateFigure(state, event.uid, (figure) =>
        figure.marker?.id === event.marker ? { ...figure, marker: null } : figure,
      );

    case 'waitSet':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, wait: event.to }));

    case 'mpDeltaChanged':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, mpDelta: event.to }));

    case 'tagged':
      return state;

    case 'chainLevelChanged':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, chainLevel: event.to }));

    case 'wheelRotated':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, wheelRotation: event.to }));

    case 'goalLockSet':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, goalLocked: event.locked }));

    case 'zGaugeChanged':
      return updatePlayer(state, event.player, { zGauge: event.to });

    case 'platesLocked':
      return updatePlayer(state, event.player, { platesLockedUntilTurn: event.untilTurn });

    case 'figureTransformed':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        figureId: event.toId,
        evolved: event.reason === 'evolve' ? true : figure.evolved,
        ...(event.reason === 'evolve'
          ? { evolutionCount: (figure.evolutionCount ?? 0) + 1 }
          : figure.evolutionCount !== undefined ? { evolutionCount: figure.evolutionCount } : {}),
        megaRevertsTo:
          event.reason === 'mega'
            ? event.fromId
            : event.reason === 'megaEnd'
              ? null
              : figure.megaRevertsTo,
      }));

    case 'megaStarted':
      return updatePlayer(
        updateFigure(state, event.uid, (figure) => ({ ...figure, megaTurnsLeft: event.turns })),
        event.player,
        { megaUsed: true },
      );

    case 'wheelPatched':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        wheelPatches: [
          ...figure.wheelPatches.filter((patch) => patch.moveName !== event.moveName),
          {
            moveName: event.moveName,
            replacement: event.replacement,
            expiresOnTurn: event.expiresOnTurn,
            ...(event.fromColor !== undefined ? { fromColor: event.fromColor } : {}),
            ...(event.toColor !== undefined ? { toColor: event.toColor } : {}),
            ...(event.starDelta !== undefined ? { starDelta: event.starDelta } : {}),
            ...(event.exceptMoveNames !== undefined ? { exceptMoveNames: event.exceptMoveNames } : {}),
            ...(event.damage !== undefined ? { damage: event.damage } : {}),
          },
        ],
      }));

    case 'lingeringAttached':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        lingering: [...(figure.lingering ?? []), event.effect],
      }));

    case 'lingeringDropped':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        lingering: (figure.lingering ?? []).filter((linger) => linger.plateId !== event.plateId),
      }));

    case 'lingeringNamedLand':
      return updateFigure(state, event.uid, (figure) => {
        const next = (figure.lingering ?? []).flatMap((linger) => {
          if (linger.untilNamedLand?.toLowerCase() !== event.name.toLowerCase()) return [linger];
          if (linger.untilNamedLandEndOfTurn === true) {
            return [{ ...linger, expiresOnTurn: event.turn + 1 }];
          }
          return [];
        });
        if (next.length === 0) {
          const { lingering: _dropped, ...rest } = figure;
          return rest;
        }
        return { ...figure, lingering: next };
      });

    case 'figureReset':
      return updateFigure(state, event.uid, (figure) => {
        const { lingering: _dropped, evolutionCount: _count, ...rest } = figure;
        return {
          ...rest,
          figureId: event.toId,
          condition: event.keepConditions ? figure.condition : null,
          wait: 0,
          marker: null,
          mpDelta: 0,
          wheelPatches: [],
          spinShifts: [],
          wheelRotation: 0,
          goalLocked: false,
          megaTurnsLeft: null,
          megaRevertsTo: null,
          evolved: event.keepEvolution ? figure.evolved : false,
          ...(event.keepEvolution && figure.evolutionCount !== undefined
            ? { evolutionCount: figure.evolutionCount }
            : {}),
        };
      });

    case 'plateMarkedUsed': {
      const plates = state.players[event.player].plates.map((slot, i) =>
        i === event.slot ? { ...slot, used: true } : slot,
      );
      return updatePlayer(state, event.player, { plates });
    }

    case 'pcOrderChanged':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, pcOrder: event.to }));

    case 'spinShiftArmed':
      return updateFigure(state, event.uid, (figure) => ({
        ...figure,
        spinShifts: [...figure.spinShifts, { until: event.until, expiresOnTurn: event.expiresOnTurn }],
      }));

    case 'timeTravelLocked':
      return { ...state, timeTravelLockedUntilTurn: event.untilTurn };

    case 'timeTravelRequested':
      return state;

    // --- battle ---------------------------------------------------------------
    case 'battleStarted':
      return {
        ...state,
        battle: {
          initiator: event.initiator,
          attacker: {
            uid: event.attacker,
            wheel: event.attackerWheel,
            landedIndex: null,
            priorLandedIndex: null,
            respinsRemaining: 0,
            repeatCount: 0,
            finalDamage: null,
          },
          defender: {
            uid: event.defender,
            wheel: event.defenderWheel,
            landedIndex: null,
            priorLandedIndex: null,
            respinsRemaining: 0,
            repeatCount: 0,
            finalDamage: null,
          },
          outcome: null,
        },
      };

    case 'spun':
      return updateBattleSide(state, event.role, (side) => ({
        ...side,
        priorLandedIndex: side.landedIndex,
        landedIndex: event.index,
      }));

    case 'battleLandedRewritten':
      return updateBattleSide(state, event.role, (side) => {
        if (side.landedIndex === null) return side;
        const current = side.wheel[side.landedIndex];
        if (current === undefined) return side;
        const next = [...side.wheel];
        next[side.landedIndex] = {
          ...current,
          moveName: event.moveName,
          color: event.color,
          damage: event.damage,
          stars: event.stars,
        };
        return { ...side, wheel: next };
      });

    // The result is threaded through the effect context, not the state: it is scoped to
    // the clause that asked for it and must not outlive it.
    case 'checkSpun':
      return state;

    case 'respinGranted':
      return updateBattleSide(state, event.role, (side) => ({
        ...side,
        respinsRemaining: side.respinsRemaining + event.count,
      }));

    case 'respinUsed':
      return updateBattleSide(state, event.role, (side) => ({ ...side, respinsRemaining: event.remaining }));

    case 'respinDeclined':
      return updateBattleSide(state, event.role, (side) => ({ ...side, respinsRemaining: 0 }));

    case 'multiplierAdvanced':
      return updateBattleSide(state, event.role, (side) => ({ ...side, repeatCount: event.repeats }));

    case 'damageComputed':
      return updateBattleSide(state, event.role, (side) => ({ ...side, finalDamage: event.final }));

    case 'battleResolved':
      return state.battle === null ? state : { ...state, battle: { ...state.battle, outcome: event.outcome } };

    case 'battleEnded':
      return { ...state, battle: null, turn: { ...state.turn, battled: true } };

    // --- board rules ----------------------------------------------------------
    case 'surrounded':
    case 'goalReached':
    case 'goalDenied':
      return state;

    // --- plates ---------------------------------------------------------------
    case 'platePlayed': {
      const plates = state.players[event.player].plates.map((slot, i) =>
        i === event.slot ? { ...slot, used: true } : slot,
      );
      return updateTurn(updatePlayer(state, event.player, { plates }), { platePlayed: true });
    }

    case 'plateRefreshed': {
      const plates = state.players[event.player].plates.map((slot, i) =>
        i === event.slot ? { ...slot, used: false } : slot,
      );
      return updatePlayer(state, event.player, { plates });
    }

    // --- flow -----------------------------------------------------------------
    case 'plateWindowClosed':
      return updateTurn(state, { plateWindowClosed: true });

    case 'preSelectClosed':
      return updateTurn(state, { preSelectClosed: true });

    case 'preSelectOffered': {
      const have = state.turn.preSelectOffered ?? [];
      if (have.includes(event.uid)) return state;
      return updateTurn(state, { preSelectOffered: [...have, event.uid] });
    }

    case 'actionTaken': {
      // Consumes the one figure action. Lock optional-battle to that figure unless
      // an MP-walk already named the mover.
      const movedUid = state.turn.movedUid ?? event.uid;
      return updateTurn(state, { moved: true, plateWindowClosed: true, movedUid });
    }

    case 'battleDeclined':
      return updateTurn(state, { battled: true });

    case 'turnForcedEnd':
      return updateTurn(state, { forcedEnd: true });

    case 'nextTurnForced':
      return { ...state, forcedNextPlayer: event.player };

    case 'decisionRequested':
      return { ...state, pending: event.decision };

    case 'decisionResolved':
      return { ...state, pending: null };

    case 'megaTicked':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, megaTurnsLeft: event.turnsLeft }));

    // Pure log entries. They change no state, but a replay that could not show *why*
    // an ability did nothing would be a replay nobody can debug with.
    case 'onceSpent':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, onceSpent: true as const }));

    case 'forcedRespinSpent':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, forcedRespinOnTurn: event.turn }));

    case 'turnBattledSet':
      return updateTurn(state, { battled: true });

    case 'platesAccounted':
      return updateFigure(state, event.uid, (figure) => ({ ...figure, platesConsumed: event.to }));

    case 'extraBattleGranted':
      return { ...state, turn: { ...state.turn, extraBattle: true as const } };

    case 'extraBattleOpened': {
      const { extraBattle: _cleared, ...rest } = state.turn;
      return { ...state, turn: { ...rest, battled: false } };
    }

    case 'surroundResumeSet':
      if (state.pending === null) return state;
      return {
        ...state,
        pending: {
          ...state.pending,
          resume: {
            ...state.pending.resume,
            afterSurround: { uid: event.uid, node: event.node },
          },
        },
      };

    case 'effectNullified':
    case 'effectPrevented':
    case 'movementGranted':
      return state;

    case 'gameEnded':
      return { ...state, result: event.result, phase: 'gameOver' };
  }
}

/** Fold a batch. `dispatch` returns `{ events, nextState }` where this holds exactly. */
export function applyEvents(state: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce(reduce, state);
}
