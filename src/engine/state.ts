/**
 * `GameState` - the one shape every other engine module reads and extends.
 *
 * Four decisions carry this design, and each is here to buy a specific property:
 *
 * 1. **The PRNG is a field, not a service.** `rng` sits in the state and every draw
 *    threads a new state through. This is what makes "same seed plus same commands
 *    gives the same duel" true by construction rather than by discipline, and it is
 *    what makes replays, server authority and AI rollouts the same mechanism.
 *
 * 2. **Everything is flat and keyed by id.** Figures live in one array indexed by
 *    instance id; a figure's location is a field on the figure. There is no separate
 *    board-occupancy array, because two representations of "who is where" is two
 *    chances to disagree, and the invariant "a figure is in exactly one zone" then
 *    holds by construction instead of by assertion. Occupancy is derived on demand -
 *    twelve figures make that free.
 *
 * 3. **No content in the state.** The state stores content *ids*; the 596 figures are
 *    injected once when the engine is created. That keeps the state small enough to
 *    hash on every step, keeps `src/engine/**` free of the content loader, and means a
 *    replay is a seed plus a command list rather than a snapshot of the card database.
 *
 * 4. **No event log in the state.** `dispatch` returns the events it emitted and the
 *    caller owns the log. Putting the log in the state would make the state grow
 *    without bound and would make the final-state hash depend on history rather than
 *    on position, which is the opposite of what a golden replay wants to assert. Celebi
 *    Time Travel rewinds the caller's log, which is what event sourcing is for.
 *
 * Everything is `readonly` and reducers return new objects. Nothing here is mutated.
 */
import { PC_CAPACITY } from '../rules/constants.js';
import type { Action, Condition, Trigger } from '../content/dsl/effects.js';
import type { SpecialCondition } from '../content/dsl/primitives.js';
import type { MarkerId } from '../content/dsl/primitives.js';
import type { Zone } from '../content/dsl/primitives.js';
import type { SpinPredicate } from '../content/dsl/selectors.js';
import type { ContentFigureId, ContentPlateId, FigureUid, NodeId, PlayerId } from './ids.js';
import type { RngState } from './rng.js';

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * The turn state machine, including all four turn-time windows the effect corpus
 * forces. Reading only the rules pages would have produced one window and a bug for
 * every ability that reads "at the start of your turn" or "before using this Pokemon".
 *
 * `plateWindow` comes before `action` in the order, which is how "a plate must precede
 * moving" is encoded - as a fact about the machine rather than as a check somebody has
 * to remember to write.
 *
 * Several of these are transient: the phase machine passes through them, emits the
 * `phaseChanged` event so the log reads honestly, and moves on without waiting. Only
 * `plateWindow`, `action`, `battleDecision`, `spin` and `respin` ever stop for input.
 */
export type Phase =
  | 'setup'
  /** Timers tick, exclusions expire, "at the start of your turn" abilities fire. */
  | 'turnStart'
  | 'plateWindow'
  /** The "before using this Pokemon" window. See the note in `phases.ts`. */
  | 'preSelect'
  | 'action'
  | 'surroundCheck'
  | 'battleDecision'
  | 'spin'
  | 'respin'
  | 'damageResolve'
  | 'turnEnd'
  | 'gameOver';

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export interface AttachedMarker {
  readonly id: MarkerId;
  /** Wait 3, MP -2; `null` for markers that carry no magnitude. */
  readonly value: number | null;
}

/**
 * One figure instance.
 *
 * The three independent state layers of docs/RULES.md section 5 are three separate
 * fields with three different lifetimes, and they are kept apart on purpose:
 * `condition` (max one, replaced not stacked, never expires), `wait` (a counter that
 * ticks on *both* players' turns), and `marker` (max one, cleared on leaving the
 * field). Folding any two together breaks real cards.
 */
