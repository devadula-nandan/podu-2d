import type {
  ClauseId, Comparison, MarkerId, PokemonType, SegmentColor, SpecialCondition, Zone,
} from './primitives.js';
import type { Chooser, Filter, Selector, SpinPredicate } from './selectors.js';

/**
 * When a clause fires.
 *
 * These are triggers, not guards, and conflating the two was the trap here. 69 clauses
 * read "If this Pokemon is knocked out, the battle opponent becomes burned" - that is
 * not a condition evaluated when the attack resolves, it is a subscription to a future
 * event. Modelling it as a guard would make it never fire, because by the time it were
 * checked the figure would already be gone.
 */
export type Trigger =
  /** Default for wheel segments: the attack landed and is resolving. */
  | 'onAttackResolve'
  /** "If this Pokemon is knocked out, ..." - 69 clauses across the corpus. */
  | 'onSelfKnockedOut'
  /** "If the battle opponent is knocked out, ..." - 74 clauses. */
  | 'onOpponentKnockedOut'
  /** "When this Pokemon is attacked, ..." */
  | 'onAttacked'
  /** "after battle" / "after the battle" - 139 clauses. */
  | 'afterBattle'
  | 'beforeBattle'
  | 'duringBattle'
  /** "at the start of your turn" - 35 clauses. */
  | 'startOfTurn'
  | 'endOfTurn'
  /** "after making an MP move" - movement-triggered abilities. */
  | 'afterMove'
  /** Moving in from the bench, which several entry abilities restrict or extend. */
  | 'onEnterField'
  /** "whenever this Pokémon moves from the P.C. to the bench". */
  | 'onPcToBench'
  /** Named-figure KO hooks on plates (Gracidea, Meteoric Teachings). */
  | 'onFigureKnockedOut'
  /** Reveal Glass recycle: opponent played a plate. */
  | 'onPlatePlayed'
  /** Phantom Energy: a surround just resolved. */
  | 'onSurrounded'
  /** Plate-return attacks: the source figure left the field. */
  | 'onLeaveField'
  /** "if Sweet Scent is spun on the field" — fires for PC figures too. */
  | 'onNamedSpin'
  /** Homeward Lights: as the Mega form appears. */
  | 'onMegaStart'
  /** Homeward Lights: as the Mega form reverts, while it is still the Mega. */
  | 'onMegaEnd'
  /** Synchronize: this figure just received a special condition. */
  | 'onConditionApplied'
  /**
   * Always on while its source is present. "While/when/if this Pokemon is on the field"
   * accounts for 174 clauses and is the whole reason the engine needs a layered,
   * nullification-aware hook bus rather than a simple event emitter.
   */
  | 'passive'
  /**
   * Not an effect at all: a precondition on playing the card. "This plate can be used
   * when none of your Pokemon are Mega Evolved" is the single most common uncompiled
   * clause at 33 occurrences. It belongs to the plate's playability check, so the
   * loader hoists these out of the effect list rather than running them.
   */
  | 'usageRestriction';

/** How long an applied effect survives. */
export type Duration =
  /** Resolves immediately and leaves no state behind. */
  | { readonly kind: 'instant' }
  /** "for 7 turns" (Mega Evolution), "returning to the bench 7 turns later". */
  | { readonly kind: 'turns'; readonly count: number }
  | { readonly kind: 'untilEndOfTurn' }
  /** "until the end of your next turn" - 15 clauses. */
  | { readonly kind: 'untilEndOfNextTurn' }
  /** "until the end of the duel" - 22 clauses. */
  | { readonly kind: 'untilEndOfDuel' }
  /**
   * "until one of your opponent's Pokemon is knocked out by a Steel-type Pokemon".
   * An open-ended predicate the engine re-checks; 11 clauses need it.
   */
  | { readonly kind: 'untilTrigger'; readonly trigger: Trigger; readonly where: readonly Filter[] }
  /**
   * Techno Blast: +50 until the next land on a named attack. `endOfThatTurn` keeps the
   * boost through the turn that lands, then drops it.
   */
  | { readonly kind: 'untilNamedLand'; readonly name: string; readonly endOfThatTurn?: boolean }
  /** Drops when the source finishes its first battle after entering the field. */
  | { readonly kind: 'untilFirstBattle' };

export const instant = (): Duration => ({ kind: 'instant' });

