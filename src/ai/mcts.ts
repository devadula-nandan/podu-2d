/**
 * UCT over `legalCommands` + `dispatch`. The engine is deterministic, so a rollout is
 * just a command list on a copied state (reducers never mutate). Same seed, same state
 * and same budget therefore pick the same command.
 *
 * Values are stored from the root seat's point of view. At an opponent node UCB
 * maximises the negation, so the opponent is treated as trying to beat us.
 */
import { commandPrior } from './eval.js';
import { AiError } from './error.js';
import { actorToMove, concedeFor, playableCommands } from './policy.js';
import type { EvaluateFn } from './types.js';
import type { Command, Engine, GameState, PlayerId, RngState } from '../engine/index.js';
import { canonicalCommand, createRng, isOver, nextInt } from '../engine/index.js';

const EXPLORATION = Math.SQRT2;
const COLLAPSE_CAP = 64;
const ROLLOUT_STEP_CAP = 256;

export interface SearchBudget {
  readonly rollouts: number;
  readonly maxDepth: number;
  readonly seed: number;
  readonly evaluate: EvaluateFn;
}

interface SearchNode {
  readonly command: Command | null;
  readonly state: GameState;
  readonly parent: SearchNode | null;
  readonly children: SearchNode[];
  untried: Command[];
  visits: number;
  total: number;
}

export function search(
  engine: Engine,
  state: GameState,
  rootPlayer: PlayerId,
  budget: SearchBudget,
): Command {
  const legal = engine.legalCommands(state);
  const rootMoves = playableCommands(legal, rootPlayer);
  if (rootMoves.length === 0) {
    const resign = concedeFor(legal, rootPlayer);
    if (resign !== null) return resign;
    throw new AiError(`player ${rootPlayer} has no legal command in phase "${state.phase}"`);
  }
  if (rootMoves.length === 1) {
    const only = rootMoves[0];
    if (only === undefined) throw new AiError('unreachable: a singleton move list was empty');
    return only;
  }

  const root: SearchNode = {
    command: null,
    state,
    parent: null,
    children: [],
    untried: [...rootMoves],
    visits: 0,
    total: 0,
  };

  let rng = createRng(budget.seed);
  for (let i = 0; i < budget.rollouts; i++) {
    const leaf = select(engine, root, rootPlayer);
    const expanded = expand(engine, leaf);
    const scored = rollout(engine, expanded.state, rootPlayer, rng, budget);
    rng = scored.rng;
    backprop(expanded, scored.value);
  }

  return bestRootCommand(root, rootMoves);
}

function select(engine: Engine, root: SearchNode, rootPlayer: PlayerId): SearchNode {
  let node = root;
  while (node.untried.length === 0 && node.children.length > 0) {
    const child = bestChild(engine, node, rootPlayer);
    if (child === null) break;
    node = child;
  }
  return node;
}

function expand(engine: Engine, node: SearchNode): SearchNode {
  const next = node.untried.shift();
  if (next === undefined) return node;
  const nextState = after(engine, node.state, next);
  const child: SearchNode = {
    command: next,
    state: nextState,
    parent: node,
    children: [],
    untried: movesFrom(engine, nextState),
    visits: 0,
    total: 0,
  };
  node.children.push(child);
  return child;
}

function after(engine: Engine, state: GameState, command: Command): GameState {
  let current = engine.dispatch(state, command).nextState;
  for (let i = 0; i < COLLAPSE_CAP; i++) {
    if (isOver(current)) return current;
    const legal = engine.legalCommands(current);
    const actor = actorToMove(current, legal);
    const playable = playableCommands(legal, actor);
    if (playable.length !== 1) return current;
    const only = playable[0];
    if (only === undefined) return current;
    current = engine.dispatch(current, only).nextState;
  }
  return current;
}

function movesFrom(engine: Engine, state: GameState): Command[] {
  if (isOver(state)) return [];
  const legal = engine.legalCommands(state);
  return playableCommands(legal, actorToMove(state, legal));
}

