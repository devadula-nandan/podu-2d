/**
 * Ver. 7.0.14 rules constants - the single place where a ruling can be changed.
 *
 * Two kinds of thing live here, and the distinction matters:
 *
 *  1. **Settled rules.** Numbers and flags that a source states outright or that the
 *     content data proves (wheel totals, plate budget, P.C. capacity, star range).
 *     These are facts; they are named only so the engine never carries a magic number.
 *
 *  2. **Rulings.** Eight questions that no source settles. Each gets a chosen default,
 *     a stated reason, and a confidence level, so a future screenshot or datamine can
 *     flip it by editing one token here instead of hunting through the engine. Every
 *     ruling is also described in `docs/RULES.md`, which carries the full evidence.
 *
 * Rulings are deliberately annotated with their widened type rather than `as const`,
 * so that comparing against the rejected alternative still typechecks - flipping a
 * ruling must never cascade into "this comparison is always false" errors.
 *
 * `primitives.js` is imported for the condition vocabulary only. It is a pure
 * vocabulary module with no I/O, so this stays inside the engine-purity boundary.
 */
import type { SpecialCondition } from '../content/dsl/primitives.js';

// ---------------------------------------------------------------------------
// Provenance vocabulary
// ---------------------------------------------------------------------------

/**
 * The sources cited by rulings, in descending trust for *rules* questions.
 *
 * `contentData` outranks everything for anything the 596 figures can demonstrate,
 * because a measured invariant beats a prose claim. `launchGuides` is last and is
 * cited only where it is being overruled - see `GOLD_BEATS_BLUE`.
 */
export const RULES_SOURCES = [
  'contentData',
  'adjudication',
  'officialPrimer',
  'bulbapedia',
  'serebii',
  'smogon',
  'fandom',
  'community',
  'launchGuides',
  'inference',
] as const;
export type SourceId = (typeof RULES_SOURCES)[number];

/**
 * How much weight a ruling deserves.
 *
 * - `verified` - the content data or a primary source states it; not really a ruling.
 * - `high`     - multiple independent sources agree, or it follows necessarily from a
 *                rule that is itself documented.
 * - `medium`   - one credible source, or a strong structural argument with no source.
 * - `low`      - a coin flip made defensible by choosing the least destructive option.
 */
export const RULING_CONFIDENCES = ['verified', 'high', 'medium', 'low'] as const;
export type RulingConfidence = (typeof RULING_CONFIDENCES)[number];

/** Machine-readable audit record for one unsettled question. */
export interface RulingNote {
  /** The question, phrased so it could be answered by evidence. */
  readonly question: string;
  /** The default this module ships. */
  readonly ruling: string;
  readonly confidence: RulingConfidence;
  /** Why this default and not another. Not a restatement of the ruling. */
  readonly reason: string;
  /** The options that were rejected, so a flip knows what it is flipping to. */
  readonly alternatives: readonly string[];
  readonly evidence: readonly SourceId[];
  /** Names of the exported constants that implement the ruling. */
  readonly constants: readonly string[];
  /** What breaks or changes if the ruling turns out to be wrong. */
  readonly blastRadius: string;
}

// ---------------------------------------------------------------------------
// Settled: board
// ---------------------------------------------------------------------------

/** 7x5 outer ring (20) + 3x3 inner ring minus its centre (8). */
export const BOARD_NODE_COUNT = 28;

/** Ring edges plus 4 corner diagonals and 2 goal-side diagonals. */
export const BOARD_EDGE_COUNT = 34;

/** One per player. 28 total nodes minus 2 goals is the officially stated 26. */
export const GOAL_NODE_COUNT = 2;

/** The non-goal node count the official material states; used as a load-time check. */
export const NON_GOAL_NODE_COUNT = BOARD_NODE_COUNT - GOAL_NODE_COUNT;

/**
 * A goal touches exactly two nodes. This is load-bearing rather than trivia: it is
 * the whole reason the goal-clamp surround kill works, so a board graph that gives a
 * goal degree 3 has a bug, not a variant layout.
 */
export const GOAL_NODE_DEGREE = 2;

/** The four outer corners. Deployment happens here and nowhere else. */
export const ENTRY_POINT_COUNT = 4;

/** Entry points sit on a ring corner plus one diagonal. */
export const ENTRY_POINT_DEGREE = 3;

