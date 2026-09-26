import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Command, Engine, FigureState, FigureUid, GameState, NodeId } from '../engine/index.js';
import { BOARD, isPreSelectClause, mpPath, OPEN_MOVEMENT, view } from '../engine/index.js';
import { resolveBoardClick, resolveFigureClick } from '../ui/board-click.js';
import {
  actorOf,
  battleTargetNodes,
  endTurnCommand,
  figureMp,
  figureName,
  figureSpriteUrlFromUid,
  figureSpriteUrlOf,
  findKind,
  movableUids,
  reachableNodes,
  playLogLines,
  seatLabel,
} from '../ui/model.js';
import { FieldOccupancy } from '../ui/FieldOccupancy.js';
import { useDuelSession, useLiveDuel } from '../ui/DuelSession.js';
import type { Table3dApi } from '../stage3d/Table3d.js';
import type { FieldHighlights } from './draw-field.js';
import { CLASH_MS, motionMs, moveMs, SURROUND_MS } from './motion.js';
import { PlayBattle } from './PlayBattle.js';
import { PlayBoard3d } from './PlayBoard3d.js';
import { PlayFigureDetail } from './PlayFigureDetail.js';
import { PlayHud } from './PlayHud.js';
import type { MatchSettingsProps } from './PlaySettings.js';
import { playSfx, unlockSfx } from './sfx.js';

interface Slide {
  readonly uid: number;
  readonly nodes: readonly NodeId[];
  readonly started: number;
  readonly duration: number;
}

function occupiedExcept(figures: readonly FigureState[], uid: number): Set<NodeId> {
  const nodes = new Set<NodeId>();
  for (const figure of figures) {
    if (figure.uid === uid || figure.zone !== 'field' || figure.node === null) continue;
    nodes.add(figure.node);
  }
  return nodes;
}

function walkNodes(from: NodeId, to: NodeId, occupied: ReadonlySet<NodeId>): NodeId[] {
  if (from === to) return [from];
  const blocked = mpPath(BOARD, from, to, 8, occupied, OPEN_MOVEMENT);
  if (blocked.length > 0) return [from, ...blocked];
  const through = mpPath(BOARD, from, to, 8, occupied, { passThrough: true, forbidden: new Set() });
  if (through.length > 0) return [from, ...through];
  return [from, to];
}

function preSelectAbility(
  engine: Engine,
  host: GameState,
  legal: readonly Command[],
  uid: FigureUid,
): Command | null {
  const figure = host.figures[uid];
  if (figure === undefined) return null;
  const clauses = engine.content.figures.get(figure.figureId)?.abilityClauses ?? [];
  return (
    legal.find((command) => {
      if (command.kind !== 'abilityAction' || command.uid !== uid) return false;
      return clauses.some((clause) => clause.id === command.clauseId && isPreSelectClause(clause));
    }) ?? null
  );
}

interface PlayDuelProps {
  readonly muted: boolean;
  readonly tableApiRef: MutableRefObject<Table3dApi | null>;
  readonly onMatchSettings: (match: MatchSettingsProps | null) => void;
}

