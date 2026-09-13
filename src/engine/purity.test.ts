import { describe, expect, it } from 'vitest';
import { applyEvents } from './reduce.js';
import { createGame } from './setup.js';
import type { GameSetup } from './setup.js';
import { canonicalJson, hashState } from './hash.js';
import { contentFigureId, figureUid, nodeId } from './ids.js';
import { assertStateInvariants } from './state.js';
import {
  GOLDEN_SEED,
  goldenCommands,
  goldenContent,
  harness,
  makeFigure,
} from './test/helpers.js';

function goldenSetup(seed: number): GameSetup {
  const { p0, p1 } = goldenContent();
  return {
    seed,
    startingPlayer: 0,
    decks: {
      0: { figures: p0.map((figure) => contentFigureId(figure.id)), plates: [] },
      1: { figures: p1.map((figure) => contentFigureId(figure.id)), plates: [] },
    },
  };
}

describe('reducer purity', () => {
  it('folds createGame events back onto the unsettled state', () => {
    const { engine } = harness({ ...goldenContent(), seed: GOLDEN_SEED });
    const setup = goldenSetup(GOLDEN_SEED);
    const initial = createGame(setup, engine.content, engine.registry);
    const opened = engine.createGame(setup);
    expect(canonicalJson(applyEvents(initial, opened.events))).toBe(canonicalJson(opened.nextState));
    expect(hashState(applyEvents(initial, opened.events))).toBe(hashState(opened.nextState));
  });

  it('keeps dispatch(state, cmd) === applyEvents(state, events) and never mutates state', () => {
    const { engine, state: start } = harness({ ...goldenContent(), seed: GOLDEN_SEED });
    let current = start;
    for (const command of goldenCommands()) {
      const before = canonicalJson(current);
      const { events, nextState } = engine.dispatch(current, command);
      expect(canonicalJson(current)).toBe(before);
      expect(canonicalJson(applyEvents(current, events))).toBe(canonicalJson(nextState));
      expect(hashState(applyEvents(current, events))).toBe(hashState(nextState));
      assertStateInvariants(nextState);
      current = nextState;
    }
  });

  it('does not mutate state when applying a batch of events twice from the same snapshot', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1)],
      p1: [makeFigure(2)],
      seed: 99,
    });
    const before = canonicalJson(state);
    const { events, nextState } = engine.dispatch(state, {
      kind: 'deploy',
      player: 0,
      uid: figureUid(0),
      entry: nodeId('r4c0'),
      to: nodeId('r4c0'),
    });
    expect(canonicalJson(state)).toBe(before);
    const replayed = applyEvents(state, events);
    expect(canonicalJson(replayed)).toBe(canonicalJson(nextState));
    expect(canonicalJson(applyEvents(state, events))).toBe(canonicalJson(nextState));
  });
});
