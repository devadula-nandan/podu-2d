import type { Command, PlayerView } from '../engine/index.js';
import { findKind } from '../ui/model.js';

/** Player-facing copy. Engine phase names stay off the table. */
export function playerPrompt(view: PlayerView, legal: readonly Command[]): string {
  if (view.result !== null) {
    return view.result.winner === null ? 'Draw' : 'Duel over';
  }
  if (view.pending !== null) return 'Choose a Pokémon';
  const you = view.you;
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
      return 'Choose a Pokémon';
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