export function PlayDuel({ muted, tableApiRef, onMatchSettings }: PlayDuelProps) {
  const { leave, tableRole } = useDuelSession();
  const { engine, duel } = useLiveDuel();
  const [picked, setSelected] = useState<FigureUid | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [slides, setSlides] = useState<readonly Slide[]>([]);
  const [surroundPulse, setSurroundPulse] = useState(0);
  const eventCursorRef = useRef(duel.events.length);
  const resultCueRef = useRef(duel.host?.result !== null);
  const pendingPlateSlot = useRef<number | null>(null);
  const plateBusy = useRef(false);
  const [plateAnimSlot, setPlateAnimSlot] = useState<number | null>(null);
  const [inspectUid, setInspectUid] = useState<FigureUid | null>(null);
  const [zArmed, setZArmed] = useState(false);

  const host = duel.displayHost;
  const playerView = host === null ? null : view(host, duel.viewing);
  const nameOf = useCallback((figure: FigureState) => figureName(engine, figure), [engine]);
  const spriteUrlOf = useCallback((figure: FigureState) => figureSpriteUrlOf(engine, figure), [engine]);
  const mpOf = useCallback((figure: FigureState) => figureMp(engine, figure), [engine]);
  const lockUid = host?.turn.movedUid ?? null;
  const selected = lockUid ?? picked;
  const selectedFigure = host === null || selected === null ? null : (host.figures[selected] ?? null);
  const inspectFigure = host === null || inspectUid === null ? null : (host.figures[inspectUid] ?? null);
  const turnStamp = host === null ? '' : `${host.turn.player}-${host.turn.number}`;

  const offerPreSelect = useCallback(
    (uid: FigureUid): void => {
      if (host === null) return;
      const pre = preSelectAbility(engine, host, duel.legal, uid);
      if (pre !== null) duel.issue(pre);
    },
    [duel, engine, host],
  );

  const selectFigure = useCallback(
    (uid: FigureUid): void => {
      if (host === null || plateBusy.current) return;
      const click = resolveFigureClick(duel.legal, duel.viewing, uid, lockUid);
      if (click.kind === 'command') {
        const plateSlot = pendingPlateSlot.current;
        if (
          plateSlot !== null &&
          click.command.kind === 'resolveDecision' &&
          click.command.accept &&
          click.command.figures[0] === uid
        ) {
          pendingPlateSlot.current = null;
          plateBusy.current = true;
          const table = tableApiRef.current;
          const command = click.command;
          void (async () => {
            if (table !== null) await table.presentPlateUse(plateSlot, uid);
            duel.issue(command);
            plateBusy.current = false;
          })();
          return;
        }
        duel.issue(click.command);
        if (click.command.kind === 'resolveDecision' && click.command.figures[0] === uid) {
          setSelected(uid);
        }
        return;
      }
      if (click.kind !== 'select') return;
      playSfx('select', muted);
      setSelected(uid);
      if (host.pending === null) offerPreSelect(uid);
    },
    [duel, host, lockUid, muted, offerPreSelect, tableApiRef],
  );

  useEffect(() => {
    setSelected(null);
  }, [turnStamp]);

  useEffect(() => {
    if (playerView === null || Math.min(8, Math.floor((playerView.zGauges[playerView.you] * 8) / 100)) < 8) {
      setZArmed(false);
    }
  }, [playerView]);

  useLayoutEffect(() => {
    const from = eventCursorRef.current;
    const next = duel.events.slice(from);
    if (next.length === 0) return;
    const started = performance.now();
    const figures = host?.figures ?? [];
    eventCursorRef.current = from + next.length;
    const fresh: Slide[] = [];
    let surround = false;
    let knocked = false;
    for (const event of next) {
      if (event.kind === 'figureDeployed') {
        const nodes = walkNodes(event.entry, event.to, occupiedExcept(figures, event.uid));
        fresh.push({ uid: event.uid, nodes, started, duration: moveMs(Math.max(1, nodes.length)) });
      }
      if (event.kind === 'figureMoved') {
        const nodes = walkNodes(event.from, event.to, occupiedExcept(figures, event.uid));
        fresh.push({ uid: event.uid, nodes, started, duration: moveMs(nodes.length - 1) });
      }
      // Bench↔field↔PC hops are driven by Table3d auto-hop from last world pos.
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
  }, [duel.events, host, muted]);

  useEffect(() => {
    if (slides.length === 0 && surroundPulse <= 0) return;
    let frame = 0;
    const tick = (t: number): void => {
      setSlides((prev) => {
        const next = prev.filter((slide) => t - slide.started < slide.duration);
        return next.length === prev.length ? prev : next;
      });
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

  const stripNotice = notice ?? duel.notice;
  useEffect(() => {
    if (stripNotice === null) return;
    const clear = duel.clearNotice;
    const timer = window.setTimeout(() => {
      setNotice(null);
      clear();
    }, 2400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [duel.clearNotice, stripNotice]);

  useEffect(() => {
    if (plateAnimSlot === null) return;
    const slot = plateAnimSlot;
    const pending = host?.pending;
    if (pending !== null && pending !== undefined && (pending.kind === 'chooseFigures' || pending.kind === 'chooseNode')) {
      pendingPlateSlot.current = slot;
      tableApiRef.current?.collapsePlateHand();
      setNotice('Choose a target for your plate.');
      setPlateAnimSlot(null);
      plateBusy.current = false;
      return;
    }
    setPlateAnimSlot(null);
    const table = tableApiRef.current;
    void (async () => {
      if (table !== null) await table.presentPlateUse(slot, 'board');
      plateBusy.current = false;
    })();
  }, [host, plateAnimSlot, tableApiRef]);

  const emptyAnim = useMemo(() => new Map<number, { nodes: readonly NodeId[]; t: number }>(), []);

  const destNodes = useMemo(() => {
    const pendingNodes: NodeId[] = [];
    if (host?.pending?.kind === 'chooseFigures' && host.pending.chooser === duel.viewing) {
      for (const uid of host.pending.figureOptions) {
        const figure = host.figures[uid];
        if (figure?.zone === 'field' && figure.node !== null) pendingNodes.push(figure.node);
      }
    }
    if (playerView === null) return pendingNodes;
    if (selected === null) return [...new Set(pendingNodes)].sort();
    return [
      ...new Set([
        ...pendingNodes,
        ...reachableNodes(duel.legal, selected),
        ...battleTargetNodes(duel.legal, playerView, selected),
      ]),
    ].sort();
  }, [duel.legal, duel.viewing, host, playerView, selected]);

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
        animByUid: emptyAnim,
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
      animByUid: emptyAnim,
      surroundPulse,
    };
  }, [
    destNodes,
    duel.legal,
    duel.pendingSurround,
    duel.surroundUids,
    duel.viewing,
    emptyAnim,
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
      const click = resolveBoardClick(
        duel.legal,
        duel.viewing,
        selected,
        occupant,
        node,
        pendingAt,
        lockUid,
        zArmed,
      );
      if (click.kind === 'command') {
        if (click.command.kind === 'mpMove' || click.command.kind === 'deploy') playSfx('move', muted);
        else if (click.command.kind === 'initiateBattle') playSfx('select', muted);
        if (click.command.kind === 'initiateBattle' && click.command.zMoveIndex !== undefined) {
          setZArmed(false);
        }
        duel.issue(click.command);
        if (!click.keepSelected) setSelected(null);
        return;
      }
      if (click.kind === 'select') {
        playSfx('select', muted);
        setSelected(click.uid);
        if (host?.pending === null) offerPreSelect(click.uid);
        return;
      }
      playSfx('illegal', muted);
      setNotice("Can't go there.");
      duel.explain("Can't go there.");
    },
    [duel, host, lockUid, muted, offerPreSelect, playerView, selected, zArmed],
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
  const issueForViewerRef = useRef(issueForViewer);
  issueForViewerRef.current = issueForViewer;
  const spinLegal = findKind(duel.legal, 'spin', duel.viewing) !== null;

  useEffect(() => {
    if (selected === null || duel.thinking || duel.handover || tableRole === 'spectator') return;
    const click = resolveFigureClick(duel.legal, duel.viewing, selected, lockUid);
    if (click.kind === 'command') duel.issue(click.command);
  }, [duel, lockUid, selected, tableRole]);

  useEffect(() => {
    if (duel.thinking || duel.handover || tableRole === 'spectator' || !spinLegal) return;
    const timer = window.setTimeout(() => {
      issueForViewerRef.current('spin');
    }, motionMs(CLASH_MS));
    return () => {
      window.clearTimeout(timer);
    };
  }, [duel.handover, duel.thinking, spinLegal, tableRole]);

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
  const logLines = useMemo(
    () => playLogLines(engine, host.figures, duel.events, duel.viewing),
    [duel.events, duel.viewing, engine, host.figures],
  );

  useEffect(() => {
    const viewing = duel.viewing;
    const concede = duel.concede;
    onMatchSettings({
      lines: logLines,
      canConcede: host.result === null && tableRole !== 'spectator',
      onConcede: () => {
        if (window.confirm('Concede this duel?')) concede(viewing);
      },
      onLeave: leave,
    });
  }, [duel.concede, duel.viewing, host.result, leave, logLines, onMatchSettings, tableRole]);

  useEffect(() => {
    return () => {
      onMatchSettings(null);
    };
  }, [onMatchSettings]);

  const onMatchIntroLand = useCallback(() => {
    playSfx('move', muted);
  }, [muted]);

  const onCoinLand = useCallback((winner: 'you' | 'rival') => {
    playSfx('hit', muted);
    setNotice(winner === 'you' ? 'Coin flip — you go first!' : 'Coin flip — Rival goes first!');
  }, [muted]);

  return (
    <div
      className="stack play"
      data-testid="play-duel"
      data-mode={duel.config.mode}
      data-role={tableRole ?? 'unknown'}
      data-viewing={String(duel.viewing)}
      data-pending={host.pending?.kind ?? ''}
      data-pending-chooser={host.pending === null ? '' : String(host.pending.chooser)}
      data-pending-options={(host.pending?.figureOptions ?? []).join(',')}
      data-legal-picks={String(
        duel.legal.filter((command) => command.kind === 'resolveDecision' && command.accept && command.figures.length === 1)
          .length,
      )}
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
      <div className="play-table">
        <PlayHud
          host={host}
          view={playerView}
          legal={duel.legal}
          mode={duel.config.mode}
          thinking={duel.thinking}
          locked={locked}
          lines={logLines}
          notice={stripNotice}
          zArmed={zArmed}
          onToggleZ={() => {
            setZArmed((armed) => {
              const next = !armed;
              setNotice(next ? 'Z-Move armed — attack to use it' : null);
              return next;
            });
          }}
          onEndTurn={() => {
            const pass = endTurnCommand(duel.legal, duel.viewing);
            if (pass !== null) duel.issue(pass);
          }}
          onRespin={(use) => {
            issueForViewer(use ? 'useRespin' : 'declineRespin');
          }}
          onDecision={(accept) => {
            const command = duel.legal.find(
              (item) =>
                item.kind === 'resolveDecision' &&
                item.player === duel.viewing &&
                item.accept === accept &&
                (accept ? item.figures.length === 0 && item.nodes.length === 0 : true),
            );
            if (command !== undefined) duel.issue(command);
          }}
        />
        <div className="play-arena">
          <PlayBoard3d
            board={BOARD}
            engine={engine}
            view={playerView}
            legal={duel.legal}
            selected={selected}
            locked={locked}
            nameOf={nameOf}
            spriteUrlOf={spriteUrlOf}
            mpOf={mpOf}
            highlights={highlights}
            moves={slides}
            tableApiRef={tableApiRef}
            onNode={onNode}
            onFigure={(uid) => {
              selectFigure(uid as FigureUid);
            }}
            onInspectFigure={(uid) => {
              setInspectUid(uid as FigureUid);
            }}
            onPlayPlate={(slot) => {
              if (plateBusy.current) return;
              const command = duel.legal.find(
                (item) => item.kind === 'playPlate' && item.player === duel.viewing && item.slot === slot,
              );
              if (command === undefined) {
                playSfx('illegal', muted);
                setNotice('That plate is not legal right now.');
                duel.explain('That plate is not legal right now.');
                return;
              }
              plateBusy.current = true;
              duel.issue(command);
              setPlateAnimSlot(slot);
            }}
            onAbility={(command) => {
              duel.issue(command);
            }}
            onEmpty={() => {
              playSfx('illegal', muted);
              setNotice("That's not a point.");
              duel.explain("That's not a point.");
            }}
            onMatchIntroLand={onMatchIntroLand}
            onCoinLand={onCoinLand}
            matchSeed={duel.config.seed}
          />
          {showBattle && !duel.handover ? (
            <PlayBattle
              snap={duel.battleSnap}
              attackerName={attackerName}
              defenderName={defenderName}
              attackerSprite={attackerSprite}
              defenderSprite={defenderSprite}
              youAreAttacker={(host.figures[duel.battleSnap.attacker]?.owner ?? 0) === duel.viewing}
              awaitingRespin={
                findKind(duel.legal, 'useRespin', duel.viewing) !== null ||
                findKind(duel.legal, 'declineRespin', duel.viewing) !== null
              }
              muted={muted}
              onClose={duel.dismissBattle}
            />
          ) : null}
          {inspectFigure !== null ? (
            <PlayFigureDetail
              engine={engine}
              figure={inspectFigure}
              you={playerView.you}
              onClose={() => {
                setInspectUid(null);
              }}
            />
          ) : null}
          {duel.thinking && !showBattle ? (
            <p className="play-thinking" data-testid="thinking">
              Opponent is thinking…
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function nameFromUid(engine: Engine, figures: readonly FigureState[], uid: number): string {
  const figure = figures[uid];
  return figure === undefined ? `#${uid}` : figureName(engine, figure);
}
