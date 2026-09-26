import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GameEvent, GameState } from '../engine/index.js';
import {
  isWaitingPhase,
  PHASE_MACHINE_EDGES,
  PHASE_MACHINE_NODES,
  type PhaseMachineNodeId,
} from '../engine/phase-machine.js';
import { PhaseMachineNode, type PhaseStatus } from './PhaseMachineNode.js';
import { phaseMachineNodeSize, phaseMachinePosition } from './phase-machine-layout.js';
import { phaseEdgeKey, phasePathOf } from './phase-machine-path.js';
import { clampPhaseZoom, PHASE_ZOOM_DEFAULT, PHASE_ZOOM_MAX, PHASE_ZOOM_MIN, stepPhaseZoom } from './phase-machine-zoom.js';
import { phaseLabel, viewSeatName } from './model.js';
import { useTheme } from './theme.js';

const NODE_TYPES = { phase: PhaseMachineNode };

const SIDE_IDS = new Set<PhaseMachineNodeId>(['waitVictory', 'goal', 'turnLimit', 'concede', 'clock']);

function edgeHandles(from: PhaseMachineNodeId, to: PhaseMachineNodeId): { sourceHandle: string; targetHandle: string } {
  if (from === 'turnEnd' && to === 'turnStart') return { sourceHandle: 'ls', targetHandle: 'l' };
  const fromSide = SIDE_IDS.has(from);
  const toSide = SIDE_IDS.has(to);
  if (!fromSide && toSide) return { sourceHandle: 'r', targetHandle: 'l' };
  if (fromSide && !toSide) return { sourceHandle: 'ls', targetHandle: 'rt' };
  return { sourceHandle: 'b', targetHandle: 't' };
}

function currentBadges(host: GameState): readonly string[] {
  const badges: string[] = [];
  if (host.pending !== null) badges.push('pending');
  if (host.turn.forcedEnd) badges.push('forced end');
  if (host.turn.extraBattle === true) badges.push('extra battle');
  if (host.turn.moved) badges.push('moved');
  if (host.result !== null) badges.push(host.result.reason);
  return badges;
}

function nodeStatus(id: PhaseMachineNodeId, path: ReturnType<typeof phasePathOf>): PhaseStatus {
  if (id === path.current) return 'current';
  return path.visited.has(id) ? 'visited' : 'unused';
}

interface FlowProps {
  readonly host: GameState;
  readonly you: 0 | 1;
  readonly events: readonly GameEvent[];
}

