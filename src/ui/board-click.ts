/**
 * Shared /3d and /dev field-click resolution.
 *
 * Original Duel: select one of yours, then click an adjacent rival to initiate.
 * After an MP-walk the mover stays selected so its battle rings stay up.
 */
import type { Command, FigureState, FigureUid, NodeId, PlayerId } from '../engine/index.js';
import { findBattle, findDeploy, findFigureDecision, findMove, findTag } from './model.js';

export type BoardClick =
  | { readonly kind: 'select'; readonly uid: FigureUid }
  | { readonly kind: 'command'; readonly command: Command; readonly keepSelected: boolean }
  | { readonly kind: 'none' };

export function resolveFigureClick(
  legal: readonly Command[],
  viewing: PlayerId,
  uid: FigureUid,
  lockUid: FigureUid | null = null,
): BoardClick {
  const pick = findFigureDecision(legal, viewing, uid);
  if (pick !== null) return { kind: 'command', command: pick, keepSelected: false };
  if (lockUid !== null && uid !== lockUid) return { kind: 'none' };
  return { kind: 'select', uid };
}

export function resolveBoardClick(
  legal: readonly Command[],
  viewing: PlayerId,
  selected: FigureUid | null,
  occupant: FigureState | null,
  node: NodeId,
  pendingAt: Command | undefined,
  lockUid: FigureUid | null = null,
  preferZ = false,
): BoardClick {
  if (occupant !== null) {
    const pick = findFigureDecision(legal, viewing, occupant.uid);
    if (pick !== null) return { kind: 'command', command: pick, keepSelected: false };
  }
  if (selected !== null) {
    const deploy = findDeploy(legal, selected, node);
    if (deploy !== null) return { kind: 'command', command: deploy, keepSelected: true };
    const move = findMove(legal, selected, node);
    if (move !== null) return { kind: 'command', command: move, keepSelected: true };
    if (occupant !== null) {
      const battle = findBattle(legal, selected, occupant.uid, preferZ);
      if (battle !== null) return { kind: 'command', command: battle, keepSelected: false };
      const tag = findTag(legal, selected, occupant.uid);
      if (tag !== null) return { kind: 'command', command: tag, keepSelected: false };
      if (occupant.owner === viewing) {
        if (lockUid !== null && occupant.uid !== lockUid) return { kind: 'none' };
        return { kind: 'select', uid: occupant.uid };
      }
    }
    if (pendingAt !== undefined) return { kind: 'command', command: pendingAt, keepSelected: false };
    return { kind: 'none' };
  }
  if (occupant !== null && occupant.owner === viewing) {
    if (lockUid !== null && occupant.uid !== lockUid) return { kind: 'none' };
    return { kind: 'select', uid: occupant.uid };
  }
  if (pendingAt !== undefined) return { kind: 'command', command: pendingAt, keepSelected: false };
  return { kind: 'none' };
}
