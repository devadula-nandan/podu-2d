/**
 * Creating a duel.
 *
 * The interesting part of this file is the gate. `createGame` asks the coverage
 * registry whether every figure and plate in both decks is fully implemented, and by
 * default it throws if any is not - with the figure name, the clause origin, the reason
 * and the source text, so the error is actionable rather than a shrug.
 *
 * `allowUnimplemented` exists because tests and exploratory play need it, but it is off
 * by default and it writes every skipped clause onto `state.unimplementedClauses`. The
 * asymmetry is the point: fielding a half-implemented figure has to be a deliberate,
 * recorded act, because the alternative is a duel that quietly claims full fidelity.
 */
import { CHESS_CLOCK_MS } from '../rules/constants.js';
import type { EngineContent } from './content.js';
import { figureContent, plateContent } from './content.js';
import { EngineError } from './state.js';
import { figureDeckIssues, isFormOnlyFigure, plateDeckIssues } from './plates.js';
import type { CoverageRegistry } from './effects/registry.js';
import { describeGaps, describePlateGaps, UnimplementedContentError } from './effects/registry.js';
import type { ContentFigureId, ContentPlateId, FigureUid, PlayerId } from './ids.js';
import { figureUid, PLAYER_IDS } from './ids.js';
import { createRng } from './rng.js';
import type { FigureState, GameState, PlateSlot, PlayerState } from './state.js';

export interface DeckSetup {
  readonly figures: readonly ContentFigureId[];
  readonly plates: readonly ContentPlateId[];
}

export interface GameSetup {
  readonly seed: number;
  readonly startingPlayer: PlayerId;
  readonly decks: Readonly<Record<PlayerId, DeckSetup>>;
  /** Field a figure whose clauses cannot all be run. Off by default, always recorded. */
  readonly allowUnimplemented?: boolean;
  /** Override the chess clock, in milliseconds. Used by tests that do not want one. */
  readonly clockMs?: number;
}

function blankFigure(uid: FigureUid, owner: PlayerId, figureId: ContentFigureId): FigureState {
  return {
    uid,
    owner,
    figureId,
    originFigureId: figureId,
    evolved: false,
    megaRevertsTo: null,
    wheelPatches: [],
    spinShifts: [],
    zone: 'bench',
    node: null,
    condition: null,
    wait: 0,
    marker: null,
    mpDelta: 0,
    megaTurnsLeft: null,
    returnOnTurn: null,
    returnZone: null,
    pcOrder: null,
    goalLocked: false,
    movedOnTurn: null,
    chainLevel: 0,
    wheelRotation: 0,
  };
}

/**
 * Everything in either deck that the engine cannot fully run.
 *
 * Checked over the *decks*, not the whole 596-figure corpus: a duel is only as faithful
 * as the twelve figures in it, and refusing to start because some figure nobody brought
 * is unimplemented would make the gate useless.
 */
export function setupGaps(setup: GameSetup, content: EngineContent, registry: CoverageRegistry): string[] {
  const gaps: string[] = [];
  for (const player of PLAYER_IDS) {
    const deck = setup.decks[player];
    for (const id of deck.figures) {
      // Throws if the id is not in the bundle at all, which is a different and worse
      // problem than an unimplemented clause and should not be reported as one.
      figureContent(content, id);
      const support = registry.figures.get(id);
      if (support !== undefined && !support.implemented) gaps.push(...describeGaps(support));
    }
    for (const id of deck.plates) {
      plateContent(content, id);
      const support = registry.plates.get(id);
      if (support !== undefined && !support.implemented) gaps.push(...describePlateGaps(support));
    }
  }
  return gaps;
}

export function createGame(
  setup: GameSetup,
  content: EngineContent,
  registry: CoverageRegistry,
): GameState {
  const gaps = setupGaps(setup, content, registry);
  if (gaps.length > 0 && setup.allowUnimplemented !== true) {
    throw new UnimplementedContentError(gaps);
  }

  const plateIssues = PLAYER_IDS.flatMap((id) => {
    const plates = setup.decks[id].plates.map((plateId) => plateContent(content, plateId).plate);
    return plateDeckIssues(plates).map((issue) => `player ${id}: ${issue}`);
  });
  if (plateIssues.length > 0) {
    throw new EngineError(`illegal plate deck:\n  ${plateIssues.join('\n  ')}`);
  }

  const figureIssues = PLAYER_IDS.flatMap((id) => {
    const figures = setup.decks[id].figures.map((figureId) => figureContent(content, figureId).figure);
    return figureDeckIssues(figures).map((issue) => `player ${id}: ${issue}`);
  });
  if (figureIssues.length > 0) {
    throw new EngineError(`illegal figure deck:\n  ${figureIssues.join('\n  ')}`);
  }

  for (const player of PLAYER_IDS) {
    for (const id of setup.decks[player].figures) {
      const figure = figureContent(content, id).figure;
      if (isFormOnlyFigure(figure)) {
        throw new EngineError(
          `${figure.name} (#${figure.id}) can only be set as a form in a deck; it cannot occupy a primary slot`,
        );
      }
    }
  }

  const figures: FigureState[] = [];
  for (const player of PLAYER_IDS) {
    for (const id of setup.decks[player].figures) {
      figures.push(blankFigure(figureUid(figures.length), player, id));
    }
  }

  const players = PLAYER_IDS.map((id): PlayerState => {
    const plates: PlateSlot[] = setup.decks[id].plates.map((plateId) => ({ plateId, used: false }));
    return {
      id,
      plates,
      clockMs: setup.clockMs ?? CHESS_CLOCK_MS,
      zGauge: 0,
      megaUsed: false,
      platesLockedUntilTurn: null,
    };
  });
  const [zero, one] = players;
  if (zero === undefined || one === undefined) throw new Error('unreachable: two players are always built');

  return {
    version: 2,
    rng: createRng(setup.seed),
    phase: 'setup',
    turn: {
      player: setup.startingPlayer,
      number: 0,
      platePlayed: false,
      plateWindowClosed: false,
      moved: false,
      battled: false,
      movedUid: null,
      forcedEnd: false,
    },
    players: [zero, one],
    figures,
    battle: null,
    pending: null,
    result: null,
    startingPlayer: setup.startingPlayer,
    forcedNextPlayer: null,
    timeTravelLockedUntilTurn: null,
    pcCounter: 0,
    unimplementedClauses: gaps,
  };
}
