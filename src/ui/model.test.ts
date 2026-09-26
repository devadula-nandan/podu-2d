import { describe, expect, it } from 'vitest';
import type { Command, Engine, GameEvent } from '../engine/index.js';
import { contentPlateId, figureUid } from '../engine/index.js';
import { describeSurroundEvents, endTurnCommand, playLogLines, recentPlayLines, viewSeatName, viewingWin } from './model.js';

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

  it('keeps the full chronological log', () => {
    const engine = {
      content: { plates: new Map([[contentPlateId(12), { plate: { name: 'X Attack' } }]]) },
    } as unknown as Engine;
    expect(
      playLogLines(
        engine,
        [],
        [
          { kind: 'turnBegan', player: 0, number: 1 },
          { kind: 'platePlayed', player: 0, slot: 0, plateId: contentPlateId(12) },
          { kind: 'turnBegan', player: 1, number: 2 },
        ],
        0,
      ),
    ).toEqual(['Your turn', 'Played X Attack', "Rival's turn"]);
  });
});

describe('viewSeatName', () => {
  it('names the near-edge viewer You and the far seat Rival', () => {
    expect(viewSeatName(0, 0)).toBe('You');
    expect(viewSeatName(1, 0)).toBe('Rival');
    expect(viewSeatName(1, 1)).toBe('You');
    expect(viewSeatName(0, 1)).toBe('Rival');
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

describe('viewingWin', () => {
  it('is you when the near-edge seat won, rival when they lost', () => {
    expect(viewingWin({ winner: 'attacker', decidedBy: 'damage', reason: '70 > 20' }, true)).toBe('you');
    expect(viewingWin({ winner: 'defender', decidedBy: 'damage', reason: '20 < 70' }, true)).toBe('rival');
    expect(viewingWin({ winner: 'defender', decidedBy: 'purple', reason: 'status' }, false)).toBe('you');
    expect(viewingWin({ winner: null, decidedBy: 'draw', reason: 'tie' }, true)).toBe('draw');
  });
});
