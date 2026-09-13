# Pokémon Duel — Rules Specification (Ver. 7.0.14)

Authoritative rules reference for this reimplementation. Target fidelity is **Ver. 7.0.14**, the final live build before the 2019-10-31 shutdown.

The game is gone. Nothing here can be checked by launching it, so every claim below carries the evidence that supports it. That is the entire point of this document: it is meant to be **auditable rather than remembered**. If a statement has no source tag, treat it as a bug in this document.

Eight questions cannot be settled from available evidence. Each has a chosen default, a stated reason and a confidence level, and each is a named constant in [`src/rules/constants.ts`](../src/rules/constants.ts) so the engine imports the ruling instead of hardcoding it. Flipping any of them is a one-token edit with a test.

---

## How to read this document

Every factual claim is tagged with where it came from:

| Tag | Meaning |
|---|---|
| `[data]` | Measured from `data/content/` — 596 figures, 152 plates, 382 abilities. Reproducible; the measuring command is given where the number is not already in `tools/validate.mjs`. |
| `[adjudication]` | Recorded in `data/content/decisions.json` with its reasoning. 17 entries. |
| `[official]` | The official Pokémon site primer. |
| `[bulbapedia]` `[serebii]` `[smogon]` `[fandom]` | Named wiki or strategy source. |
| `[community]` | Player reports, no primary documentation. |
| `[launch]` | Third-party launch-week guides. Lowest tier; cited only where overruled. |
| `[inference]` | Derived from another rule in this document rather than sourced. Always labelled, never dressed up as a citation. |

### Source register and precedence