/**
 * Surround arity is per node, never a constant: a figure is knocked out when every
 * adjacent node is occupied by enemies, and node degree varies across the board.
 * These bounds exist so the graph loader can reject a malformed topology.
 */
export const MIN_NODE_DEGREE = 2;
export const MAX_NODE_DEGREE = 3;

// ---------------------------------------------------------------------------
// Settled: turn structure and movement
// ---------------------------------------------------------------------------

/** At most one plate, one movement and one battle per turn, in that order. */
export const PLATES_PER_TURN = 1;
export const MOVES_PER_TURN = 1;
export const BATTLES_PER_TURN = 1;

/** Five figures are deliberately immobile (Metapod, Kakuna, Spiritomb, Aegislash Blade Forme, Regigigas). */
export const MP_BASE_MIN = 0;

/** Printed MP never exceeds 3: the distribution is MP0 x5, MP1 x71, MP2 x377, MP3 x143. */
export const MP_BASE_MAX = 3;

/** Abilities push effective MP to 4, so movement code must not clamp at MP_BASE_MAX. */
export const MP_EFFECTIVE_MAX = 4;

/** Deploying onto an entry point costs 1 MP; any remainder continues the same move. */
export const DEPLOY_MP_COST = 1;

/**
 * The starting player loses 1 MP on their first turn only - which is why a 1 MP figure
 * cannot be deployed on turn one. It is not a general first-round penalty.
 */
export const FIRST_TURN_MP_PENALTY = 1;

/** Battles are range 1 by default; "Range 2" is explicit game vocabulary, not an ability quirk. */
export const BATTLE_RANGE_DEFAULT = 1;
export const BATTLE_RANGE_MAX = 2;

// ---------------------------------------------------------------------------
// Settled: wheels and battle resolution
// ---------------------------------------------------------------------------

/**
 * Every wheel sums to exactly 96 units. Verified on 596/596 figures, which is the
 * single strongest invariant in the project - it is what caught the Vaporeon
 * power-for-probability transcription bug.
 */
export const WHEEL_TOTAL_UNITS = 96;

/** Purple star values run 1-4. Bulbapedia's explicit `stars=` never exceeds 4 across 1,317 Purple segments. */
export const PURPLE_STAR_MIN = 1;
export const PURPLE_STAR_MAX = 4;

/** At most two types per figure; 338 of 596 are dual-typed. */
export const MAX_TYPES_PER_FIGURE = 2;

/**
 * Gold's *only* privilege is beating Purple. Against White it is an ordinary damage
 * comparison. Two launch-week guides claim Gold also beats Blue; five better sources
 * contradict them and this ships as `false`. See docs/RULES.md for the full conflict.
 */
export const GOLD_BEATS_BLUE = false;
export const GOLD_BEATS_WHITE = false;

/** White/Gold vs White/Gold with identical damage: nobody wins and both figures survive. */
export const EQUAL_DAMAGE_IS_DRAW = true;

/** Purple vs Purple on equal stars: a draw, and neither Purple effect fires. */
export const EQUAL_STARS_IS_DRAW = true;

/**
 * The battle winner stays put. Advancing after a win exists only where an effect says
 * so explicitly, which is a large part of why the game favours the defender.
 */
export const WINNER_ADVANCES = false;

/** Chain Level adds flat damage per level and appears in zero effect texts - engine-internal only. */
export const CHAIN_LEVEL_DAMAGE_PER_LEVEL = 1;

/** Trigger resolution starts with the player who initiated the battle, then alternates. */
export const INITIATOR_TRIGGERS_FIRST = true;

// ---------------------------------------------------------------------------
// Settled: state layers
// ---------------------------------------------------------------------------

/** Exactly one special condition at a time; a new one replaces the old, and none expire. */
export const MAX_CONDITIONS_PER_FIGURE = 1;

/** Exactly one marker at a time, cleared on leaving the field. */
export const MAX_MARKERS_PER_FIGURE = 1;

/** Wait counts down on every turn, including the opponent's - so N Wait is N/2 of your own turns. */
export const WAIT_TICKS_ON_BOTH_TURNS = true;

/** Tagging cures an adjacent ally and ends your turn. Several abilities forbid being tagged. */
export const TAGGING_ENDS_TURN = true;

