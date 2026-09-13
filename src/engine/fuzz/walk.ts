/**
 * One seeded random-legal self-play game.
 *
 * Command choice uses a walker RNG derived from the game seed so spins (which draw
 * from `state.rng`) are not consumed by the harness. The same seed therefore
 * reproduces the deck, the command list and the final hash.
 */
import type { Command } from '../commands.js';
import type { Engine } from '../dispatch.js';
import type { GameEvent } from '../events.js';
import { createRng, nextInt, pick } from '../rng.js';
import type { RngState } from '../rng.js';
import type { GameSetup } from '../setup.js';
import type { GameState, Phase, WinReason } from '../state.js';
import { isOver } from '../state.js';
import { assertAfterDispatch, allStateProblems, FuzzInvariantError, notePhases } from './invariants.js';
import { buildDecks, fuzzPools } from './pool.js';
import type { BuiltDecks, FuzzPools } from './pool.js';

/** Stop a stuck phase from hanging CI. Long enough for a 300-turn crawl to still cap first. */
export const DEFAULT_COMMAND_CAP = 400;

/**
 * Concede is always legal, so a uniform pick among `legalCommands` ends most games
 * on the opening action. 1/1000 still produces concede wins without drowning Wait
 * Victory (which looks at `hasAnyAction`, not at the concede command).
 */
export const CONCEDE_RATE_DENOM = 1000;

const WALKER_XOR = 0x9e3779b9;

export type EndKind = WinReason | 'unfinished';

export interface WalkOptions {
  readonly commandCap?: number;
  readonly concedeRateDenom?: number;
  /** When set, skip seeded deck construction and play this setup instead. */
  readonly setup?: GameSetup;
}

export interface GameWalk {
  readonly seed: number;
  readonly setup: GameSetup;
  readonly commands: Command[];
  readonly state: GameState;
  readonly end: EndKind;
  readonly commandCount: number;
  readonly surroundKos: number;
  readonly phases: readonly Phase[];
  readonly commandKinds: readonly Command['kind'][];
}

export function walkerRng(seed: number): RngState {
  return createRng(seed ^ WALKER_XOR);
}

function playable(legal: readonly Command[]): Command[] {
  return legal.filter((command) => command.kind !== 'concede' && command.kind !== 'advanceClock');
}

function concedeForTurn(legal: readonly Command[], player: GameState['turn']['player']): Command[] {
  const mine = legal.filter((command) => command.kind === 'concede' && command.player === player);
  if (mine.length > 0) return mine;
  return legal.filter((command) => command.kind === 'concede');
}

export function pickWalkerCommand(
  legal: readonly Command[],
  state: GameState,
  rng: RngState,
  concedeRateDenom: number,
): { command: Command; rng: RngState } {
  const moves = playable(legal);
  if (moves.length === 0) {
    const resign = concedeForTurn(legal, state.turn.player);
    const drawn = pick(rng, resign);
    if (drawn.value === null) {
      throw new Error(`no legal command in phase "${state.phase}" (game over: ${isOver(state)})`);
    }
    return { command: drawn.value, rng: drawn.rng };
  }

  if (concedeRateDenom > 1) {
    const roll = nextInt(rng, concedeRateDenom);
    if (roll.value === 0) {
      const resign = pick(roll.rng, concedeForTurn(legal, state.turn.player));
      if (resign.value !== null) return { command: resign.value, rng: resign.rng };
    }
    rng = roll.rng;
  }

  const drawn = pick(rng, moves);
  if (drawn.value === null) throw new Error('unreachable: playable was non-empty');
  return { command: drawn.value, rng: drawn.rng };
}

function countSurroundKos(events: readonly GameEvent[]): number {
  let n = 0;
  for (const event of events) {
    if (event.kind === 'surrounded') n += 1;
  }
  return n;
}

export function playFuzzGame(
  engine: Engine,
  seed: number,
  opts: WalkOptions = {},
  pools: FuzzPools = fuzzPools(engine),
): GameWalk {
  const commandCap = opts.commandCap ?? DEFAULT_COMMAND_CAP;
  const concedeRateDenom = opts.concedeRateDenom ?? CONCEDE_RATE_DENOM;
  const built: BuiltDecks | null = opts.setup === undefined ? buildDecks(engine, seed, pools) : null;
  const setup = opts.setup ?? built?.setup;
  if (setup === undefined) throw new Error('unreachable: setup is always produced');

  const opened = engine.createGame(setup);
  const openProblems = allStateProblems(opened.nextState);
  if (openProblems.length > 0) throw new FuzzInvariantError(seed, 0, openProblems);

  let current = opened.nextState;
  let rng = walkerRng(seed);
  const commands: Command[] = [];
  const phases = new Set<Phase>();
  const kinds = new Set<Command['kind']>();
  let surroundKos = countSurroundKos(opened.events);
  notePhases(opened.events, current.phase, phases);

  while (!isOver(current) && commands.length < commandCap) {
    const legal = engine.legalCommands(current);
    if (legal.length === 0) {
      throw new FuzzInvariantError(seed, commands.length, [
        `legalCommands is empty in phase "${current.phase}" but the game is not over`,
      ]);
    }

    const picked = pickWalkerCommand(legal, current, rng, concedeRateDenom);
    rng = picked.rng;
    const { events, nextState } = engine.dispatch(current, picked.command);
    assertAfterDispatch(seed, commands.length + 1, current, events, nextState);

    commands.push(picked.command);
    kinds.add(picked.command.kind);
    surroundKos += countSurroundKos(events);
    notePhases(events, nextState.phase, phases);
    current = nextState;
  }

  const end: EndKind = current.result?.reason ?? 'unfinished';
  return {
    seed,
    setup,
    commands,
    state: current,
    end,
    commandCount: commands.length,
    surroundKos,
    phases: [...phases].sort(),
    commandKinds: [...kinds].sort(),
  };
}

/** Replay a recorded command list and return the final state. Checks every dispatch. */
export function replayCommands(
  engine: Engine,
  setup: GameSetup,
  commands: readonly Command[],
  seed = setup.seed,
): GameState {
  const opened = engine.createGame(setup);
  const openProblems = allStateProblems(opened.nextState);
  if (openProblems.length > 0) throw new FuzzInvariantError(seed, 0, openProblems);

  let current = opened.nextState;
  commands.forEach((command, index) => {
    const { events, nextState } = engine.dispatch(current, command);
    assertAfterDispatch(seed, index + 1, current, events, nextState);
    current = nextState;
  });
  return current;
}
