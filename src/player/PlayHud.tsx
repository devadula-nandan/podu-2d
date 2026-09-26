import { useState } from 'react';
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
  readonly notice?: string | null;
  readonly zArmed?: boolean;
  readonly onToggleZ?: () => void;
  readonly onEndTurn: () => void;
  readonly onRespin: (use: boolean) => void;
  readonly onDecision: (accept: boolean) => void;
}

export function PlayHud({
  host,
  view,
  legal,
  mode,
  thinking,
  locked,
  lines,
  notice = null,
  zArmed = false,
  onToggleZ,
  onEndTurn,
  onRespin,
  onDecision,
}: Props) {
  const you = view.you;
  const endTurn = endTurnCommand(legal, you);
  const turnYou = view.turn.player === you;
  const showEndTurn = !locked && view.result === null && turnYou && endTurn !== null;
  const useRespin = findKind(legal, 'useRespin', you);
  const declineRespin = findKind(legal, 'declineRespin', you);
  const skipOptional = legal.find(
    (command) => command.kind === 'resolveDecision' && command.player === you && !command.accept,
  );
  const takeOptional = legal.find(
    (command) =>
      command.kind === 'resolveDecision' &&
      command.player === you &&
      command.accept &&
      command.figures.length === 0 &&
      command.nodes.length === 0,
  );
  const prompt = playerPrompt(view, legal);
  const rivalSeat = you === 0 ? 1 : 0;
  const turnsLeft = Math.max(0, 301 - view.turn.number);
  const [logOpen, setLogOpen] = useState(false);
  const latest = lines[lines.length - 1] ?? (turnYou ? 'Your turn' : "Rival's turn");
  const yourZ = zPips(view.zGauges[you]);
  const zReady = yourZ >= 8;

  return (
    <header className="match-hud" data-mode={mode} data-yours={turnYou ? '1' : '0'}>
      <div className="match-top">
        <div className="match-header" id="match-header">
          <div className={`player-chip you${turnYou ? ' active' : ''}`}>
            <div className="meta">
              <div className="name">You</div>
              <div className="chip-row">
                <div className={`sub clock${clockTone(view.clocks[you])}`}>{formatClock(view.clocks[you])}</div>
                {zReady ? (
                  <button
                    type="button"
                    className="play-z-btn"
                    data-testid="play-z"
                    data-on={zArmed ? '1' : '0'}
                    data-full="1"
                    title={zArmed ? 'Z-Move armed — attack to use it' : 'Use Z-Move'}
                    aria-label={zArmed ? 'Z-Move armed' : 'Arm Z-Move'}
                    aria-pressed={zArmed}
                    disabled={locked || onToggleZ === undefined}
                    onClick={() => {
                      onToggleZ?.();
                    }}
                  >
                    Z
                  </button>
                ) : (
                  <span
                    className="play-z-gauge"
                    data-testid="play-z"
                    data-full="0"
                    title="Z-Move"
                    aria-label="Z-Move gauge"
                  >
                    {Array.from({ length: 8 }, (_, index) => (
                      <i key={index} data-on={index < yourZ ? '1' : '0'} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className={`turn-chip${turnsLeft <= 20 ? ' urgent' : ''}`} data-testid="play-turn">
            {view.turn.number}
          </div>
          <div className={`player-chip opp${turnYou ? '' : ' active'}`}>
            <div className="meta">
              <div className="name">Rival</div>
              <div className="chip-row">
                <span
                  className="play-z-gauge"
                  data-testid="play-z-rival"
                  data-full={zPips(view.zGauges[rivalSeat]) >= 8 ? '1' : '0'}
                  title="Z-Move"
                  aria-label="Z-Move gauge"
                >
                  {Array.from({ length: 8 }, (_, index) => (
                    <i key={index} data-on={index < zPips(view.zGauges[rivalSeat]) ? '1' : '0'} />
                  ))}
                </span>
                <div className={`sub clock${clockTone(view.clocks[rivalSeat])}`} data-testid="play-clock-rival">
                  {formatClock(view.clocks[rivalSeat])}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className={`play-log${notice !== null ? ' is-notice' : host.result !== null ? ' is-result' : ''}`}
          data-testid="play-strip"
          data-turn={turnYou ? 'you' : 'rival'}
          aria-live="polite"
        >
          {notice !== null ? (
            <p className="play-log-latest" data-testid="notice" role="status">
              {notice}
            </p>
          ) : host.result !== null ? (
            <p className="play-result play-log-latest" data-testid="result">
              {host.result.winner === null
                ? `Draw — ${host.result.reason}`
                : `${host.result.winner === you ? 'You' : 'Rival'} wins — ${host.result.reason}. ${host.result.detail}`}
            </p>
          ) : (
            <p className="play-log-latest">{latest}</p>
          )}
          <button
            type="button"
            className="play-log-toggle"
            data-testid="play-log-toggle"
            aria-expanded={logOpen}
            aria-controls="play-log-full"
            onClick={() => {
              setLogOpen((open) => !open);
            }}
          >
            {logOpen ? 'Hide' : 'Log'}
          </button>
        </div>
        {logOpen ? (
          <ol className="play-log-full" id="play-log-full" data-testid="play-log-full">
            {lines.length === 0 ? <li>{latest}</li> : lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
          </ol>
        ) : null}
      </div>
      <p className="visually-hidden" data-testid="play-prompt">
        {prompt}
      </p>
      <p className="visually-hidden" data-testid="play-to-move">
        {turnYou ? 'Your turn' : "Rival's turn"}
        {thinking ? ' · thinking…' : ''}
      </p>
      {(showEndTurn ||
        useRespin !== null ||
        declineRespin !== null ||
        takeOptional !== undefined ||
        skipOptional !== undefined) ? (
        <div className="action-bar">
          {showEndTurn ? (
            <button type="button" className="hud-action hot" data-testid="end-turn" onClick={onEndTurn}>
              Don&apos;t battle
            </button>
          ) : null}
          {useRespin !== null ? (
            <button type="button" className="hud-action" disabled={locked} onClick={() => { onRespin(true); }}>
              Spin again
            </button>
          ) : null}
          {declineRespin !== null ? (
            <button type="button" className="hud-action" disabled={locked} onClick={() => { onRespin(false); }}>
              Keep spin
            </button>
          ) : null}
          {takeOptional !== undefined ? (
            <button type="button" className="hud-action" disabled={locked} onClick={() => { onDecision(true); }}>
              Do it
            </button>
          ) : null}
          {skipOptional !== undefined ? (
            <button type="button" className="hud-action" disabled={locked} data-testid="skip-optional" onClick={() => { onDecision(false); }}>
              Skip
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

function zPips(gauge: number): number {
  return Math.min(8, Math.floor((gauge * 8) / 100));
}

function clockTone(ms: number): string {
  if (ms <= 30_000) return ' urgent';
  if (ms <= 60_000) return ' hot';
  return '';
}