// ---------------------------------------------------------------------------
// Settled: zones, plates, Mega
// ---------------------------------------------------------------------------

/** The P.C. holds two figures; a third pushes the oldest out to the bench with a Wait. */
export const PC_CAPACITY = 2;

/** Overflow is first-in-first-out, not player's choice. */
export const PC_OVERFLOW_IS_FIFO = true;

/** Up to six plate slots in a deck. */
export const PLATE_DECK_SLOTS = 6;

/** Total plate cost must not exceed 8. Stated outright on Serebii's plate listing. */
export const PLATE_COST_BUDGET = 8;

/** Each plate is usable once per duel unless its own text makes it resettable. */
export const PLATE_USES_PER_DUEL = 1;

/** No plate window exists inside a battle, and none exists after a figure has moved. */
export const PLATES_ALLOWED_MID_BATTLE = false;
export const PLATES_ALLOWED_AFTER_MOVING = false;

/** Mega Evolution lasts 7 turns and abilities modify it (Ruinous Helix +2, Flower Carpet freezes it). */
export const MEGA_DURATION_TURNS = 7;

/** One Mega Evolution per duel. */
export const MEGA_EVOLUTIONS_PER_DUEL = 1;

/**
 * Fallback duration for temporary exclusion when an effect names no timer. Effect text
 * drives the real value and the corpus contains both 5 (Rampager) and 7 (Inferno
 * Ladder); 7 is the longer, so the fallback never returns a figure early.
 */
export const TEMPORARY_EXCLUSION_DEFAULT_TURNS = 7;

/** Ultra Space keeps markers and conditions but freezes Wait and Mega timers. */
export const ULTRA_SPACE_FREEZES_TIMERS = true;

// ---------------------------------------------------------------------------
// Settled: win conditions
// ---------------------------------------------------------------------------

/** A goal is captured by *movement* into it. Being pushed or swapped in does not win. */
export const GOAL_CAPTURE_REQUIRES_MOVEMENT = true;

/** Surround is evaluated at the end of movement, not continuously. */
export const SURROUND_CHECKED_AT_END_OF_MOVEMENT = true;

/** Playing a plate counts as an action, so it postpones a Wait Victory. */
export const PLATE_COUNTS_AS_ACTION_FOR_WAIT_VICTORY = true;

/** Hard turn cap. See TURN_LIMIT_OUTCOME and TURN_LIMIT_COUNTING for what it does. */
export const TURN_LIMIT = 300;

/** Per-player chess clock; running it out loses the duel. */
export const CHESS_CLOCK_MINUTES = 5;
export const CHESS_CLOCK_MS = CHESS_CLOCK_MINUTES * 60_000;

// ---------------------------------------------------------------------------
// Ruling 1 - goal-side diagonal attachment
// ---------------------------------------------------------------------------

/**
 * Where the two goal-side diagonals meet the outer ring.
 *
 * - `adjacentToGoal` - the outer endpoint is the ring node immediately beside the goal.
 * - `oneNodeOut`     - the outer endpoint is the next node along the ring.
 *
 * **Chosen default: `adjacentToGoal`. Confidence: medium.**
 *
 * Two board renders disagree and neither has been inspected first-hand. This reading is
 * taken because it is the one consistent with the rest of the verified topology: the
 * diagonal terminates *beside* the goal rather than on it, so the goal keeps its
 * degree of 2 (`GOAL_NODE_DEGREE`) and the total stays at 34 edges, while still giving
 * the defender the short diagonal route into the goal mouth that the board's whole
 * defensive character depends on. `oneNodeOut` preserves the counts too but leaves the
 * goal approach a pure corridor, which no strategy source describes.
 */
export type GoalSideDiagonalAttachment = 'adjacentToGoal' | 'oneNodeOut';
export const GOAL_SIDE_DIAGONAL_ATTACHMENT: GoalSideDiagonalAttachment = 'adjacentToGoal';

// ---------------------------------------------------------------------------
// Ruling 2 - 300-turn behaviour
// ---------------------------------------------------------------------------