/** Where a `Move` action puts its target. */
export type Destination =
  | { readonly kind: 'zone'; readonly zone: Zone }
  /** "moves to a point 3 steps away" - 77 + 54 clauses for 3 and 2 steps. */
  | { readonly kind: 'pointStepsAway'; readonly steps: number; readonly chooser: Chooser }
  /** "is knocked 1 step back (the opponent chooses the point)" - direction is away from the attacker. */
  | {
      readonly kind: 'knockBack';
      readonly steps: number;
      readonly chooser: Chooser;
      /** "Any Pokémon it collides with are also knocked back." */
      readonly collide?: boolean;
    }
  /** "jumps over the battle opponent and lands 1-2 steps away". */
  | { readonly kind: 'jumpOver'; readonly over: Selector; readonly minSteps: number; readonly maxSteps: number }
  /** "switches places with its battle opponent" - a swap, so both figures move. */
  | { readonly kind: 'swapWith'; readonly with: Selector }
  /** "moves to a spot beyond the battle opponent" — the first empty node on the far ray. */
  | { readonly kind: 'beyond'; readonly over: Selector; readonly chooser: Chooser }
  /** "your entry point", used by the bench-entry abilities. */
  | { readonly kind: 'entryPoint' }
  /** "an open spot next to an adjacent figure". */
  | { readonly kind: 'openSpotAdjacentTo'; readonly of: Selector; readonly chooser: Chooser }
  /** "move it to your goal point if it is open". */
  | { readonly kind: 'goal' }
  /** "to one space away from your entry point". */
  | { readonly kind: 'adjacentToOwnEntry'; readonly chooser: Chooser }
  /** Metang: "to a point not more than 1 or 2 steps away from this Pokémon". */
  | {
      readonly kind: 'pointWithinSteps';
      readonly min: number;
      readonly max: number;
      readonly of: Selector;
      readonly chooser: Chooser;
    }
  /** "drawn 1-2 steps closer to this Pokémon". */
  | {
      readonly kind: 'drawCloser';
      readonly min: number;
      readonly max: number;
      readonly toward: Selector;
      readonly chooser: Chooser;
    }
  /** "may be moved within their MP range". */
  | { readonly kind: 'withinMpRange'; readonly chooser: Chooser }
  /** "moves to the point the battle opponent was on" after that figure left the field. */
  | { readonly kind: 'vacatedBy'; readonly of: Selector }
  /** "to a point of your choosing on the field". */
  | { readonly kind: 'anyOpenField'; readonly chooser: Chooser }
  /**
   * Route move: a landing that is N steps away, optionally adjacent to a set and/or
   * restricted to a straight line. Not a leap grant — the clause moves once.
   */
  | {
      readonly kind: 'route';
      readonly minSteps: number;
      readonly maxSteps: number;
      readonly straight: boolean;
      readonly adjacentTo?: Selector;
      readonly chooser: Chooser;
    }
  /** Come Here: each target lands on its own owner's open entry. */
  | { readonly kind: 'respectiveEntry' }
  /**
   * Electric succession: land on an open point adjacent to the Electric chain
   * starting from an adjacent Electric figure.
   */
  | { readonly kind: 'beyondSuccession'; readonly types: readonly PokemonType[]; readonly chooser: Chooser };

/** What a damage modifier does. */
export type DamageModifier
  /** "deals +50 damage" - 51+29+27+23 clauses across the common values. */
  = | { readonly kind: 'flat'; readonly amount: number }
  /** "Damage Attacks deal x2 damage" - 17 clauses. */
  | { readonly kind: 'multiply'; readonly factor: number }
  /**
   * "damage is multiplied by the number of Pin Missile spins" AND "by the number of
   * your own Pokemon". The multiplier is a count of something, and that something is
   * sometimes a spin tally and sometimes a board query - so it takes a selector, not
   * just a number. Missing this would have hard-coded 6 clauses into the wrong shape.
   */
  | { readonly kind: 'multiplyByCount'; readonly of: CountSource }
  /** "damage is boosted by N for each Pokémon in your P.C." */
  | { readonly kind: 'flatByCount'; readonly amount: number; readonly of: CountSource }
  /** "takes no damage" - 13 clauses. */
  | { readonly kind: 'none' }
  /**
   * "boosted by the amount of any Attack damage increases from the battle opponent's
   * Ability". The amount is queried from the opponent's live ability flats, not guessed.
   */
  | { readonly kind: 'copyAbilityIncreases'; readonly from: Selector };

