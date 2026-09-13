import type { GameEvent } from '../engine/index.js';
import { eventLabel } from './replay.js';

interface Props {
  readonly events: readonly GameEvent[];
  readonly cursor: number;
  readonly onScrub: (index: number) => void;
  readonly onLive: () => void;
}

export function ReplayScrubber({ events, cursor, onScrub, onLive }: Props) {
  const max = events.length;
  const atLive = cursor >= max;
  const current = cursor === 0 ? 'Opening settle' : eventLabel(events[cursor - 1] ?? { kind: 'gameStarted', startingPlayer: 0 });

  return (
    <div className="scrubber" data-testid="replay-scrubber">
      <p className="kicker">Replay</p>
      <p className="note" data-testid="replay-position">
        {atLive ? 'Live' : `Event ${cursor}/${max}`} · {current}
      </p>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={cursor}
        data-testid="replay-slider"
        aria-label="Replay event cursor"
        onChange={(event) => {
          onScrub(Number(event.target.value));
        }}
      />
      <div className="actions">
        <button
          type="button"
          className="ghost"
          data-testid="replay-prev"
          disabled={cursor <= 0}
          onClick={() => {
            onScrub(cursor - 1);
          }}
        >
          Prev
        </button>
        <button
          type="button"
          className="ghost"
          data-testid="replay-next"
          disabled={atLive}
          onClick={() => {
            onScrub(cursor + 1);
          }}
        >
          Next
        </button>
        <button type="button" className={atLive ? 'primary' : 'ghost'} data-testid="replay-live" onClick={onLive}>
          Live
        </button>
      </div>
    </div>
  );
}