export interface FigureState {
  readonly uid: FigureUid;
  readonly owner: PlayerId;
  readonly figureId: ContentFigureId;
  /** The deck figure this instance started as. Form / Mega / evolution change `figureId`. */
  readonly originFigureId: ContentFigureId;
  /** True after a successful `evolve` transform. Not inferred from evoStage. */
  readonly evolved: boolean;
  /** Successful evolve count this duel. Omitted at 0 so golden hashes stay still. */
  readonly evolutionCount?: number;
  /** Turn number a once-per-turn forced respin was spent. Omitted until used. */
  readonly forcedRespinOnTurn?: number;
  /** Content id to restore when a Mega timer expires. */
  readonly megaRevertsTo: ContentFigureId | null;
  /** "This Attack becomes a Miss" and friends — applied at wheel construction. */
  readonly wheelPatches: readonly WheelPatch[];
  /** "Shift the result clockwise until …" — applied after a spin lands. */
  readonly spinShifts: readonly SpinShift[];

  readonly zone: Zone;
  /** Non-null exactly when `zone === 'field'`. Checked by `assertStateInvariants`. */
  readonly node: NodeId | null;
  /** Last field node before leaving. Used by KO-claim landings. Omitted until they have left. */
  readonly lastFieldNode?: NodeId;

  /** Layer 1. At most one, and none wear off by themselves. */
  readonly condition: SpecialCondition | null;
  /** Layer 2. Ticks down on every turn including the opponent's. 0 means ready. */
  readonly wait: number;
  /** Layer 3. At most one, cleared on leaving the field. */
  readonly marker: AttachedMarker | null;

  /** Sum of every MP adjustment in force. Effective MP is base + this, clamped. */
  readonly mpDelta: number;

  /** Turns of Mega Evolution left, or `null` when not Mega Evolved. */
  readonly megaTurnsLeft: number | null;
  /** Absolute turn number this figure returns from temporary exclusion, or `null`. */
  readonly returnOnTurn: number | null;
  /** Return destination for a timed exclusion. */
  readonly returnZone: Zone | null;
  /** Desolate Land: return when this figure leaves the field. Omitted otherwise. */
  readonly returnWhenUid?: FigureUid;

  /** Monotonic arrival order in the P.C., so overflow is FIFO and not a choice. */
  readonly pcOrder: number | null;

  /** Three abilities forbid their own figure from ever winning at the goal. */
  readonly goalLocked: boolean;
  /** Turn number of the last MP move, for "newly moved" filters. */
  readonly movedOnTurn: number | null;
  /**
   * Battles finished since last field entry. Omitted at 0 so generic goldens stay still.
   * Only written for figures whose compiled text asks about the first-battle window.
   */
  readonly fieldBattles?: number;
  /** Hidden tiebreaker: adds `CHAIN_LEVEL_DAMAGE_PER_LEVEL` per level. */
  readonly chainLevel: number;
  /** "Shifts this Pokemon's Attacks two segments clockwise" - the Mawile line. */
  readonly wheelRotation: number;
  /** Timed plate/attack auras. Absent when none are attached. */
  readonly lingering?: readonly LingeringEffect[];
  /** "Just once" abilities. Omitted until spent so golden hashes stay still. */
  readonly onceSpent?: true;
  /** Plates this figure's attacks switched to used. Omitted until one is consumed. */
  readonly platesConsumed?: number;
}

/** A timed substitution of one printed move for another (usually Miss). */
export interface WheelPatch {
  readonly moveName: string;
  readonly replacement: string;
  /** Absolute turn number on which the patch is dropped at turn start; `null` lasts the duel. */
  readonly expiresOnTurn: number | null;
  readonly fromColor?: 'white' | 'gold' | 'purple' | 'blue' | 'miss';
  readonly toColor?: 'white' | 'gold' | 'purple' | 'blue' | 'miss';
  readonly starDelta?: number;
  readonly exceptMoveNames?: readonly string[];
  readonly damage?: number;
}

/** A plate or timed aura parked on a figure. Omitted when empty so golden hashes stay still. */
export interface LingeringEffect {
  readonly actions: readonly Action[];
  readonly expiresOnTurn: number | null;
  readonly controller: PlayerId;
  /** Delayed plate/ability hooks; omitted lingerings stay `passive` declarations. */
  readonly trigger?: Trigger;
  readonly when?: readonly Condition[];
  /** Set when a plate attached this lingering, so in-use nullify can find it. */
  readonly plateId?: ContentPlateId;
  /** Drop or retarget expiry when this figure lands on this printed attack. */
  readonly untilNamedLand?: string;
  readonly untilNamedLandEndOfTurn?: true;
  /** Drop when this figure finishes its first battle after entering the field. */
  readonly untilFirstBattleOf?: FigureUid;
}