export type CountSource =
  /** Tally from the enclosing repeat-until-miss loop. */
  | { readonly kind: 'spinRepeats' }
  | { readonly kind: 'figures'; readonly of: Selector }
  /** "repeats for each time this Pokémon has evolved". */
  | { readonly kind: 'evolutionCount'; readonly of: Selector };

/** Things an effect can forbid. Drawn from the 114 "cannot"/"prevent" clauses. */
export type Preventable =
  | 'beKnockedOut'
  | 'beMoved'
  | 'gainConditions'
  | 'usePlates'
  | 'attack'
  | 'mpMove'
  | 'evolve'
  | 'megaEvolve'
  | 'spinAgain'
  | 'gainWait'
  | 'gainMarkers'
  | 'beSurrounded'
  | 'surround'
  | 'beSurroundedByUltraBeasts'
  | 'namedEffect'
  | 'beTagged'
  | 'loseConditions'
  /** Instant KOs from attack notes, not battle-damage or surround KOs. */
  | 'instantKoFromAttacks'
  /** Attack notes that make this figure spin or respin. Abilities still can. */
  | 'spinFromAttacks'
  /** Battle KOs whose winning segment is Gold. White / surround / notes still kill. */
  | 'goldAttackKo'
  /** Ability form changes. Evolution and Mega still go through. */
  | 'changeForm'
  /** Air Lock: do not send this figure to Ultra Space by opposing effects. */
  | 'moveToUltraSpace'
  /** Primordial Sea: Ultra Beasts do not leave Ultra Space by effects. */
  | 'leaveUltraSpace'
  /** Mega duration does not tick down. */
  | 'megaTick'
  /** Blue Attacks are not rewritten / recoloured off the wheel. */
  | 'recolorAttacks';

/** Movement permissions an ability can grant. These modify pathfinding, not position. */
export type MovementGrant = 'throughOthers' | 'overOthers' | 'underOthers' | 'extraStep';

