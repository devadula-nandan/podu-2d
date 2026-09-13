import type { GameState } from '../engine/index.js';

/** Hidden occupancy list so e2e can assert the same figure sits on the same node across views. */
export function FieldOccupancy({ host }: { readonly host: GameState }) {
  const rows = host.figures.filter((figure) => figure.zone === 'field' && figure.node !== null);
  return (
    <ul data-testid="field-occupancy" hidden>
      {rows.map((figure) => (
        <li key={figure.uid} data-testid={`occupancy-${figure.uid}`} data-node={figure.node}>
          {figure.uid}@{figure.node}
        </li>
      ))}
    </ul>
  );
}
