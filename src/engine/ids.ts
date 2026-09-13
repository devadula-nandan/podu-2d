/**
 * Branded identifier types shared across the engine.
 *
 * These live in their own module so the board graph, the state model and the effect
 * runtime can all name the same ids without importing each other. A branded string
 * costs nothing at runtime and stops the single most likely engine bug: passing a
 * figure instance id where a node id is wanted, or a content figure id where an
 * instance id is wanted. Those two are both numbers and both called "figure id" in
 * conversation, which is exactly why the compiler has to keep them apart.
 */

/** Seat, not team colour. Player 0 defends row 4 of the board; player 1 defends row 0. */
export type PlayerId = 0 | 1;

export const PLAYER_IDS: readonly PlayerId[] = [0, 1];

export const opponentOf = (player: PlayerId): PlayerId => (player === 0 ? 1 : 0);

/** A point on the board. */
export type NodeId = string & { readonly __brand: 'NodeId' };
export const nodeId = (id: string): NodeId => id as NodeId;

/**
 * One figure *instance* in one duel.
 *
 * Distinct from the content `figure.id`, and deliberately so: names are not unique
 * in the content (three different figures are called "Dawn Wings Necrozma"), and a
 * deck may legally hold two copies of the same figure id. Only the instance id
 * identifies a piece on the board.
 */
export type FigureUid = number & { readonly __brand: 'FigureUid' };
export const figureUid = (n: number): FigureUid => n as FigureUid;

/** A content figure id, i.e. the `id` field in `data/content/figures.json`. */
export type ContentFigureId = number & { readonly __brand: 'ContentFigureId' };
export const contentFigureId = (n: number): ContentFigureId => n as ContentFigureId;

/** A content plate id. */
export type ContentPlateId = number & { readonly __brand: 'ContentPlateId' };
export const contentPlateId = (n: number): ContentPlateId => n as ContentPlateId;