function rollout(
  engine: Engine,
  start: GameState,
  rootPlayer: PlayerId,
  rng: RngState,
  budget: SearchBudget,
): { value: number; rng: RngState } {
  let current = start;
  let rngNow = rng;
  let decisions = 0;
  for (let steps = 0; steps < ROLLOUT_STEP_CAP; steps++) {
    if (isOver(current)) break;
    if (decisions >= budget.maxDepth) break;
    const legal = engine.legalCommands(current);
    if (legal.length === 0) break;
    const actor = actorToMove(current, legal);
    const playable = playableCommands(legal, actor);
    if (playable.length === 0) {
      const resign = concedeFor(legal, actor);
      if (resign === null) break;
      current = engine.dispatch(current, resign).nextState;
      break;
    }
    if (playable.length === 1) {
      const only = playable[0];
      if (only === undefined) break;
      current = engine.dispatch(current, only).nextState;
      continue;
    }
    const picked = pickWeighted(playable, engine.deps.board, rngNow);
    rngNow = picked.rng;
    current = engine.dispatch(current, picked.value).nextState;
    decisions += 1;
  }
  return { value: budget.evaluate(current, rootPlayer), rng: rngNow };
}

function pickWeighted(
  commands: readonly Command[],
  board: Engine['deps']['board'],
  rng: RngState,
): { value: Command; rng: RngState } {
  let total = 0;
  const weights: number[] = [];
  for (const command of commands) {
    const weight = Math.max(1, Math.round(commandPrior(command, board) * 100));
    weights.push(weight);
    total += weight;
  }
  const draw = nextInt(rng, total);
  let acc = 0;
  for (let i = 0; i < commands.length; i++) {
    acc += weights[i] ?? 0;
    if (draw.value < acc) {
      const chosen = commands[i];
      if (chosen !== undefined) return { value: chosen, rng: draw.rng };
    }
  }
  const fallback = commands[0];
  if (fallback === undefined) throw new AiError('cannot pick from an empty command list');
  return { value: fallback, rng: draw.rng };
}

function bestChild(engine: Engine, node: SearchNode, rootPlayer: PlayerId): SearchNode | null {
  if (node.children.length === 0) return null;
  const legal = engine.legalCommands(node.state);
  const chooser = actorToMove(node.state, legal);
  const sign = chooser === rootPlayer ? 1 : -1;
  let best: SearchNode | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKey = '';
  for (const child of node.children) {
    const mean = child.visits === 0 ? 0 : child.total / child.visits;
    const explore =
      child.visits === 0
        ? Number.POSITIVE_INFINITY
        : EXPLORATION * Math.sqrt(Math.log(Math.max(1, node.visits)) / child.visits);
    const score = sign * mean + explore;
    const key = child.command === null ? '' : canonicalCommand(child.command);
    if (best === null || score > bestScore || (score === bestScore && key < bestKey)) {
      best = child;
      bestScore = score;
      bestKey = key;
    }
  }
  return best;
}

function backprop(node: SearchNode, value: number): void {
  let cursor: SearchNode | null = node;
  while (cursor !== null) {
    cursor.visits += 1;
    cursor.total += value;
    cursor = cursor.parent;
  }
}

function bestRootCommand(root: SearchNode, fallback: readonly Command[]): Command {
  let best: SearchNode | null = null;
  let bestKey = '';
  for (const child of root.children) {
    if (child.command === null) continue;
    const key = canonicalCommand(child.command);
    if (best === null) {
      best = child;
      bestKey = key;
      continue;
    }
    const moreVisits = child.visits > best.visits;
    const sameVisits = child.visits === best.visits;
    const betterMean =
      child.visits > 0 && best.visits > 0 && child.total / child.visits > best.total / best.visits;
    const sameMean =
      child.visits > 0 && best.visits > 0 && child.total / child.visits === best.total / best.visits;
    if (moreVisits || (sameVisits && betterMean) || (sameVisits && sameMean && key < bestKey)) {
      best = child;
      bestKey = key;
    }
  }
  if (best?.command !== undefined && best.command !== null) return best.command;
  const first = fallback[0];
  if (first === undefined) throw new AiError('search finished with no command');
  return first;
}