/** A timed post-spin clockwise shift. */
export interface SpinShift {
  readonly until: SpinPredicate;
  readonly expiresOnTurn: number | null;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface PlateSlot {
  readonly plateId: ContentPlateId;
  /** Each plate is usable once per duel unless its own text makes it resettable. */
  readonly used: boolean;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly plates: readonly PlateSlot[];
  /** Milliseconds left on this player's chess clock. Time enters only via commands. */
  readonly clockMs: number;
  /** Z-Move charge, manipulable in both directions. */
  readonly zGauge: number;
  readonly megaUsed: boolean;
  /** Set by Intimidating Aura and friends; `null` means plates are available. */
  readonly platesLockedUntilTurn: number | null;
}

// ---------------------------------------------------------------------------
// Turn
// ---------------------------------------------------------------------------

export interface TurnState {
  readonly player: PlayerId;
  /**
   * Individual player-turns, 1-based, matching `TURN_LIMIT_COUNTING = 'playerTurns'`.
   * Nothing compares this against a literal 300; the cap comes from the constant.
   */
  readonly number: number;
  readonly platePlayed: boolean;
  /** Latches once a figure moves. Encodes "a plate must precede moving". */
  readonly plateWindowClosed: boolean;
  readonly moved: boolean;
  readonly battled: boolean;
  /**
   * The figure that took this turn's movement (MP-walk or deploy). Battle
   * initiation locks to that figure; if it has no adjacent fight the turn ends.
   */
  readonly movedUid: FigureUid | null;
  /** Occupied figures the last MP path crossed. Cleared at turn start. */
  readonly lastPassedThrough?: readonly FigureUid[];
  /** Figures an attack note moved this turn. Omitted until one is. */
  readonly attackMovedUids?: readonly FigureUid[];
  /** Set by an `endTurn` action so the phase machine stops offering further windows. */
  readonly forcedEnd: boolean;
  /** One extra battle window after the current battle. Omitted until granted. */
  readonly extraBattle?: true;
  /** Latches after the preSelect window has been offered once this turn. */
  readonly preSelectClosed?: true;
  /** Figures whose "Before using this Pokémon" ability already fired this turn. */
  readonly preSelectOffered?: readonly FigureUid[];
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

/**
 * A wheel segment after construction hooks have run.
 *
 * This is not the content `WheelSegment`: burn and paralysis rewrite the smallest
 * non-Miss segment to a Miss, substitution hooks replace whole moves, and recolouring
 * hooks change the colour. Resolving those into a per-battle wheel means the spin step
 * reads one flat array and the rules that produced it are auditable afterwards.
 */
export interface ResolvedSegment {
  readonly size: number;
  readonly moveName: string;
  readonly color: 'white' | 'gold' | 'purple' | 'blue' | 'miss';
  readonly damage: number | null;
  readonly stars: number | null;
  /** True when damage is a repeat-until-miss multiplier rather than a flat number. */
  readonly isMultiplier: boolean;
  /** Index into the figure's base wheel, so effects can name the original segment. */
  readonly sourceIndex: number;
  /** Which construction hooks touched this segment; surfaced by the rules inspector. */
  readonly notes: readonly string[];
}

export interface BattleSide {
  readonly uid: FigureUid;
  readonly wheel: readonly ResolvedSegment[];
  readonly landedIndex: number | null;
  /** Previous landing, so "same Attack both times" can compare. */
  readonly priorLandedIndex: number | null;
  /** Stacking, not a boolean: Impermeable Mail and King Horn each add +1 spin. */
  readonly respinsRemaining: number;
  /** Tally for the repeat-until-miss multiplier loop. */
  readonly repeatCount: number;
  /** Damage after the ordered additive and multiplicative stages. */
  readonly finalDamage: number | null;
}

export type BattleWinner = 'attacker' | 'defender' | null;

export interface BattleOutcome {
  readonly winner: BattleWinner;
  /** Which colour decided it, for the rules inspector and for effect gating. */
  readonly decidedBy: 'blue' | 'gold' | 'purple' | 'white' | 'damage' | 'stars' | 'miss' | 'draw';
  readonly reason: string;
}

export interface BattleState {
  /** Trigger resolution starts with this player. */
  readonly initiator: PlayerId;
  readonly attacker: BattleSide;
  readonly defender: BattleSide;
  readonly outcome: BattleOutcome | null;
}

// ---------------------------------------------------------------------------
// Pending decisions
// ---------------------------------------------------------------------------

/**
 * A choice the *player* has to make in the middle of resolution.
 *
 * 79 clauses read "You may ..." and a further 81 bind a chosen target that later
 * clauses refer back to. Auto-resolving those would have the engine quietly play the
 * game for the user, so they surface as a pending decision and the phase machine
 * refuses to advance until it is answered.
 */
export type TransformReason = 'evolve' | 'form' | 'mega' | 'megaEnd';

/**
 * How to continue a clause after the player answers.
 *
 * Stored on the pending decision (and therefore on the event log) so a replay can
 * resume without a hidden continuation table.
 */
export interface DecisionResume {
  readonly source: FigureUid;
  readonly controller: PlayerId;
  readonly remaining: readonly Action[];
  readonly then: readonly Action[];
  readonly bind: 'antecedent' | 'nodes' | 'none';
  /** Figures already chosen in a prior pending step of the same clause (fuse host). */
  readonly bound?: readonly FigureUid[];
  /**
   * Surround check paused for an escape optional. After the decision, finish KOs / goal
   * for this mover without asking the escape again.
   */
  readonly afterSurround?: { readonly uid: FigureUid; readonly node: NodeId | null };
}

export interface PendingDecision {
  readonly kind: 'optionalAction' | 'chooseFigures' | 'chooseNode' | 'choosePlate';
  readonly chooser: PlayerId;
  readonly prompt: string;
  readonly figureOptions: readonly FigureUid[];
  readonly nodeOptions: readonly NodeId[];
  readonly slotOptions: readonly number[];
  readonly minCount: number;
  readonly maxCount: number;
  /** Opaque token the resolver uses to resume the interrupted clause. */
  readonly resumeToken: string;
  readonly resume: DecisionResume;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type WinReason =
  | 'goal'
  | 'surroundGoalDenied'
  | 'waitVictory'
  | 'clock'
  | 'turnLimit'
  | 'concede';

export interface GameResult {
  /** `null` is a genuine draw, which `TURN_LIMIT_OUTCOME = 'draw'` can produce. */
  readonly winner: PlayerId | null;
  readonly reason: WinReason;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

export interface GameState {
  /** Bumped whenever the shape changes, so an old replay fails loudly, not subtly. */
  readonly version: 2;
  readonly rng: RngState;
  readonly phase: Phase;
  readonly turn: TurnState;
  readonly players: readonly [PlayerState, PlayerState];
  /** Indexed by `FigureUid`: `figures[uid].uid === uid` for every entry. */
  readonly figures: readonly FigureState[];
  readonly battle: BattleState | null;
  readonly pending: PendingDecision | null;
  readonly result: GameResult | null;
  readonly startingPlayer: PlayerId;
  /**
   * Celebi Time Travel lockout. Absolute turn number until which neither player may
   * activate Time Travel; `null` means the ability is available.
   */
  readonly timeTravelLockedUntilTurn: number | null;
  /**
   * Set by a `forceNextTurn` action and consumed by the next `turnBegan`.
   *
   * It lives on the state rather than on the turn because it outlives the turn that
   * set it - that is the entire mechanic - and a field on `TurnState` would be wiped by
   * the very transition it is supposed to steer.
   */
  readonly forcedNextPlayer: PlayerId | null;
  /** Monotonic counter handing out `pcOrder`, so FIFO survives serialisation. */
  readonly pcCounter: number;
  /**
   * Clauses the coverage registry could not implement on figures in this duel.
   *
   * Empty unless the game was created with `allowUnimplemented`, which is off by
   * default. It is recorded rather than dropped so a UI can badge an affected figure
   * and nobody can later claim the duel was played at full fidelity.
   */
  readonly unimplementedClauses: readonly string[];
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Throwing lookup. `noUncheckedIndexedAccess` is on, and `!` is banned, so this earns its keep. */
export function figureOf(state: GameState, uid: FigureUid): FigureState {
  const figure = state.figures[uid];
  if (figure === undefined) throw new EngineError(`no figure with uid ${uid}`);
  return figure;
}

export function playerOf(state: GameState, id: PlayerId): PlayerState {
  return state.players[id];
}

export function fieldFigures(state: GameState): readonly FigureState[] {
  return state.figures.filter((f) => f.zone === 'field');
}

/** Derived, never stored: one representation of "who is where" cannot disagree with itself. */
export function occupancy(state: GameState): Map<NodeId, FigureUid> {
  const map = new Map<NodeId, FigureUid>();
  for (const figure of state.figures) {
    if (figure.zone === 'field' && figure.node !== null) map.set(figure.node, figure.uid);
  }
  return map;
}

export function occupiedNodes(state: GameState): Set<NodeId> {
  return new Set(occupancy(state).keys());
}

export function figureAt(state: GameState, node: NodeId): FigureState | null {
  for (const figure of state.figures) {
    if (figure.zone === 'field' && figure.node === node) return figure;
  }
  return null;
}

export function pcFigures(state: GameState, player: PlayerId): readonly FigureState[] {
  return state.figures
    .filter((f) => f.owner === player && f.zone === 'pc')
    .sort((a, b) => (a.pcOrder ?? 0) - (b.pcOrder ?? 0));
}

export const isOver = (state: GameState): boolean => state.result !== null;

/**
 * The invariants the fuzz harness will assert 10,000 times and that are cheap enough to
 * assert in every test now. Returns problems rather than throwing so a caller can
 * report all of them at once.
 */
export function stateProblems(state: GameState): string[] {
  const problems: string[] = [];
  const seenNodes = new Map<NodeId, FigureUid>();

  state.figures.forEach((figure, index) => {
    if (figure.uid !== index) problems.push(`figures[${index}] has uid ${figure.uid}`);
    if (figure.zone === 'field' && figure.node === null) {
      problems.push(`figure ${figure.uid} is on the field with no node`);
    }
    if (figure.zone !== 'field' && figure.node !== null) {
      problems.push(`figure ${figure.uid} is in ${figure.zone} but still holds node ${figure.node}`);
    }
    if (figure.node !== null) {
      const other = seenNodes.get(figure.node);
      if (other !== undefined) problems.push(`figures ${other} and ${figure.uid} share node ${figure.node}`);
      seenNodes.set(figure.node, figure.uid);
    }
    if (figure.wait < 0) problems.push(`figure ${figure.uid} has negative wait ${figure.wait}`);
    if (figure.marker !== null && figure.zone !== 'field' && figure.zone !== 'ultraSpace') {
      problems.push(`figure ${figure.uid} kept marker ${figure.marker.id} after leaving the field`);
    }
    if (figure.zone !== 'pc' && figure.pcOrder !== null) {
      problems.push(`figure ${figure.uid} is in ${figure.zone} but holds a pcOrder`);
    }
  });

  for (const player of [0, 1] as const) {
    const inPc = state.figures.filter((f) => f.owner === player && f.zone === 'pc');
    if (inPc.length > PC_CAPACITY) {
      problems.push(`player ${player} has ${inPc.length} figures in the P.C.; capacity is ${PC_CAPACITY}`);
    }
    if (state.players[player].clockMs < 0) problems.push(`player ${player} has a negative clock`);
  }

  if (state.turn.number < 0) problems.push(`turn number is ${state.turn.number}`);
  if (state.result !== null && state.phase !== 'gameOver') {
    problems.push(`game has a result but the phase is ${state.phase}`);
  }
  return problems;
}

export function assertStateInvariants(state: GameState): void {
  const problems = stateProblems(state);
  if (problems.length > 0) {
    throw new EngineError(`state invariants violated:\n  ${problems.join('\n  ')}`);
  }
}
