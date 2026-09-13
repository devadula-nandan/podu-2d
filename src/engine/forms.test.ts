import { describe, expect, it } from 'vitest';
import { MEGA_DURATION_TURNS } from '../rules/constants.js';
import { createEngine } from './dispatch.js';
import {
  formSiblings,
  megaBlockedByOncePerDuel,
  megaEndEvents,
  megaStartEvents,
  namedFiguresInText,
  resolveEvolutionTargets,
  resolveFormTargets,
  resolveMegaTargets,
} from './forms.js';
import { contentFigureId } from './ids.js';
import { applyEvents } from './reduce.js';
import { figureOf } from './state.js';
import { harness, makeFigure, makePlate, onField, uid } from './test/helpers.js';
import { tickTimers } from './rules/zones.js';

function contentFor(figures: ReturnType<typeof makeFigure>[]) {
  return createEngine({ figures, plates: [], abilities: [] }).content;
}

describe('forms and evolution', () => {
  it('keys form siblings by id, not by the printed name', () => {
    const shield = makeFigure(10, { name: 'Aegislash', form: 'Aegislash Shield Forme' });
    const blade = makeFigure(11, { name: 'Aegislash', form: 'Aegislash Blade Forme' });
    const other = makeFigure(12, { name: 'Aegislash', form: 'Aegislash Shield Forme' });
    const content = contentFor([shield, blade, other]);

    expect(formSiblings(content, contentFigureId(10))).toEqual([11]);
    expect(resolveFormTargets(content, contentFigureId(10), ['Blade'])).toEqual([11]);
    expect(resolveFormTargets(content, contentFigureId(10), [])).toEqual([11]);
  });

  it('resolves Mega X/Y from the printed name and a plate hint, never an invented line', () => {
    const base = makeFigure(1, { name: 'Charizard' });
    const megaX = makeFigure(2, { name: 'Mega Charizard X' });
    const megaY = makeFigure(3, { name: 'Mega Charizard Y' });
    const content = contentFor([base, megaX, megaY]);

    expect(resolveMegaTargets(content, contentFigureId(1))).toEqual([2, 3]);
    expect(resolveMegaTargets(content, contentFigureId(1), 'Charizardite X')).toEqual([2]);
    expect(resolveMegaTargets(content, contentFigureId(1), 'Charizardite Y')).toEqual([3]);
    expect(namedFiguresInText(content, 'It can evolve.', contentFigureId(1))).toEqual([]);
    expect(resolveEvolutionTargets(content, contentFigureId(1), 'It can evolve.')).toEqual([]);
    expect(resolveEvolutionTargets(content, contentFigureId(1), 'Evolves into Mega Charizard X')).toEqual([2]);
  });

  it('Megas last MEGA_DURATION_TURNS, set megaUsed, and revert when the timer expires', () => {
    expect(MEGA_DURATION_TURNS).toBe(7);
    const { state } = harness({
      p0: [makeFigure(1, { name: 'Charizard' }), makeFigure(2, { name: 'Mega Charizard' })],
      p1: [makeFigure(3)],
    });
    const placed = onField(state, [[0, 'r4c1']]);
    const started = applyEvents(placed, megaStartEvents(placed, uid(0), 0, contentFigureId(2)));
    expect(figureOf(started, uid(0)).figureId).toBe(2);
    expect(figureOf(started, uid(0)).megaRevertsTo).toBe(1);
    expect(figureOf(started, uid(0)).megaTurnsLeft).toBe(MEGA_DURATION_TURNS);
    expect(started.players[0]?.megaUsed).toBe(true);
    expect(megaBlockedByOncePerDuel(started, uid(0))).toBe(true);

    let ticking = started;
    for (let i = 0; i < MEGA_DURATION_TURNS; i++) {
      ticking = tickTimers(ticking).state;
    }
    expect(figureOf(ticking, uid(0)).megaTurnsLeft).toBeNull();
    const ended = applyEvents(ticking, megaEndEvents(ticking, uid(0)));
    expect(figureOf(ended, uid(0)).figureId).toBe(1);
    expect(figureOf(ended, uid(0)).megaRevertsTo).toBeNull();
  });

  it('a Mega Stone plate mega-evolves the stand-in when a Mega form exists', () => {
    const { engine, state } = harness({
      p0: [makeFigure(1, { name: 'Charizard' }), makeFigure(2, { name: 'Mega Charizard X' })],
      p1: [makeFigure(3)],
      p0Plates: [
        makePlate(1, 'mega evolve this Pokémon for 7 turns', {
          cost: null,
          name: 'Charizardite X',
          endsTurn: false,
        }),
      ],
    });
    const placed = onField(state, [[0, 'r4c1']]);
    const played = engine.dispatch(placed, { kind: 'playPlate', player: 0, slot: 0 });
    expect(figureOf(played.nextState, uid(0)).figureId).toBe(2);
    expect(figureOf(played.nextState, uid(0)).megaTurnsLeft).toBe(7);
    expect(played.nextState.players[0]?.megaUsed).toBe(true);
  });
});
