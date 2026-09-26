import { useEffect, useMemo, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { BoardGraph, Command, Engine, FigureState, FigureUid, NodeId, PlayerView } from '../engine/index.js';
import { PC_CAPACITY } from '../rules/constants.js';
import { figureOfContent, plateOfContent } from '../ui/boot.js';
import { commandsForUid, figureMp, figureName, plateCost, zoneFigures } from '../ui/model.js';
import { Table3d, type Table3dApi, type Table3dMove } from '../stage3d/Table3d.js';
import type { FieldHighlights } from './draw-field.js';

const LONG_PRESS_MS = 480;

function matchIntroKey(seed: number): string {
  return `podu:match-intro:${seed >>> 0}`;
}

function matchIntroAlreadyDone(seed: number): boolean {
  try {
    return sessionStorage.getItem(matchIntroKey(seed)) === '1';
  } catch {
    return false;
  }
}

function markMatchIntroDone(seed: number): void {
  try {
    sessionStorage.setItem(matchIntroKey(seed), '1');
  } catch {
    /* private mode */
  }
}

/** Call when a brand-new match opens so the coin can play again. */
export function clearMatchIntroFlag(seed: number): void {
  try {
    sessionStorage.removeItem(matchIntroKey(seed));
  } catch {
    /* private mode */
  }
}

interface Props {
  readonly board: BoardGraph;
  readonly engine: Engine;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly selected: FigureUid | null;
  readonly locked: boolean;
  readonly nameOf: (figure: FigureState) => string;
  readonly spriteUrlOf: (figure: FigureState) => string | null;
  readonly mpOf: (figure: FigureState) => number;
  readonly highlights: FieldHighlights;
  readonly moves?: readonly Table3dMove[];
  readonly tableApiRef?: MutableRefObject<Table3dApi | null>;
  readonly onNode: (node: NodeId) => void;
  readonly onFigure: (uid: number) => void;
  readonly onInspectFigure: (uid: number) => void;
  readonly onPlayPlate: (slot: number) => void;
  readonly onAbility: (command: Command) => void;
  readonly onEmpty: () => void;
  readonly onMatchIntroLand?: () => void;
  readonly onCoinLand?: (winner: 'you' | 'rival') => void;
  /** Stable per-match id — intro plays once for this seed, including after remount/refresh. */
  readonly matchSeed?: number;
}

export function PlayBoard3d({
  board,
  engine,
  view,
  legal,
  selected,
  locked,
  nameOf,
  spriteUrlOf,
  mpOf,
  highlights,
  moves = [],
  tableApiRef,
  onNode,
  onFigure,
  onInspectFigure,
  onPlayPlate,
  onAbility,
  onEmpty,
  onMatchIntroLand,
  onCoinLand,
  matchSeed,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tableRef = useRef<Table3d | null>(null);
  const hitsRef = useRef(new Map<string, HTMLButtonElement>());
  const longPressRef = useRef<{ timer: number; uid: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const matchIntroRef = useRef(false);
  const introSeedRef = useRef<number | null>(null);
  const tableIntroAppliedRef = useRef(false);
  const flip = view.you === 1;
  const rival = view.you === 0 ? 1 : 0;
  const youBench = useMemo(() => zoneFigures(view, view.you, 'bench'), [view]);
  const rivalBench = useMemo(() => zoneFigures(view, rival, 'bench'), [rival, view]);
  const youPc = useMemo(() => zoneFigures(view, view.you, 'pc'), [view]);
  const rivalPc = useMemo(() => zoneFigures(view, rival, 'pc'), [rival, view]);
  const plates = useMemo(
    () =>
      view.yourPlates.map((plate, slot) => {
        const content = plateOfContent(engine, plate.plateId);
        const playable = legal.some(
          (command) => command.kind === 'playPlate' && command.player === view.you && command.slot === slot,
        );
        return {
          slot,
          name: content?.name ?? `Plate ${slot + 1}`,
          cost: content === null ? 0 : plateCost(content),
          used: plate.used,
          playable,
          rarity: content?.rarity ?? 'C',
          effect: content?.effect ?? '',
        };
      }),
    [engine, legal, view.you, view.yourPlates],
  );
  const abilityActions = legal.filter((command) => command.kind === 'abilityAction' && command.player === view.you);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (canvas === null || wrap === null) return;
    const table = new Table3d(canvas);
    tableRef.current = table;
    tableIntroAppliedRef.current = false;
    const onHandChange = (open: boolean): void => {
      wrap.classList.toggle('is-plate-hand', open);
    };
    table.onHandChange = onHandChange;
    if (tableApiRef !== undefined) {
      tableApiRef.current = {
        resetCamera: () => {
          table.resetCamera();
        },
        setCameraLocked: (lockedCam) => {
          table.setCameraLocked(lockedCam);
        },
        setOrbitSuppressed: (suppressed) => {
          table.setOrbitSuppressed(suppressed);
        },
        setWorldTheme: (theme) => {
          table.setWorldTheme(theme);
        },
        openPlateHand: () => {
          table.openPlateHand();
        },
        collapsePlateHand: () => {
          table.collapsePlateHand();
        },
        isPlateHandOpen: () => table.isPlateHandOpen(),
        presentPlateUse: (slot, target) => table.presentPlateUse(slot, target),
        figureWorldPos: (uid) => table.figureWorldPos(uid),
        playMatchIntro: (opts) => table.playMatchIntro(opts),
        skipMatchIntro: () => {
          table.skipMatchIntro();
        },
        playCoinFlip: (winner) => table.playCoinFlip(winner),
      };
    }
    const fit = (): void => {
      table.setSize(wrap.clientWidth, wrap.clientHeight);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      if (tableApiRef !== undefined) tableApiRef.current = null;
      table.dispose();
      tableRef.current = null;
    };
  }, [tableApiRef]);

  useEffect(() => {
    if (matchSeed === undefined) return;
    if (introSeedRef.current !== matchSeed) {
      introSeedRef.current = matchSeed;
      matchIntroRef.current = false;
      tableIntroAppliedRef.current = false;
    }
  }, [matchSeed]);

  useEffect(() => {
    const table = tableRef.current;
    if (table === null) return;
    table.setScene({
      board,
      figures: view.figures,
      nameOf,
      spriteUrlOf,
      mpOf,
      highlights,
      flip,
      clocks: [view.clocks[0], view.clocks[1]],
      turnPlayer: view.turn.player,
      plates,
      moves,
    });
    if (tableIntroAppliedRef.current) return;
    tableIntroAppliedRef.current = true;

    const alreadyDone = matchSeed !== undefined && matchIntroAlreadyDone(matchSeed);
    if (alreadyDone || matchIntroRef.current) {
      matchIntroRef.current = true;
      table.skipMatchIntro();
      return;
    }

    matchIntroRef.current = true;
    if (matchSeed !== undefined) markMatchIntroDone(matchSeed);
    const firstPlayer: 'you' | 'rival' = view.turn.player === view.you ? 'you' : 'rival';
    void table.playMatchIntro({
      firstPlayer,
      onLand: onMatchIntroLand,
      onCoinLand,
    });
  }, [
    board,
    flip,
    highlights,
    matchSeed,
    mpOf,
    nameOf,
    moves,
    onCoinLand,
    onMatchIntroLand,
    plates,
    spriteUrlOf,
    view.clocks,
    view.figures,
    view.turn.player,
    view.you,
  ]);

  useEffect(() => {
    tableRef.current?.setMoves(moves);
  }, [moves]);

  useEffect(() => {
    let frame = 0;
    const tick = (): void => {
      const table = tableRef.current;
      const wrap = wrapRef.current;
      if (table !== null && wrap !== null && table.takeHitLayoutDirty()) {
        const minW = Math.min(0.12, 44 / Math.max(1, wrap.clientWidth));
        const minH = Math.min(0.12, 44 / Math.max(1, wrap.clientHeight));
        for (const node of board.nodes) {
          const el = hitsRef.current.get(`node-${node.id}`);
          const point = table.project(node);
          if (el === undefined || point === null) continue;
          el.style.left = `${point.x * 100}%`;
          el.style.top = `${point.y * 100}%`;
          el.style.width = `${Math.max(minW, point.w) * 100}%`;
          el.style.height = `${Math.max(minH, point.h) * 100}%`;
          el.dataset.y = String(Math.round(point.y * 100));
        }
        for (const figure of view.figures) {
          if (figure.zone === 'excluded' || figure.zone === 'ultraSpace') continue;
          const el = hitsRef.current.get(`figure-${figure.uid}`);
          const point = table.figureScreen(figure.uid);
          if (el === undefined || point === null) continue;
          el.style.left = `${point.x * 100}%`;
          el.style.top = `${point.y * 100}%`;
          el.style.width = `${Math.max(minW, point.w) * 100}%`;
          el.style.height = `${Math.max(minH, point.h) * 100}%`;
        }
        for (const plate of plates) {
          const el = hitsRef.current.get(`plate-${plate.slot}`);
          const point = table.plateScreen(plate.slot);
          if (el === undefined || point === null) continue;
          el.style.left = `${point.x * 100}%`;
          el.style.top = `${point.y * 100}%`;
          el.style.width = `${Math.max(minW * 0.7, point.w) * 100}%`;
          el.style.height = `${Math.max(minH, point.h) * 100}%`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [board.nodes, plates, view.figures]);

  const bindHit = (key: string) => (el: HTMLButtonElement | null) => {
    if (el === null) hitsRef.current.delete(key);
    else hitsRef.current.set(key, el);
  };

  const endPressGesture = (): void => {
    tableRef.current?.setOrbitSuppressed(false);
    clearLongPress();
  };

  const clearLongPress = (): void => {
    const active = longPressRef.current;
    if (active === null) return;
    window.clearTimeout(active.timer);
    longPressRef.current = null;
  };

  const beginLongPress = (uid: number, clientX: number, clientY: number): void => {
    clearLongPress();
    tableRef.current?.setOrbitSuppressed(true);
    longPressRef.current = {
      uid,
      x: clientX,
      y: clientY,
      timer: window.setTimeout(() => {
        longPressRef.current = null;
        suppressClickRef.current = true;
        tableRef.current?.setOrbitSuppressed(false);
        onInspectFigure(uid);
      }, LONG_PRESS_MS),
    };
  };

  const trackLongPressMove = (clientX: number, clientY: number): void => {
    const active = longPressRef.current;
    if (active === null) return;
    const dx = clientX - active.x;
    const dy = clientY - active.y;
    // Touch jitter is larger than mouse — allow a bit more travel before cancel.
    if (dx * dx + dy * dy > 360) endPressGesture();
  };

  const figureHit = (figure: FigureState, side: 'you' | 'rival') => {
    const can = commandsForUid(legal, figure.uid).length > 0;
    const kind = can
      ? legal.some((command) => command.kind === 'deploy' && command.uid === figure.uid)
        ? 'deploy'
        : 'act'
      : 'none';
    const otherBlocked = view.turn.movedUid !== null && figure.uid !== view.turn.movedUid;
    const name = figureName(engine, figure);
    const mp = figureMp(engine, figure);
    const printed = figureOfContent(engine, figure.figureId);
    const disabled = locked || otherBlocked || (side === 'rival' && !can) || figure.zone === 'pc';
    return (
      <button
        key={figure.uid}
        type="button"
        className="play-canvas-hit play-disc"
        ref={bindHit(`figure-${figure.uid}`)}
        data-testid={`figure-${figure.uid}`}
        data-can={kind}
        data-owner={figure.owner}
        data-zone={figure.zone}
        data-selected={selected === figure.uid ? '1' : '0'}
        data-wait={figure.wait > 0 ? String(figure.wait) : undefined}
        data-condition={figure.condition ?? undefined}
        aria-disabled={disabled ? 'true' : undefined}
        aria-label={`${name}, MP ${mp}${printed === null ? '' : `, ${printed.types.join('/')}`}. Long-press for details.`}
        onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          beginLongPress(figure.uid, event.clientX, event.clientY);
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLButtonElement>) => {
          trackLongPressMove(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          endPressGesture();
        }}
        onPointerCancel={endPressGesture}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (!disabled) onFigure(figure.uid);
        }}
      />
    );
  };

  const fieldFigures = useMemo(
    () => view.figures.filter((figure) => figure.zone === 'field'),
    [view.figures],
  );

  return (
    <div className="play-board play-board-3d" ref={wrapRef} data-testid="play-board" data-flip={flip ? '1' : '0'}>
      <canvas
        ref={canvasRef}
        data-testid="board-canvas"
        tabIndex={0}
        role="img"
        aria-label="Duel board, 28 points"
        onPointerDownCapture={(event) => {
          if (event.button !== 0) return;
          const table = tableRef.current;
          const canvas = canvasRef.current;
          if (table === null || canvas === null) return;
          const rect = canvas.getBoundingClientRect();
          if (table.pickPlate(event.clientX, event.clientY, rect) !== null) return;
          const uid = table.pickFigure(event.clientX, event.clientY, rect);
          if (uid === null) return;
          canvas.setPointerCapture(event.pointerId);
          beginLongPress(uid, event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          trackLongPressMove(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          const canvas = canvasRef.current;
          if (canvas !== null && canvas.hasPointerCapture(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
          }
          endPressGesture();
        }}
        onPointerCancel={endPressGesture}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          const table = tableRef.current;
          const canvas = canvasRef.current;
          if (table === null || canvas === null) return;
          const rect = canvas.getBoundingClientRect();
          const plate = table.pickPlate(event.clientX, event.clientY, rect);
          if (plate !== null) {
            if (!table.isPlateHandOpen()) {
              table.openPlateHand();
              return;
            }
            onPlayPlate(plate);
            return;
          }
          if (table.isPlateHandOpen()) {
            table.collapsePlateHand();
            return;
          }
          const uid = table.pickFigure(event.clientX, event.clientY, rect);
          if (uid !== null) {
            onFigure(uid);
            return;
          }
          const node = table.pick(event.clientX, event.clientY, rect);
          if (node !== null) onNode(node);
          else onEmpty();
        }}
      />
      <div className="play-node-hits" aria-hidden="false">
        {board.nodes.map((node) => {
          const occupant = view.figures.find((figure) => figure.zone === 'field' && figure.node === node.id);
          const reach = highlights.reachable.has(node.id);
          const battle = highlights.battleNodes.has(node.id);
          const movable = occupant !== undefined && highlights.movableUids.has(occupant.uid);
          const occupantSprite = occupant === undefined ? null : spriteUrlOf(occupant);
          return (
            <button
              key={node.id}
              type="button"
              className="play-node"
              ref={bindHit(`node-${node.id}`)}
              data-testid={`node-${node.id}`}
              data-reach={reach ? '1' : '0'}
              data-battle={battle ? '1' : '0'}
              data-movable={movable ? '1' : '0'}
              {...(occupant !== undefined ? { 'data-uid': String(occupant.uid) } : {})}
              {...(occupant !== undefined && occupant.wait > 0 ? { 'data-wait': String(occupant.wait) } : {})}
              {...(occupant !== undefined && occupant.condition !== null ? { 'data-condition': occupant.condition } : {})}
              {...(occupant !== undefined && occupantSprite !== null
                ? { 'data-sprite': occupantSprite, 'data-sprite-name': nameOf(occupant) }
                : {})}
              aria-label={node.id}
              onClick={(event) => {
                event.stopPropagation();
                onNode(node.id);
              }}
            />
          );
        })}
      </div>
      <div className="play-figure-hits">
        {fieldFigures.map((figure) => figureHit(figure, figure.owner === view.you ? 'you' : 'rival'))}
      </div>
      <section className="play-seat play-seat-hits" data-side="rival" data-testid="play-seat-rival">
        <div className="play-bench" aria-label="Rival bench">
          {rivalBench.map((figure) => figureHit(figure, 'rival'))}
        </div>
        <div className="play-pc" aria-label="Pokémon Center">
          <span className="visually-hidden">
            P.C. {rivalPc.length}/{PC_CAPACITY}
          </span>
          {rivalPc.map((figure) => figureHit(figure, 'rival'))}
        </div>
        {view.opponentPlates.unused > 0 || view.opponentPlates.used.length > 0 ? (
          <p className="visually-hidden" data-testid="opponent-plates">
            Rival plates · {view.opponentPlates.unused} facedown
          </p>
        ) : null}
      </section>
      <section className="play-seat play-seat-hits" data-side="you" data-testid="play-seat-you">
        <div className="play-bench" aria-label="Your bench">
          {youBench.map((figure) => figureHit(figure, 'you'))}
        </div>
        <div className="play-pc" aria-label="Pokémon Center">
          <span className="visually-hidden">
            P.C. {youPc.length}/{PC_CAPACITY}
          </span>
          {youPc.map((figure) => figureHit(figure, 'you'))}
        </div>
        <div className="play-plates" data-testid="play-plates">
          {plates.map((plate) => (
            <button
              key={plate.slot}
              type="button"
              className="play-canvas-hit play-plate"
              ref={bindHit(`plate-${plate.slot}`)}
              data-testid={`play-plate-${plate.slot}`}
              data-used={plate.used ? '1' : '0'}
              disabled={locked || plate.used}
              aria-label={`${plate.name}, cost ${plate.cost}`}
              onClick={(event) => {
                event.stopPropagation();
                const table = tableRef.current;
                if (table === null) return;
                if (!table.isPlateHandOpen()) {
                  table.openPlateHand();
                  return;
                }
                if (!plate.playable) return;
                onPlayPlate(plate.slot);
              }}
            />
          ))}
        </div>
        {abilityActions.length > 0 ? (
          <div className="play-abilities play-abilities-float">
            {abilityActions.map((command, index) => (
              <button
                key={`${command.kind}-${index}`}
                type="button"
                className="hud-action"
                disabled={locked}
                onClick={() => {
                  onAbility(command);
                }}
              >
                Ability
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
