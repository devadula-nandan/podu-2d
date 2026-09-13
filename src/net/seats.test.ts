import { describe, expect, it } from 'vitest';
import type { DuelConfig } from '../ui/use-duel.js';
import { roleOfSeat, viewingForRole } from './seats.js';

const config: DuelConfig = {
  seed: 2,
  startingPlayer: 0,
  decks: {
    0: { figures: [1, 2, 3, 4, 5, 6], plates: [] },
    1: { figures: [7, 8, 9, 10, 11, 12], plates: [] },
  },
  allowUnimplemented: false,
  mode: 'hotseat',
  humanSeat: 0,
  difficulty: 'easy',
};

describe('table seats', () => {
  it('maps seat index to role and viewing', () => {
    expect(roleOfSeat(0)).toBe('home');
    expect(roleOfSeat(1)).toBe('away');
    expect(roleOfSeat(null)).toBe('spectator');
    expect(viewingForRole('home', config)).toBe(0);
    expect(viewingForRole('away', config)).toBe(1);
    expect(viewingForRole('spectator', config)).toBe(0);
    expect(viewingForRole('home', { ...config, mode: 'vsAi', humanSeat: 0 })).toBe(0);
  });
});