1. **Bulbapedia** — [Pokémon Duel](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Duel) plus per-figure pages. Primary for **figure data**: it stores every figure as machine-readable wikitext (`{{DuelAttack|movecol=purple|stars=3|prob=28|effect=…}}`), where `prob` *is* the /96 wheel size, with explicit `stars`, `evostage`, `type2` and versioned revisions.
2. **Serebii** — [mechanics page](https://www.serebii.net/duel/mechanics.shtml) and figure/plate listings. Primary for **plate economy** and the best single prose statement of battle resolution. Hand-typed HTML and demonstrably typo-prone on data.
3. **Official primer** — [Prime yourself for Pokémon Duel](https://www.pokemon.com/uk/strategy/prime-yourself-for-pokemon-duels). Authoritative in principle, thin in practice, and one of the four sources that contradict each other on conditions and movement.
4. **Smogon** — board description and strategic mechanics.
5. **Fandom wikis** — broad coverage, weakest editorial control.
6. **Launch-week guides** — written before the mechanics stabilised and three years before Ver. 7.0.14.

**Precedence differs by question type, deliberately:**

- For anything the 596 figures can demonstrate, `[data]` outranks all prose. A measured invariant beats a remembered claim — see [Corrections the data forced](#corrections-the-data-forced), where prose lost seven times running.
- For rules prose, the order above applies, with one exception: Bulbapedia outranks Serebii on data but **not** on rules narrative, where Serebii's mechanics page is more complete.
- `[inference]` never outranks a source. It is only used where sources are silent or mutually contradictory.

This mirrors `RULES_SOURCES` in the constants module, which is ordered the same way.

---

## 1. Board

**28 nodes, 34 edges.** A 7×5 outer ring (20 nodes) plus a 3×3 inner ring with no centre (8 nodes), joined by 4 corner diagonals and 2 goal-side diagonals. `[smogon]` `[bulbapedia]`

- **26 non-goal nodes**, which matches the officially stated point count and is the cross-check that confirms the 28-node reading describes the right board. `[official]` `[inference]`
- **Goals have degree 2.** `[smogon]` This is load-bearing, not trivia: it is precisely why the goal-clamp surround kill works. A board graph that gives a goal degree 3 has a bug, not a variant layout.
- **Entry points are the 4 outer corners, degree 3.** An occupied entry point cannot be deployed onto, and *either* player's figure blocks it. `[serebii]`
- **180°-rotationally symmetric, not mirrored.** `[smogon]` Load-bearing for strategy and for board-graph tests.
- **Node degree varies between 2 and 3, so surround arity is computed per node**, never hardcoded. `[inference from the topology]`
- **Exactly one board layout exists.** The blue/red tinting is art with no mechanical meaning. `[serebii]`

> ⚠️ **Topology is the least verified part of this document.** It is triangulated from Smogon's prose, the official node count, and pixel inspection of board renders — no board image has been inspected first-hand by this project. The `board-movement` work should begin by verifying it rather than trusting it. One consequence is [Ruling 1](#ruling-1--goal-side-diagonal-attachment).

Constants: `BOARD_NODE_COUNT`, `BOARD_EDGE_COUNT`, `GOAL_NODE_COUNT`, `NON_GOAL_NODE_COUNT`, `GOAL_NODE_DEGREE`, `ENTRY_POINT_COUNT`, `ENTRY_POINT_DEGREE`, `MIN_NODE_DEGREE`, `MAX_NODE_DEGREE`.

### Three distinct graph relations

Collapsing these into one "distance" function is a design error the effect corpus rules out. `[data]`

| Relation | Respects occupancy? | Used for |
|---|---|---|
| `mpReachable` | Yes — blocked by any figure | Legal MP movement |
| `stepDistance` | No | "within N steps", "N steps away", battle range |
| `connectedComponent` | N/A — typed walk | "every Electric-type Pokémon it is connected to", and the "succession" of adjacent figures in Invisible Wall, Cosmic Surfer, Forest Leap |

`nStepsAway` appears 209 times and `withinNSteps` 199 times in the clause corpus, with measured ranges `{1,2,3,4}` and `{2,3}` respectively, so step distance is genuinely independent of reachability. `[data]`

---

## 2. Turn structure

A turn offers up to three things, in **strict order**: `[serebii]` `[official]`

1. **Optionally play one plate** — must precede moving.
2. **Optionally move one figure** — an MP move, a deploy, a tag, or an ability action.
3. **Optionally initiate one battle.**

Battle is optional, and **a figure may battle without moving**. This is a large part of why the game favours the defender. `[serebii]`

Constants: `PLATES_PER_TURN`, `MOVES_PER_TURN`, `BATTLES_PER_TURN`, `PLATES_ALLOWED_AFTER_MOVING`.

### Four turn-time windows, not one

The effect corpus forces four distinct windows. Reading only the rules pages would have produced one. `[data]`

| Window | Evidence |
|---|---|
| Plate window | Rules prose; closes permanently once a figure moves |
| "At the start of your turn" | Shed Skin, Loyalty, Stance Change: B, Surprise Strike, Time Travel |
| "Before using this Pokémon" | Run Off, Strong Breeze, Ice Breaker, Stance Change: S, Volt Swap, Illusion |
| The action itself | — |

### "Instead of an MP move" is a whole action class

Over thirty abilities replace the movement action rather than modifying it: the three Lock On variants, Long Lick, Entangle, Forest Leap, Electroswap, Cosmic Surfer, Distort, High-Speed Drill, Bug Trap, Ice Shield, Gulp, Magnetic Body, Raid, Rush In, Slime Touch, Snowy Transformation, Swarm, Tectonic Tunnel, Tunnel Construction B, Ultra Pump Up, Spaceborn, Rocket Ride, Time Travel. `[data]`

So the action window accepts `MpMove | Deploy | Tag | AbilityAction`, with `AbilityAction` a first-class sibling rather than a special case.

---

## 3. Movement and MP

- **MP is 0–3 base and reaches 4 via abilities.** Do not clamp at 3. `[data]`
- **MP may be partially spent.** `[serebii]`
- **Deploying costs 1 MP, and leftover MP continues the same move.** `[serebii]`
- **The first-turn MP−1 penalty applies only to the starting player, on their first turn only** — which is why a 1 MP figure cannot be deployed on turn one. It is not a general first-round penalty. `[serebii]`
- **All figures block movement, friendly and enemy alike.** Pass-through is an ability, not a default. `[serebii]`

Base MP distribution: MP0 ×5, MP1 ×71, MP2 ×377, MP3 ×143. `[data]`

The five 0-MP figures are immobile by design, each with an ability that explains it: Metapod and Kakuna (Metamorphosis), Spiritomb (Grudge Stone), Aegislash Blade Forme (Stance Change: B), Regigigas (Slow Start). `[data]` A schema with `mp: 1|2|3` would reject all five, which is how the 0 floor was discovered.

Constants: `MP_BASE_MIN`, `MP_BASE_MAX`, `MP_EFFECTIVE_MAX`, `DEPLOY_MP_COST`, `FIRST_TURN_MP_PENALTY`.

### Movement permission is a predicate space, not a flag

The corpus contains *through*, *over*, *under*, *past-if-burned*, *over-non-Flying*, and asymmetric "others may move over me", with named effects (Fly, Fly Away, Soar) that other abilities nullify. `[data]` `grantMovement` accounts for 97 compiled actions.

---

## 4. Battle resolution

### The colour hierarchy

**Blue > Gold > Purple > White > Miss** `[serebii]` `[bulbapedia]` `[official]`

This is *not* a total order, and implementing it as one is a bug:

| Matchup | Result |
|---|---|
| Blue vs anything | Blue wins |
| Blue vs Blue | Draw |
| Gold vs Purple | Gold wins |
| **Gold vs White, White vs White, Gold vs Gold** | **Higher damage wins; equal damage is a draw and both survive** |
| Purple vs Purple | Higher ☆ wins; **equal ☆ is a draw and neither effect fires** |
| Miss vs anything | Miss loses |
| Miss vs Miss | Draw |

- **Gold has no advantage over White.** Its only privilege is beating Purple. `[serebii]`
- **Gold knocks out on any damage above 0** when it wins. `[serebii]`
- **The winner does not advance.** Repositioning after a battle exists only where effect text says so explicitly. `[serebii]`
- **Trigger resolution starts with the player who initiated the battle.** `[serebii]`
- **Chain Level adds +1 damage per level**, acting as a hidden tiebreaker. `[serebii]`

Constants: `GOLD_BEATS_BLUE`, `GOLD_BEATS_WHITE`, `EQUAL_DAMAGE_IS_DRAW`, `EQUAL_STARS_IS_DRAW`, `WINNER_ADVANCES`, `CHAIN_LEVEL_DAMAGE_PER_LEVEL`, `INITIATOR_TRIGGERS_FIRST`.

> **Two sources claim Gold beats Blue. They are overruled.** See [Conflict 1](#conflict-1--does-gold-beat-blue) for the full record.

**Chain Level appears in zero effect texts** across all 2,614 of them, so it is engine-internal only and no ability interacts with it. `[data]`

### Targeting

Battle targeting is **not** strictly adjacency. "Range 2" is explicit game vocabulary: High Flying attacks two spaces away *through* an intervening figure, and Two-Sword Strike, Paper Sword, Psychic Amplifier, Meditative Alchemy and Stance Change: B all grant it. `[data]` Target selection therefore takes a range.

Constants: `BATTLE_RANGE_DEFAULT`, `BATTLE_RANGE_MAX`.

### Wheels

Every wheel is an ordered, cyclic sequence of integer segments **summing to exactly 96**. Verified on **596 of 596 figures** with zero validator errors. `[data]`

This is the strongest invariant in the project and it earns its keep: it is what exposed Vaporeon, where Serebii listed `50` for Quick Attack — the move's *power*, not its probability. Bulbapedia gives `power=50|prob=24`, and 24 is exactly what makes the wheel total 96. `[adjudication]`

Segments carry one of four damage shapes, or none. Counts are over **all 3,663 segments — 2,707 base-wheel plus 956 Z-Move**, since the shapes are the same in both: `[data]`

| Shape | All segments | Base wheel only | Notes |
|---|---|---|---|
| `fixed` | 1,727 | 959 | Not always a multiple of ten — the data contains 67, 103, 142, 206, 302 |
| `stars` | 656 | 476 | Purple only (with one caveat — see §9) |
| `multiplier` | 44 | 44 | A repeat-until-miss loop, not a modifier. Z-Moves never use it |
| `variable` | 13 | 13 | Written "90+" |
| none | 1,223 | 1,215 | Blue, Miss, and status-only Purple |

Base-wheel colour distribution, for reference: White 919, Miss 832, Purple 478, Blue 360, Gold 118. `[data]` Gold is much the rarest colour, on roughly a fifth as many segments as White.

**The multiplier semantics are a control-flow primitive.** Verbatim: *"Spin again until Bullet Seed does not land — damage is multiplied by the number of Bullet Seed spins."* Rock Blast, Fury Attack, Rollout, Fire Spin, Pin Missile and Icicle Spear share it. `[data]`

Multipliers sometimes count **figures** rather than spins: *"multiplied by the number of Pin Missile spins"* and *"…by the number of your own Pokémon"* read almost identically but one is a loop tally and the other a board query. `[data]`

**Wheel resizing does not exist** — zero texts. **Wheel rotation does** — *"Shifts this Pokémon's Attacks two segments clockwise"* (the Mawile line). `[data]`

**Segment substitution is its own hook.** Rocket Ride turns Flamethrower into Flame Gun; Open Sea Singer redefines Round; the Land's Energy plate redefines Land's Wrath; Meteoric Teachings redefines Break Energy; Golden Module replaces a Purple segment with a Gold one. `[data]`

**Respins are a stacking counter, not a boolean.** Impermeable Mail and King Horn each *"add +1 spin"*, and Psychic Net scales with Reuniclus count. `[data]` 76 compiled `respin` actions.

**Spin is a standalone primitive.** Many abilities force spins outside combat — Entry Shot, the Lock On family, Long Lick, Entangle, Grudge Stone, Spark Noise, Acid Downpour — so spinning must not be entangled with the battle phase. `[data]` `spin` is the single most common action in the corpus at 816 mentions.

Constants: `WHEEL_TOTAL_UNITS`, `PURPLE_STAR_MIN`, `PURPLE_STAR_MAX`.

### Damage is not a running integer sum

The pipeline needs **ordered additive and multiplicative stages**: `[data]`

- Dual Brains deals *"×2 damage"*; Fluffy and Shadow Shield halve.
- Hacking Gems applies *"−1 damage"*.
- The four dance abilities and Green Power add per-figure increments of +1 or +5.
- Measured damage bonuses: `{+1, +5, +10, +20, +30, +50, +60}`.

Knockout prevention is a separate stage again — 81 compiled `prevent` actions. `[data]`

---

## 5. The three independent state layers

These are three separate layers with different lifetimes, and conflating any two of them breaks real cards. `[data]`

### Special conditions — exactly 7, max 1, and none expire

A new condition **replaces** the old one. None wear off on their own. `[serebii]` `[data]`

| Condition | Effect | Corpus mentions |
|---|---|---|
| Poisoned | −20 damage | 106 |
| Noxious | −40 damage | 44 |
| Burn | −10 damage, and the smallest non-Miss segment becomes Miss | 157 |
| Paralyzed | Smallest non-Miss segment becomes Miss | 163 |
| Sleep | See [Ruling 4](#ruling-4--sleep-and-frozen-versus-mp-movement) | 48 |
| Frozen | Attacks forced to Miss; cleared after a battle | 94 |
| Confusion | The landed result advances one segment clockwise | 132 |

**Noxious is the 7th condition and is genuinely distinct from Poisoned.** Mega Beedrill settles it outright by branching on both in one sentence: *"If the battle opponent is noxious, exclude it from the duel. If it's not noxious, the battle opponent becomes poisoned."* `[data]` A source that treats them as synonyms is wrong.

Constants: `MAX_CONDITIONS_PER_FIGURE`, `CONDITION_BLOCKS_MP_MOVE`.

### Wait N

An integer counter that **ticks on every turn, including the opponent's** `[serebii]` — so Wait 4 costs two of your own turns, not four. Measured values: `{2, 3, 4, 5, 7, 9, 10}`, and `wait` is the most common marker in the corpus at 420 mentions. `[data]`

Constant: `WAIT_TICKS_ON_BOTH_TURNS`.

### Markers — max 1, an open set

Cleared on leaving the field. At least **19 named kinds**: Cracked, Curse, Photon, Final Song, Branded, Imprisoned, Pumpkin, Clinging Gas, Weak Armor, Symbiont, Disguise, Forest Mischief, Lock-On, Charge, Mummy, Slime, Alchemy, plus the MP modifiers. `[data]`

Frequency: Wait 420, MP−1 65, Cracked 50, MP−2 46, Curse 12, MP+1 5, then a long tail appearing once or twice. `[data]`

**Markers must be an open registry, not a union type.** An early probe reported 7 kinds; the corpus has at least 19 with a long tail, so a closed union would have silently rejected real cards. Conditions really are closed at 7; markers are not. `[data]`

Constant: `MAX_MARKERS_PER_FIGURE`.

### Cures

- **Tagging** — touch an afflicted ally from an adjacent point. **It ends your turn**, and several abilities block being tagged. `[serebii]`
- Heal plates, P.C. visits, and abilities. `[serebii]` 77 compiled `cureConditions` actions. `[data]`

Constant: `TAGGING_ENDS_TURN`.

---

## 6. Zones

| Zone | Rules |
|---|---|
| Bench | Default holding area |
| Field | The 28-node board |
| P.C. | **Max 2.** A third entrant pushes the oldest out to the bench **with a Wait** (FIFO, not player's choice) `[serebii]` |
| Excluded | Out of the duel; may be **temporary with a return timer** — Rampager 5 turns, Inferno Ladder 7 `[data]` |
| Ultra Space | Markers and conditions **retained**; Wait and Mega timers **frozen** `[serebii]` |

123 compiled `exclude` actions and 50 `ultraSpace` selector uses confirm both are load-bearing rather than edge cases. `[data]`

Constants: `PC_CAPACITY`, `PC_OVERFLOW_IS_FIFO`, `TEMPORARY_EXCLUSION_DEFAULT_TURNS`, `ULTRA_SPACE_FREEZES_TIMERS`.

---

## 7. Plates

- Up to **6 slots**, **total cost ≤ 8**. Stated outright on Serebii's plate listing. `[serebii]`
- Individual plate cost is 1, 2 or 3. `[data]` — 152 plates.
- **Each usable once per duel**, unless the plate is resettable (Recycle, Gracidea, Meteoric Teachings). `[serebii]` `[data]`
- **Own turn only, never mid-battle.** `[serebii]`
- **Whether a plate consumes the turn is literally whether its text ends "Your turn ends."** `[data]` — so `endsTurn` is parsed, not curated.
- Plates can be **locked out entirely** by abilities: Intimidating Aura, Wily Jaws, Big Chorus, Hypnotic Voice. `[data]`
- Plate durations are `thisTurn`, `whileOnField`, or `untilEvent` (Iron Power). `[data]`

Constants: `PLATE_DECK_SLOTS`, `PLATE_COST_BUDGET`, `PLATE_USES_PER_DUEL`, `PLATES_ALLOWED_MID_BATTLE`, `PLATES_ALLOWED_AFTER_MOVING`.

---

## 8. Win conditions

1. **Goal capture** — move a figure into the opponent's goal. **By movement only.** `[serebii]` Three abilities forbid their own figure from winning at the goal at all, so the check carries a per-figure lockout. `[data]`
2. **Surround** — a figure is knocked out when every adjacent node is occupied by enemies. **Checked at the end of movement**, not continuously. `[serebii]` Arity is per node, since degree varies.
3. **Wait Victory** — a player with no legal action loses. **Playing a plate counts as an action**, so it postpones this. `[serebii]`
4. **Clock** — a **5-minute per-player chess clock**; running out loses. `[serebii]`
5. **300-turn cap** — see [Ruling 2](#ruling-2--300-turn-behaviour).

Constants: `GOAL_CAPTURE_REQUIRES_MOVEMENT`, `SURROUND_CHECKED_AT_END_OF_MOVEMENT`, `PLATE_COUNTS_AS_ACTION_FOR_WAIT_VICTORY`, `CHESS_CLOCK_MINUTES`, `CHESS_CLOCK_MS`, `TURN_LIMIT`, `SURROUND_GOAL_PRIORITY`, `MAX_SURROUNDS_PER_TURN`.

Interactions between 1, 2 and 5 are unsettled: see [Ruling 2](#ruling-2--300-turn-behaviour), [Ruling 3](#ruling-3--surround-versus-goal-victory-priority) and [Ruling 6](#ruling-6--one-surround-per-turn).

---

## 9. Content-layer invariants the rules depend on

`tools/validate.mjs` checks these and exits non-zero. It distinguishes **errors** from **warnings**, and the distinction is worth stating precisely rather than rounding off to "the data is validated". `[data]`

**Hard errors — the engine may assume these:**

- Every wheel sums to exactly **96** (gated on the figure's `dataComplete` flag).
- **Base-wheel** stars appear only on Purple segments, within **1–4**.
- Base-wheel segment colours are one of the five known values, and sizes are integers ≥ 1.
- Base MP is within **0–3**.
- Figure ids are unique; **at most two types** per figure, each a known type. 338 of 596 are dual-typed.
- Plate cost is within **1–3** and every plate has effect text.

**Warnings — true in practice, but *not* guaranteed:**

- **Every wheel has a Miss segment.** Widely true and relied on by the wheel-construction hooks, but only warned about, so engine code should not assume it without checking.
- No Purple segment lacks a star value — see [Ruling 7](#ruling-7--the-two-starless-purple-segments) for the two that do.
- No Miss segment carries damage.

**Not checked:**

- **Z-Move segments.** The per-segment colour and star *error* checks loop over `wheel` only, never `zMoves`. The summary statistics do include Z-Moves, which is why the "max 4★" figure is trustworthy while the colour data is not — see §15.
- **Reference resolution.** That every ability, form and evolution id resolves is *claimed* but not actually asserted anywhere. It is a reasonable thing to believe and an unreasonable thing to rely on; the `content-schema` work should make it real.

A validator turned out to be worth more than a careful parser: it caught the `moveocl=` parameter-name typo, the star-range error, and Miss-segment gaps that reading by hand had missed. `[data]` Folding it into the zod schema layer is the `content-schema` work, which should close the Z-Move hole while it is there.

Constant: `MAX_TYPES_PER_FIGURE`.

### Dual typing is real and load-bearing

Dry Skin reads *"if the battle opponent is a Water-type Pokémon **that does not have any other types**"* and Enhanced Core targets *"your Pokémon that are **both** Electric and Steel type"*. `[data]` A single-type field would break both.

**Type order is unreliable in both sources and must never be load-bearing.** Bulbapedia inverts Durant and Toxapex; Serebii inverts Stunfisk. The type *sets* agree, so order is pinned to the National Dex and engine logic treats types as an unordered set. `[adjudication]`

---

## 10. Questions closed by reading the data

Seven questions that looked open, and are not. Each was closed by measurement rather than argument. `[data]`

| Question | Resolution | Evidence |
|---|---|---|
| Do wheel variants exist? | **No.** A figure has exactly one current wheel. | The repeated move tables are **patch-version history, newest-first** — every figure page wraps them in `<li class="tabs" title="V7.0.14">`. Verified on Dialga, Charizard, Heatran, Toxapex, Noivern. |
| What is the Purple ☆ range? | **1–4.** | Bulbapedia's explicit `stars=` across **1,317 scraped Purple segments** never exceeds 4. Distribution `{1: 406, 2: 434, 3: 256, 4: 221}` — no 5 anywhere. Serebii's lone apparent 5★ was an error; on Serebii stars hide in the *damage* column as `&star;` entities. **Note the 1,317 is a raw-scrape count and includes the patch-history tables**, so it is larger than the 650 Purple segments in the merged content (478 base-wheel + 172 Z-Move); it is the right number for "how much evidence bounds the range", not for "how many Purple segments the game has". |
| Is the plate budget a count or a cost? | **Total cost ≤ 8.** | Stated outright on Serebii's plate listing. |
| What is the 7th condition? | **Noxious**, distinct from Poisoned. | Mega Beedrill branches on both in one sentence. |
| What is the base MP floor? | **0.** | Five figures are deliberately immobile, each with an ability that explains it. |
| Does anything interact with Chain Level? | **No.** Engine-internal only. | Zero occurrences across 2,614 effect texts. |
| Are markers a closed set? | **No** — at least 19 named kinds. | Corpus enumeration. Conditions *are* closed at 7. |

---

## 11. Source conflicts and their rulings

Where sources disagree, the conflict is recorded with the ruling and the reasoning. None is silently resolved.

### Conflict 1 — Does Gold beat Blue?

**The claim.** Two launch-week third-party guides state that Gold defeats Blue. `[launch]`

**The counter-evidence.** Five better sources give the hierarchy as **Blue > Gold > Purple > White > Miss**, with Gold's only stated privilege being that it beats Purple: Serebii's mechanics page, Bulbapedia, the official primer, Smogon, and the Fandom wikis. `[serebii]` `[bulbapedia]` `[official]` `[smogon]` `[fandom]`

**Ruling: Gold does not beat Blue.** `GOLD_BEATS_BLUE = false`. Confidence: **high**.

**Reasoning, in descending weight:**

1. **Source weight is five to two, and the two are the weakest tier.** Both claimants are launch-week guides, written before the mechanics pages stabilised and roughly three years before Ver. 7.0.14. Even if they described launch behaviour correctly, they cannot speak to the final build — and this project targets the final build.
2. **The claim makes the hierarchy cyclic.** Blue > Gold > Purple plus Gold > Blue is a cycle, and it cannot be expressed in the linear `A > B > C > D > E` form that every better source uses. Those sources are not summarising a cycle badly; they are describing something else.
3. **Wheel economics point the same way.** `[data]` Measured per-segment footprint across all 596 wheels:

   | Colour | Segments | Mean size (/96) | Min | Max |
   |---|---|---|---|---|
   | White | 919 | 32.18 | 8 | 72 |
   | Purple | 478 | 27.25 | 8 | 60 |
   | **Gold** | 118 | **27.11** | 8 | 60 |
   | **Blue** | 360 | **15.12** | **4** | 40 |
   | Miss | 832 | 7.18 | 1 | 32 |

   When the designers grant a Gold outcome they grant a window the same width as an ordinary Purple (27.11 vs 27.25). When they grant a Blue they grant one **less than half** as wide, and Blue holds the smallest non-Miss minimum on the board at 4 units. The pricing says Gold is a Purple-class outcome and Blue is a class above it — exactly the hierarchy the five sources describe.

   *Stated honestly:* this is circumstantial, not a rules citation, and it is not unambiguous. Gold occupies less *aggregate* wheel space than Blue (3,199 units total against 5,444), because far fewer figures carry a Gold at all. The per-segment figure is the relevant one for pricing a single outcome, but a reader is entitled to weigh that differently, so it is ranked third rather than first.

   Reproduce with: `node -p "const a=require('./data/content/figures.json'); ..."` over `figures.json`, grouping `wheel[].size` by `wheel[].color`.

**How to flip:** set `GOLD_BEATS_BLUE = true`. It is read only by the colour-comparison step of the battle pipeline.

### Conflict 2 — Sleep and Frozen versus movement

Four sources contradict each other. Unresolvable from prose; escalated to [Ruling 4](#ruling-4--sleep-and-frozen-versus-mp-movement).

### Conflict 3 — Ability names and effects across sources

29 disagreements, all adjudicated; 17 decisions logged in `data/content/decisions.json` with reasoning. `[adjudication]` They split cleanly once the effect *text* was compared rather than the name:

- **Three pure renames** with identical text: Rhyhorn `Onslaught` → `Reckless Charge`, Electivire `Ace` → `Grounding`, Delphox `Magic Trick_Miss` → `Magic Trick`.
- **Six Serebii typos**: `Bigg Eggsplosion`, `Eartne Rapids`, `Transcendant Helix`, `Guartop Steelshell`, `Magic Trick_Miss`.
- **Five cases of genuine version drift** where the mechanic itself changed — Drapion went from a respin-forcing `Battle Armor` to a poison-damage aura `Diffuse Poison`; Wimpod from a damage aura to the switch-out `Wimp Out`. **Bulbapedia held the newer version in every one.**

**Bulbapedia is the default winner, and it earned the position.** It was right on all six disputed type sets — Serebii had Landorus as *Fire/Psychic* and Stakataka as *Fighting/Ghost*, both flatly wrong — corrects every spelling error found, and carries newer version data. `[adjudication]`

### Conflict 4 — Rarity versus material cost

An earlier build derived rarity from material cost (C=250, UC=450, R=1800, EX=4000, UX=5000) and used it to override both wikis, silently rewriting five figures. `tools/check-rarity.mjs` showed the relation is **one-to-many**: R exists at 1800 *and* 2700; EX at 3000/4000/6000/8000; UX at 5000/7500/10000. `[data]`

**Ruling: the override was reverted.** The two real rarity conflicts are flagged as contested instead — see [Ruling 8](#ruling-8--the-contested-figure-fields). The same check caught a field swap where Alolan Sandslash carries material cost `2700` in its *gems* field.

**The lesson, recorded because it will recur:** a plausible pattern that holds for 590 of 596 rows is still not a rule.

### Conflict 5 — Scrafty's wheel is unrecoverable

Bulbapedia, live Serebii, and **all 11 Internet Archive snapshots of Serebii from 2019 to 2024** give the identical 92/96. `[adjudication]`

**Ruling: padded with a 4-unit Miss and flagged `inferred`.** Miss is the neutral outcome, so no power is invented, and Scrafty already carries 4- and 8-unit Miss segments, making a third idiomatic.

Two other figures carry an `inferred` flag: Shiny Vaporeon (no wheel on either source; rarity matched to base Vaporeon — marked **REVIEW** in the data) and Shiny Mimikyu. `[data]`

### Conflict 6 — Transcription and encoding hazards

Recorded because they are the class of bug that silently produces plausible wrong numbers. `[data]`

- **Unicode broke counting twice.** Bulbapedia writes markers as `MP −2` with U+2212 and multipliers as `40×` with U+00D7. The first under-counted MP markers **8×**; the second silently demoted **38 multiplier segments** to plain fixed damage. Unicode dashes and multiplication signs must be folded before any matching.
- **Bulbapedia's typos are in the parameter *names*.** Four segments use `moveocl=` instead of `movecol=`, and four use `movecol=whie`. A missing colour yields `null` rather than an error, so the parser accepts both misspellings explicitly.
- **Serebii leaks MediaWiki templates** as `Special Condition|poisoned` in 160 clauses.
- **Wording differs across sources**, so normalisation is a required stage: `faint` ≡ knocked out, `neighbour`/`neighbor` ≡ adjacent, `switches place(s)` ≡ swap positions. Unfolded, one mechanic fragments into several patterns.
- **No single source is complete.** Serebii's ability listing and its figure pages each held one ability the other lacked (`Flame Evolution` on Larvesta; `Control Mask` on no figure). Bulbapedia contributed 17 more. Final count: **382**. Same for wheels: 22 broken on Serebii, 13 on Bulbapedia, but only **one** broken on both. Cross-validation is the whole reason coverage reached 100%.

---

## 12. Corrections the data forced

The architecture's *shape* survived contact with the real content; its *specifics* did not. Recorded so the same mistakes are not re-made, and as the standing argument for measuring before designing. `[data]`

| Assumption | Reality | Proof |
|---|---|---|
| One type per figure | Up to two | Dry Skin's *"does not have any other types"*; Enhanced Core's *"both Electric and Steel"* |
| An ability is one handler | An **ordered array of clauses**, each on its own hook | Barbed Horns carries four independent clauses — pass-through movement, a tag prohibition, a Gold-to-Miss conversion, and a team damage aura. Prism Armor: Dawn carries six |
| One action per turn | "Instead of an MP move" is a whole action class | 30+ abilities |
| One turn-time window | Four | §2 |
| Targeting is adjacency | Targeting takes a range | "Range 2" is game vocabulary |
| Form change is Evolution | A **separate first-class system** | Rotom's five forms, Necrozma Dusk Mane/Dawn Wings/Ultra, Aegislash stance, Kyurem fusion, Primal Reversion, Zygarde Complete, Keldeo Resolute, Shaymin Sky, the weather trio. Several read *"can only be set as a form in a deck"* (Enforcer, Neuroforce, Teravolt, Turboblaze, Stance Change: B), so **forms affect deck validation too** |
| Evolution has one trigger | Many, and it can branch | After battle (Emergent Evolution, Metamorphosis), on being knocked out (Rapid Evolution, Evolution to Beauty, Trainee), on P.C.-to-bench (Spontaneous Evolution, Upside-Down Evolution), on spinning one move three times (Arm Thrust Evolution), on inflicting a condition (Poisonous Evolution, Floating Candle), on surrounding (Black Core), and *"undergoes branching Evolution"* (Bright Arrow). A stage concept exists too — Winged Sphere targets *"Stage 1 or higher"* |
| Damage is additive tens | Ordered additive **and** multiplicative stages over integers | §4 |
| Distance is one relation | Three | §1 |
| Moves are fixed | Substitutable wholesale | §4 |
| Respin is a boolean | A stacking counter | §4 |
| Types are permanent | Temporarily overwritable | Multitype, RKS System, the Rotom plates' *"all Pokémon become Fire-type for 9 turns"* |
| Mega duration is fixed | Modifiable | Ruinous Helix +2; Flower Carpet freezes it |
| Triggers are conditions | **Separate types** | 69 clauses read *"If this Pokémon is knocked out, the battle opponent becomes burned"* — as a guard it could never fire, because the figure is gone by evaluation time. They are subscriptions to future events |
| Ties are non-events | Tie-triggered effects exist | *"If the battle is a tie, the battle opponent is excluded from the duel"* (Palkia, Darkrai) |

### Advanced systems

- **Mega Evolution** — 7 turns, one per duel, modifiable duration, team aura. 67 compiled `megaEvolve` actions. `[data]`
- **Z-Moves** — the charge gauge is manipulable in both directions. 52 compiled `adjustZGauge` actions. Some figures carry more than one Z-Move (Mega Garchomp carries two). `[data]`
- **Celebi's Time Travel** — an event-log rewind, which the event-sourced engine makes a replay operation rather than a special case.

Constants: `MEGA_DURATION_TURNS`, `MEGA_EVOLUTIONS_PER_DUEL`.

### Nullification

Ten abilities nullify others: Mold Breaker, Enforcer, Mummy, Branded, Black Core, Superjammer, Psychic Sensor, Frost Sphere, Silk Sphere, Venom Sphere. `[data]` Combined with the recurring *"this effect does not stack"*, this forces a **two-pass** hook bus: pass one computes the surviving clause set after nullifiers and `noStack` collapsing, pass two runs survivors in layer order. A single-pass bus cannot express it.

---

## 13. The eight open rulings

None of these is settled by available evidence. Each is a named constant in [`src/rules/constants.ts`](../src/rules/constants.ts), carries a confidence level, and is listed in the machine-readable `OPEN_RULINGS` registry so the rules inspector can tell a player *"this outcome depended on a ruling we are only medium-confident in"* rather than presenting a guess as a fact.

No ruling is allowed confidence `verified` — a verified question is not open, and the test suite enforces it.

### Ruling 1 — Goal-side diagonal attachment

**Question.** Do the two goal-side diagonals meet the ring node immediately beside the goal, or the next node out?

**Ruling: immediately beside the goal.** `GOAL_SIDE_DIAGONAL_ATTACHMENT = 'adjacentToGoal'`. Confidence: **medium**.

**Reasoning.** Two board renders disagree and neither has been inspected first-hand. `[community]` `[smogon]` Both readings preserve the verified 28 nodes / 34 edges and leave the goal at degree 2 — the diagonal terminates *beside* the goal, not on it, under either. `[inference]` The chosen reading is the one that gives the defender the short diagonal route into the goal mouth that the board's defensive character depends on; `oneNodeOut` leaves the goal approach a pure corridor, which no strategy source describes.

**Blast radius.** Two edges in the board graph. Shifts goal approach routes, MP reachability near the goal, and which nodes participate in a goal clamp. Read only by board and movement code.

**To settle it:** inspect a Ver. 7 board render directly. This is the cheapest of the eight to resolve and should be done as the first step of `board-movement`.

### Ruling 2 — 300-turn behaviour

**Question.** What happens at 300 turns, and does 300 count player-turns or rounds?

**Ruling: a draw, counting individual player-turns.** `TURN_LIMIT_OUTCOME = 'draw'`, `TURN_LIMIT_COUNTING = 'playerTurns'`, `TURN_LIMIT = 300`. Confidence: **low** — the lowest in this document.

**Reasoning.** Effectively single-sourced, and the source is silent on both halves. `[fandom]` A draw is chosen as the least destructive option: it invents no winner, and it is the only outcome that cannot silently corrupt AI training or a golden replay by awarding a result the real game would not have. `mostFiguresOnField` is the most plausible alternative if evidence appears, since it mirrors how other deadlock rules break ties by board presence.

`playerTurns` is chosen because every other turn-scoped counter in the game — Wait ticking, Mega duration, temporary exclusion — counts individual turns, so it is the internally consistent reading. `[inference]` The two readings differ by a factor of two: 300 rounds is 600 individual turns, a very long duel for a game with a 5-minute clock.

**Blast radius.** Only duels that reach the cap, which the chess clock makes rare. Matters most to the fuzz harness, whose termination invariant ("every game terminates within 300 turns") is written against this constant.

### Ruling 3 — Surround versus goal victory priority

**Question.** If one movement both captures the goal and leaves the moving figure surrounded, which resolves?

**Ruling: surround. The mover is knocked out and no goal is scored.** `SURROUND_GOAL_PRIORITY = 'surroundFirst'`. Confidence: **medium**.

**Reasoning.** Community evidence says surround wins, but it is single-sourced and undocumented. `[community]` Two structural arguments support it: `[inference]`

1. Surround is checked at the end of movement, and goal capture is itself a movement result, so both are evaluated in the same window — and a knocked-out figure cannot be standing on the goal.
2. The opposite ruling would make the goal clamp unusable as a defence. Goals have degree 2 specifically so that two figures can seal one, and `goalFirst` would mean the clamp never stops a goal run, only punishes it afterwards. That the topology exists to support the clamp is circumstantial support for the clamp working.

**Blast radius.** A rare but game-ending interaction, and one the MCTS AI will find. A wrong ruling here teaches the AI an unsound sacrifice line, which is worse than the rarity suggests.

### Ruling 4 — Sleep and Frozen versus MP movement

**Question.** Do Sleep and Frozen prevent their figure from making an MP move?

**Ruling: Sleep prevents movement; Frozen does not.** `CONDITION_BLOCKS_MP_MOVE`. Confidence: **medium**.

**Reasoning.** The official primer, Serebii, the Fandom wikis and Smogon all contradict each other, so prose cannot settle it and the decision is made on internal consistency. `[official]` `[serebii]` `[fandom]` `[smogon]` `[inference]`

- **Frozen already has a complete mechanic**: attacks are forced to Miss, and it clears after a battle. It is a fully specified condition without a movement clause, so adding one would be invention.
- **Sleep has no stated battle effect at all.** Since no condition expires on its own, a Sleep that did not stop movement would be a condition that does literally nothing — a permanently attached no-op. That cannot be right, so movement is what Sleep must affect.

The other five conditions all have fully specified wheel or damage effects and are therefore `false` with high confidence; only the Sleep and Frozen entries are genuinely rulings.

**Blast radius.** Changes the legal move set whenever either condition is on the board, which moves both the AI's evaluation and the Wait Victory check. The widest-reaching of the eight in ordinary play.

### Ruling 5 — Voluntary pass

**Question.** May a player decline to act when legal actions exist?

**Ruling: no. Passing is not a legal action.** `VOLUNTARY_PASS_ALLOWED = false`. Confidence: **high**.

**Reasoning.** No source addresses it directly, and player evidence leans towards no. `[community]` **Wait Victory settles it by implication:** a player loses when they have *no legal action*, so if "pass" were always available then no player could ever be without one, and Wait Victory could never trigger. Since Wait Victory is documented, voluntary passing cannot exist. `[inference]`

This is the only ruling here rated `high` on inference alone, and the rating is earned by the argument being a contradiction rather than a preference. It is `high` and not `verified` because it is still derived rather than sourced.

Note the distinction the engine must keep: a figure with 0 MP and nothing to battle still **ends its turn**. That is the *absence* of a legal action — the thing that feeds Wait Victory — not a pass.

**Blast radius.** Adds or removes a command from every action window, changing the AI branching factor everywhere, and decides whether Wait Victory is reachable at all.

### Ruling 6 — One surround per turn

**Question.** Did the Trading Figure Game's one-surround-per-turn cap carry over to Duel?

**Ruling: no cap. Every surround produced by a movement resolves.** `MAX_SURROUNDS_PER_TURN = null`. Confidence: **medium**.

**Reasoning.** The cap is a Trading Figure Game rule and no Ver. 7 source restates it. `[community]` It is also hard to attach to anything in the digital game: surround is an automatic end-of-movement board-state check, not a player action, so there is no decision point at which a player would choose *which* surround to take. `[inference]` A cap needs an agent to bind, and there isn't one.

**Blast radius.** Only turns where one movement completes two surrounds at once — rare, because a movement changes occupancy at just two nodes. That rarity is also why no better evidence has surfaced: the two rulings are nearly indistinguishable from replays.

**To flip:** set `MAX_SURROUNDS_PER_TURN = 1`. The engine reads it as a cap on knockouts emitted by a single surround-check phase. `null` means unlimited; `0` would mean surround never kills, which is why the sentinel is `null` and not a number.

### Ruling 7 — The two starless Purple segments

**Question.** Are Dragonite's *Sightseeing* and Mega Metagross's *Teleport Beam* genuinely 0★, or is the star value simply missing from the source?

**Ruling: missing. Substitute 1★.** `STARLESS_PURPLE_POLICY = 'sourceOmission'`, `STARLESS_PURPLE_SUBSTITUTE_STARS = 1`. Confidence: **medium**.

**Reasoning.** `[data]` `[bulbapedia]` `[inference]`

1. A genuine 0 would sit outside the 1–4 range that **1,317 scraped Purple segments** establish, and it is an error under `tools/validate.mjs`, not merely unusual. Omission is much the likelier explanation for **two rows out of 478** base-wheel Purple segments.
2. **The ruling is nearly harmless, and this is checkable.** Both segments carry `damage: null` — verified directly against `figures.json`; they are the *only* two base-wheel Purple segments in the merged content without a `stars` damage shape (476 of 478 have one). So stars feed only the Purple-vs-Purple ☆ comparison here, never a damage number.
3. Substituting the floor of the legal range means the ruling can understate these two segments but can never hand them an unearned win.

**Blast radius.** Two segments on two figures, and only in a Purple mirror match.

**A larger mirror-image gap exists and is *not* covered by this ruling.** **65 Z-Move segments carry no colour at all** (`color: null`) — the opposite omission, and far more of it. Eight of those also carry a star value, all 4★: *Twinkle Tackle* on Igglybuff, Shiny Sylveon and Shiny Tapu Koko; *Devastating Drake* on Shiny Rayquaza, Shiny Mega Rayquaza and Shiny Mega Charizard X; Excadrill's *Tectonic Rage*; and Aurorus's *Continental Crush*. `[data]`

Since stars occur only on Purple, those eight are almost certainly Purple, and the 57 with fixed damage are almost certainly White — but both are inferences about *content*, not rules rulings, so they belong to the `content-schema` work rather than here. The gap went unnoticed because **`tools/validate.mjs` applies its colour and star checks to `wheel` only, never to `zMoves`** (§9). This is the clearest argument in the project for the zod schema layer covering every segment array rather than the one that happened to be checked first.

**Note.** These two fields are also flagged `contested` in the content data (`281:stars:Sightseeing`, `505:stars:Teleport Beam`), so they are counted in [Ruling 8](#ruling-8--the-contested-figure-fields) as well. The two rulings overlap by design: this one decides the *value*, that one decides the *witness*.

### Ruling 8 — The contested figure fields

**Question.** Which source wins the fields where Bulbapedia and Serebii disagree and neither can be outvoted?

**Ruling: Bulbapedia, with per-field reversal available.** `CONTESTED_FIELD_WINNER = 'bulbapedia'`, `CONTESTED_FIELD_OVERRIDES` (empty by default). Confidence: **high**.

**Reasoning.** Bulbapedia earned the default rather than being assumed into it — see [Conflict 3](#conflict-3--ability-names-and-effects-across-sources). `[adjudication]` It is `high` rather than `verified` because a default that is right most of the time is still a default: these twelve fields are exactly the places where it was applied with **no corroboration at all**.

**The affected fields**, mirroring the `contested` flags in `data/content/figures.json`:

| Field | Figure | Kind |
|---|---|---|
| `44:mp` | Audino | MP |
| `44:rarity` | Audino | Rarity |
| `90:rarity` | Weedle | Rarity |
| `179:mp` | Leafeon | MP |
| `279:mp` | Mega Beedrill | MP |
| `281:stars:Sightseeing` | Dragonite | Stars — see [Ruling 7](#ruling-7--the-two-starless-purple-segments) |
| `315:mp` | Durant | MP |
| `505:stars:Teleport Beam` | Mega Metagross | Stars — see [Ruling 7](#ruling-7--the-two-starless-purple-segments) |
| `523:mp` | Stakataka | MP |
| `542:mp` | Mega Manectric | MP |
| `543:mp` | Mega Sharpedo | MP |
| `566:mp` | Tyranitar | MP |

**Twelve fields across eleven figures**: eight MP values, two rarities, and the two starless Purple segments.

> **Count correction.** Earlier project notes described this as "eleven contested fields — 8 MP values and 2 rarities, plus Shiny Vaporeon's mirrored wheel." Reading the data directly gives **eleven contested *figures* and twelve contested *fields***, and **Shiny Vaporeon is not among them** — it carries an `inferred` flag ("no wheel on either source — REVIEW"), not a `contested` one, which is a different and more serious problem. The eleventh and twelfth fields are the two starless Purple segments of Ruling 7. The table above is authoritative; it was read from `figures.json` and cross-checked against the 17 entries in `decisions.json`.

**Blast radius.** Eight MP values (one movement point each), two rarities (deck-building cost only), and the two starless segments. No mechanic changes shape — which is why this is the least dangerous of the eight despite having the most moving parts.

**To flip one field:** add an entry to `CONTESTED_FIELD_OVERRIDES`, e.g. `{ '179:mp': 2 }` to restore Serebii's Leafeon. No content file is edited and no adjudication is lost.

---

## 14. Constant index

Everything the engine imports from [`src/rules/constants.ts`](../src/rules/constants.ts) instead of hardcoding.

### Rulings — flip these, not the engine

| Constant | Default | Confidence | §|
|---|---|---|---|
| `GOAL_SIDE_DIAGONAL_ATTACHMENT` | `'adjacentToGoal'` | medium | [R1](#ruling-1--goal-side-diagonal-attachment) |
| `TURN_LIMIT_OUTCOME` | `'draw'` | low | [R2](#ruling-2--300-turn-behaviour) |
| `TURN_LIMIT_COUNTING` | `'playerTurns'` | low | [R2](#ruling-2--300-turn-behaviour) |
| `SURROUND_GOAL_PRIORITY` | `'surroundFirst'` | medium | [R3](#ruling-3--surround-versus-goal-victory-priority) |
| `CONDITION_BLOCKS_MP_MOVE` | Sleep only | medium | [R4](#ruling-4--sleep-and-frozen-versus-mp-movement) |
| `VOLUNTARY_PASS_ALLOWED` | `false` | high | [R5](#ruling-5--voluntary-pass) |
| `MAX_SURROUNDS_PER_TURN` | `null` | medium | [R6](#ruling-6--one-surround-per-turn) |
| `STARLESS_PURPLE_POLICY` | `'sourceOmission'` | medium | [R7](#ruling-7--the-two-starless-purple-segments) |
| `STARLESS_PURPLE_SUBSTITUTE_STARS` | `1` | medium | [R7](#ruling-7--the-two-starless-purple-segments) |
| `CONTESTED_FIELD_WINNER` | `'bulbapedia'` | high | [R8](#ruling-8--the-contested-figure-fields) |
| `CONTESTED_FIELD_OVERRIDES` | `{}` | high | [R8](#ruling-8--the-contested-figure-fields) |
| `GOLD_BEATS_BLUE` | `false` | high | [C1](#conflict-1--does-gold-beat-blue) |

### Settled values

| Group | Constants |
|---|---|
| Board | `BOARD_NODE_COUNT` 28, `BOARD_EDGE_COUNT` 34, `GOAL_NODE_COUNT` 2, `NON_GOAL_NODE_COUNT` 26, `GOAL_NODE_DEGREE` 2, `ENTRY_POINT_COUNT` 4, `ENTRY_POINT_DEGREE` 3, `MIN_NODE_DEGREE` 2, `MAX_NODE_DEGREE` 3 |
| Turn | `PLATES_PER_TURN` 1, `MOVES_PER_TURN` 1, `BATTLES_PER_TURN` 1 |
| Movement | `MP_BASE_MIN` 0, `MP_BASE_MAX` 3, `MP_EFFECTIVE_MAX` 4, `DEPLOY_MP_COST` 1, `FIRST_TURN_MP_PENALTY` 1 |
| Battle | `WHEEL_TOTAL_UNITS` 96, `PURPLE_STAR_MIN` 1, `PURPLE_STAR_MAX` 4, `BATTLE_RANGE_DEFAULT` 1, `BATTLE_RANGE_MAX` 2, `GOLD_BEATS_WHITE` false, `EQUAL_DAMAGE_IS_DRAW` true, `EQUAL_STARS_IS_DRAW` true, `WINNER_ADVANCES` false, `CHAIN_LEVEL_DAMAGE_PER_LEVEL` 1, `INITIATOR_TRIGGERS_FIRST` true |
| State layers | `MAX_CONDITIONS_PER_FIGURE` 1, `MAX_MARKERS_PER_FIGURE` 1, `WAIT_TICKS_ON_BOTH_TURNS` true, `TAGGING_ENDS_TURN` true |
| Zones | `PC_CAPACITY` 2, `PC_OVERFLOW_IS_FIFO` true, `TEMPORARY_EXCLUSION_DEFAULT_TURNS` 7, `ULTRA_SPACE_FREEZES_TIMERS` true |
| Plates | `PLATE_DECK_SLOTS` 6, `PLATE_COST_BUDGET` 8, `PLATE_USES_PER_DUEL` 1, `PLATES_ALLOWED_MID_BATTLE` false, `PLATES_ALLOWED_AFTER_MOVING` false |
| Mega | `MEGA_DURATION_TURNS` 7, `MEGA_EVOLUTIONS_PER_DUEL` 1 |
| Win | `GOAL_CAPTURE_REQUIRES_MOVEMENT` true, `SURROUND_CHECKED_AT_END_OF_MOVEMENT` true, `PLATE_COUNTS_AS_ACTION_FOR_WAIT_VICTORY` true, `TURN_LIMIT` 300, `CHESS_CLOCK_MINUTES` 5, `CHESS_CLOCK_MS` 300000 |
| Content | `MAX_TYPES_PER_FIGURE` 2, `CONTESTED_FIELDS`, `CONTESTED_FIELD_COUNT` 12 |

`src/rules/constants.test.ts` asserts the module's internal consistency: ranges ordered, counts positive and integral, board counts mutually derivable, the condition table total over all seven conditions, and every `OPEN_RULINGS` entry carrying a question, a reason longer than its own ruling, a real confidence level, at least one cited source, at least one rejected alternative, and constant names that the module actually exports.

---

## 15. What this document does not settle

Honest limits, so nothing downstream over-trusts it.

- **Board topology is second-hand.** §1. Verify before building movement.
- **Z-Move segments are unvalidated, and it shows.** 65 of the 956 carry no colour, 8 of them with a star value. `[data]` The Z-Move data is good enough for damage numbers and nothing has been proven wrong, but the colour-comparison step cannot run on a colourless segment, so `content-schema` should extend the invariants to `zMoves` before `battle` relies on them. See [Ruling 7](#ruling-7--the-two-starless-purple-segments).
- **One suspected duplicate.** Dawn Wings Necrozma lists six Z-Move entries that are three distinct moves each appearing twice (*Menacing Moonraze Maelstrom*, *Never-Ending Nightmare*, *Shattered Psyche*). `[data]` This may be a merge artefact or may be real form data; it was not adjudicated and should be checked rather than assumed either way.
- **The long tail of effects is not rules-complete.** 3,863 atomic clauses over **1,311 distinct patterns**, of which **893 occur exactly once**. No DSL cleverness collapses those — each is bespoke. `[data]` The cumulative curve: 25 patterns → 35% coverage, 100 → 55%, 200 → 65%, 500 → 79%, 1,000 → 92%. This is the single biggest scope fact in the project, and it is why the coverage registry is a deliverable rather than a nicety: ship the composable core, mark the tail honestly, and let the deck builder refuse figures whose clauses are not implemented.
- **Numbers here describe Ver. 7.0.14 only.** Five abilities are known to have changed mechanically across versions, so an older guide can be accurate about an earlier build and still wrong for this one.
- **Nothing here is playtested.** Every claim is documentary or measured from content data. Engine behaviour is verified separately by golden replays, fuzz self-play and manual playtesting.

## 16. Provenance

- Content data: `data/content/figures.json`, `plates.json`, `abilities.json`, `decisions.json`.
- Raw scrapes, clause corpus, pattern rankings and disagreement reports: `data/raw/`.
- Invariant checks: `tools/validate.mjs` (`npm run data:validate`).
- Effect grammar and the text-to-DSL compiler: `src/content/dsl/`.
- Rulings as code: `src/rules/constants.ts`, tested by `src/rules/constants.test.ts`.

Changing a ruling means editing one token in `constants.ts` and the corresponding section here. Changing a *fact* means adding a source.
