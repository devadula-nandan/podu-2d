import { figureUid, nodeId, type FigureState, type NodeId } from '../engine/index.js';
import type { FieldHighlights } from '../player/draw-field.js';

export const EMPTY_HIGHLIGHTS: FieldHighlights = {
  reachable: new Set(),
  battleNodes: new Set(),
  surroundUids: new Set(),
  selectedUid: null,
  selectedNode: null,
  movableUids: new Set(),
  focusNode: null,
  animByUid: new Map(),
  surroundPulse: 0,
};

/** Story-only stand-in. Table3d only reads `uid`, `zone`, and `node`. */
export function storyFigure(uid: number, owner: 0 | 1, node: string): FigureState {
  return {
    uid: figureUid(uid),
    owner,
    zone: 'field',
    node: nodeId(node),
  } as FigureState;
}

export function storyNode(id: string): NodeId {
  return nodeId(id);
}
