import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Engine, FigureState, FigureUid, NodeId } from '../engine/index.js';
import { BOARD, view } from '../engine/index.js';
import { resolveBoardClick, resolveFigureClick } from '../ui/board-click.js';
import {
  actorOf,
  battleTargetNodes,
  endTurnCommand,
  figureName,
  figureSpriteUrlFromUid,
  figureSpriteUrlOf,
  findKind,
  movableUids,
  reachableNodes,
  recentPlayLines,
  seatLabel,
} from '../ui/model.js';
import { FieldOccupancy } from '../ui/FieldOccupancy.js';
import { useDuelSession, useLiveDuel } from '../ui/DuelSession.js';
import type { FieldHighlights } from './draw-field.js';
import { easeOutCubic, motionMs, MOVE_MS, SURROUND_MS } from './motion.js';
import { PlayBattle } from './PlayBattle.js';
import { PlayBoard } from './PlayBoard.js';
import { PlayHud } from './PlayHud.js';
import { PlaySeat } from './PlayTrays.js';
import { playSfx, unlockSfx } from './sfx.js';

interface Slide {
  readonly uid: number;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly started: number;
  readonly duration: number;
}

export function PlayDuel({ muted }: { readonly muted: boolean }) {
  const { leave, tableRole } = useDuelSession();
  const { engine, duel } = useLiveDuel();
  const [picked, setSelected] = useState<FigureUid | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [slides, setSlides] = useState<readonly Slide[]>([]);
  const [surroundPulse, setSurroundPulse] = useState(0);
  const [now, setNow] = useState(() => performance.now());
  const eventCursorRef = useRef(duel.events.length);
  const resultCueRef = useRef(duel.host?.result !== null);

  const host = duel.displayHost;
  const playerView = host === null ? null : view(host, duel.viewing);
  const nameOf = useCallback((figure: FigureState) => figureName(engine, figure), [engine]);
  const spriteUrlOf = useCallback((figure: FigureState) => figureSpriteUrlOf(engine, figure), [engine]);
  const lockUid = host?.turn.movedUid ?? null;
  const selected = lockUid ?? picked;
  const selectedFigure = host === null || selected === null ? null : (host.figures[selected] ?? null);

  useEffect(() => {
    const from = eventCursorRef.current;
    const next = duel.events.slice(from);
    if (next.length === 0) return;
    const started = performance.now();
    const frame = window.requestAnimationFrame(() => {
      eventCursorRef.current = from + next.length;
      const fresh: Slide[] = [];
      let surround = false;
      let knocked = false;
      for (const event of next) {
        if (event.kind === 'figureDeployed') {
          fresh.push({ uid: event.uid, from: event.entry, to: event.to, started, duration: motionMs(MOVE_MS) });
        }
        if (event.kind === 'figureMoved') {
          fresh.push({ uid: event.uid, from: event.from, to: event.to, started, duration: motionMs(MOVE_MS) });
        }
        if (event.kind === 'surrounded') surround = true;
        if (event.kind === 'figureKnockedOut') knocked = true;
      }
      if (fresh.length > 0) {
        setSlides((prev) => [...prev, ...fresh]);
        playSfx('move', muted);
      }
      if (surround) {
        setSurroundPulse(1);
        playSfx('ko', muted);
        window.setTimeout(() => {
          setSurroundPulse(0);
        }, motionMs(SURROUND_MS));
      } else if (knocked) {
        playSfx('ko', muted);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [duel.events, muted]);

  useEffect(() => {
    if (slides.length === 0 && surroundPulse <= 0) return;
    let frame = 0;
    const tick = (t: number): void => {
      setNow(t);
      setSlides((prev) => prev.filter((slide) => t - slide.started < slide.duration));
      if (surroundPulse > 0) {
        const decay = 1 - Math.min(1, (t % motionMs(SURROUND_MS)) / motionMs(SURROUND_MS));
        setSurroundPulse(decay);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [slides.length, surroundPulse]);

  useEffect(() => {
    if (host === null || host.result === null || resultCueRef.current) return;
    resultCueRef.current = true;
    if (host.result.reason.includes('goal')) playSfx('goal', muted);
  }, [host, muted]);

  const animByUid = useMemo(() => {
    const map = new Map<number, { from: NodeId; to: NodeId; t: number }>();
    for (const slide of slides) {
      map.set(slide.uid, {
        from: slide.from,
        to: slide.to,
        t: easeOutCubic((now - slide.started) / slide.duration),
      });
    }
    return map;
  }, [now, slides]);

  const destNodes = useMemo(() => {
    if (playerView === null || selected === null) return [];
    return [
      ...new Set([...reachableNodes(duel.legal, selected), ...battleTargetNodes(duel.legal, playerView, selected)]),
    ].sort();
  }, [duel.legal, playerView, selected]);

  const highlights = useMemo<FieldHighlights>(() => {
    if (playerView === null) {
      return {
        reachable: new Set(),
        battleNodes: new Set(),
        surroundUids: new Set(),
        selectedUid: null,
        selectedNode: null,
        movableUids: new Set(),
        focusNode: null,
        animByUid,
        surroundPulse,
      };
    }
    return {
      reachable: selected === null ? new Set() : reachableNodes(duel.legal, selected),
      battleNodes: battleTargetNodes(duel.legal, playerView, selected),
      surroundUids: new Set([...duel.surroundUids, ...duel.pendingSurround]),
      selectedUid: selected,
      selectedNode: selectedFigure?.node ?? null,
      movableUids: movableUids(duel.legal, duel.viewing),
      focusNode: destNodes[0] ?? null,
      animByUid,
      surroundPulse,
    };
  }, [
    animByUid,
    destNodes,
    duel.legal,
    duel.pendingSurround,
    duel.surroundUids,
    duel.viewing,
    playerView,
    selected,
    selectedFigure,
    surroundPulse,
  ]);

  const onNode = useCallback(
    (node: NodeId): void => {
      if (playerView === null) return;
      unlockSfx();
      if (duel.handover) {
        setNotice('Pass the device first.');
        duel.explain('Pass the device first.');
        return;
      }
      if (duel.thinking) {
        setNotice('Opponent is thinking…');
        duel.explain('Opponent is thinking…');
        return;
      }
      const occupant = playerView.figures.find((figure) => figure.zone === 'field' && figure.node === node) ?? null;
      const pendingAt = duel.legal.find(
        (command) =>
          command.kind === 'resolveDecision' && command.player === duel.viewing && command.nodes.includes(node),
      );
      const click = resolveBoardClick(duel.legal, duel.viewing, selected, occupant, node, pendingAt, lockUid);
      if (click.kind === 'command') {
        if (click.command.kind === 'mpMove' || click.command.kind === 'deploy') playSfx('move', muted);
        else if (click.command.kind === 'initiateBattle') playSfx('select', muted);
        duel.issue(click.command);
        if (!click.keepSelected) setSelected(null);
        return;
      }
      if (click.kind === 'select') {
        playSfx('select', muted);
        setSelected(click.uid);
        return;
      }
      playSfx('illegal', muted);
      setNotice("Can't go there.");
      duel.explain("Can't go there.");
    },
    [duel, lockUid, muted, playerView, selected],
  );

  const issueForViewer = useCallback(
    (kind: 'declinePlate' | 'declineBattle' | 'spin' | 'useRespin' | 'declineRespin'): void => {
      const command = findKind(duel.legal, kind, duel.viewing);
      if (command === null) return;
      if (kind === 'spin') playSfx('spin', muted);
      duel.issue(command);
    },
    [duel, muted],
  );

  useEffect(() => {
    if (selected === null || duel.thinking || duel.handover || tableRole === 'spectator') return;
    const click = resolveFigureClick(duel.legal, duel.viewing, selected, lockUid);
    if (click.kind === 'command') duel.issue(click.command);
  }, [duel, lockUid, selected, tableRole]);

  useEffect(() => {
    if (duel.thinking || duel.handover || tableRole === 'spectator') return;
    if (findKind(duel.legal, 'spin', duel.viewing) === null) return;
    const timer = window.setTimeout(() => {
      issueForViewer('spin');
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [duel.handover, duel.legal, duel.thinking, duel.viewing, issueForViewer, tableRole]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (playerView === null) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
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
      if (event.key === 'Escape') {
        setSelected(null);
        duel.dismissBattle();
        setNotice(null);
        return;
      }
      if (duel.thinking || duel.handover) return;
      if (event.key === 's' || event.key === 'S') issueForViewer('spin');
      if (event.key === 'd' || event.key === 'D') {
        const pass = endTurnCommand(duel.legal, duel.viewing);
        if (pass !== null) duel.issue(pass);
      }
      const benchIndex = Number(event.key) - 1;
      if (benchIndex >= 0 && benchIndex <= 5) {
        const bench = playerView.figures.filter((figure) => figure.owner === duel.viewing && figure.zone === 'bench');
        const pick = bench[benchIndex];
        if (pick !== undefined) {
          playSfx('select', muted);
          setSelected(pick.uid);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [duel, issueForViewer, muted, playerView]);

  if (duel.fatal !== null || host === null || playerView === null) {
    return (
      <div className="play-boot" data-testid="play-fatal">
        <h2>Could not start</h2>
        <p>{duel.fatal ?? 'No host state.'}</p>
        <button type="button" className="play-primary" onClick={leave}>
          Back
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
  const locked =
    duel.thinking || duel.handover || tableRole === 'spectator' || nextSeat !== duel.viewing;
  const showBattle = duel.battleSnap !== null && host.result === null;

  return (
    <div
      className="stack play"
      data-testid="play-duel"
      data-mode={duel.config.mode}
      data-role={tableRole ?? 'unknown'}
      data-flip={duel.viewing === 1 ? '1' : '0'}
    >
      <FieldOccupancy host={host} />
      {tableRole === 'spectator' ? (
        <p className="play-banner" data-testid="table-full">
          Watching — table is full.
        </p>
      ) : null}
      {duel.handover ? (
        <div className="play-handover" data-testid="handover">
          <div className="play-handover-card">
            <p className="play-kicker">Hotseat</p>
            <h2>Pass the device</h2>
            <p>Next seat is {seatLabel(nextSeat)}. Unused plates stay hidden.</p>
            <button type="button" className="play-primary" data-testid="handover-confirm" onClick={duel.confirmHandover}>
              I am here
            </button>
          </div>
        </div>
      ) : null}
      <PlayHud
        host={host}
        view={playerView}
        legal={duel.legal}
        mode={duel.config.mode}
        thinking={duel.thinking}
        locked={locked}
        lines={recentPlayLines(engine, host.figures, duel.events, duel.viewing)}
        onEndTurn={() => {
          const pass = endTurnCommand(duel.legal, duel.viewing);
          if (pass !== null) duel.issue(pass);
        }}
        onRespin={(use) => {
          issueForViewer(use ? 'useRespin' : 'declineRespin');
        }}
        onConcede={() => {
          if (window.confirm('Concede this duel?')) duel.concede(duel.viewing);
        }}
        onLeave={leave}
      />
      <PlaySeat
        side="rival"
        engine={engine}
        view={playerView}
        legal={duel.legal}
        selected={selected}
        locked={locked}
        onSelect={(uid) => {
          const click = resolveFigureClick(duel.legal, duel.viewing, uid, lockUid);
          if (click.kind === 'command') {
            duel.issue(click.command);
            return;
          }
          if (click.kind !== 'select') return;
          playSfx('select', muted);
          setSelected(uid);
        }}
        onPlayPlate={() => undefined}
        onAbility={() => undefined}
      />
      <div className="stack-board play-arena">
        <PlayBoard
          board={BOARD}
          view={playerView}
          nameOf={nameOf}
          spriteUrlOf={spriteUrlOf}
          highlights={highlights}
          onNode={onNode}
          onEmpty={() => {
            playSfx('illegal', muted);
            setNotice("That's not a point.");
            duel.explain("That's not a point.");
          }}
        />
        {showBattle && !duel.handover ? (
          <PlayBattle
            snap={duel.battleSnap}
            attackerName={attackerName}
            defenderName={defenderName}
            attackerSprite={attackerSprite}
            defenderSprite={defenderSprite}
            awaitingRespin={
              findKind(duel.legal, 'useRespin', duel.viewing) !== null ||
              findKind(duel.legal, 'declineRespin', duel.viewing) !== null
            }
            muted={muted}
            onClose={duel.dismissBattle}
          />
        ) : null}
        {duel.thinking ? (
          <p className="play-thinking" data-testid="thinking">
            Opponent is thinking…
          </p>
        ) : null}
      </div>
      <PlaySeat
        side="you"
        engine={engine}
        view={playerView}
        legal={duel.legal}
        selected={selected}
        locked={locked}
        onSelect={(uid) => {
          const click = resolveFigureClick(duel.legal, duel.viewing, uid, lockUid);
          if (click.kind === 'command') {
            duel.issue(click.command);
            return;
          }
          if (click.kind !== 'select') return;
          playSfx('select', muted);
          setSelected(uid);
        }}
        onPlayPlate={(slot) => {
          const command = duel.legal.find(
            (item) => item.kind === 'playPlate' && item.player === duel.viewing && item.slot === slot,
          );
          if (command === undefined) {
            playSfx('illegal', muted);
            setNotice('That plate is not legal right now.');
            duel.explain('That plate is not legal right now.');
            return;
          }
          duel.issue(command);
        }}
        onAbility={(command) => {
          duel.issue(command);
        }}
      />
      {notice !== null || duel.notice !== null ? (
        <div className="play-toast" role="status" data-testid="notice">
          {notice ?? duel.notice}{' '}
          <button
            type="button"
            className="play-ghost"
            onClick={() => {
              setNotice(null);
              duel.clearNotice();
            }}
          >
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
