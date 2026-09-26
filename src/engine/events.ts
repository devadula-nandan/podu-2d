/**
 * Events: the only thing that changes state, and the only thing a replay needs.
 *
 * The contract this file exists to enforce is that **`reduce(state, event)` never looks
 * at the content database**. Every value a reducer needs is carried on the event -
 * `mpSpent`, the resolved wheel, the computed damage, the new P.C. ordering. That costs
 * a few extra fields and buys three things: replaying a log needs no card data, a
 * divergent replay can be bisected event by event, and no reducer can accidentally
 * become nondeterministic by reading content that a later patch changed.
 *
 * Randomness is explicit for the same reason. Any step that draws from the PRNG emits
 * `rngAdvanced` carrying the post-draw generator state, immediately before the event
 * that used it. So `events.reduce(reduce, before)` equals the `nextState` that
 * `dispatch` returned, which is asserted in the tests rather than assumed.
 */
import type { SpecialCondition, Zone } from '../content/dsl/primitives.js';
import type { MarkerId } from '../content/dsl/primitives.js';
import type { SpinPredicate } from '../content/dsl/selectors.js';
import type { ContentFigureId, ContentPlateId, FigureUid, NodeId, PlayerId } from './ids.js';
import type { RngState } from './rng.js';
import type {
  BattleOutcome,
  GameResult,
  PendingDecision,
  Phase,
  ResolvedSegment,
  LingeringEffect,
  TransformReason,
} from './state.js';

/** Why a figure left the field. Surfaced by the rules inspector and read by triggers. */
export type KnockOutCause = 'battle' | 'surround' | 'effect';

export type BattleRole = 'attacker' | 'defender';

export interface DamageStage {
  readonly label: string;
  readonly kind: 'base' | 'add' | 'multiply' | 'floor';
  readonly amount: number;
  readonly running: number;
}

