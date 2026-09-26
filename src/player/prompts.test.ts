import { describe, expect, it } from 'vitest';
import { playerPrompt } from './prompts.js';
import type { Command, PlayerView } from '../engine/index.js';

function view(phase: PlayerView['phase']): PlayerView {
  return {
    you: 0,
    phase,
    turn: {
      player: 0,
      number: 1,
      platePlayed: false,
      plateWindowClosed: false,
      moved: false,
      battled: false,
      movedUid: null,
      forcedEnd: false,
    },
    figures: [],
    pending: null,
    result: null,
    yourPlates: [],
    opponentPlates: { unused: 0, used: [] },
    clocks: { 0: 300000, 1: 300000 },
    zGauges: { 0: 0, 1: 0 },
    megaUsed: { 0: false, 1: false },
  } as unknown as PlayerView;
}

describe('playerPrompt', () => {
  it('translates the action window', () => {
    expect(playerPrompt(view('action'), [])).toBe('Choose a Pokémon to move');
  });

  it('says Select a Pokémon while a plate is waiting on a figure', () => {
    const pending = view('action');
    pending.pending = {
      kind: 'chooseFigures',
      chooser: 0,
      prompt: 'choose figures',
      figureOptions: [0],
      nodeOptions: [],
      minCount: 1,
      maxCount: 1,
      resumeToken: 't',
      resume: { source: 0, controller: 0, remaining: [], then: [], bind: 'none' },
      slotOptions: [],
    } as PlayerView['pending'];
    expect(playerPrompt(pending, [])).toBe('Select a Pokémon');
  });

  it('asks for a spin when that command is legal', () => {
    const spin = { kind: 'spin', player: 0 } as Command;
    expect(playerPrompt(view('action'), [spin])).toBe('Spin!');
  });

  it('asks Battle? when declineBattle is legal', () => {
    const decline = { kind: 'declineBattle', player: 0 } as Command;
    expect(playerPrompt(view('battleDecision'), [decline])).toBe('Battle?');
  });

  it('offers plate or figure when both are legal', () => {
    const plate = { kind: 'playPlate', player: 0, slot: 0 } as Command;
    const move = { kind: 'mpMove', player: 0, uid: 0, to: 'r3c0' } as Command;
    expect(playerPrompt(view('plateWindow'), [plate, move])).toBe('Play a plate or choose a Pokémon');
  });

  it('does not ask to choose a Pokémon on the rival\'s turn', () => {
    const theirs = view('action');
    theirs.turn = { ...theirs.turn, player: 1 };
    expect(playerPrompt(theirs, [])).toBe('Rival is moving');
  });
});
