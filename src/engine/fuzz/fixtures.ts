/**
 * Extra golden replays: `{ seed, decks, commands[] } → hash`.
 *
 * The original pin (`cce0ee57` in `src/engine/replay.test.ts`) is not touched. These
 * use the real content bundle and six-figure decks so a hash miss means the engine's
 * observable state changed on a path the synthetic 1v1 pin does not cover.
 *
 * Hashes are FNV-1a of `canonicalJson(state)` via `hashState`. Bump a hash only when
 * a deliberate rules change altered `GameState`; do not "fix" a miss by copying a new
 * value without knowing why the state moved.
 */
import type { Command } from '../commands.js';
import { contentFigureId, contentPlateId, figureUid, nodeId } from '../ids.js';
import type { GameSetup } from '../setup.js';

export interface FuzzGolden {
  readonly name: string;
  readonly hash: string;
  readonly setup: GameSetup;
  readonly commands: readonly Command[];
}

/** Implemented no-ability figures, listed explicitly so a newly-implemented lower id cannot retarget the decks. */
const P0_STARTERS = [4, 6, 2, 5, 8, 10] as const; // Charmander, Ekans, Tauros, Mightyena, Snubbull, Seedot
const P1_STARTERS = [17, 19, 20, 23, 24, 26] as const; // Murkrow, Mudkip, …

function decks(
  p0: readonly number[],
  p1: readonly number[],
  plates0: readonly number[] = [],
  plates1: readonly number[] = [],
): GameSetup['decks'] {
  return {
    0: { figures: p0.map(contentFigureId), plates: plates0.map(contentPlateId) },
    1: { figures: p1.map(contentFigureId), plates: plates1.map(contentPlateId) },
  };
}

const starterDecks = decks(P0_STARTERS, P1_STARTERS);

export const FUZZ_GOLDENS: readonly FuzzGolden[] = [
  {
    name: 'concede-on-opening',
    hash: 'ccf4416a',
    setup: { seed: 0x636f6e63, startingPlayer: 0, decks: starterDecks },
    commands: [{ kind: 'concede', player: 0 }],
  },
  {
    name: 'p1-concede-on-opening',
    hash: '24190107',
    setup: { seed: 0x636f6e31, startingPlayer: 0, decks: starterDecks },
    commands: [{ kind: 'concede', player: 1 }],
  },
  {
    name: 'charmander-deploys-to-r3c0',
    hash: '5f9374e6',
    setup: { seed: 0x6465706c, startingPlayer: 0, decks: starterDecks },
    commands: [{ kind: 'deploy', player: 0, uid: figureUid(0), entry: nodeId('r4c0'), to: nodeId('r3c0') }],
  },
  {
    name: 'file-clash-then-one-spin',
    // Bumped: before-using moved off the global preSelect scan (preSelectClosed always latches).
    hash: '4bb07322',
    setup: { seed: 0x7370696e, startingPlayer: 0, decks: starterDecks },
    commands: [
      { kind: 'deploy', player: 0, uid: figureUid(0), entry: nodeId('r4c0'), to: nodeId('r3c0') },
      { kind: 'deploy', player: 1, uid: figureUid(6), entry: nodeId('r0c0'), to: nodeId('r1c0') },
      { kind: 'mpMove', player: 0, uid: figureUid(0), to: nodeId('r2c0') },
      { kind: 'initiateBattle', player: 0, attacker: figureUid(0), defender: figureUid(6) },
      { kind: 'spin', player: 0 },
    ],
  },
  {
    name: 'plates-decision-then-concede',
    // Bumped: mega-stone usage gates skip unnamed holders; preSelectClosed always latches.
    hash: '5b274c1b',
    setup: {
      seed: 2002872692,
      startingPlayer: 1,
      decks: decks(
        [152, 10, 125, 29, 97, 144],
        [562, 461, 410, 531, 386, 354],
        [387, 26, 435, 438],
        [402, 418, 388, 436, 448],
      ),
    },
    commands: [
      { kind: 'playPlate', player: 1, slot: 4 },
      { kind: 'playPlate', player: 0, slot: 1 },
      { kind: 'concede', player: 0 },
    ],
  },
];
