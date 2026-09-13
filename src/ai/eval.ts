/**
 * Cheap static evaluation, kept here so a stronger function can replace it later.
 *
 * Terminal scores come from `state.result`. Everything else is read through
 * `view(state, player)` so the heuristic never looks at the opponent's unused plate
 * identities or the PRNG. Depth-capped rollouts land here.
 */
import type {
  BoardGraph,
  Command,
  FigureState,
  GameState,
  NodeId,
  PlayerId,
  PlayerView,
} from '../engine/index.js';
import { BOARD, opponentOf, stepDistance, view } from '../engine/index.js';

/** True terminals. Non-terminals stay inside (-1, 1) so a forced win outranks any heuristic. */
const WIN = 1;
const LOSS = -1;
const DRAW = 0;

const BOARD_DIAMETER = 12;

function stillInDuel(figure: FigureState): boolean {
  return !(figure.zone === 'excluded' && figure.returnOnTurn === null);
}

function occupancyOwners(figures: readonly FigureState[]): ReadonlyMap<NodeId, PlayerId> {
  const occ = new Map<NodeId, PlayerId>();
  for (const figure of figures) {
    if (figure.zone === 'field' && figure.node !== null) occ.set(figure.node, figure.owner);
  }
  return occ;
}

/** Fraction of adjacent nodes held by the enemy. 1 means the figure is surrounded. */
function surroundPressure(
  board: BoardGraph,
  node: NodeId,
  owner: PlayerId,
  occ: ReadonlyMap<NodeId, PlayerId>,
): number {
  const spot = board.byId.get(node);
  if (spot === undefined || spot.neighbors.length === 0) return 0;
  let enemy = 0;
  for (const neighbor of spot.neighbors) {
    const who = occ.get(neighbor);
    if (who !== undefined && who !== owner) enemy += 1;
  }
  return enemy / spot.neighbors.length;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Score in [-1, 1] from `player`'s seat: goal distance, remaining figures, surround
 * pressure, and the public plate count. Swap this function via `ChooseOptions.evaluate`.
 */
export function evaluate(state: GameState, player: PlayerId, board: BoardGraph = BOARD): number {
  const seen: PlayerView = view(state, player);
  if (seen.result !== null) {
    if (seen.result.winner === player) return WIN;
    if (seen.result.winner === null) return DRAW;
    return LOSS;
  }

  const you = player;
  const them = opponentOf(player);
  const attack = board.goals[them];
  const defend = board.goals[you];
  const occ = occupancyOwners(seen.figures);

  let myAlive = 0;
  let theirAlive = 0;
  let myField = 0;
  let theirField = 0;
  let myGoal = 0;
  let theirGoal = 0;
  let myThreat = 0;
  let theirThreat = 0;
  let myClosest = BOARD_DIAMETER;
  let theirClosest = BOARD_DIAMETER;

  for (const figure of seen.figures) {
    if (!stillInDuel(figure)) continue;
    if (figure.owner === you) myAlive += 1;
    else theirAlive += 1;
    if (figure.zone !== 'field' || figure.node === null) continue;

    if (figure.owner === you) {
      myField += 1;
      const distance = stepDistance(board, figure.node, attack);
      if (distance < myClosest) myClosest = distance;
      myGoal += 1 / (1 + distance);
      myThreat += surroundPressure(board, figure.node, you, occ);
    } else {
      theirField += 1;
      const distance = stepDistance(board, figure.node, defend);
      if (distance < theirClosest) theirClosest = distance;
      theirGoal += 1 / (1 + distance);
      theirThreat += surroundPressure(board, figure.node, them, occ);
    }
  }

  const aliveDen = Math.max(1, myAlive + theirAlive);
  const fieldDen = Math.max(1, myField + theirField);
  const goalDen = Math.max(1e-6, myGoal + theirGoal);
  const threatDen = Math.max(1e-6, myThreat + theirThreat);
  const myPlates = seen.yourPlates.filter((slot) => !slot.used).length;
  const theirPlates = seen.opponentPlates.unused;

  const raw =
    (0.34 * (myAlive - theirAlive)) / aliveDen +
    (0.14 * (myField - theirField)) / fieldDen +
    (0.32 * (myGoal - theirGoal)) / goalDen +
    (0.12 * (theirThreat - myThreat)) / threatDen +
    (0.06 * (theirClosest - myClosest)) / BOARD_DIAMETER +
    (0.02 * (myPlates - theirPlates)) / 6;

  return clamp(raw, -0.95, 0.95);
}

/**
 * Bias for the random rollout policy. Favours walking toward the enemy goal so a
 * depth-capped playout is not a pure drunkard's walk. Weights are positive so every
 * remaining legal command can still be drawn.
 */
export function commandPrior(command: Command, board: BoardGraph): number {
  switch (command.kind) {
    case 'deploy':
    case 'mpMove':
      return 1.6 + 1 / (1 + stepDistance(board, command.to, board.goals[opponentOf(command.player)]));
    case 'initiateBattle':
      return 1.25;
    case 'tag':
      return 1.1;
    case 'playPlate':
    case 'useRespin':
    case 'spin':
    case 'abilityAction':
    case 'resolveDecision':
      return 1;
    case 'declinePlate':
    case 'declineWindow':
    case 'declineBattle':
    case 'declineRespin':
      return 0.65;
    case 'concede':
      return 0.02;
    case 'advanceClock':
      return 0.01;
  }
}