/**
 * What happens when `TURN_LIMIT` is reached.
 *
 * **Chosen default: `draw`. Confidence: low.**
 *
 * Effectively single-sourced, and the one source does not say. `draw` is chosen as the
 * least destructive option: it invents no winner, and it is the only outcome that
 * cannot silently corrupt AI training or golden replays by awarding a result the real
 * game would not have. `mostFiguresOnField` is the most plausible alternative if
 * evidence ever appears, since it mirrors how other deadlock rules in the game break
 * ties by board presence.
 */
export type TurnLimitOutcome = 'draw' | 'doubleLoss' | 'suddenDeath' | 'mostFiguresOnField';
export const TURN_LIMIT_OUTCOME: TurnLimitOutcome = 'draw';

/**
 * What `TURN_LIMIT` counts.
 *
 * **Chosen default: `playerTurns`. Confidence: low.**
 *
 * The same single source leaves this open, and the two readings differ by a factor of
 * two - 300 rounds is 600 individual turns, which is a very long duel for a game with
 * a 5-minute clock. `playerTurns` is chosen because every other turn-scoped rule in
 * the game (Wait ticking, Mega duration, temporary exclusion) counts individual turns,
 * so it is the consistent reading. Note that the chess clock will usually end a stalled
 * duel long before either interpretation fires, which is what keeps the confidence
 * cost of this ruling low in practice.
 */
export type TurnLimitCounting = 'playerTurns' | 'rounds';
export const TURN_LIMIT_COUNTING: TurnLimitCounting = 'playerTurns';

// ---------------------------------------------------------------------------
// Ruling 3 - surround versus goal victory
// ---------------------------------------------------------------------------

/**
 * Which resolves first when one movement both captures the goal and leaves the moving
 * figure surrounded.
 *
 * **Chosen default: `surroundFirst` - the mover is knocked out and does not win.
 * Confidence: medium.**
 *
 * Community evidence says surround wins, but it is single-sourced. It is also the
 * reading the rest of the rules imply: surround is checked at the end of movement
 * (`SURROUND_CHECKED_AT_END_OF_MOVEMENT`) and goal capture is itself a movement result,
 * so both are evaluated in the same window, and a knocked-out figure cannot be standing
 * on the goal. The opposite ruling would make the goal-clamp - the entire reason goals
 * have degree 2 - unusable as a defence, which is strong circumstantial support.
 */
export type SurroundGoalPriority = 'surroundFirst' | 'goalFirst';
export const SURROUND_GOAL_PRIORITY: SurroundGoalPriority = 'surroundFirst';

// ---------------------------------------------------------------------------
// Ruling 4 - Sleep and Frozen versus MP movement
// ---------------------------------------------------------------------------

/**
 * Whether a special condition prevents its figure from making an MP move.
 *
 * **Chosen default: Sleep blocks movement, Frozen does not. Confidence: medium.**
 *
 * The official primer, Serebii, the Fandom wikis and Smogon contradict each other, so
 * this is decided on internal consistency instead. Frozen already has a complete,
 * well-attested mechanic - attacks are forced to Miss, and it clears after a battle -
 * so it needs no movement clause to be a meaningful condition. Sleep has no stated
 * battle effect at all; since no condition expires on its own, a Sleep that did not
 * stop movement would be a condition that does literally nothing, which cannot be
 * right. The other five conditions all have fully specified wheel or damage effects
 * and are therefore `false` with high confidence.
 */
export const CONDITION_BLOCKS_MP_MOVE: Readonly<Record<SpecialCondition, boolean>> = {
  asleep: true,
  frozen: false,
  burned: false,
  confused: false,
  paralyzed: false,
  poisoned: false,
  noxious: false,
};

// ---------------------------------------------------------------------------
// Ruling 5 - voluntary pass
// ---------------------------------------------------------------------------

/**
 * Whether a player with legal actions available may decline to take any of them.
 *
 * **Chosen default: `false` - passing is not a legal action. Confidence: high.**
 *
 * No source addresses it directly, but Wait Victory settles it by implication: a player
 * loses when they have *no legal action*, and if "pass" were always available then no
 * player could ever be without one and Wait Victory could never trigger. Since Wait
 * Victory is documented, voluntary passing cannot exist. Note this is derived rather
 * than sourced, which is why it is `high` and not `verified`.
 *
 * A figure with 0 MP and nothing to battle still ends its turn - that is the absence of
 * a legal action, not a pass, and it is what feeds `WaitVictory`.
 */
export const VOLUNTARY_PASS_ALLOWED = false;

