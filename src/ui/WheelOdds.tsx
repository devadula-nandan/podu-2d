import type { ResolvedSegment } from '../engine/index.js';
import { formatMatchupShare, formatUnits, matchupOdds, wheelOdds } from './odds.js';

export function WheelOdds({
  segments,
  caption,
}: {
  readonly segments: readonly ResolvedSegment[];
  readonly caption: string;
}) {
  const odds = wheelOdds(segments);
  return (
    <div className="odds" data-testid="wheel-odds" data-odds-sum={String(odds.sumPercent)}>
      <p className="kicker">{caption}</p>
      <table>
        <caption className="muted">
          Exact /{odds.totalUnits || 96} units. Size is the chance, not the colour.
        </caption>
        <thead>
          <tr>
            <th scope="col">Move</th>
            <th scope="col">Colour</th>
            <th scope="col">Chance</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment, index) => (
            <tr key={`${segment.moveName}-${index}`} data-units={segment.size}>
              <td>{segment.moveName}</td>
              <td>
                {segment.color.toUpperCase().slice(0, 1)} {segment.color}
              </td>
              <td>{formatUnits(segment.size, odds.totalUnits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note" data-testid="odds-sum">
        {odds.totalUnits}/{odds.totalUnits || 96} = {odds.sumPercent}%
      </p>
    </div>
  );
}

export function MatchupOdds({
  attacker,
  defender,
}: {
  readonly attacker: readonly ResolvedSegment[];
  readonly defender: readonly ResolvedSegment[];
}) {
  const odds = matchupOdds(attacker, defender);
  return (
    <p className="note" data-testid="matchup-odds">
      Exact matchup · attacker {formatMatchupShare(odds.attacker, odds.pairs)} · draw{' '}
      {formatMatchupShare(odds.draw, odds.pairs)} · defender {formatMatchupShare(odds.defender, odds.pairs)}
    </p>
  );
}
