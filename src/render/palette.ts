/**
 * Table colours. You vs Rival is the primary seat distinction (blue vs red).
 * Wheel state is still paired with a letter / pattern — never a colour alone.
 */
export const FELT = '#141c28';
export const FELT_INK = '#0d131c';
export const IVORY = '#e8dcc4';
export const BRASS = '#d4b36a';
export const STEEL = '#7f8b9a';
export const CORRIDOR = '#2a3648';

/** Matches `--you` / `--rival` in `styles.css`. */
export const YOU_HEX = '#2f6bff';
export const RIVAL_HEX = '#e23b3b';

export type SideStyle = {
  readonly fill: string;
  readonly rim: string;
  readonly ink: string;
  readonly mark: 'Y' | 'R';
  readonly shape: 'circle';
};

/** Beige disc + blue rim. Viewer-relative: the near-edge seat. */
export const YOU: SideStyle = {
  fill: '#c5d2f4',
  rim: YOU_HEX,
  ink: '#142038',
  mark: 'Y',
  shape: 'circle',
};

/** Beige disc + red rim. Viewer-relative: the far-edge seat. */
export const RIVAL: SideStyle = {
  fill: '#f0c6c2',
  rim: RIVAL_HEX,
  ink: '#3a1414',
  mark: 'R',
  shape: 'circle',
};

export const SEAT_A = { fill: YOU.fill, rim: YOU.rim, ink: YOU.ink, mark: 'A' as const, shape: 'circle' as const };
export const SEAT_B = { fill: RIVAL.fill, rim: RIVAL.rim, ink: RIVAL.ink, mark: 'B' as const, shape: 'circle' as const };

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

/** Viewer-relative You / Rival. Tokens and HUD accents use this, not player index. */
export function sideOf(owner: 0 | 1, you: 0 | 1): SideStyle {
  return owner === you ? YOU : RIVAL;
}

export function seatOf(player: 0 | 1): typeof SEAT_A | typeof SEAT_B {
  return player === 0 ? SEAT_A : SEAT_B;
}