/** Guards. Distinct from `Trigger`: these ask "is it true now", not "has it happened". */
export type Condition =
  | { readonly kind: 'targetExists'; readonly selector: Selector }
  | { readonly kind: 'targetCount'; readonly selector: Selector; readonly op: Comparison; readonly value: number }
  | { readonly kind: 'hasCondition'; readonly target: Selector; readonly conditions: readonly SpecialCondition[] }
  | { readonly kind: 'hasType'; readonly target: Selector; readonly types: readonly PokemonType[] }
  | { readonly kind: 'inZone'; readonly target: Selector; readonly zones: readonly Zone[] }
  | { readonly kind: 'mp'; readonly target: Selector; readonly op: Comparison; readonly value: number }
  /** "If the battle opponent's Attack is 120 damage or higher" - 21 clauses. */
  | { readonly kind: 'spun'; readonly target: Selector; readonly match: SpinPredicate }
  | { readonly kind: 'isMegaEvolved'; readonly target: Selector; readonly value: boolean }
  /** "If it does" - chains off whether the preceding optional action was taken. */
  | { readonly kind: 'precedingActionTaken' }
  | { readonly kind: 'hasMarker'; readonly target: Selector; readonly marker: MarkerId }
  | { readonly kind: 'hasWait'; readonly target: Selector }
  | { readonly kind: 'mpCompare'; readonly left: Selector; readonly op: Comparison; readonly right: Selector }
  | { readonly kind: 'isEvolved'; readonly target: Selector; readonly value: boolean }
  | { readonly kind: 'hasChangedForm'; readonly target: Selector }
  | { readonly kind: 'battleTied' }
  | { readonly kind: 'isTurnPlayer'; readonly who: 'controller' | 'opponent' }
  | { readonly kind: 'atEntryPoint'; readonly target: Selector }
  | {
      readonly kind: 'entryPointsFilled';
      readonly whose: 'controller' | 'opponent';
      readonly by: 'ally' | 'opposing';
    }
  | { readonly kind: 'usingPlate'; readonly name: string }
  /** Origin figure's printed name, for "has changed its form from Necrozma". */
  | { readonly kind: 'changedFormFrom'; readonly target: Selector; readonly names: readonly string[] }
  /** The plate that just fired `onPlatePlayed`. */
  | { readonly kind: 'plateJustPlayed'; readonly name: string; readonly match: 'eq' | 'ne' }
  /** The bound antecedent's printed name. */
  | { readonly kind: 'antecedentNamed'; readonly names: readonly string[] }
  /** "if the opponent's Attack deals more than half the damage that this Pokémon's Attack deals". */
  | { readonly kind: 'opponentDamageVsSelf'; readonly op: Comparison; readonly fraction: number }
  /** "If it passes through Poisoned, noxious, or sleeping Pokémon". */
  | { readonly kind: 'passedThrough'; readonly conditions: readonly SpecialCondition[] }
  /** "a Water Pokémon that does not have any other types". */
  | { readonly kind: 'exclusiveType'; readonly target: Selector; readonly type: PokemonType }
  /** "if the battle opponent spins the same Attack both times". */
  | { readonly kind: 'sameAttackBothTimes'; readonly target: Selector }
  | { readonly kind: 'pcHasSpace'; readonly whose: 'controller' | 'opponent' }
  | { readonly kind: 'goalOpen'; readonly whose: 'controller' | 'opponent' }
  /** The source figure just won the current battle. */
  | { readonly kind: 'isBattleWinner' }
  /** A named attack was just spun, anywhere in the current spin set. */
  | { readonly kind: 'namedAttackSpun'; readonly names: readonly string[] }
  /**
   * First-battle-after-moving window.
   * `untilEngage` is before the first battle; `during`/`untilEnd` cover that battle;
   * `after` is the afterBattle hook of that same first fight.
   */
  | {
      readonly kind: 'firstBattleAfterMoving';
      readonly target: Selector;
      readonly phase: 'untilEngage' | 'during' | 'untilEnd' | 'after';
    }
  /** Synchronize / Floating Candle: the condition that just landed. */
  | { readonly kind: 'appliedCondition'; readonly conditions: readonly SpecialCondition[] }
  /** Nebby's Power: a named evolution target exists in sourced text. */
  | { readonly kind: 'canEvolve'; readonly target: Selector; readonly value: boolean }
  /** Punishment*: live +damage modifiers or ability flats. */
  | { readonly kind: 'hasDamageIncrease'; readonly target: Selector }
  /** Bone Bearer: this figure's attack note just moved the battle opponent. */
  | { readonly kind: 'attackMovedOpponent' }
  /** Electric Mat: someone else's MP path crossed this figure. */
  | { readonly kind: 'passedOverSelf' }
  | { readonly kind: 'anyOf'; readonly of: readonly Condition[] }
  | { readonly kind: 'allOf'; readonly of: readonly Condition[] }
  | { readonly kind: 'not'; readonly of: Condition }
  | { readonly kind: 'unimplemented'; readonly text: string };

/**
 * The action primitives. Every one is present in the corpus; the comments carry the
 * observed clause counts so the coverage of each is auditable.
 */
