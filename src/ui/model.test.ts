import { describe, expect, it } from 'vitest';
import type { Command, Engine, GameEvent } from '../engine/index.js';
import { contentPlateId, figureUid } from '../engine/index.js';
import { describeSurroundEvents, endTurnCommand, recentPlayLines } from './model.js';

describe('describeSurroundEvents', () => {
  it('names the KO and the P.C. move', () => {
    const events: GameEvent[] = [
      { kind: 'surrounded', uid: figureUid(6), by: [figureUid(1), figureUid(3)] },
      {
        kind: 'zoneChanged',
        uid: figureUid(6),
        from: 'field',
        to: 'pc',
        node: null,
        pcOrder: 0,
      },
    ];
    expect(describeSurroundEvents((uid) => (uid === 6 ? 'Murkrow' : `#${uid}`), events)).toBe(
      'Murkrow was surrounded and sent to the P.C.',
    );
  });

  it('is silent when nothing was surrounded', () => {
    expect(describeSurroundEvents(() => 'x', [{ kind: 'turnEnded', player: 0 }])).toBeNull();
  });
});

describe('recentPlayLines', () => {
  it('keeps the latest two player-facing lines', () => {
    const engine = {
      content: { plates: new Map([[contentPlateId(12), { plate: { name: 'X Attack' } }]]) },
    } as unknown as Engine;
    const lines = recentPlayLines(
      engine,
      [],
      [
        { kind: 'turnBegan', player: 0, number: 1 },
        { kind: 'platePlayed', player: 0, slot: 0, plateId: contentPlateId(12) },
        { kind: 'phaseChanged', from: 'plateWindow', to: 'action' },
      ],
      0,
    );
    expect(lines).toEqual(['Your turn', 'Played X Attack']);
  });
});

describe('endTurnCommand', () => {
  it('is only declineBattle for the acting seat', () => {
    const declineBattle = { kind: 'declineBattle', player: 0 } as Command;
    const declinePlate = { kind: 'declinePlate', player: 0 } as Command;
    const concede = { kind: 'concede', player: 0 } as Command;
    expect(endTurnCommand([declinePlate, concede], 0)).toBeNull();
    expect(endTurnCommand([declineBattle, declinePlate, concede], 0)).toEqual(declineBattle);
    expect(endTurnCommand([declineBattle, concede], 1)).toBeNull();
  });
});