function PhaseMachineFlow({ host, you, events }: FlowProps) {
  const phase = host.phase;
  const path = useMemo(() => phasePathOf(events, phase), [events, phase]);
  const { zoomTo, fitView } = useReactFlow();
  const { theme } = useTheme();
  const [zoom, setZoom] = useState(PHASE_ZOOM_DEFAULT);
  const waiting = isWaitingPhase(phase);
  const over = host.result !== null || phase === 'gameOver';
  const zoomLabel = `${Math.round(zoom * 100)}%`;

  const nodes = useMemo<Node[]>(() => {
    const badges = currentBadges(host);
    return PHASE_MACHINE_NODES.map((node) => {
      const size = phaseMachineNodeSize(node);
      return {
        id: node.id,
        type: 'phase' as const,
        position: phaseMachinePosition(node.id),
        width: size.width,
        height: size.height,
        data: {
          label: node.label,
          kind: node.kind,
          status: nodeStatus(node.id, path),
          badges: node.id === path.current ? badges : [],
        },
        draggable: false,
        selectable: false,
        style: { width: size.width, height: size.height },
      };
    });
  }, [host, path]);

  const ready = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => {
    if (!ready || fitted.current) return;
    fitted.current = true;
    void fitView({ padding: 0.1 });
  }, [fitView, ready]);

  const edges = useMemo<Edge[]>(() => {
    return PHASE_MACHINE_EDGES.map((hop) => {
      const key = hop.id;
      const taken = path.taken.has(key);
      const current =
        path.lastHop !== null && phaseEdgeKey(path.lastHop.from, path.lastHop.to) === key;
      const stroke = current || taken ? 'var(--amber)' : 'var(--steel)';
      return {
        id: hop.id,
        source: hop.from,
        target: hop.to,
        ...edgeHandles(hop.from, hop.to),
        label: hop.label,
        className: current ? 'is-current-edge' : taken ? 'is-taken' : 'is-unused',
        animated: current,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
        style: {
          stroke,
          strokeWidth: current ? 2.6 : taken ? 2 : 1.05,
          opacity: current || taken ? 1 : 0.5,
        },
        labelStyle: {
          fill: current || taken ? 'var(--amber)' : 'var(--steel)',
          fontSize: 9,
          fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
        },
        labelBgStyle: { fill: 'var(--felt)', fillOpacity: 0.88 },
      };
    });
  }, [path]);

  const applyZoom = useCallback(
    (next: number) => {
      const clamped = clampPhaseZoom(next);
      setZoom(clamped);
      void zoomTo(clamped);
    },
    [zoomTo],
  );

  const resetView = useCallback(() => {
    void fitView({ padding: 0.1, duration: 180 });
  }, [fitView]);

  return (
    <div
      className="phase-machine"
      data-testid="phase-machine"
      data-phase={phase}
      data-player={host.turn.player}
      data-over={over ? '1' : '0'}
      data-taken={[...path.taken].join(' ')}
      data-current-edge={path.lastHop === null ? '' : phaseEdgeKey(path.lastHop.from, path.lastHop.to)}
      data-node-count={PHASE_MACHINE_NODES.length}
    >
      <p className="kicker">Phase machine</p>
      <p className="note" data-testid="phase-machine-caption">
        {phaseLabel(phase)} · {viewSeatName(host.turn.player, you)}
        {over && host.result !== null
          ? ` · ${host.result.reason}`
          : waiting
            ? ' · waiting'
            : ' · auto'}
      </p>
      <div className="phase-machine-zoom" data-testid="phase-machine-zoom">
        <button
          type="button"
          className="ghost"
          data-testid="phase-machine-zoom-out"
          aria-label="Zoom out"
          disabled={zoom <= PHASE_ZOOM_MIN}
          onClick={() => {
            applyZoom(stepPhaseZoom(zoom, -1));
          }}
        >
          −
        </button>
        <input
          type="range"
          min={PHASE_ZOOM_MIN}
          max={PHASE_ZOOM_MAX}
          step={0.05}
          value={zoom}
          aria-label="Machine zoom"
          data-testid="phase-machine-zoom-slider"
          onChange={(event) => {
            applyZoom(Number(event.target.value));
          }}
        />
        <button
          type="button"
          className="ghost"
          data-testid="phase-machine-zoom-in"
          aria-label="Zoom in"
          disabled={zoom >= PHASE_ZOOM_MAX}
          onClick={() => {
            applyZoom(stepPhaseZoom(zoom, 1));
          }}
        >
          +
        </button>
        <span className="phase-machine-zoom-value">{zoomLabel}</span>
        <button type="button" className="ghost" data-testid="phase-machine-zoom-reset" onClick={resetView}>
          Reset
        </button>
      </div>
      <div className="phase-machine-viewport" data-testid="phase-machine-viewport">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          minZoom={PHASE_ZOOM_MIN}
          maxZoom={PHASE_ZOOM_MAX}
          defaultViewport={{ x: 0, y: 0, zoom: PHASE_ZOOM_DEFAULT }}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          panOnDrag
          zoomOnPinch
          zoomOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          colorMode={theme === 'light' ? 'light' : 'dark'}
          onMove={(_, viewport) => {
            setZoom(viewport.zoom);
          }}
        >
          <Background gap={18} size={1} color="var(--line)" />
        </ReactFlow>
      </div>
    </div>
  );
}

interface Props {
  readonly host: GameState;
  readonly you: 0 | 1;
  readonly events: readonly GameEvent[];
}

export function PhaseMachine({ host, you, events }: Props) {
  return (
    <ReactFlowProvider>
      <PhaseMachineFlow host={host} you={you} events={events} />
    </ReactFlowProvider>
  );
}
