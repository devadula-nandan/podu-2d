import { containedDrawRect, figureInitials, TOKEN_ART_INSET } from '../content/sprites.js';
import type { BoardGraph, BoardNode, FigureState, FigureUid, NodeId, PlayerView } from '../engine/index.js';
import { getSpriteImage } from './sprite-images.js';
import {
  BATTLE_STROKE,
  CORRIDOR,
  FELT,
  FELT_INK,
  IVORY,
  REACH_STROKE,
  SELECT_STROKE,
  STEEL,
  SURROUND_STROKE,
  seatOf,
} from './palette.js';

export interface BoardLayout {
  readonly pad: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardHighlights {
  readonly reachable: ReadonlySet<string>;
  readonly battleNodes: ReadonlySet<string>;
  readonly surroundUids: ReadonlySet<number>;
  readonly selectedUid: FigureUid | null;
  readonly selectedNode: NodeId | null;
  readonly movableUids: ReadonlySet<number>;
  readonly focusNode: NodeId | null;
}

export interface BoardScene {
  readonly board: BoardGraph;
  readonly view: PlayerView;
  readonly nameOf: (figure: FigureState) => string;
  readonly spriteUrlOf: (figure: FigureState) => string | null;
  readonly highlights: BoardHighlights;
  readonly flip?: boolean;
}

const NODE_R = 18;

/** 180° partner in unit space. Clicks use the same map so the logical node is unchanged. */
export function visualUnit(node: Pick<BoardNode, 'x' | 'y'>, flip: boolean): { x: number; y: number } {
  return flip ? { x: 1 - node.x, y: 1 - node.y } : { x: node.x, y: node.y };
}

export function projectNode(node: BoardNode, layout: BoardLayout, flip = false): { x: number; y: number } {
  const point = visualUnit(node, flip);
  return {
    x: layout.pad + point.x * (layout.width - layout.pad * 2),
    y: layout.pad + point.y * (layout.height - layout.pad * 2),
  };
}

export function hitNode(
  board: BoardGraph,
  layout: BoardLayout,
  sx: number,
  sy: number,
  flip = false,
): NodeId | null {
  let best: NodeId | null = null;
  let bestD = NODE_R + 10;
  for (const node of board.nodes) {
    const { x, y } = projectNode(node, layout, flip);
    const d = Math.hypot(sx - x, sy - y);
    if (d < bestD) {
      bestD = d;
      best = node.id;
    }
  }
  return best;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHatch(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let i = -r; i <= r; i += 5) {
    ctx.beginPath();
    ctx.moveTo(x + i, y - r);
    ctx.lineTo(x + i + r * 2, y + r);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTokenArt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  name: string,
  spriteUrl: string | null,
  ink: string,
  _shape: 'circle' | 'square',
): void {
  const sprite = spriteUrl === null ? null : getSpriteImage(spriteUrl);
  if (sprite !== null) {
    const box = Math.max(1, (r - TOKEN_ART_INSET) * 2);
    const dest = containedDrawRect(sprite.naturalWidth || sprite.width, sprite.naturalHeight || sprite.height, x, y, box);
    ctx.drawImage(sprite, dest.x, dest.y, dest.w, dest.h);
    return;
  }
  ctx.fillStyle = ink;
  ctx.font = '700 10px "Sora", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(figureInitials(name), x, y - 2);
}

export function drawBoard(ctx: CanvasRenderingContext2D, scene: BoardScene, layout: BoardLayout): void {
  const { board, view, nameOf, spriteUrlOf, highlights } = scene;
  const flip = scene.flip === true;
  ctx.save();
  ctx.fillStyle = FELT;
  ctx.fillRect(0, 0, layout.width, layout.height);

  ctx.fillStyle = FELT_INK;
  ctx.beginPath();
  ctx.ellipse(layout.width / 2, layout.height / 2, layout.width * 0.42, layout.height * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.strokeStyle = CORRIDOR;
  ctx.lineWidth = 10;
  for (const [a, b] of board.edges) {
    const na = board.byId.get(a);
    const nb = board.byId.get(b);
    if (na === undefined || nb === undefined) continue;
    const pa = projectNode(na, layout, flip);
    const pb = projectNode(nb, layout, flip);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  const occupied = new Map<string, FigureState>();
  for (const figure of view.figures) {
    if (figure.zone === 'field' && figure.node !== null) occupied.set(figure.node, figure);
  }

  for (const node of board.nodes) {
    const { x, y } = projectNode(node, layout, flip);
    const occupant = occupied.get(node.id) ?? null;
    const reachable = highlights.reachable.has(node.id);
    const battle = highlights.battleNodes.has(node.id);
    const selectedHere = highlights.selectedNode === node.id;
    const focused = highlights.focusNode === node.id;

    ctx.beginPath();
    ctx.arc(x, y, NODE_R + 1, 0, Math.PI * 2);
    ctx.fillStyle = node.kind === 'goal' ? '#1b2430' : '#243044';
    ctx.fill();
    ctx.lineWidth = node.kind === 'entry' ? 3 : 1.5;
    ctx.strokeStyle = node.kind === 'goal' ? IVORY : node.kind === 'entry' ? STEEL : '#3a4658';
    ctx.stroke();

    if (reachable) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = REACH_STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = REACH_STROKE;
      ctx.font = '700 8px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GO', x, y - NODE_R - 8);
    }
    if (battle) {
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = BATTLE_STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selectedHere) {
      ctx.strokeStyle = SELECT_STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R + 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (focused) {
      ctx.fillStyle = IVORY;
      ctx.font = '700 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▶', x, y - NODE_R - 16);
      ctx.setLineDash([1, 2]);
      ctx.strokeStyle = IVORY;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R + 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (occupant === null) {
      ctx.fillStyle = STEEL;
      ctx.font = '600 8px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tag =
        node.kind === 'goal'
          ? `G${node.owner === 0 ? 'A' : 'B'}`
          : node.kind === 'entry'
            ? `E${node.owner === 0 ? 'A' : 'B'}`
            : '·';
      ctx.fillText(tag, x, y);
    } else {
      const seat = seatOf(occupant.owner);
      const r = NODE_R - 2;
      ctx.fillStyle = seat.fill;
      if (seat.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        roundedRect(ctx, x - r, y - r, r * 2, r * 2, 4);
        ctx.fill();
      }
      ctx.strokeStyle = seat.ink;
      ctx.lineWidth = 1.5;
      if (seat.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        roundedRect(ctx, x - r, y - r, r * 2, r * 2, 4);
        ctx.stroke();
      }

      if (highlights.surroundUids.has(occupant.uid)) {
        drawHatch(ctx, x, y, r, SURROUND_STROKE);
        ctx.strokeStyle = SURROUND_STROKE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 7, y - 7);
        ctx.lineTo(x + 7, y + 7);
        ctx.moveTo(x + 7, y - 7);
        ctx.lineTo(x - 7, y + 7);
        ctx.stroke();
      }

      if (highlights.selectedUid === occupant.uid || highlights.movableUids.has(occupant.uid)) {
        ctx.setLineDash(highlights.selectedUid === occupant.uid ? [] : [3, 2]);
        ctx.strokeStyle = highlights.selectedUid === occupant.uid ? SELECT_STROKE : REACH_STROKE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      drawTokenArt(ctx, x, y, r, nameOf(occupant), spriteUrlOf(occupant), seat.ink, seat.shape);
      ctx.fillStyle = seat.ink;
      ctx.font = '600 7px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(seat.mark, x, y + 9);

      const badges: string[] = [];
      if (occupant.condition !== null) badges.push(occupant.condition.slice(0, 3).toUpperCase());
      if (occupant.marker !== null) badges.push(occupant.marker.id.slice(0, 3).toUpperCase());
      if (occupant.wait > 0) badges.push(`W${occupant.wait}`);
      if (occupant.megaTurnsLeft !== null) badges.push(`M${occupant.megaTurnsLeft}`);
      if (badges.length > 0) {
        ctx.fillStyle = IVORY;
        ctx.font = '600 7px "IBM Plex Mono", monospace';
        ctx.fillText(badges.join('·'), x, y + r + 10);
      }
    }
  }

  ctx.restore();
}
