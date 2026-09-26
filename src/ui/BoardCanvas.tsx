import { useEffect, useRef } from 'react';
import type { BoardGraph, NodeId, PlayerView, FigureState, FigureUid } from '../engine/index.js';
import { drawBoard, hitNode, type BoardHighlights } from '../render/draw-board.js';
import { useSpriteTick } from './use-sprite-tick.js';

interface Props {
  readonly board: BoardGraph;
  readonly view: PlayerView;
  readonly nameOf: (figure: FigureState) => string;
  readonly spriteUrlOf: (figure: FigureState) => string | null;
  readonly highlights: BoardHighlights;
  readonly onNode: (node: NodeId) => void;
  readonly onEmpty?: () => void;
}

export function BoardCanvas({ board, view, nameOf, spriteUrlOf, highlights, onNode, onEmpty }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const spriteTick = useSpriteTick();
  const flip = view.you === 1;

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const field = canvas.closest('.duel-field');
    if (!(field instanceof HTMLElement)) return;

    const paint = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(120, Math.round(field.clientWidth));
      const height = Math.max(120, Math.round(field.clientHeight));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${String(width)}px`;
      canvas.style.height = `${String(height)}px`;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBoard(ctx, { board, view, nameOf, spriteUrlOf, highlights, flip }, { pad: 36, width, height });
    };

    paint();
    const observer = new ResizeObserver(() => {
      paint();
    });
    observer.observe(field);
    return () => {
      observer.disconnect();
    };
  }, [board, flip, highlights, nameOf, spriteTick, spriteUrlOf, view]);

  return (
    <canvas
      ref={ref}
      data-testid="board-canvas"
      data-flip={flip ? '1' : '0'}
      tabIndex={0}
      role="img"
      aria-label="Duel board, 28 nodes"
      onClick={(event) => {
        const canvas = ref.current;
        if (canvas === null) return;
        const rect = canvas.getBoundingClientRect();
        const node = hitNode(
          board,
          { pad: 36, width: rect.width, height: rect.height },
          event.clientX - rect.left,
          event.clientY - rect.top,
          flip,
        );
        if (node !== null) onNode(node);
        else onEmpty?.();
      }}
    />
  );
}

export type { BoardHighlights, FigureUid };
