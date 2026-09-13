/**
 * `createEngine(content)` - the whole engine behind one function.
 *
 * Content is *injected here and nowhere else*. `src/engine/**` must not import the
 * content loader (it is lint-enforced), and the reason is not tidiness: the engine has
 * to be constructible from a fixture in a unit test, from a patched bundle on a server,
 * and from a saved bundle in a replay, without any of those three loading a file.
 *
 * `dispatch` returns `{ events, nextState }` and guarantees
 * `applyEvents(state, events) === nextState`. That is asserted in the tests rather than
 * trusted, because it is the property every other guarantee rests on - a replay is
 * exactly the event list, and a divergence is bisectable only if the fold is exact.
 */
import { BOARD } from './board/graph.js';
import type { Command } from './commands.js';
import type { EngineContent } from './content.js';
import { indexContent } from './content.js';
import type { ContentInput } from './content.js';
import type { EngineDeps } from './effects/context.js';
import { buildCoverageRegistry } from './effects/registry.js';
import type { CoverageRegistry } from './effects/registry.js';
import type { GameEvent } from './events.js';
import { hashState } from './hash.js';
import type { PlayerId } from './ids.js';
import { execute, legalCommands, settle } from './phases.js';
import { createGame } from './setup.js';
import type { GameSetup } from './setup.js';
import type { GameState } from './state.js';
import { view } from './view.js';
import type { PlayerView } from './view.js';

export interface DispatchResult {
  readonly events: readonly GameEvent[];
  readonly nextState: GameState;
}

export interface Engine {
  readonly deps: EngineDeps;
  readonly content: EngineContent;
  readonly registry: CoverageRegistry;
  /** Build a duel. Throws unless every figure and plate in both decks is implemented. */
  createGame(setup: GameSetup): DispatchResult;
  dispatch(state: GameState, command: Command): DispatchResult;
  legalCommands(state: GameState): Command[];
  view(state: GameState, playerId: PlayerId): PlayerView;
  hash(state: GameState): string;
}

export function createEngine(input: ContentInput): Engine {
  const content = indexContent(input);
  const registry = buildCoverageRegistry(content);
  const deps: EngineDeps = { content, board: BOARD };

  return {
    deps,
    content,
    registry,

    createGame(setup) {
      const initial = createGame(setup, content, registry);
      // The opening settle is part of creation: it emits `gameStarted`, runs turn one's
      // start-of-turn abilities and stops at the first real decision. A caller should
      // never receive a state sitting in a transient phase.
      const batch = settle(initial, deps);
      return { events: batch.events, nextState: batch.state };
    },

    dispatch(state, command) {
      const batch = execute(state, deps, command);
      return { events: batch.events, nextState: batch.state };
    },

    legalCommands: (state) => legalCommands(state, deps),
    view,
    hash: hashState,
  };
}
