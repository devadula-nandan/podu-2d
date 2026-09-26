import type { BoardNode } from '../engine/index.js';

/** Same span as pokemon-duel-webgl (`X_POS` / `Y_POS` ±2.2). */
export const BOARD_SPAN = 4.4;
export const FLOOR_Y = -0.08;
export const BOARD_THICK = 0.11;
export const BOARD_TOP = FLOOR_Y + BOARD_THICK;
export const PUCK_H = 0.04;
export const NODE_RADIUS = 0.1;
export const ROUTE_Y = BOARD_TOP + PUCK_H / 2;

export function visualUnit(x: number, y: number, flip: boolean): { x: number; y: number } {
  return flip ? { x: 1 - x, y: 1 - y } : { x, y };
}

/** Unit-square board → world XZ. y=1 (player 0) sits toward +Z / the camera. */
export function worldOf(x: number, y: number, flip: boolean): { x: number; y: number; z: number } {
  const point = visualUnit(x, y, flip);
  return {
    x: (point.x - 0.5) * BOARD_SPAN,
    y: ROUTE_Y,
    z: (point.y - 0.5) * BOARD_SPAN,
  };
}

export function worldOfNode(node: Pick<BoardNode, 'x' | 'y'>, flip: boolean): { x: number; y: number; z: number } {
  return worldOf(node.x, node.y, flip);
}
