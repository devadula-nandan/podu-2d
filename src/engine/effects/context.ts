/**
 * Everything a clause is allowed to see while it resolves.
 *
 * A clause is a pure function of this context. That is not a stylistic preference: the
 * two-clause spin idiom ("All opposing Pokemon spin." / "Those that spin White Attacks
 * move to the bench.") is 314 clauses feeding 378 follow-ups, and the only alternative
 * to threading `spunResults` explicitly is ambient mutable state between clauses -
 * which would make replay and AI rollout unsound in a way that is very hard to detect.
 */
import type { Trigger } from '../../content/dsl/effects.js';
import type { SegmentColor, SpecialCondition } from '../../content/dsl/primitives.js';
import type { ResolvedSegment } from '../state.js';
import type { GameState } from '../state.js';
import type { BoardGraph } from '../board/graph.js';
import type { EngineContent } from '../content.js';
import type { ContentPlateId, FigureUid, PlayerId } from '../ids.js';

/** The immutable dependencies every engine call carries. */
export interface EngineDeps {
  readonly content: EngineContent;
  readonly board: BoardGraph;
}

export interface EffectContext {
  readonly state: GameState;
  readonly deps: EngineDeps;
  /** The figure whose clause is running. `self` resolves to this. */
  readonly source: FigureUid;
  /** Whoever controls the clause. Drives `ally` / `opposing`. */
  readonly controller: PlayerId;
  /** Non-null only inside a battle. */
  readonly battleOpponent: FigureUid | null;
  /** Bound by a preceding `select`, or by the enclosing spin check. */
  readonly antecedent: readonly FigureUid[];
  /** Results of the most recent spin check, keyed by the figure that spun. */
  readonly spunResults: ReadonlyMap<FigureUid, ResolvedSegment>;
  /** Set after an `optional` is accepted; read by `precedingActionTaken`. */
  readonly precedingActionTaken: boolean;
  /** The move currently resolving, so `replaceSegment` knows which attack to rewrite. */
  readonly activeMoveName: string | null;
  /** Plate name, when a plate is the source of the clause (Mega Stone X/Y). */
  readonly plateHint: string | null;
  /** Plate id, when a plate is attaching lingerings. */
  readonly plateId: ContentPlateId | null;
  /** Name of the plate that just resolved, for `onPlatePlayed` guards. */
  readonly lastPlayedPlate: string | null;
  /** Trigger that launched this clause. Attack-note KOs are `onAttackResolve`. */
  readonly clauseTrigger: Trigger | null;
  /** Colour of the move currently resolving, for White-only status prevention. */
  readonly activeMoveColor: SegmentColor | null;
  /** Synchronize: the condition that just landed on the source. */
  readonly receivedCondition: SpecialCondition | null;
  /** Synchronize: who applied that condition. */
  readonly conditionCauser: FigureUid | null;
}

export function withState(ctx: EffectContext, state: GameState): EffectContext {
  return { ...ctx, state };
}

export function withAntecedent(ctx: EffectContext, antecedent: readonly FigureUid[]): EffectContext {
  return { ...ctx, antecedent };
}

export function withSpunResults(
  ctx: EffectContext,
  spunResults: ReadonlyMap<FigureUid, ResolvedSegment>,
): EffectContext {
  return { ...ctx, spunResults };
}

export function withPreceding(ctx: EffectContext, precedingActionTaken: boolean): EffectContext {
  return { ...ctx, precedingActionTaken };
}

export function withActiveMove(ctx: EffectContext, activeMoveName: string | null): EffectContext {
  return { ...ctx, activeMoveName };
}

export function withPlateHint(ctx: EffectContext, plateHint: string | null): EffectContext {
  return { ...ctx, plateHint };
}

export function withPlateId(ctx: EffectContext, plateId: ContentPlateId | null): EffectContext {
  return { ...ctx, plateId };
}

export function withLastPlayedPlate(ctx: EffectContext, lastPlayedPlate: string | null): EffectContext {
  return { ...ctx, lastPlayedPlate };
}

export function baseContext(
  state: GameState,
  deps: EngineDeps,
  source: FigureUid,
  controller: PlayerId,
): EffectContext {
  const battle = state.battle;
  const battleOpponent = battle === null
    ? null
    : battle.attacker.uid === source
      ? battle.defender.uid
      : battle.defender.uid === source
        ? battle.attacker.uid
        : null;
  return {
    state,
    deps,
    source,
    controller,
    battleOpponent,
    antecedent: [],
    spunResults: new Map(),
    precedingActionTaken: false,
    activeMoveName: null,
    plateHint: null,
    plateId: null,
    lastPlayedPlate: null,
    clauseTrigger: null,
    activeMoveColor: null,
    receivedCondition: null,
    conditionCauser: null,
  };
}
