/**
 * Extra golden replays: `{ seed, decks, commands[] } → hash`.
 *
 * The original pin (`ea6a37de` in `src/engine/replay.test.ts`) is not touched. These
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
    hash: '4f2e8e8b',
    setup: { seed: 0x636f6e63, startingPlayer: 0, decks: starterDecks },
    commands: [{ kind: 'concede', player: 0 }],
  },
  {
    name: 'p1-concede-on-opening',
    hash: 'c1a1a394',
    setup: { seed: 0x636f6e31, startingPlayer: 0, decks: starterDecks },
    commands: [{ kind: 'concede', player: 1 }],
  },
  {
    name: 'charmander-deploys-to-r3c0',
    hash: '76797ae5',
    setup: { seed: 0x6465706c, startingPlayer: 0, decks: starterDecks },
    commands: [{ kind: 'deploy', player: 0, uid: figureUid(0), entry: nodeId('r4c0'), to: nodeId('r3c0') }],
  },
  {
    name: 'file-clash-then-one-spin',
    // Bumped from 92091f5b: FigureState.lastFieldNode is now kept across a KO.
    hash: 'eca626ed',
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
    // Bumped from 91c97ad2: same lastFieldNode field as the clash golden.
    hash: '9e704d75',
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
      { kind: 'playPlate', player: 0, slot: 3 },
      { kind: 'deploy', player: 0, uid: figureUid(2), entry: nodeId('r4c0'), to: nodeId('r4c1') },
      { kind: 'playPlate', player: 1, slot: 2 },
      { kind: 'playPlate', player: 0, slot: 2 },
      { kind: 'deploy', player: 0, uid: figureUid(0), entry: nodeId('r4c0'), to: nodeId('r3c0') },
      { kind: 'playPlate', player: 1, slot: 3 },
      { kind: 'deploy', player: 1, uid: figureUid(9), entry: nodeId('r0c0'), to: nodeId('r0c2') },
      { kind: 'playPlate', player: 0, slot: 1 },
      { kind: 'playPlate', player: 1, slot: 1 },
      { kind: 'deploy', player: 1, uid: figureUid(11), entry: nodeId('r0c0'), to: nodeId('r0c1') },
      { kind: 'declinePlate', player: 0 },
      { kind: 'deploy', player: 0, uid: figureUid(3), entry: nodeId('r4c6'), to: nodeId('r4c5') },
      { kind: 'playPlate', player: 1, slot: 0 },
      { kind: 'playPlate', player: 0, slot: 0 },
      // Ampharosite now names Ampharos; none is on the field, so it no longer
      // raises a choose-any-ally decision the way the old un-named selector did.
      { kind: 'mpMove', player: 0, uid: figureUid(0), to: nodeId('r2c0') },
      { kind: 'concede', player: 1 },
    ],
  },
];