export type Action =
  /** "becomes confused" and friends - the single largest family. */
  | { readonly do: 'applyCondition'; readonly target: Selector; readonly condition: SpecialCondition }
  /** "Removes all special conditions from your Pokemon" - 62 clauses. */
  | {
      readonly do: 'cureConditions';
      readonly target: Selector;
      /** Empty means all. */
      readonly conditions: readonly SpecialCondition[];
    }
  /** Covers Wait, the MP markers, and the 19+ named markers uniformly. */
  | {
      readonly do: 'attachMarker';
      readonly target: Selector;
      readonly marker: MarkerId;
      /** Wait 3, MP -2; `null` for markers that carry no magnitude. */
      readonly value: number | null;
      readonly duration: Duration;
    }
  | { readonly do: 'removeMarker'; readonly target: Selector; readonly marker: MarkerId }
  /** "Knocks out the battle opponent" - 370 + 62 + 45 clauses. */
  | { readonly do: 'knockOut'; readonly target: Selector }
  /**
   * "temporarily excluded from the duel, returning to the bench 7 turns later" (50) and
   * the permanent "excluded from the duel" (42). The Ultra Space variant routes there
   * instead of the bench, which is why the return zone is explicit.
   */
  | {
      readonly do: 'exclude';
      readonly target: Selector;
      readonly returnTo: Zone | null;
      readonly returnAfterTurns: number | null;
      /** Desolate Land: return when the excluding figure leaves the field. */
      readonly returnWhenSourceLeaves?: true;
    }
  | { readonly do: 'move'; readonly target: Selector; readonly to: Destination }
  /**
   * The two-clause spin idiom, made structural.
   *
   * 314 clauses make a group spin and 378 follow-up clauses branch on the outcome
   * ("Those that spin White Attacks move to the bench"). Leaving those as sibling
   * clauses would force ambient mutable state between them; nesting the follow-ups as
   * children keeps every clause a pure function of its own inputs, which is what makes
   * replay determinism and AI rollout safe.
   */
  | { readonly do: 'spinCheck'; readonly target: Selector; readonly then: readonly Clause[] }
  /**
   * "Spin again until Pin Missile does not land" (repeat-until-miss, 44 segments) and
   * "Spin again until an Attack other than Dragon Dance is spun". Control flow, not a
   * damage modifier.
   */
  | {
      readonly do: 'respin';
      readonly until: SpinPredicate;
      readonly max: number | null;
      /** Power Battle: both sides must spin again. Not an optional one-side respin. */
      readonly forced?: boolean;
      readonly who?: 'self' | 'both' | 'opponent';
      /** "once a turn" / "only once per turn" forced respins. */
      readonly oncePerTurn?: boolean;
    }
  | {
      readonly do: 'modifyDamage';
      readonly target: Selector;
      readonly modifier: DamageModifier;
      readonly duration: Duration;
      /** Ember / named-move boosts: only while this printed attack is resolving. */
      readonly named?: string;
    }
  | {
      readonly do: 'modifyMp';
      readonly target: Selector;
      readonly delta: number;
      readonly duration: Duration;
      /** Live count query. Queried, not snapshotted into `mpDelta`. */
      readonly of?: CountSource;
      /** Cap on resulting MP ("to a maximum of MP4"). */
      readonly cap?: number;
    }
  | {
      readonly do: 'grantMovement';
      readonly target: Selector;
      readonly grant: MovementGrant;
      readonly duration?: Duration;
      /** Phantom Energy: only these occupied figures may be crossed. */
      readonly over?: Selector;
    }
  | {
      readonly do: 'prevent';
      readonly target: Selector;
      readonly what: Preventable;
      readonly duration: Duration;
      /** Ballast: only while this printed attack is resolving. */
      readonly named?: string;
      /** "the asleep condition is not removed" — only these conditions. */
      readonly conditions?: readonly SpecialCondition[];
      /** Slime Barrier: only White-attack status. */
      readonly fromColor?: SegmentColor;
      /** Flawless / Diamond: only from these types. */
      readonly vsTypes?: readonly PokemonType[];
      /** Flawless / Diamond: battle damage vs attack-note KO. */
      readonly vsCause?: 'attackDamage' | 'attackEffect';
    }
  /** "the effects of Abilities that decrease damage ... are nullified" - 48 clauses. */
  | {
      readonly do: 'nullify';
      readonly target: Selector;
      readonly duration: Duration;
      readonly scope?: 'all' | 'damageModifiers';
      readonly plateNameIncludes?: string;
      readonly exceptPlate?: string;
      /** Headwind: only while the target faces an ally of these types. */
      readonly onlyVsAllyTypes?: readonly PokemonType[];
    }
  | { readonly do: 'evolve'; readonly target: Selector; readonly onlyNamed?: readonly string[] }
  /** "Choose one of your Sceptile on the field, and Mega Evolve it for 7 turns" - 67 clauses. */
  | { readonly do: 'megaEvolve'; readonly target: Selector; readonly turns: number }
  | { readonly do: 'changeForm'; readonly target: Selector; readonly into: readonly string[] }
  /** "Your turn ends" - 90 clauses, and a genuine action rather than a phase transition. */
  | { readonly do: 'endTurn' }
  /** "the next turn will always be the other player's". */
  | { readonly do: 'forceNextTurn'; readonly player: 'controller' | 'opponent' }
  /** "Reduces the opponent's Z-Move gauge by two thirds of its max value" - 51 clauses. */
  | {
      readonly do: 'adjustZGauge';
      readonly target: 'controller' | 'opponent';
      readonly fractionOfMax: number | null;
      readonly flat: number | null;
    }
  /**
   * "Shifts this Pokemon's Attacks two segments clockwise" (wheel rotation) and "shift
   * the result clockwise until a non-Purple, non-Blue Attack comes up" (result shift).
   * Two distinct mechanics that read almost identically in prose.
   */
  | { readonly do: 'rotateWheel'; readonly target: Selector; readonly segments: number }
  | { readonly do: 'shiftSpinResult'; readonly target: Selector; readonly until: SpinPredicate; readonly duration: Duration }
  /** "This Attack becomes a Miss for the next turn". */
  | {
      readonly do: 'replaceSegment';
      readonly target: Selector;
      readonly moveName: string;
      readonly duration: Duration;
      readonly damage?: number;
      readonly then?: readonly Clause[];
      /** Printed move to overwrite. "The Dodges of adjacent Pokémon become Misses." */
      readonly replaces?: string;
    }
  /** "If this Pokemon spins Miss in battle, one of your Plates will switch from used to unused". */
  | {
      readonly do: 'refreshPlate';
      readonly count: number;
      readonly player: 'controller' | 'opponent' | 'both';
      /** Return as many plates as this figure's attack consumed. */
      readonly accounted?: boolean;
      /** Substring on the printed plate name. */
      readonly nameIncludes?: string;
      /** Mega Stones only — `cost === null` in the schema. */
      readonly megaOnly?: boolean;
    }
  /** "This Pokemon must battle if possible after making an MP move". */
  | { readonly do: 'forceBattle'; readonly target: Selector; readonly against?: Selector }
  /** "after moving, this Pokémon may attack an opposing Pokémon again, but just once". */
  | { readonly do: 'grantExtraBattle' }
  /** "White Attacks become Gold Attacks", "Blue Attacks that are not Dodge become Misses". */
  | {
      readonly do: 'recolorAttacks';
      readonly target: Selector;
      readonly from: SegmentColor;
      readonly to: SegmentColor;
      readonly except: readonly string[];
      readonly duration: Duration;
    }
  /** "gains ★+2", "has ★+1". Purple star bonus. */
  | { readonly do: 'modifyStars'; readonly target: Selector; readonly delta: number; readonly duration: Duration }
  /** "its Attacks have Range 2". */
  | { readonly do: 'setBattleRange'; readonly target: Selector; readonly range: number; readonly duration: Duration }
  /** "mega evolution turns increases by N". */
  | { readonly do: 'adjustMegaTurns'; readonly target: Selector; readonly delta: number }
  /** "can move to a point that is N steps away" — leap, not a one-shot move. */
  | { readonly do: 'grantLeap'; readonly target: Selector; readonly steps: number }
  /** "switches one of the opponent's plates from unused to used". */
  | {
      readonly do: 'consumePlate';
      readonly player: 'controller' | 'opponent' | 'both';
      readonly count: number;
      readonly nameIncludes: string | null;
    }
  /** "Switch the order of your Pokémon in the P.C." */
  | { readonly do: 'reorderPc'; readonly player: 'controller' | 'opponent' }
  /** "This Pokémon cannot win by reaching the goal". */
  | { readonly do: 'lockGoal'; readonly target: Selector; readonly locked: boolean }
  /** Copy this figure's special condition onto another, then clear it here. */
  | { readonly do: 'transferConditions'; readonly from: Selector; readonly to: Selector }
  /** Marker/condition inflictions aimed at `target` land on `to` instead. */
  | { readonly do: 'redirectInflictions'; readonly target: Selector; readonly to: Selector; readonly duration: Duration }
  /** Knock `knock` back and move `claim` onto the vacated node. */
  | { readonly do: 'claimSpot'; readonly knock: Selector; readonly claim: Selector; readonly steps: number }
  /** Attach `then` as a delayed lingering clause with its own trigger. */
  | {
      readonly do: 'armTrigger';
      readonly target: Selector;
      readonly trigger: Trigger;
      readonly when: readonly Condition[];
      readonly then: readonly Action[];
      readonly duration: Duration;
    }
  /** "return to their start-of-the-duel state (excluding evolution)". */
  | {
      readonly do: 'resetToStart';
      readonly target: Selector;
      readonly keepEvolution: boolean;
      readonly keepConditions: boolean;
    }
  /**
   * DNA Splicers / Necroizer. Pairing tokens are taken from the printed text
   * (`Zekrom`→`Black Kyurem`); no dex line is invented.
   */
  | {
      readonly do: 'fuse';
      readonly host: Selector;
      readonly material: Selector;
      readonly materialTo: 'excluded' | 'ultraSpace';
      readonly intoByMaterial: readonly (readonly [string, string])[];
    }
  /** Appliance plates: "All Pokémon become Fire-type for 9 turns." */
  | {
      readonly do: 'setType';
      readonly target: Selector;
      readonly types: readonly PokemonType[];
      readonly duration: Duration;
    }
  /** Dark Sphere / Stony Sphere: cannot pass through listed blockers by Abilities. */
  | {
      readonly do: 'denyPassThrough';
      readonly movers: Selector;
      readonly blockers: Selector;
      readonly duration: Duration;
    }
  /** "Nullifies the effects of one of … in-use plates, and that plate counts as used." */
  | {
      readonly do: 'nullifyInUsePlate';
      readonly player: 'controller' | 'opponent';
      readonly exceptMega: boolean;
      /** Set after the player picks among several in-use plates. */
      readonly slot?: number;
      /** Metal Coat: only this plate name. */
      readonly nameIncludes?: string;
    }
  /** Mud Energy: +1 to Wait effects received. */
  | {
      readonly do: 'modifyWaitReceived';
      readonly target: Selector;
      readonly delta: number;
      readonly duration: Duration;
    }
  /** Reckless Charge: MP along a ray, not an unrestricted N-step leap. */
  | { readonly do: 'grantStraightMp'; readonly target: Selector; readonly steps: number }
  /** "If there are other Pokémon on your bench, this Pokémon cannot enter the field using an MP move." */
  | { readonly do: 'denyDeploy'; readonly target: Selector }
  /** Giratina: opponent ability damage increases become decreases. */
  | { readonly do: 'invertAbilityIncreases'; readonly target: Selector; readonly duration: Duration }
  /** Solgaleo: cannot be moved by effects except this Pokémon's attacks. */
  | { readonly do: 'restrictMoves'; readonly target: Selector; readonly duration: Duration }
  /** Weak Armor: remove the unnamed marker and conditions instead of a KO. */
  | {
      readonly do: 'surviveByClearing';
      readonly target: Selector;
      /** Full marker: only White-attack damage KOs. Omit for any knockout. */
      readonly vs?: 'whiteDamage';
    }
  /**
   * Power Construct / Primal Reversion: transform instead of going to the P.C.
   * Standing declaration, queried at knockout like `surviveByClearing`.
   */
  | {
      readonly do: 'surviveByForm';
      readonly target: Selector;
      readonly into: readonly string[];
      readonly vs?: 'battleDamage';
    }
  /** Ultra Beast: treat matching figures as newly moved. */
  | { readonly do: 'treatAsNewlyMoved'; readonly target: Selector }
  /** Arceus: type becomes the chosen Pokémon's type. Types are snapshotted at apply time. */
  | {
      readonly do: 'copyType';
      readonly target: Selector;
      readonly from: Selector;
      readonly duration: Duration;
      readonly types?: readonly PokemonType[];
    }
  /** "Repeat this effect for each Pokémon in the Ultra Space." */
  | { readonly do: 'repeatFor'; readonly of: Selector; readonly then: readonly Action[] }
  /** "this effect repeats for each time this Pokémon has evolved". Extra copies, not a replace. */
  | { readonly do: 'repeatTimes'; readonly times: CountSource; readonly then: readonly Action[] }
  /** Absolute MP. Queried as an override, not added to `mpDelta`. */
  | { readonly do: 'setMp'; readonly target: Selector; readonly value: number; readonly duration: Duration }
  /** Copy lingering Sphere-plate auras from `from` onto `target`. */
  | {
      readonly do: 'copyPlateEffects';
      readonly target: Selector;
      readonly from: Selector;
      readonly nameIncludes: string;
      readonly duration: Duration;
    }
  /** "when moving from the bench, it can only move to one space away from the entry point". */
  | { readonly do: 'restrictDeploy'; readonly target: Selector }
  /** "this Pokémon counts as having already battled". */
  | { readonly do: 'markBattled' }
  /** "must MP move as far as its MP range will allow". */
  | { readonly do: 'forceFullMp'; readonly target: Selector }
  /**
   * "MP cannot be N or lower (except through the effects of markers)".
   * Floor applies to base + ability auras; `mpDelta` (markers) is added after.
   */
  | { readonly do: 'floorMp'; readonly target: Selector; readonly min: number }
  /**
   * Move effects that would move this Pokémon's battle opponent: this controller
   * decides whether they fire, who they hit, and where that figure lands.
   */
  | { readonly do: 'seizeMoveEffects'; readonly target: Selector }
  /**
   * "You may move this Pokemon to the bench" - 79 clauses are player-optional. This
   * must surface as a real pending decision rather than auto-resolving, or the engine
   * silently plays the game for the user.
   */
  | { readonly do: 'optional'; readonly chooser: Chooser; readonly then: readonly Action[] }
  /**
   * "Choose one of your Pokemon on the field." - a clause whose only job is to bind a
   * target that later clauses refer back to as "that Pokemon". Without this the
   * following clause ("While that Pokemon is on the field, it deals +20 damage") has no
   * referent, which is why 11 selections and 17 follow-ups were failing together.
   */
  | { readonly do: 'select'; readonly target: Selector; readonly chooser: Chooser }
  /**
   * Declarative classifications - "Ultra Beast.", "Restored Pokemon." - that read like
   * effects but are figure attributes the rules key off elsewhere. Recognised so they
   * stop polluting the unimplemented count.
   */
  | { readonly do: 'tag'; readonly tag: string }
  /** "This effect does not stack." Carried on the clause's `noStackKey`; this is the marker. */
  | { readonly do: 'noStack' }
  /** "Just once, …" — Lombre Slippery. Marks the source so the clause cannot fire again. */
  | { readonly do: 'spendOnce' }
  /** Loyalty: arriving on the bench does not carry Wait. */
  | { readonly do: 'readyImmediately'; readonly target: Selector }
  /** King Horn / Impermeable Mail: +N to spin-again respins of matching figures. */
  | { readonly do: 'bonusRespin'; readonly target: Selector; readonly delta: number }
  /**
   * Ultra Space duration-multiply: this figure's Attack-effect flats and turn
   * durations are multiplied by (count of `of`) + `plus`.
   */
  | { readonly do: 'scaleAttackEffects'; readonly target: Selector; readonly plus: number; readonly of: CountSource }
  /** Family Bond: strip KO-prevention lingerings/markers on the battle opponent. */
  | { readonly do: 'stripKoPrevention'; readonly target: Selector }
  /** Enforcer: return to `originFigureId`. */
  | { readonly do: 'revertForm'; readonly target: Selector }
  /** Air Balloon denial: opposing movers cannot use that named over-others grant. */
  | {
      readonly do: 'denyNamedGrant';
      readonly movers: Selector;
      readonly nameIncludes: string;
      readonly grant: MovementGrant;
    }
  /** Earthen Rage: adjacent empty points are landable, not transit. */
  | { readonly do: 'denyAdjacentPass'; readonly movers: Selector; readonly around: Selector }
  /** Synchronize: copy the condition just received onto `to`. */
  | { readonly do: 'copyReceivedCondition'; readonly to: Selector }
  /**
   * A clause that exists only to carry its guard - it grants permission rather than
   * doing anything. Used with the `usageRestriction` trigger so a plate's playability
   * condition can travel through the same pipeline as its effects without pretending
   * to be one.
   */
  | { readonly do: 'usageGate' }
  /** Emitted by the compiler for text it recognises but cannot yet express. */
  | { readonly do: 'unimplemented'; readonly text: string };

/**
 * A clause: the unit of effect, and the unit of coverage.
 *
 * Abilities and attacks decompose into ordered clause arrays rather than being single
 * opaque functions, because the corpus shows the same clauses recombining constantly -
 * 1,311 distinct patterns over 3,863 clauses. Clause-level granularity is also what
 * lets the coverage registry report honestly on the 893 patterns that occur once.
 */
export interface Clause {
  readonly id: ClauseId;
  readonly trigger: Trigger;
  /** Guard evaluated when the trigger fires; empty means unconditional. */
  readonly when: readonly Condition[];
  readonly actions: readonly Action[];
  /**
   * Resolution order within a trigger. Nullifiers must run before what they suppress,
   * and damage modifiers before damage is applied, so ordering cannot be incidental.
   */
  readonly layer: number;
  /**
   * "This effect does not stack." Clauses sharing a non-null key collapse to one
   * instance, resolved during the hook bus's first pass.
   */
  readonly noStackKey: string | null;
  /** Verbatim source text, kept for debugging, provenance and the coverage report. */
  readonly source: string;
}