export type GameEvent =
  | { readonly kind: 'gameStarted'; readonly startingPlayer: PlayerId }
  | { readonly kind: 'phaseChanged'; readonly from: Phase; readonly to: Phase }
  | { readonly kind: 'turnBegan'; readonly player: PlayerId; readonly number: number }
  | { readonly kind: 'turnEnded'; readonly player: PlayerId }

  /** Emitted immediately before whatever consumed the draw. */
  | { readonly kind: 'rngAdvanced'; readonly rng: RngState }

  | { readonly kind: 'clockAdvanced'; readonly player: PlayerId; readonly ms: number; readonly remaining: number }

  // --- movement and zones ---------------------------------------------------
  | {
      readonly kind: 'figureDeployed';
      readonly uid: FigureUid;
      readonly entry: NodeId;
      readonly to: NodeId;
      readonly mpSpent: number;
    }
  | {
      readonly kind: 'figureMoved';
      readonly uid: FigureUid;
      readonly from: NodeId;
      readonly to: NodeId;
      readonly mpSpent: number;
    }
  /** Occupied figures crossed on the last MP path. Content-free: uids are already resolved. */
  | { readonly kind: 'pathCrossed'; readonly uid: FigureUid; readonly through: readonly FigureUid[] }
  /** Ultra Beast "treated as newly moved" — sets `movedOnTurn` without changing node. */
  | { readonly kind: 'movedFlagSet'; readonly uid: FigureUid; readonly turn: number }
  | {
      readonly kind: 'zoneChanged';
      readonly uid: FigureUid;
      readonly from: Zone;
      readonly to: Zone;
      /** Destination node when entering the field, else `null`. */
      readonly node: NodeId | null;
      /** Arrival order when entering the P.C., else `null`. Drives FIFO overflow. */
      readonly pcOrder: number | null;
    }
  | { readonly kind: 'figureKnockedOut'; readonly uid: FigureUid; readonly cause: KnockOutCause }
  | {
      readonly kind: 'figureExcluded';
      readonly uid: FigureUid;
      readonly returnOnTurn: number | null;
      readonly returnZone: Zone | null;
      readonly returnWhenUid?: FigureUid;
    }
  /** An attack note moved this figure. Bone Bearer reads it after the battle. */
  | { readonly kind: 'attackEffectMoved'; readonly uid: FigureUid }
  | { readonly kind: 'figureReturned'; readonly uid: FigureUid; readonly to: Zone }

  // --- the three state layers -----------------------------------------------
  | {
      readonly kind: 'conditionApplied';
      readonly uid: FigureUid;
      readonly condition: SpecialCondition;
      /** The condition this one replaced, since a new one replaces rather than stacks. */
      readonly replaced: SpecialCondition | null;
    }
  | { readonly kind: 'conditionCleared'; readonly uid: FigureUid; readonly condition: SpecialCondition }
  | {
      readonly kind: 'markerAttached';
      readonly uid: FigureUid;
      readonly marker: MarkerId;
      readonly value: number | null;
      readonly replaced: MarkerId | null;
    }
  | { readonly kind: 'markerCleared'; readonly uid: FigureUid; readonly marker: MarkerId }
  | { readonly kind: 'waitSet'; readonly uid: FigureUid; readonly from: number; readonly to: number }
  | { readonly kind: 'mpDeltaChanged'; readonly uid: FigureUid; readonly from: number; readonly to: number }
  | { readonly kind: 'tagged'; readonly uid: FigureUid; readonly target: FigureUid }
  | { readonly kind: 'chainLevelChanged'; readonly uid: FigureUid; readonly from: number; readonly to: number }
  | { readonly kind: 'wheelRotated'; readonly uid: FigureUid; readonly from: number; readonly to: number }
  /** Three abilities forbid their own figure from ever winning at the goal. */
  | { readonly kind: 'goalLockSet'; readonly uid: FigureUid; readonly locked: boolean }
  | { readonly kind: 'zGaugeChanged'; readonly player: PlayerId; readonly from: number; readonly to: number }
  | { readonly kind: 'platesLocked'; readonly player: PlayerId; readonly untilTurn: number | null }
  | {
      readonly kind: 'figureTransformed';
      readonly uid: FigureUid;
      readonly fromId: ContentFigureId;
      readonly toId: ContentFigureId;
      readonly reason: TransformReason;
    }
  | { readonly kind: 'megaStarted'; readonly uid: FigureUid; readonly player: PlayerId; readonly turns: number }
  | {
      readonly kind: 'wheelPatched';
      readonly uid: FigureUid;
      readonly moveName: string;
      readonly replacement: string;
      readonly expiresOnTurn: number | null;
      readonly fromColor?: 'white' | 'gold' | 'purple' | 'blue' | 'miss';
      readonly toColor?: 'white' | 'gold' | 'purple' | 'blue' | 'miss';
      readonly starDelta?: number;
      readonly exceptMoveNames?: readonly string[];
      readonly damage?: number;
    }
  | { readonly kind: 'lingeringAttached'; readonly uid: FigureUid; readonly effect: LingeringEffect }
  | { readonly kind: 'lingeringDropped'; readonly uid: FigureUid; readonly plateId: ContentPlateId }
  | {
      readonly kind: 'lingeringNamedLand';
      readonly uid: FigureUid;
      readonly name: string;
      readonly turn: number;
    }
  | {
      readonly kind: 'figureReset';
      readonly uid: FigureUid;
      readonly keepEvolution: boolean;
      readonly keepConditions: boolean;
      readonly toId: ContentFigureId;
    }
  | { readonly kind: 'plateMarkedUsed'; readonly player: PlayerId; readonly slot: number }
  | { readonly kind: 'platesAccounted'; readonly uid: FigureUid; readonly to: number }
  | { readonly kind: 'pcOrderChanged'; readonly uid: FigureUid; readonly from: number | null; readonly to: number }
  | {
      readonly kind: 'spinShiftArmed';
      readonly uid: FigureUid;
      readonly until: SpinPredicate;
      readonly expiresOnTurn: number | null;
    }
  | { readonly kind: 'timeTravelLocked'; readonly untilTurn: number | null }
  | { readonly kind: 'timeTravelRequested'; readonly uid: FigureUid }

  // --- battle ---------------------------------------------------------------
  | {
      readonly kind: 'battleStarted';
      readonly initiator: PlayerId;
      readonly attacker: FigureUid;
      readonly defender: FigureUid;
      readonly attackerWheel: readonly ResolvedSegment[];
      readonly defenderWheel: readonly ResolvedSegment[];
    }
  | {
      readonly kind: 'spun';
      readonly role: BattleRole;
      readonly uid: FigureUid;
      /** The raw 0..95 unit the wheel landed on, kept so a spin animation is exact. */
      readonly unit: number;
      readonly index: number;
      /** Shifted by Confusion, if it was. */
      readonly shiftedFrom: number | null;
    }
  /**
   * A spin outside a battle. 314 clauses make a group spin and 378 branch on the
   * result, and none of those are battle spins, so they cannot carry a battle role.
   */
  | {
      readonly kind: 'checkSpun';
      readonly uid: FigureUid;
      readonly unit: number;
      readonly index: number;
      readonly segment: ResolvedSegment;
    }
  | {
      readonly kind: 'battleLandedRewritten';
      readonly role: BattleRole;
      readonly moveName: string;
      readonly color: 'white' | 'gold' | 'purple' | 'blue' | 'miss';
      readonly damage: number | null;
      readonly stars: number | null;
    }
  | { readonly kind: 'respinGranted'; readonly role: BattleRole; readonly count: number }
  | { readonly kind: 'respinUsed'; readonly role: BattleRole; readonly remaining: number }
  /** A side gave up its remaining respins. Distinct from spending them all. */
  | { readonly kind: 'respinDeclined'; readonly role: BattleRole }
  | { readonly kind: 'multiplierAdvanced'; readonly role: BattleRole; readonly repeats: number }
  | {
      readonly kind: 'damageComputed';
      readonly role: BattleRole;
      readonly stages: readonly DamageStage[];
      readonly final: number | null;
    }
  | { readonly kind: 'battleResolved'; readonly outcome: BattleOutcome }
  | { readonly kind: 'battleEnded' }

  // --- board rules ----------------------------------------------------------
  | { readonly kind: 'surrounded'; readonly uid: FigureUid; readonly by: readonly FigureUid[] }
  | { readonly kind: 'goalReached'; readonly uid: FigureUid; readonly node: NodeId; readonly player: PlayerId }
  | {
      readonly kind: 'goalDenied';
      readonly uid: FigureUid;
      readonly node: NodeId;
      readonly reason: 'surroundFirst' | 'figureLocked';
    }

  // --- plates ---------------------------------------------------------------
  | { readonly kind: 'platePlayed'; readonly player: PlayerId; readonly slot: number; readonly plateId: ContentPlateId }
  | { readonly kind: 'plateRefreshed'; readonly player: PlayerId; readonly slot: number }

  // --- flow -----------------------------------------------------------------
  | { readonly kind: 'plateWindowClosed' }
  | { readonly kind: 'preSelectClosed' }
  | { readonly kind: 'preSelectOffered'; readonly uid: FigureUid }
  | { readonly kind: 'actionTaken'; readonly player: PlayerId; readonly uid: FigureUid | null }
  /** An `endTurn` action fired. 90 clauses end your turn as an effect, not as a phase. */
  | { readonly kind: 'turnForcedEnd' }
  /** "the next turn will always be the other player's" - overrides normal alternation. */
  | { readonly kind: 'nextTurnForced'; readonly player: PlayerId }
  | { readonly kind: 'battleDeclined'; readonly player: PlayerId }
  | { readonly kind: 'decisionRequested'; readonly decision: PendingDecision }
  | { readonly kind: 'decisionResolved'; readonly resumeToken: string }
  | { readonly kind: 'megaTicked'; readonly uid: FigureUid; readonly turnsLeft: number | null }
  /** A clause was cancelled by a nullifier before it ran. Recorded, not silent. */
  | {
      readonly kind: 'effectNullified';
      readonly source: FigureUid;
      readonly clauseId: string;
      readonly nullifier: FigureUid;
    }
  /** A `prevent` clause blocked something. `what` names the blocked category. */
  | { readonly kind: 'effectPrevented'; readonly uid: FigureUid; readonly what: string }
  /** Lombre Slippery and friends: the "just once" clause has been used. */
  | { readonly kind: 'onceSpent'; readonly uid: FigureUid }
  /** Once-per-turn forced respin was spent this turn. */
  | { readonly kind: 'forcedRespinSpent'; readonly uid: FigureUid; readonly turn: number }
  | { readonly kind: 'extraBattleGranted' }
  /** Route-move rider: this Pokémon counts as having already battled. */
  | { readonly kind: 'turnBattledSet' }
  /** First-battle tracker: this figure just finished a field battle. */
  | { readonly kind: 'fieldBattled'; readonly uid: FigureUid }
  | { readonly kind: 'extraBattleOpened' }
  /** Stamp the pending surround-escape resume with the mover that paused the check. */
  | { readonly kind: 'surroundResumeSet'; readonly uid: FigureUid; readonly node: NodeId | null }
  /** An "instead of an MP move" grant. The move itself still arrives as `figureMoved`. */
  | { readonly kind: 'movementGranted'; readonly uid: FigureUid; readonly spaces: number }
  | { readonly kind: 'gameEnded'; readonly result: GameResult };

export type GameEventKind = GameEvent['kind'];
