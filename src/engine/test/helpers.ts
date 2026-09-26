/**
 * Shared fixtures for engine tests. Not part of the public engine surface.
 *
 * Content is built in memory so tests never touch `src/content/load`. A figure with
 * `ability: null` and no segment notes compiles to zero clauses and is fully
 * implemented, which is what lets `createGame` run without `allowUnimplemented`.
 */
import type { Figure, Plate } from '../../content/schema.js';
import type { Command } from '../commands.js';
import { createEngine } from '../dispatch.js';
import type { Engine } from '../dispatch.js';
import type { GameEvent } from '../events.js';
import { applyEvents, hashState } from '../index.js';
import { contentFigureId, contentPlateId, figureUid, nodeId } from '../ids.js';
import type { FigureUid, NodeId } from '../ids.js';
import type { GameSetup } from '../setup.js';
import type { GameState } from '../state.js';

export function makeFigure(
  id: number,
  opts: {
    mp?: number;
    name?: string;
    types?: Figure['types'];
    ability?: Figure['ability'];
    form?: Figure['form'];
    evoStage?: Figure['evoStage'];
    zMoves?: Figure['zMoves'];
  } = {},
): Figure {
  return {
    id,
    name: opts.name ?? `Figure ${id}`,
    form: opts.form ?? null,
    rarity: 'C',
    types: opts.types ?? ['Normal'],
    mp: opts.mp ?? 3,
    evoStage: opts.evoStage ?? 1,
    materialCost: 250,
    gems: null,
    league: 'Beginner',
    booster: null,
    ability: opts.ability ?? null,
    wheel: [
      { size: 40, moveName: 'Tackle', color: 'white', damage: { kind: 'fixed', base: 40 }, notes: null },
      { size: 24, moveName: 'Quick Attack', color: 'gold', damage: { kind: 'fixed', base: 30 }, notes: null },
      { size: 16, moveName: 'Splash', color: 'blue', damage: null, notes: null },
      { size: 8, moveName: 'Toxic', color: 'purple', damage: { kind: 'stars', stars: 2 }, notes: null },
      { size: 8, moveName: 'Miss', color: 'miss', damage: null, notes: null },
    ],
    zMoves: opts.zMoves ?? [],
    wheelSum: 96,
    wheelSource: 'test',
    diskVersion: null,
    sources: ['bulbapedia'],
    dataComplete: true,
  };
}

export function makePlate(
  id: number,
  effect = 'Your turn ends.',
  opts: { cost?: number | null; endsTurn?: boolean; name?: string } = {},
): Plate {
  return {
    id,
    category: 'Blue',
    name: opts.name ?? `Plate ${id}`,
    rarity: 'C',
    cost: opts.cost === undefined ? 1 : opts.cost,
    effect,
    endsTurn: opts.endsTurn ?? true,
  };
}

export interface HarnessOpts {
  readonly seed?: number;
  readonly startingPlayer?: 0 | 1;
  readonly clockMs?: number;
  readonly allowUnimplemented?: boolean;
  readonly p0: readonly Figure[];
  readonly p1: readonly Figure[];
  readonly p0Plates?: readonly Plate[];
  readonly p1Plates?: readonly Plate[];
}

export interface Harness {
  readonly engine: Engine;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export function harness(opts: HarnessOpts): Harness {
  const p0Plates = opts.p0Plates ?? [];
  const p1Plates = opts.p1Plates ?? [];
  const engine = createEngine({
    figures: [...opts.p0, ...opts.p1],
    plates: [...p0Plates, ...p1Plates],
    abilities: [],
  });

  const setup: GameSetup = {
    seed: opts.seed ?? 1,
    startingPlayer: opts.startingPlayer ?? 0,
    decks: {
      0: {
        figures: opts.p0.map((figure) => contentFigureId(figure.id)),
        plates: p0Plates.map((plate) => contentPlateId(plate.id)),
      },
      1: {
        figures: opts.p1.map((figure) => contentFigureId(figure.id)),
        plates: p1Plates.map((plate) => contentPlateId(plate.id)),
      },
    },
    ...(opts.clockMs !== undefined ? { clockMs: opts.clockMs } : {}),
    ...(opts.allowUnimplemented === true ? { allowUnimplemented: true } : {}),
  };

  const opened = engine.createGame(setup);
  return { engine, state: opened.nextState, events: opened.events };
}

/** Put figures on named nodes without going through legal movement. */
export function onField(state: GameState, placements: readonly (readonly [number, string])[]): GameState {
  return applyEvents(
    state,
    placements.map(([uid, node]) => ({
      kind: 'figureDeployed' as const,
      uid: figureUid(uid),
      entry: nodeId(node),
      to: nodeId(node),
      mpSpent: 0,
    })),
  );
}

export const uid = (n: number): FigureUid => figureUid(n);
export const nid = (id: string): NodeId => nodeId(id);

export const GOLDEN_SEED = 0x706f6475;

export function goldenContent(): { p0: Figure[]; p1: Figure[] } {
  return {
    p0: [makeFigure(101, { mp: 3, name: 'Alpha' })],
    p1: [makeFigure(202, { mp: 3, name: 'Beta' })],
  };
}

export function goldenCommands(): Command[] {
  return [
    { kind: 'deploy', player: 0, uid: uid(0), entry: nid('r4c0'), to: nid('r3c0') },
    { kind: 'deploy', player: 1, uid: uid(1), entry: nid('r0c0'), to: nid('r1c0') },
    { kind: 'mpMove', player: 0, uid: uid(0), to: nid('r2c0') },
    { kind: 'declineBattle', player: 0 },
    { kind: 'mpMove', player: 1, uid: uid(1), to: nid('r0c1') },
  ];
}

export function play(engine: Engine, state: GameState, commands: readonly Command[]): GameState {
  let current = state;
  for (const command of commands) {
    current = engine.dispatch(current, command).nextState;
  }
  return current;
}

export function playHashed(engine: Engine, state: GameState, commands: readonly Command[]): string {
  return hashState(play(engine, state, commands));
}
