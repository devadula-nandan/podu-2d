import type { DuelConfig } from '../ui/use-duel.js';
import { roleOfSeat, viewingForRole as viewing, type TableRole } from './room.js';

export type { TableRole } from './room.js';
export { roleOfSeat };

export function viewingForRole(role: TableRole | null, config: DuelConfig): 0 | 1 {
  return viewing(role, config);
}
