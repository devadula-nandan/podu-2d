import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { PhaseMachineNodeKind } from '../engine/phase-machine.js';

export type PhaseStatus = 'current' | 'visited' | 'unused';

export type PhaseFlowNodeData = {
  readonly label: string;
  readonly kind: PhaseMachineNodeKind;
  readonly status: PhaseStatus;
  readonly badges: readonly string[];
};

export type PhaseFlowNode = Node<PhaseFlowNodeData, 'phase'>;

function PhaseMachineNodeInner({ data, id }: NodeProps<PhaseFlowNode>) {
  return (
    <div
      className="phase-flow-node"
      data-kind={data.kind}
      data-status={data.status}
      data-testid={`phase-node-${id}`}
      style={{ width: '100%', height: '100%', boxSizing: 'border-box' }}
    >
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Left} id="ls" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="target" position={Position.Right} id="rt" />
      <span className="phase-flow-label">{data.label}</span>
      {data.badges.length > 0 ? (
        <span className="phase-flow-badges">
          {data.badges.map((badge) => (
            <em key={badge}>{badge}</em>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export const PhaseMachineNode = memo(PhaseMachineNodeInner);
