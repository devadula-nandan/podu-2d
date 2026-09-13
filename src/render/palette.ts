/**
 * Colourblind-safe table colours. Seat and wheel state are always paired with a
 * shape or letter — never a colour alone.
 */
export const FELT = '#141c28';
export const FELT_INK = '#0d131c';
export const IVORY = '#e8dcc4';
export const BRASS = '#d4b36a';
export const STEEL = '#7f8b9a';
export const CORRIDOR = '#2a3648';

export const SEAT_A = { fill: '#3d6b8c', ink: '#d7e6f0', mark: 'A' as const, shape: 'circle' as const };
export const SEAT_B = { fill: '#8c5a3d', ink: '#f3e2d4', mark: 'B' as const, shape: 'square' as const };

export const WHEEL_COLORS = {
  white: { fill: '#f4efe4', ink: '#2a2418', letter: 'W', pattern: 'solid' as const },
  gold: { fill: '#e0b84a', ink: '#2a2418', letter: 'G', pattern: 'dots' as const },
  purple: { fill: '#7b4ea3', ink: '#f4efe4', letter: 'P', pattern: 'diag' as const },
  blue: { fill: '#2f6fbf', ink: '#f4efe4', letter: 'B', pattern: 'horiz' as const },
  miss: { fill: '#4a5560', ink: '#f4efe4', letter: 'M', pattern: 'cross' as const },
} as const;

export type WheelColor = keyof typeof WHEEL_COLORS;

export const REACH_STROKE = '#e8dcc4';
export const BATTLE_STROKE = '#d4b36a';
export const SURROUND_STROKE = '#c45c4a';
export const SELECT_STROKE = '#f4efe4';

export function seatOf(player: 0 | 1): typeof SEAT_A | typeof SEAT_B {
  return player === 0 ? SEAT_A : SEAT_B;
}
