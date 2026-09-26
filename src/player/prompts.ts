import type { Command, PlayerView } from '../engine/index.js';
import { findKind } from '../ui/model.js';

/** Player-facing copy. Engine phase names stay off the table. */
export function playerPrompt(view: PlayerView, legal: readonly Command[]): string {
  if (view.result !== null) {
    return view.result.winner === null ? 'Draw' : 'Duel over';
  }
  const you = view.you;
  if (view.pending !== null && view.pending.chooser === you) {
    if (view.pending.kind === 'optionalAction') {
      return view.pending.prompt === 'move' ? 'Switch places?' : 'Use the effect?';
    }
    if (view.pending.kind === 'chooseNode') return 'Select a point';
    if (view.pending.kind === 'choosePlate') return 'Select a plate';
    return 'Select a Pokémon';
  }
  if (view.turn.player !== you) return 'Rival is moving';
  if (view.pending !== null) return 'Rival is choosing';
  if (findKind(legal, 'spin', you) !== null) return 'Spin!';
  if (findKind(legal, 'useRespin', you) !== null || findKind(legal, 'declineRespin', you) !== null) {
    return 'Spin again?';
  }
  if (findKind(legal, 'declineBattle', you) !== null) return 'Battle?';
  const canPlate = findKind(legal, 'playPlate', you) !== null || findKind(legal, 'declinePlate', you) !== null;
  const canAct = legal.some(
    (command) =>
      command.player === you
      && (command.kind === 'mpMove' || command.kind === 'deploy' || command.kind === 'initiateBattle'),
  );
  if (canPlate && canAct) return 'Play a plate or choose a Pokémon';
  if (canPlate) return 'Play a plate?';
  if (findKind(legal, 'declineWindow', you) !== null) return 'Before you move…';
  switch (view.phase) {
    case 'setup':
    case 'turnStart':
    case 'plateWindow':
      return 'Play a plate?';
    case 'preSelect':
      return 'Before you move…';
    case 'action':
      return 'Choose a Pokémon to move';
    case 'surroundCheck':
      return 'Surround!';
    case 'battleDecision':
      return 'Battle?';
    case 'spin':
      return 'Spin!';
    case 'respin':
      return 'Spin again?';
    case 'damageResolve':
      return 'Hit!';
    case 'turnEnd':
      return 'Turn over';
    case 'gameOver':
      return 'Duel over';
  }
}
