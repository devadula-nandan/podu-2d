import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Command, Engine, FigureState, FigureUid, NodeId, PlayerId } from '../engine/index.js';
import { BOARD, view } from '../engine/index.js';
import { BattleOverlay } from './BattleOverlay.js';
import { BoardCanvas } from './BoardCanvas.js';
import { Hud } from './Hud.js';
import { Inspector } from './Inspector.js';
import { PhaseMachine } from './PhaseMachine.js';
import { ReplayScrubber } from './ReplayScrubber.js';
import { Trays } from './Trays.js';
import { resolveBoardClick, resolveFigureClick } from './board-click.js';
import {
  actorOf,
  battleTargetNodes,
  commandLabel,
  decisionCommands,
  figureName,
  figureSpriteUrlFromUid,
  figureSpriteUrlOf,
  findKind,
  movableUids,
  phaseLabel,
  reachableNodes,
  seatLabel,
} from './model.js';
import { FieldOccupancy } from './FieldOccupancy.js';
import { useLiveDuel } from './DuelSession.js';

interface Props {
  readonly onRematch: () => void;
  readonly onNewSeed: () => void;
  readonly onLeave: () => void;
}

type WorkspacePane = 'inspector' | 'commands' | 'scrub' | 'machine';

export function DuelScreen({ onRematch, onNewSeed, onLeave }: Props) {
  const { engine, duel } = useLiveDuel();
  const [picked, setSelected] = useState<FigureUid | null>(null);
  const [help, setHelp] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [pane, setPane] = useState<WorkspacePane>('commands');
  const [focus, setFocus] = useState<{ uid: FigureUid | null; index: number }>({ uid: null, index: 0 });
  const host = duel.displayHost;
  const playerView = host === null ? null : view(host, duel.viewing);
  const nameOf = useCallback((figure: FigureState) => figureName(engine, figure), [engine]);
  const spriteUrlOf = useCallback((figure: FigureState) => figureSpriteUrlOf(engine, figure), [engine]);
  const selected =
    picked ??
    (host !== null && host.phase === 'battleDecision' ? host.turn.movedUid : null);
  const selectedFigure = host === null || selected === null ? null : (host.figures[selected] ?? null);

  const destNodes = useMemo(() => {
    if (playerView === null || selected === null) return [];
    const nodes = new Set<NodeId>([
      ...reachableNodes(duel.legal, selected),
      ...battleTargetNodes(duel.legal, playerView, selected),
    ]);
    return [...nodes].sort();
  }, [duel.legal, playerView, selected]);

  const focusDest = focus.uid === selected ? focus.index : 0;
  const focusNode = destNodes[focusDest] ?? destNodes[0] ?? null;

  const highlights = useMemo(() => {
    if (playerView === null) {
      return {
        reachable: new Set<NodeId>(),
        battleNodes: new Set<NodeId>(),
        surroundUids: new Set<number>(),
        selectedUid: null,
        selectedNode: null,
        movableUids: new Set<number>(),
        focusNode: null,
      };
    }
    return {
      reachable: selected === null ? new Set<NodeId>() : reachableNodes(duel.legal, selected),
      battleNodes: battleTargetNodes(duel.legal, playerView, selected),
      surroundUids: new Set<number>([...duel.surroundUids, ...duel.pendingSurround]),
      selectedUid: selected,
      selectedNode: selectedFigure?.node ?? null,
      movableUids: movableUids(duel.legal, duel.viewing),
      focusNode,
    };
  }, [duel.legal, duel.pendingSurround, duel.surroundUids, duel.viewing, focusNode, playerView, selected, selectedFigure]);

  const onNode = useCallback(
    (node: NodeId): void => {
      if (playerView === null) return;
      if (duel.handover) {
        duel.explain('Hand the device over first.');
        return;
      }
      if (duel.thinking) {
        duel.explain('The AI is thinking.');
        return;
      }
      if (duel.scrubbing) {
        duel.explain('Jump to live before acting. The scrubber is a view of the caller log.');
        return;
      }
      const occupant = playerView.figures.find((figure) => figure.zone === 'field' && figure.node === node) ?? null;
      const pendingAt = duel.legal.find(
        (command) =>
          command.kind === 'resolveDecision' && command.player === duel.viewing && command.nodes.includes(node),
      );
      const click = resolveBoardClick(duel.legal, duel.viewing, selected, occupant, node, pendingAt);
      if (click.kind === 'command') {
        duel.issue(click.command);
        if (!click.keepSelected) setSelected(null);
        return;
      }
      if (click.kind === 'select') {
        setSelected(click.uid);
        return;
      }
      duel.explain(`Illegal click in the ${phaseLabel(playerView.phase)} window.`);
    },
    [duel, playerView, selected],
  );

  const issueForViewer = useCallback(
    (kind: 'declinePlate' | 'declineBattle' | 'spin' | 'useRespin' | 'declineRespin'): void => {
      const command = findKind(duel.legal, kind, duel.viewing);
      if (command === null) {
        duel.explain(`No ${kind} command is legal for ${seatLabel(duel.viewing)}.`);
        return;
      }
      duel.issue(command);
    },
    [duel],
  );

  const onPlayPlate = useCallback(
    (slot: number): void => {
      if (duel.handover) {
        duel.explain('Hand the device over first.');
        return;
      }
      if (duel.thinking) {
        duel.explain('The AI is thinking.');
        return;
      }
      const command = duel.legal.find(
        (item) => item.kind === 'playPlate' && item.player === duel.viewing && item.slot === slot,
      );
      if (command === undefined) {
        duel.explain('That plate is not legal right now.');
        return;
      }
      duel.issue(command);
    },
    [duel],
  );

  const onAbility = useCallback(
    (command: Command): void => {
      if (duel.handover) {
        duel.explain('Hand the device over first.');
        return;
      }
      if (duel.thinking) {
        duel.explain('The AI is thinking.');
        return;
      }
      duel.issue(command);
    },
    [duel],
  );

  useEffect(() => {
    if (picked === null || duel.thinking || duel.handover || duel.scrubbing) return;
    const click = resolveFigureClick(duel.legal, duel.viewing, picked);
    if (click.kind === 'command') duel.issue(click.command);
  }, [duel, picked]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (playerView === null) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        setHelp((prev) => !prev);
        return;
      }
      if (event.key === 'Escape') {
        setSelected(null);
        duel.dismissBattle();
        duel.clearNotice();
        return;
      }
      if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        duel.undo();
        return;
      }
      if (event.key === 'u' || event.key === 'U') {
        duel.undo();
        return;
      }
      if (event.key === '[' || event.key === 'PageUp') {
        duel.scrubTo(duel.eventCursor - 1);
        return;
      }
      if (event.key === ']' || event.key === 'PageDown') {
        duel.scrubTo(duel.eventCursor + 1);
        return;
      }
      if (event.key === 'End') {
        duel.jumpToLive();
        return;
      }
      if (destNodes.length > 0 && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        event.preventDefault();
        setFocus({
          uid: selected,
          index: (focusDest + (event.key === 'ArrowRight' ? 1 : -1) + destNodes.length) % destNodes.length,
        });
        return;
      }
      if (event.key === 'Enter' && destNodes.length > 0 && focusNode !== null) {
        event.preventDefault();
        onNode(focusNode);
        return;
      }
      if (duel.thinking || duel.handover || duel.scrubbing) return;
      if (event.key === 'd' || event.key === 'D') {
        if (findKind(duel.legal, 'declinePlate', duel.viewing) !== null) issueForViewer('declinePlate');
        else if (findKind(duel.legal, 'declineBattle', duel.viewing) !== null) issueForViewer('declineBattle');
        return;
      }
      if (event.key === 's' || event.key === 'S') {
        issueForViewer('spin');
        return;
      }
      const benchIndex = Number(event.key) - 1;
      if (benchIndex >= 0 && benchIndex <= 5) {
        const bench = playerView.figures.filter((figure) => figure.owner === duel.viewing && figure.zone === 'bench');
        const pick = bench[benchIndex];
        if (pick !== undefined) setSelected(pick.uid);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [destNodes, duel, focusDest, focusNode, issueForViewer, onNode, playerView, selected]);

  if (duel.fatal !== null || host === null || playerView === null) {
    return (
      <div className="boot" data-testid="duel-fatal">
        <h2>Could not start the duel</h2>
        <p className="note">{duel.fatal ?? 'No host state.'}</p>
        <button type="button" className="primary" onClick={onLeave}>
          Back to decks
        </button>
      </div>
    );
  }

  const attackerName =
    duel.battleSnap === null ? '' : nameFromUid(engine, host.figures, duel.battleSnap.attacker);
  const defenderName =
    duel.battleSnap === null ? '' : nameFromUid(engine, host.figures, duel.battleSnap.defender);
  const attackerSprite =
    duel.battleSnap === null ? null : figureSpriteUrlFromUid(engine, host.figures, duel.battleSnap.attacker);
  const defenderSprite =
    duel.battleSnap === null ? null : figureSpriteUrlFromUid(engine, host.figures, duel.battleSnap.defender);
  const nextSeat = actorOf(host, duel.legal);
  const actionsLocked = duel.thinking || duel.handover || duel.scrubbing;

  return (
    <div
      className="stack duel"
      data-testid="duel"
      data-mode={duel.config.mode}
      data-debug={debugOpen ? '1' : '0'}
      data-pane={pane}
    >
      <FieldOccupancy host={host} />
      {duel.handover ? (
        <div className="handover-overlay" data-testid="handover">
          <div className="handover-card">
            <p className="eyebrow">Hotseat hand-off</p>
            <h2>Pass the device to {seatLabel(nextSeat)}</h2>
            <p className="note">
              Hidden information is plate identities. The next view is built with{' '}
              <code>view(state, {nextSeat})</code> and will not show the other seat&apos;s unused plates.
            </p>
            {duel.lastSurround !== null ? (
              <p className="note" data-testid="handover-surround">
                {duel.lastSurround}
              </p>
            ) : null}
            {duel.battleSnap !== null && duel.battleSnap.outcome !== null ? (
              <p className="note" data-testid="handover-battle">
                Last battle: {duel.battleSnap.outcome.decidedBy} — {duel.battleSnap.outcome.reason}
              </p>
            ) : null}
            <button type="button" className="primary" data-testid="handover-confirm" onClick={duel.confirmHandover}>
              I am {seatLabel(nextSeat)}
            </button>
          </div>
        </div>
      ) : null}
      <Hud
        engine={engine}
        host={host}
        view={playerView}
        legal={duel.legal}
        seedLabel={duel.seedLabel}
        mode={duel.config.mode}
        difficulty={duel.config.difficulty}
        thinking={duel.thinking}
        locked={actionsLocked}
        lastSurround={duel.lastSurround}
        onDeclinePlate={() => {
          issueForViewer('declinePlate');
        }}
        onDeclineBattle={() => {
          issueForViewer('declineBattle');
        }}
        onSpin={() => {
          issueForViewer('spin');
        }}
        onRespin={(use) => {
          issueForViewer(use ? 'useRespin' : 'declineRespin');
        }}
        onConcede={() => {
          if (window.confirm(`Concede as ${seatLabel(duel.viewing)}?`)) duel.concede(duel.viewing);
        }}
        onRematch={onRematch}
        onNewSeed={onNewSeed}
        onLeave={onLeave}
        canUndo={duel.canUndo}
        scrubbing={duel.scrubbing}
        onUndo={() => {
          duel.undo();
        }}
        onCopySeed={() => {
          void duel.copySeed().then((url) => {
            duel.explain(`Copied ${url}`);
          });
        }}
        dense
      />
      <div className="dev-tabs" role="tablist" aria-label="Developer workspace" data-testid="dev-workspace-tabs">
        <button
          type="button"
          role="tab"
          className="dev-tab"
          aria-selected={debugOpen && pane === 'inspector'}
          data-testid="dev-tab-inspector"
          onClick={() => {
            setPane('inspector');
            setDebugOpen(true);
          }}
        >
          Inspector
        </button>
        <button
          type="button"
          role="tab"
          className="dev-tab"
          aria-selected={debugOpen && pane === 'commands'}
          data-testid="dev-tab-commands"
          onClick={() => {
            setPane('commands');
            setDebugOpen(true);
          }}
        >
          Commands
        </button>
        <button
          type="button"
          role="tab"
          className="dev-tab"
          aria-selected={debugOpen && pane === 'scrub'}
          data-testid="dev-tab-scrub"
          onClick={() => {
            setPane('scrub');
            setDebugOpen(true);
          }}
        >
          Scrub
        </button>
        <button
          type="button"
          role="tab"
          className="dev-tab"
          aria-selected={debugOpen && pane === 'machine'}
          data-testid="dev-tab-machine"
          onClick={() => {
            setPane('machine');
            setDebugOpen(true);
          }}
        >
          Machine
        </button>
        <button
          type="button"
          className="ghost"
          data-testid="dev-tab-board"
          onClick={() => {
            setDebugOpen((prev) => !prev);
          }}
        >
          {debugOpen ? 'Board' : 'Debug'}
        </button>
      </div>
      <Trays
        side="rival"
        engine={engine}
        view={playerView}
        legal={duel.legal}
        selected={selected}
        onSelect={(uid) => {
          if (actionsLocked) return;
          const click = resolveFigureClick(duel.legal, duel.viewing, uid);
          if (click.kind === 'command') {
            duel.issue(click.command);
            return;
          }
          setSelected(uid);
        }}
        onPlayPlate={onPlayPlate}
        onAbility={onAbility}
      />
      <div className="stack-board board-wrap">
        <BoardCanvas
          board={BOARD}
          view={playerView}
          nameOf={nameOf}
          spriteUrlOf={spriteUrlOf}
          highlights={highlights}
          onNode={onNode}
          onEmpty={() => {
            duel.explain('That click missed the graph. Nodes are the discs; dashed GO rings are legal destinations.');
          }}
        />
        {duel.battleSnap !== null && host.result === null ? (
          <BattleOverlay
            snap={duel.battleSnap}
            attackerName={attackerName}
            defenderName={defenderName}
            attackerSprite={attackerSprite}
            defenderSprite={defenderSprite}
            canSpin={!actionsLocked && findKind(duel.legal, 'spin', duel.viewing) !== null}
            awaitingRespin={
              findKind(duel.legal, 'useRespin', duel.viewing) !== null ||
              findKind(duel.legal, 'declineRespin', duel.viewing) !== null
            }
            onSpin={() => {
              issueForViewer('spin');
            }}
            onClose={duel.dismissBattle}
          />
        ) : null}
        <aside className="debug-drawer" hidden={!debugOpen} data-testid="debug-drawer">
          <div className="debug-body">
            {pane === 'inspector' ? <Inspector engine={engine} host={host} selected={selectedFigure} /> : null}
            {pane === 'machine' ? <PhaseMachine host={host} /> : null}
            {pane === 'scrub' ? (
              <ReplayScrubber
                events={duel.events}
                cursor={duel.eventCursor}
                onScrub={duel.scrubTo}
                onLive={duel.jumpToLive}
              />
            ) : null}
            {pane === 'commands' ? (
              <div className="panel">
                <div className="actions hud-actions">
                  <button type="button" className="ghost" data-testid="undo" disabled={duel.thinking || !duel.canUndo} onClick={duel.undo}>
                    Undo
                  </button>
                  <button type="button" className="primary" data-testid="spin" disabled={actionsLocked} onClick={() => { issueForViewer('spin'); }}>
                    Spin
                  </button>
                  <button type="button" className="ghost" onClick={() => { if (window.confirm(`Concede as ${seatLabel(duel.viewing)}?`)) duel.concede(duel.viewing); }}>
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
                  <button
                    type="button"
                    className="ghost seed-copy"
                    data-testid="copy-seed"
                    onClick={() => {
                      void duel.copySeed().then((url) => {
                        duel.explain(`Copied ${url}`);
                      });
                    }}
                  >
                    Copy seed URL
                  </button>
                </div>
                {help ? (
                  <p className="help">
                    1–6 bench · Esc cancel · D skip/decline · S spin · U/Ctrl+Z undo · [ ] scrub · arrows
                    cycle GO · Enter confirm · End live
                  </p>
                ) : null}
                {playerView.pending !== null ? (
                  <div className="pending" data-testid="pending">
                    <p className="kicker">Pending decision · {seatLabel(playerView.pending.chooser)}</p>
                    <p>{playerView.pending.prompt}</p>
                  </div>
                ) : null}
                {duel.thinking ? (
                  <p className="note thinking" data-testid="thinking">
                    {seatLabel(actorOf(host, duel.legal))} is thinking…
                  </p>
                ) : null}
                {duel.lastAiLabel !== null ? (
                  <p className="note" data-testid="ai-last-command">
                    AI: {duel.lastAiLabel}
                  </p>
                ) : null}
                <p className="kicker">Legal commands</p>
                <div className="actions" data-testid="legal-moves">
                  {decisionCommands(duel.legal)
                    .filter((command) => command.player === duel.viewing)
                    .map((command, index) => (
                      <button
                        key={`${command.kind}-${index}`}
                        type="button"
                        className="action"
                        data-testid={`legal-${command.kind}-${index}`}
                        disabled={actionsLocked}
                        onClick={() => {
                          duel.issue(command);
                          if (command.kind === 'mpMove' || command.kind === 'deploy') setSelected(command.uid);
                          else setSelected(null);
                        }}
                      >
                        {commandLabel(engine, host.figures, command, playerView.pending)}
                      </button>
                    ))}
                </div>
                {duel.config.mode === 'vsAi' || duel.log.length > 0 ? (
                  <div className="command-log" data-testid="command-log">
                    <p className="kicker">Command log</p>
                    <ol>
                      {duel.log.slice(-16).map((row) => (
                        <li key={row.id} data-who={row.who}>
                          <span className="muted">T{row.turn}</span> {row.who === 'ai' ? 'AI' : 'You'}: {row.label}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
      <Trays
        side="you"
        engine={engine}
        view={playerView}
        legal={duel.legal}
        selected={selected}
        onSelect={(uid) => {
          if (actionsLocked) return;
          const click = resolveFigureClick(duel.legal, duel.viewing, uid);
          if (click.kind === 'command') {
            duel.issue(click.command);
            return;
          }
          setSelected(uid);
        }}
        onPlayPlate={onPlayPlate}
        onAbility={onAbility}
      />
      {duel.notice !== null ? (
        <div className="toast" role="status" data-testid="notice">
          {duel.notice}{' '}
          <button type="button" className="ghost" onClick={duel.clearNotice}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function nameFromUid(engine: Engine, figures: readonly FigureState[], uid: number): string {
  const figure = figures[uid];
  return figure === undefined ? `#${uid}` : figureName(engine, figure);
}

export type { PlayerId };