// ---------------------------------------------------------------------------
// Ruling 6 - one surround per turn
// ---------------------------------------------------------------------------

/**
 * How many surround knockouts one turn may produce. `null` means no limit.
 *
 * **Chosen default: `null` - unlimited, all surrounds resolve together.
 * Confidence: medium.**
 *
 * The one-per-turn cap is a Trading Figure Game rule and no Ver. 7 source restates it.
 * It is also hard to attach to anything in the digital game: surround is an automatic
 * board-state check at the end of movement rather than a player action, so there is no
 * decision point at which a player would choose which surround to take. Set this to `1`
 * if the TFG rule turns out to have carried over; the engine reads it as a cap on
 * knockouts emitted by a single `SurroundCheck` phase.
 *
 * In practice multi-surround turns are rare - one movement can only change occupancy
 * around the nodes it left and entered - so the two rulings are hard to distinguish
 * from replays, which is why no better evidence has surfaced.
 */
export const MAX_SURROUNDS_PER_TURN: number | null = null;

// ---------------------------------------------------------------------------
// Ruling 7 - the two starless Purple segments
// ---------------------------------------------------------------------------

/**
 * How to read the two Purple segments with no star value: Dragonite's Sightseeing and
 * Mega Metagross's Teleport Beam.
 *
 * **Chosen default: `sourceOmission`, substituting `PURPLE_STAR_MIN`.
 * Confidence: medium.**
 *
 * Reading them as a genuine 0 would put them outside the 1-4 range that 1,317 other
 * Purple segments establish and would break the content validator, so omission is much
 * the likelier explanation. The ruling is also nearly harmless: both segments carry
 * `damage: null`, so stars feed only the Purple-vs-Purple comparison and never a damage
 * number. Substituting the floor of the legal range means the ruling can understate
 * these two segments but can never hand them an unearned win.
 */
export type StarlessPurplePolicy = 'sourceOmission' | 'genuineZeroStars';
export const STARLESS_PURPLE_POLICY: StarlessPurplePolicy = 'sourceOmission';

/** The star value substituted when `STARLESS_PURPLE_POLICY` is `sourceOmission`. */
export const STARLESS_PURPLE_SUBSTITUTE_STARS: 1 | 2 | 3 | 4 = 1;

// ---------------------------------------------------------------------------
// Ruling 8 - the contested figure fields
// ---------------------------------------------------------------------------

/**
 * Which witness wins where Bulbapedia and Serebii disagree and neither can be outvoted.
 *
 * **Chosen default: `bulbapedia`. Confidence: high.**
 *
 * Bulbapedia earned the default rather than being assumed into it: it was right on all
 * six disputed type sets (Serebii had Landorus as Fire/Psychic and Stakataka as
 * Fighting/Ghost, both flatly wrong), it corrects every transcription error found, and
 * it held the newer version in all five cases of genuine mechanical drift. It also
 * stores figures as machine-readable templates rather than hand-typed HTML.
 *
 * This is `high` rather than `verified` because a default that is right most of the
 * time is still a default - the twelve fields in `CONTESTED_FIELDS` are exactly the
 * places where it was applied with no corroboration.
 */
export type ContestedFieldWinner = 'bulbapedia' | 'serebii';
export const CONTESTED_FIELD_WINNER: ContestedFieldWinner = 'bulbapedia';

/** `figureId:field`, matching the `contested` entries in `data/content/figures.json`. */
export type ContestedFieldKey = `${number}:${string}`;

/**
 * The contested fields, mirroring the `contested` flags on the 11 affected figures.
 *
 * `data/content/figures.json` and `decisions.json` remain the source of truth; this
 * mirror exists so the deck builder can badge a contested figure and the rules
 * inspector can explain it without reparsing the content layer.
 *
 * Eight MP values, two rarities and the two starless Purple segments of ruling 7 -
 * twelve fields over eleven figures.
 */
