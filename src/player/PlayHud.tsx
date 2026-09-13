import type { Command, GameState, PlayerView } from '../engine/index.js';
import { endTurnCommand, findKind, formatClock } from '../ui/model.js';
import type { PlayMode } from '../ui/use-duel.js';
import { playerPrompt } from './prompts.js';

interface Props {
  readonly host: GameState;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly mode: PlayMode;
  readonly thinking: boolean;
  readonly locked: boolean;
  readonly lines: readonly string[];
  readonly onEndTurn: () => void;
  readonly onRespin: (use: boolean) => void;
  readonly onConcede: () => void;
  readonly onLeave: () => void;
}

export function PlayHud({
  host,
  view,
  legal,
  mode,
  thinking,
  locked,
  lines,
  onEndTurn,
  onRespin,
  onConcede,
  onLeave,
}: Props) {
  const you = view.you;
  const endTurn = endTurnCommand(legal, you);
  const turnYou = view.turn.player === you;
  const showEndTurn = !locked && view.result === null && turnYou && endTurn !== null;
  const useRespin = findKind(legal, 'useRespin', you);
  const declineRespin = findKind(legal, 'declineRespin', you);
  const showZ = view.zGauges[0] > 0 || view.zGauges[1] > 0;
  const showMega =
    view.megaUsed[0] ||
    view.megaUsed[1] ||
    view.figures.some((figure) => figure.megaTurnsLeft !== null);
  const prompt = playerPrompt(view, legal);
  const rivalLabel = 'Rival';

  return (
    <header className="play-hud" data-mode={mode}>
      <div className="play-clocks" data-testid="play-clocks">
        <ClockChip
          mark="A"
          shape="circle"
          you={you === 0}
          active={view.turn.player === 0}
          time={formatClock(view.clocks[0])}
        />
        <p className="play-prompt" data-testid="play-prompt">
          {prompt}
        </p>
        <ClockChip
          mark="B"
          shape="square"
          you={you === 1}
          active={view.turn.player === 1}
          time={formatClock(view.clocks[1])}
        />
      </div>
      <div className="play-turnline">
        <span data-testid="play-to-move">
          {turnYou ? 'Your turn' : `${rivalLabel}'s turn`}
          {thinking ? ' · thinking…' : ''}
        </span>
        <span className="play-turn-n" data-testid="play-turn">
          Turn {view.turn.number}
        </span>
        {showZ ? (
          <span className="play-meter" data-testid="play-z">
            Z {view.zGauges[0]} / {view.zGauges[1]}
          </span>
        ) : null}
        {showMega ? (
          <span className="play-meter" data-testid="play-mega">
            Mega {megaShort(0, view)} · {megaShort(1, view)}
          </span>
        ) : null}
        <button type="button" className="play-icon" onClick={onLeave}>
          Leave
        </button>
        <button type="button" className="play-icon" onClick={onConcede} disabled={host.result !== null}>
          Concede
        </button>
      </div>
      <div className="play-strip" data-testid="play-strip" aria-live="polite">
        {lines.length === 0 ? (
          <span className="play-strip-line">{turnYou ? 'Your turn' : `${rivalLabel}'s turn`}</span>
        ) : (
          lines.map((line, index) => (
            <span key={`${index}-${line}`} className="play-strip-line">
              {line}
            </span>
          ))
        )}
      </div>
      <div className="play-dock">
        {showEndTurn ? (
          <button type="button" className="play-primary" data-testid="end-turn" onClick={onEndTurn}>
            End turn
          </button>
        ) : null}
        {useRespin !== null ? (
          <button type="button" className="play-ghost" disabled={locked} onClick={() => { onRespin(true); }}>
            Spin again
          </button>
        ) : null}
        {declineRespin !== null ? (
          <button type="button" className="play-ghost" disabled={locked} onClick={() => { onRespin(false); }}>
            Keep spin
          </button>
        ) : null}
      </div>
      {host.result !== null ? (
        <p className="play-result" data-testid="result">
          {host.result.winner === null
            ? `Draw — ${host.result.reason}`
            : `${host.result.winner === you ? 'You' : 'Rival'} wins — ${host.result.reason}. ${host.result.detail}`}
        </p>
      ) : null}
    </header>
  );
}

function ClockChip({
  mark,
  shape,
  you,
  active,
  time,
}: {
  readonly mark: 'A' | 'B';
  readonly shape: 'circle' | 'square';
  readonly you: boolean;
  readonly active: boolean;
  readonly time: string;
}) {
  return (
    <div className="play-clock" data-active={active ? '1' : '0'} data-you={you ? '1' : '0'}>
      <span className={`play-seat-mark play-seat-${shape}`} aria-hidden="true">
        {mark}
      </span>
      <b>{time}</b>
      <small>{you ? 'You' : 'Rival'}</small>
    </div>
  );
}

function megaShort(player: 0 | 1, view: PlayerView): string {
  const live = view.figures.find((figure) => figure.owner === player && figure.megaTurnsLeft !== null);
  if (live !== undefined) return `${live.megaTurnsLeft}`;
  return view.megaUsed[player] ? 'used' : 'ready';
}
