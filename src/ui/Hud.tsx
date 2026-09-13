import type { Difficulty } from '../ai/index.js';
import type { Command, Engine, GameState, PlayerId, PlayerView } from '../engine/index.js';
import { MEGA_EVOLUTIONS_PER_DUEL } from '../rules/constants.js';
import { findKind, formatClock, phaseLabel, seatLabel } from './model.js';
import type { PlayMode } from './use-duel.js';

interface Props {
  readonly engine: Engine;
  readonly host: GameState;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly seedLabel: string;
  readonly mode: PlayMode;
  readonly difficulty: Difficulty;
  readonly thinking: boolean;
  readonly locked: boolean;
  readonly lastSurround: string | null;
  readonly onDeclinePlate: () => void;
  readonly onDeclineBattle: () => void;
  readonly onSpin: () => void;
  readonly onRespin: (use: boolean) => void;
  readonly onConcede: () => void;
  readonly onRematch: () => void;
  readonly onNewSeed: () => void;
  readonly onLeave: () => void;
  readonly canUndo: boolean;
  readonly scrubbing: boolean;
  readonly onUndo: () => void;
  readonly onCopySeed: () => void;
  readonly dense?: boolean;
}

export function Hud({
  engine,
  host,
  view,
  legal,
  seedLabel,
  mode,
  difficulty,
  thinking,
  locked,
  lastSurround,
  onDeclinePlate,
  onDeclineBattle,
  onSpin,
  onRespin,
  onConcede,
  onRematch,
  onNewSeed,
  onLeave,
  canUndo,
  scrubbing,
  onUndo,
  onCopySeed,
  dense = false,
}: Props) {
  const you = view.you;
  const turnPlayer = view.turn.player;
  const declinePlate = findKind(legal, 'declinePlate', you);
  const declineBattle = findKind(legal, 'declineBattle', you);
  const spin = findKind(legal, 'spin', you);
  const useRespin = findKind(legal, 'useRespin', you);
  const declineRespin = findKind(legal, 'declineRespin', you);
  const summary = `${engine.registry.totals.figuresImplemented}/${engine.registry.totals.figures} figures live`;
  const youActing = turnPlayer === you;

  return (
    <header className="hud">
      <div className="timer-pill">
        <div className="timer-side" data-who="you" data-hot={youActing ? '1' : '0'}>
          <span className="timer-mark" aria-hidden="true">
            Y
          </span>
          <div>
            <b data-testid="to-move">
              {seatLabel(turnPlayer)}
              {youActing ? ' · you' : mode === 'vsAi' ? ' · AI' : ' · opponent'}
            </b>
            <small>{youActing ? (thinking ? 'Thinking' : 'Acting') : 'Waiting'}</small>
          </div>
        </div>
        <b className="timer" data-testid="clocks">
          {formatClock(view.clocks[0])} / {formatClock(view.clocks[1])}
        </b>
        <div className="timer-side" data-who="rival" data-hot={youActing ? '0' : '1'}>
          <div>
            <b>{youActing ? (mode === 'vsAi' ? 'Rival' : seatLabel(turnPlayer === 0 ? 1 : 0)) : 'You'}</b>
            <small>{youActing ? 'Waiting' : thinking ? 'Thinking' : 'Acting'}</small>
          </div>
          <span className="timer-mark is-rival" aria-hidden="true">
            R
          </span>
        </div>
      </div>
      <div className="hud-debug">
        <span>
          turn <b data-testid="turn">{view.turn.number}</b>
        </span>
        <span className="hud-seed">
          <b data-testid="seed">{seedLabel}</b>
        </span>
        {mode === 'vsAi' ? (
          <span>
            vs AI <b data-testid="ai-difficulty">{thinking ? `${difficulty} · thinking…` : difficulty}</b>
          </span>
        ) : null}
        <span>
          phase · <b data-testid="phase">{phaseLabel(view.phase)}</b>
        </span>
        {dense ? null : (
          <>
            <span>
              z {view.zGauges[0]}/{view.zGauges[1]}
            </span>
            <span>
              mega {MEGA_EVOLUTIONS_PER_DUEL} {megaText(0, view)} · {megaText(1, view)}
            </span>
            <button type="button" className="ghost seed-copy" data-testid="copy-seed" onClick={onCopySeed}>
              Copy seed URL
            </button>
          </>
        )}
      </div>
      {dense ? null : (
      <div className="actions hud-actions">
        <button
          type="button"
          className="ghost"
          disabled={locked || declinePlate === null}
          data-testid="skip-plate"
          onClick={onDeclinePlate}
        >
          Skip plate
        </button>
        <button
          type="button"
          className="ghost"
          disabled={locked || declineBattle === null}
          data-testid="decline-battle"
          onClick={onDeclineBattle}
        >
          Decline battle
        </button>
        <button type="button" className="primary" disabled={locked || spin === null} onClick={onSpin} data-testid="spin">
          Spin
        </button>
        <button type="button" className="ghost" disabled={locked || useRespin === null} onClick={() => { onRespin(true); }}>
          Use respin
        </button>
        <button
          type="button"
          className="ghost"
          disabled={locked || declineRespin === null}
          onClick={() => {
            onRespin(false);
          }}
        >
          Keep spin
        </button>
        <button type="button" className="ghost" data-testid="undo" disabled={thinking || !canUndo} onClick={onUndo}>
          Undo
        </button>
        <button type="button" className="ghost" onClick={onConcede}>
          Concede
        </button>
        <button type="button" className="ghost" onClick={onRematch} data-testid="rematch">
          Rematch same seed
        </button>
        <button type="button" className="ghost" onClick={onNewSeed} data-testid="new-seed">
          New seed
        </button>
        <button type="button" className="ghost" onClick={onLeave}>
          Decks
        </button>
      </div>
      )}
      {dense ? null : (
      <p className="help">
        {summary}. Click a figure, then a dashed GO node. Keys: 1–6 bench, Esc cancel, D skip/decline, S
        spin, U/Ctrl+Z undo, [ ] scrub, arrows cycle GO, ? help. Colour is never the only signal — seats
        are A-circle / B-square, wheels are letter + hatch + size.
        {scrubbing ? ' Viewing a replay prefix — jump to live to act.' : ''}
        {mode === 'vsAi'
          ? ' AI search seed is duelSeed ⊕ (turn × 0x9e3779b9); same seed + same clicks replay.'
          : ''}
      </p>
      )}
      {view.pending !== null ? (
        <p className="note" data-testid="hud-pending">
          Pending: {view.pending.prompt}
        </p>
      ) : null}
      {lastSurround !== null ? (
        <p className="note" data-testid="surround-notice">
          {lastSurround}
        </p>
      ) : null}
      {host.result !== null ? (
        <p className="note" data-testid="result">
          {host.result.winner === null
            ? `Draw (${host.result.reason})`
            : `${seatLabel(host.result.winner)} wins — ${host.result.reason}. ${host.result.detail}`}
        </p>
      ) : null}
    </header>
  );
}

function megaText(player: PlayerId, view: PlayerView): string {
  const used = view.megaUsed[player];
  const live = view.figures.find((figure) => figure.owner === player && figure.megaTurnsLeft !== null);
  if (live !== undefined) return `${seatLabel(player)} mega ${live.megaTurnsLeft}`;
  return used ? `${seatLabel(player)} spent` : `${seatLabel(player)} ready`;
}
