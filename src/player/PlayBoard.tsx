import { useEffect, useRef, useState } from 'react';
import type { BoardGraph, FigureState, NodeId, PlayerView } from '../engine/index.js';
import { hitNode, projectNode, type BoardLayout } from '../render/draw-board.js';
import { useSpriteTick } from '../ui/use-sprite-tick.js';
import { drawField, type FieldHighlights } from './draw-field.js';

const PAD = 36;

interface Props {
  readonly board: BoardGraph;
  readonly view: PlayerView;
  readonly nameOf: (figure: FigureState) => string;
  readonly spriteUrlOf: (figure: FigureState) => string | null;
  readonly highlights: FieldHighlights;
  readonly onNode: (node: NodeId) => void;
  readonly onEmpty: () => void;
}

export function PlayBoard({ board, view, nameOf, spriteUrlOf, highlights, onNode, onEmpty }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const spriteTick = useSpriteTick();
  const flip = view.you === 1;
  const [layout, setLayout] = useState<BoardLayout>({ pad: PAD, width: 320, height: 320 });
  const layoutRef = useRef(layout);
  const sizeRef = useRef({ width: 320, height: 320 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = wrapRef.current;
    if (canvas === null || parent === null) return;

    let frame = 0;
    const paint = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(120, parent.clientWidth);
      const height = Math.max(120, parent.clientHeight);
      const next = { pad: PAD, width, height };
      layoutRef.current = next;
      if (width !== sizeRef.current.width || height !== sizeRef.current.height) {
        sizeRef.current = { width, height };
        setLayout(next);
      }
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawField(ctx, { board, view, nameOf, spriteUrlOf, highlights, flip }, layoutRef.current);
    };

    const loop = (): void => {
      paint();
      const moving = highlights.animByUid.size > 0 || highlights.surroundPulse > 0.02;
      if (moving) frame = requestAnimationFrame(loop);
    };

    paint();
    if (highlights.animByUid.size > 0 || highlights.surroundPulse > 0.02) {
      frame = requestAnimationFrame(loop);
    }
    const observer = new ResizeObserver(() => {
      paint();
    });
    observer.observe(parent);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [board, flip, highlights, nameOf, spriteTick, spriteUrlOf, view]);

  return (
    <div className="play-board" ref={wrapRef} data-testid="play-board" data-flip={flip ? '1' : '0'}>
      <canvas
        ref={canvasRef}
        data-testid="board-canvas"
        tabIndex={0}
        role="img"
        aria-label="Duel board, 28 points"
        onClick={(event) => {
          const canvas = canvasRef.current;
          if (canvas === null) return;
          const rect = canvas.getBoundingClientRect();
          const node = hitNode(
            board,
            layoutRef.current,
            event.clientX - rect.left,
            event.clientY - rect.top,
            flip,
          );
          if (node !== null) onNode(node);
          else onEmpty();
        }}
      />
      <div className="play-node-hits" aria-hidden="false">
        {board.nodes.map((node) => {
          const { x, y } = projectNode(node, layout, flip);
          const w = layout.width;
          const h = layout.height;
          const reach = highlights.reachable.has(node.id);
          const battle = highlights.battleNodes.has(node.id);
          const occupant = view.figures.find((figure) => figure.zone === 'field' && figure.node === node.id);
          const movable = occupant !== undefined && highlights.movableUids.has(occupant.uid);
          const occupantSprite = occupant === undefined ? null : spriteUrlOf(occupant);
          return (
            <button
              key={node.id}
              type="button"
              className="play-node"
              data-testid={`node-${node.id}`}
              data-reach={reach ? '1' : '0'}
              data-battle={battle ? '1' : '0'}
              data-movable={movable ? '1' : '0'}
              data-y={String(Math.round((y / h) * 100))}
              {...(occupant !== undefined ? { 'data-uid': String(occupant.uid) } : {})}
              {...(occupant !== undefined && occupantSprite !== null
                ? { 'data-sprite': occupantSprite, 'data-sprite-name': nameOf(occupant) }
                : {})}
              style={{ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%` }}
              aria-label={node.id}
              onClick={(event) => {
                event.stopPropagation();
                onNode(node.id);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