export const CONTESTED_FIELDS: readonly { readonly key: ContestedFieldKey; readonly name: string }[] = [
  { key: '44:mp', name: 'Audino' },
  { key: '44:rarity', name: 'Audino' },
  { key: '90:rarity', name: 'Weedle' },
  { key: '179:mp', name: 'Leafeon' },
  { key: '279:mp', name: 'Mega Beedrill' },
  { key: '281:stars:Sightseeing', name: 'Dragonite' },
  { key: '315:mp', name: 'Durant' },
  { key: '505:stars:Teleport Beam', name: 'Mega Metagross' },
  { key: '523:mp', name: 'Stakataka' },
  { key: '542:mp', name: 'Mega Manectric' },
  { key: '543:mp', name: 'Mega Sharpedo' },
  { key: '566:mp', name: 'Tyranitar' },
];

/** Asserted against `CONTESTED_FIELDS` so the doc, the data and the code cannot drift apart. */
export const CONTESTED_FIELD_COUNT = 12;

/**
 * Per-field reversals of `CONTESTED_FIELD_WINNER`, applied by the content loader after
 * parsing. Empty by default - every contested field currently takes Bulbapedia.
 *
 * Adding `{ '179:mp': 2 }` here is the whole of flipping Leafeon back to Serebii's
 * reading, which is the point: no content file is edited and no adjudication is lost.
 */
export const CONTESTED_FIELD_OVERRIDES: Readonly<Record<ContestedFieldKey, string | number>> = {};

// ---------------------------------------------------------------------------
// The audit registry
// ---------------------------------------------------------------------------

/**
 * Every unsettled question in one machine-readable place.
 *
 * This exists so the rules inspector can say "this outcome depended on a ruling we are
 * only medium-confident in" instead of presenting a guess as a fact, and so a reviewer
 * can diff the project's uncertainty rather than re-reading the engine.
 */
