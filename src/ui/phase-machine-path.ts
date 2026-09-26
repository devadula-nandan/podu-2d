/**
 * Fold the caller-owned event log onto the complete phase graph.
 * `phaseChanged` is a hop; `gameEnded` walks the reason node then `gameOver`.
 */
import {
  isPhaseEndReason,
  PHASE_MACHINE_EDGES,
  phaseMachineEdgeKey,
  type PhaseMachineNodeId,
} from '../engine/phase-machine.js';
import type { GameEvent } from '../engine/events.js';
import type { Phase, WinReason } from '../engine/state.js';

export interface PhaseHop {
  readonly from: PhaseMachineNodeId;
  readonly to: PhaseMachineNodeId;
}

export interface PhasePath {
  readonly current: Phase;
  readonly visited: ReadonlySet<PhaseMachineNodeId>;
  readonly taken: ReadonlySet<string>;
  readonly lastHop: PhaseHop | null;
}

const GRAPH_EDGE_KEYS = new Set(PHASE_MACHINE_EDGES.map((hop) => hop.id));

export function phaseEdgeKey(from: PhaseMachineNodeId, to: PhaseMachineNodeId): string {
  return phaseMachineEdgeKey(from, to);
}

export function endReasonNode(reason: WinReason): PhaseMachineNodeId | null {
  return isPhaseEndReason(reason) ? reason : null;
}

export function phasePathOf(events: readonly GameEvent[], current: Phase): PhasePath {
  const visited = new Set<PhaseMachineNodeId>(['start', 'setup']);
  const taken = new Set<string>();
  if (GRAPH_EDGE_KEYS.has(phaseEdgeKey('start', 'setup'))) taken.add(phaseEdgeKey('start', 'setup'));
  let lastHop: PhaseHop = { from: 'start', to: 'setup' };
  let at: Phase = 'setup';

  const hop = (from: PhaseMachineNodeId, to: PhaseMachineNodeId): void => {
    visited.add(from);
    visited.add(to);
    const key = phaseEdgeKey(from, to);
    if (GRAPH_EDGE_KEYS.has(key)) taken.add(key);
    lastHop = { from, to };
  };

  // createGame settles before the caller log starts, so liveEvents often omit
  // setup → turnStart → plateWindow even though displayHost is already there.
  const loggedFromSetup = events.some((event) => event.kind === 'phaseChanged' && event.from === 'setup');
  if (!loggedFromSetup && current !== 'setup') {
    hop('setup', 'turnStart');
    at = 'turnStart';
    if (current !== 'turnStart') {
      hop('turnStart', 'plateWindow');
      at = 'plateWindow';
    }
  }

  for (const event of events) {
    if (event.kind === 'phaseChanged') {
      hop(event.from, event.to);
      at = event.to;
    } else if (event.kind === 'gameEnded' && at !== 'gameOver') {
      const reason = endReasonNode(event.result.reason);
      if (reason !== null) {
        hop(at, reason);
        hop(reason, 'gameOver');
      } else {
        hop(at, 'gameOver');
      }
      at = 'gameOver';
    }
  }

  visited.add(current);
  return { current, visited, taken, lastHop };
}
