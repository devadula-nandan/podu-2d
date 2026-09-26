/**
 * Every printed wheel, Z-move, plate, and "before using" ability must be able to
 * enter a duel without stealing the opponent's opening turn.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Ability, Figure, Plate } from '../content/schema.js';
import { WHEEL_TOTAL_UNITS } from '../rules/constants.js';
import { Z_GAUGE_MAX } from './constants.js';
import { createEngine } from './dispatch.js';
import {
  isActivableAbilityClause,
  isFormOnlyFigure,
  isInsteadOfAttackClause,
  isInsteadOfMoveClause,
  isPreSelectClause,
} from './plates.js';
import { applyEvents } from './reduce.js';
import { buildZMoveWheel, resolvePrintedWheel, wheelTotal } from './rules/wheel.js';
import { contentFigureId, contentPlateId, figureUid } from './ids.js';
import { harness, makeFigure, onField } from './test/helpers.js';

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(`data/content/${name}.json`, 'utf8'));
}

const figures = loadJson('figures') as Figure[];
const plates = loadJson('plates') as Plate[];
const abilities = loadJson('abilities') as Ability[];
const engine = createEngine({ figures, plates, abilities });

const fieldable = [...engine.content.figures.values()].find(
  (entry) => !isFormOnlyFigure(entry.figure) && entry.figure.dataComplete,
);
if (fieldable === undefined) throw new Error('expected a fieldable figure');
const dummyId = contentFigureId(fieldable.figure.id);

function plateNeedsNamedFigure(plate: Plate): boolean {
  return /Splicers|Orb|Module|Gracidea|Necroizer|Ultra Burst|Meteorite|Flute|Stone|ite\b|Sphere|Memory|Drive|Mask|Fossil/.test(
    plate.name,
  );
}

function openDuel(figureId: number, plateId?: number) {
  const partner = [...engine.content.figures.values()].find(
    (entry) =>
      !isFormOnlyFigure(entry.figure)
      && entry.figure.dataComplete
      && entry.figure.mp >= 3
      && entry.figure.id !== figureId
      && entry.figure.id !== fieldable.figure.id,
  );
  if (partner === undefined) throw new Error('expected a 3 MP partner figure');
  return engine.createGame({
    seed: 1,
    startingPlayer: 0,
    decks: {
      0: {
        figures: [contentFigureId(figureId), contentFigureId(partner.figure.id)],
        plates: plateId === undefined ? [] : [contentPlateId(plateId)],
      },
      1: { figures: [dummyId], plates: [] },
    },
    allowUnimplemented: true,
  }).nextState;
}

describe('printed content can enter a live duel', () => {
  it('keeps every complete figure wheel at 96 units', () => {
    const bad: string[] = [];
    for (const entry of engine.content.figures.values()) {
      if (!entry.figure.dataComplete) continue;
      const printed = resolvePrintedWheel(entry.figure.wheel);
      const total = wheelTotal(printed);
      if (total !== WHEEL_TOTAL_UNITS) {
        bad.push(`${entry.figure.name} #${entry.figure.id}: ${total}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('builds a 96-unit Z-move wheel for every printed Z-move', () => {
    const bad: string[] = [];
    for (const entry of engine.content.figures.values()) {
      for (const z of entry.figure.zMoves) {
        const zWheel = buildZMoveWheel(z);
        if (wheelTotal(zWheel) !== WHEEL_TOTAL_UNITS) {
          bad.push(`${entry.figure.name} ${z.moveName}: ${wheelTotal(zWheel)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not let any before-using ability freeze the opponent\'s opening turn', () => {
    const seen = new Set<string>();
    const frozen: string[] = [];
    for (const entry of engine.content.figures.values()) {
      const text = entry.figure.ability?.text;
      if (text === undefined || seen.has(text)) continue;
      if (!entry.abilityClauses.some((clause) => isPreSelectClause(clause))) continue;
      seen.add(text);
      const opened = harness({
        startingPlayer: 1,
        p0: [makeFigure(1, { name: entry.figure.name, ability: entry.figure.ability })],
        p1: [makeFigure(2, { name: 'Sentret', mp: 2 })],
        allowUnimplemented: true,
      });
      if (opened.state.pending !== null && opened.state.pending.chooser === 0) {
        frozen.push(`${entry.figure.name}: ${text.slice(0, 80)}`);
      }
      const legal = opened.engine.legalCommands(opened.state);
      const aiCanAct = legal.some(
        (command) => command.player === 1 && command.kind !== 'concede' && command.kind !== 'advanceClock',
      );
      if (!aiCanAct) frozen.push(`${entry.figure.name}: no AI command`);
    }
    expect(frozen).toEqual([]);
  });

  it('lets every plate sit in a duel without hanging legalCommands', () => {
    const failed: string[] = [];
    for (const entry of engine.content.plates.values()) {
      try {
        const opened = openDuel(fieldable.figure.id, entry.plate.id);
        engine.legalCommands(opened);
      } catch (err) {
        failed.push(`${entry.plate.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(failed.slice(0, 12)).toEqual([]);
  });

  it('offers every printed Z-Move when the gauge is full and adjacent', () => {
    const missed: string[] = [];
    const crashed: string[] = [];
    for (const entry of engine.content.figures.values()) {
      if (isFormOnlyFigure(entry.figure) || entry.figure.zMoves.length === 0) continue;
      let state = openDuel(entry.figure.id);
      state = applyEvents(onField(state, [[0, 'r3c0'], [2, 'r2c0']]), [
        {
          kind: 'zGaugeChanged',
          player: 0,
          from: state.players[0].zGauge,
          to: Z_GAUGE_MAX,
        },
      ]);
      let legal;
      try {
        legal = engine.legalCommands(state);
      } catch (err) {
        crashed.push(`${entry.figure.name}: legal ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const battles = legal.filter(
        (command) => command.kind === 'initiateBattle' && command.player === 0 && command.attacker === figureUid(0),
      );
      if (battles.length === 0) continue;
      for (let index = 0; index < entry.figure.zMoves.length; index++) {
        const z = battles.find((command) => command.kind === 'initiateBattle' && command.zMoveIndex === index);
        if (z === undefined) {
          missed.push(`${entry.figure.name} ${entry.figure.zMoves[index]?.moveName ?? index}`);
          continue;
        }
        try {
          const started = engine.dispatch(state, z).nextState;
          const spin = engine.legalCommands(started).find((command) => command.kind === 'spin');
          if (spin !== undefined) engine.dispatch(started, spin);
        } catch (err) {
          crashed.push(
            `${entry.figure.name} ${entry.figure.zMoves[index]?.moveName}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    expect(crashed.slice(0, 8)).toEqual([]);
    expect(missed.slice(0, 8)).toEqual([]);
  });

  it('dispatches every plate that is legal on the opening field', () => {
    const crashed: string[] = [];
    for (const entry of engine.content.plates.values()) {
      try {
        const placed = onField(openDuel(fieldable.figure.id, entry.plate.id), [[0, 'r3c0']]);
        const play = engine
          .legalCommands(placed)
          .find((command) => command.kind === 'playPlate' && command.player === 0);
        if (play === undefined) continue;
        engine.dispatch(placed, play);
      } catch (err) {
        crashed.push(`${entry.plate.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(crashed.slice(0, 12)).toEqual([]);
  });

  it('lists every instead-of-move or form ability once the figure is on the field', () => {
    const missed: string[] = [];
    const crashed: string[] = [];
    for (const entry of engine.content.figures.values()) {
      if (isFormOnlyFigure(entry.figure)) continue;
      const activable = entry.abilityClauses.filter((clause) => isActivableAbilityClause(clause));
      if (activable.length === 0) continue;
      try {
        let state = onField(openDuel(entry.figure.id), [[0, 'r3c0']]);
        const needsAttack = activable.some((clause) => isInsteadOfAttackClause(clause));
        if (needsAttack) {
          state = applyEvents(onField(state, [[1, 'r2c0']]), [
            { kind: 'phaseChanged', from: state.phase, to: 'battleDecision' },
          ]);
        }
        const legal = engine.legalCommands(state);
        for (const clause of activable) {
          const found = legal.some(
            (command) =>
              command.kind === 'abilityAction' && command.uid === figureUid(0) && command.clauseId === clause.id,
          );
          if (!found && !isInsteadOfAttackClause(clause)) {
            missed.push(`${entry.figure.name} #${entry.figure.id}: ${clause.source.slice(0, 80)}`);
          }
        }
      } catch (err) {
        crashed.push(`${entry.figure.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(crashed.slice(0, 8)).toEqual([]);
    expect(missed.slice(0, 8)).toEqual([]);
  });

  it('teleports a field Pokémon onto your open goal with Goal Block and ends the turn', () => {
    const wobbuffet = figures.find((figure) => figure.name === 'Wobbuffet' && figure.form === null);
    const plate = plates.find((entry) => entry.name === 'Goal Block');
    expect(wobbuffet).toBeDefined();
    expect(plate).toBeDefined();
    if (wobbuffet === undefined || plate === undefined) return;
    const placed = onField(openDuel(wobbuffet.id, plate.id), [[0, 'r4c0']]);
    const play = engine.legalCommands(placed).find((command) => command.kind === 'playPlate' && command.player === 0);
    expect(play).toBeDefined();
    if (play === undefined) return;
    const played = engine.dispatch(placed, play);
    const goal = engine.deps.board.goals[0];
    const mover = played.nextState.figures.find((figure) => figure.uid === figureUid(0));
    expect(played.nextState.pending).toBeNull();
    expect(mover?.node).toBe(goal);
    expect(played.nextState.turn.player).toBe(1);
    expect(played.events.some((event) => event.kind === 'figureMoved' && event.uid === figureUid(0) && event.to === goal)).toBe(true);
  });

  it('does not hang or no-op after playing a legal plate', () => {
    const housekeeping = new Set([
      'platePlayed',
      'plateWindowClosed',
      'preSelectClosed',
      'preSelectOffered',
      'phaseChanged',
      'turnBegan',
      'turnEnded',
      'decisionRequested',
      'decisionResolved',
      'actionTaken',
      'battleDeclined',
      'movedFlagSet',
      'rngAdvanced',
      'gameStarted',
      'megaTicked',
    ]);
    const hung: string[] = [];
    const nops: string[] = [];
    for (const entry of engine.content.plates.values()) {
      try {
        const placed = onField(openDuel(fieldable.figure.id, entry.plate.id), [[0, 'r3c0']]);
        const play = engine
          .legalCommands(placed)
          .find((command) => command.kind === 'playPlate' && command.player === 0);
        if (play === undefined) continue;
        let state = engine.dispatch(placed, play).nextState;
        const events = [...engine.dispatch(placed, play).events];
        for (let steps = 0; state.pending !== null && steps < 16; steps++) {
          const chooser = state.pending.chooser;
          const legal = engine.legalCommands(state);
          const pick =
            legal.find(
              (command) =>
                command.kind === 'resolveDecision' &&
                command.player === chooser &&
                command.accept &&
                (command.figures.length > 0 || command.nodes.length > 0 || (command.slots?.length ?? 0) > 0),
            ) ??
            legal.find(
              (command) => command.kind === 'resolveDecision' && command.player === chooser,
            );
          if (pick === undefined) break;
          const step = engine.dispatch(state, pick);
          events.push(...step.events);
          state = step.nextState;
        }
        if (state.pending !== null) {
          hung.push(`${entry.plate.name} #${entry.plate.id} (${state.pending.kind})`);
          continue;
        }
        const didWork = events.some((event) => !housekeeping.has(event.kind));
        if (!didWork && !plateNeedsNamedFigure(entry.plate)) {
          nops.push(`${entry.plate.name} #${entry.plate.id}`);
        }
      } catch (err) {
        hung.push(`${entry.plate.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(hung.slice(0, 12)).toEqual([]);
    expect(nops.slice(0, 12)).toEqual([]);
  });

  it('does not hang after dispatching a listed instead-of-move ability', () => {
    const hung: string[] = [];
    for (const entry of engine.content.figures.values()) {
      if (isFormOnlyFigure(entry.figure)) continue;
      const clauses = entry.abilityClauses.filter((clause) => isInsteadOfMoveClause(clause));
      if (clauses.length === 0) continue;
      try {
        let state = onField(openDuel(entry.figure.id), [[0, 'r3c0']]);
        const legal = engine.legalCommands(state);
        const action = legal.find(
          (command) => command.kind === 'abilityAction' && command.uid === figureUid(0),
        );
        if (action === undefined) continue;
        state = engine.dispatch(state, action).nextState;
        for (let steps = 0; state.pending !== null && steps < 12; steps++) {
          const chooser = state.pending.chooser;
          const pick = engine
            .legalCommands(state)
            .find((command) => command.kind === 'resolveDecision' && command.player === chooser);
          if (pick === undefined) break;
          state = engine.dispatch(state, pick).nextState;
        }
        if (state.pending !== null && state.pending.chooser !== 0) continue;
        if (state.pending !== null) hung.push(`${entry.figure.name} #${entry.figure.id} (${state.pending.kind})`);
      } catch (err) {
        hung.push(`${entry.figure.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(hung.slice(0, 12)).toEqual([]);
  });
});