export const OPEN_RULINGS = {
  goalSideDiagonalAttachment: {
    question: 'Do the two goal-side diagonals meet the ring node beside the goal, or the next one out?',
    ruling: 'The node immediately beside the goal.',
    confidence: 'medium',
    reason:
      'Two board renders disagree and neither was inspected first-hand. This reading keeps the goal at degree 2 and the edge count at 34 while preserving the short diagonal approach to the goal mouth that the board\'s defensive character relies on.',
    alternatives: ['oneNodeOut'],
    evidence: ['community', 'smogon', 'inference'],
    constants: ['GOAL_SIDE_DIAGONAL_ATTACHMENT'],
    blastRadius:
      'Changes two edges in the board graph, so it shifts goal approach routes, MP reachability near the goal and the nodes that participate in a goal clamp. Nothing outside board/movement reads it.',
  },
  turnLimitBehaviour: {
    question: 'What happens at 300 turns, and does 300 count player-turns or rounds?',
    ruling: 'A draw, counting individual player-turns.',
    confidence: 'low',
    reason:
      'Effectively single-sourced and the source is silent on both halves. A draw invents no winner, and player-turns is consistent with every other turn-scoped counter in the game (Wait, Mega duration, temporary exclusion).',
    alternatives: ['doubleLoss', 'suddenDeath', 'mostFiguresOnField', 'rounds'],
    evidence: ['fandom', 'inference'],
    constants: ['TURN_LIMIT', 'TURN_LIMIT_OUTCOME', 'TURN_LIMIT_COUNTING'],
    blastRadius:
      'Only affects duels that reach the cap, which the 5-minute chess clock makes rare. Matters most to the fuzz harness, whose termination invariant is written against it.',
  },
  surroundVsGoalVictory: {
    question: 'If one movement both captures the goal and leaves the mover surrounded, which applies?',
    ruling: 'Surround applies: the mover is knocked out and no goal is scored.',
    confidence: 'medium',
    reason:
      'Community evidence says surround wins, and both checks fall in the same end-of-movement window, so a knocked-out figure cannot be standing on the goal. The opposite ruling would make the degree-2 goal clamp useless as a defence.',
    alternatives: ['goalFirst'],
    evidence: ['community', 'inference'],
    constants: ['SURROUND_GOAL_PRIORITY', 'SURROUND_CHECKED_AT_END_OF_MOVEMENT'],
    blastRadius:
      'Decides a rare but game-ending interaction. Reachable by AI search, so a wrong ruling here teaches the AI an unsound sacrifice line.',
  },
  conditionsBlockingMovement: {
    question: 'Do Sleep and Frozen prevent MP movement?',
    ruling: 'Sleep prevents movement; Frozen does not.',
    confidence: 'medium',
    reason:
      'Four sources contradict each other, so this is decided on internal consistency. Frozen already has a complete mechanic (attacks forced to Miss, cleared after a battle); Sleep has no stated battle effect, and since no condition expires on its own, a Sleep that did not stop movement would do nothing at all.',
    alternatives: ['neither blocks movement', 'both block movement', 'only Frozen blocks movement'],
    evidence: ['officialPrimer', 'serebii', 'fandom', 'smogon', 'inference'],
    constants: ['CONDITION_BLOCKS_MP_MOVE'],
    blastRadius:
      'Changes the legal move set whenever either condition is on the board, so it moves both the AI\'s evaluation and the Wait Victory check.',
  },
  voluntaryPass: {
    question: 'May a player decline to act when legal actions exist?',
    ruling: 'No. Passing is not a legal action.',
    confidence: 'high',
    reason:
      'Derived from Wait Victory rather than sourced: a player loses when they have no legal action, so if "pass" were always available, Wait Victory could never trigger. Since Wait Victory is documented, voluntary passing cannot exist.',
    alternatives: ['pass always allowed', 'pass allowed only when no movement is possible'],
    evidence: ['inference'],
    constants: ['VOLUNTARY_PASS_ALLOWED', 'PLATE_COUNTS_AS_ACTION_FOR_WAIT_VICTORY'],
    blastRadius:
      'Adds or removes a command from every ActionWindow, which changes the AI branching factor everywhere and decides whether Wait Victory is reachable at all.',
  },
  oneSurroundPerTurn: {
    question: 'Did the Trading Figure Game one-surround-per-turn cap carry over to Duel?',
    ruling: 'No cap. Every surround produced by a movement resolves.',
    confidence: 'medium',
    reason:
      'No Ver. 7 source restates the TFG rule, and a per-turn cap has nothing to attach to in the digital game: surround is an automatic end-of-movement board check, not a player action, so there is no point at which a player would choose which surround to take.',
    alternatives: ['1'],
    evidence: ['inference'],
    constants: ['MAX_SURROUNDS_PER_TURN'],
    blastRadius:
      'Only differs on turns where one movement completes two surrounds at once, which is rare because a movement changes occupancy at just two nodes.',
  },
  starlessPurpleSegments: {
    question: "Are Dragonite's Sightseeing and Mega Metagross's Teleport Beam 0-star, or is the star value simply missing?",
    ruling: 'Missing. Substitute 1 star.',
    confidence: 'medium',
    reason:
      'A genuine 0 would sit outside the 1-4 range that 1,317 other Purple segments establish and would fail the content validator. Both segments also carry no damage, so stars feed only the Purple-vs-Purple comparison; substituting the floor of the range can understate them but never hands them an unearned win.',
    alternatives: ['genuineZeroStars', 'refuse to load the figure'],
    evidence: ['contentData', 'bulbapedia', 'inference'],
    constants: ['STARLESS_PURPLE_POLICY', 'STARLESS_PURPLE_SUBSTITUTE_STARS', 'PURPLE_STAR_MIN'],
    blastRadius: 'Two segments on two figures, and only in a Purple mirror match.',
  },
  contestedFigureFields: {
    question: 'Which source wins the twelve fields where Bulbapedia and Serebii disagree with no tiebreaker?',
    ruling: 'Bulbapedia, with per-field reversal available.',
    confidence: 'high',
    reason:
      'Bulbapedia earned the default: right on all six disputed type sets, correct on every transcription error found, and holding the newer version in all five cases of real mechanical drift. It is still a default rather than evidence, which is why each application is flagged rather than forgotten.',
    alternatives: ['serebii', 'refuse to load contested figures'],
    evidence: ['adjudication', 'contentData', 'bulbapedia', 'serebii'],
    constants: ['CONTESTED_FIELD_WINNER', 'CONTESTED_FIELDS', 'CONTESTED_FIELD_OVERRIDES'],
    blastRadius:
      'Eight MP values (one movement point each), two rarities (deck-building cost only) and the two starless segments of ruling 7. No mechanic changes shape.',
  },
} as const satisfies Record<string, RulingNote>;

/** The stable ids of the open questions, for tests and for the rules inspector. */
export type OpenRulingId = keyof typeof OPEN_RULINGS;

/** Guards against a ruling being quietly dropped from the registry. */
export const OPEN_RULING_COUNT = 8;
