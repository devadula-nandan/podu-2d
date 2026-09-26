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
  SURROUND_STROKE,
  sideOf,
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

/** 7×5 lattice projects into whatever canvas width × height the field gives. */

const MIN_NODE_R = 16;
const MAX_NODE_R = 40;

export function nodeRadius(layout: BoardLayout): number {
  const innerW = Math.max(1, layout.width - layout.pad * 2);
  const innerH = Math.max(1, layout.height - layout.pad * 2);
  const cell = Math.min(innerW / 6, innerH / 4);
  return Math.max(MIN_NODE_R, Math.min(MAX_NODE_R, cell * 0.42));
}

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
  let bestD = nodeRadius(layout) + 12;
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
): void {
  const sprite = spriteUrl === null ? null : getSpriteImage(spriteUrl);
  if (sprite !== null) {
    const box = Math.max(1, (r - TOKEN_ART_INSET) * 2);
    const dest = containedDrawRect(sprite.naturalWidth || sprite.width, sprite.naturalHeight || sprite.height, x, y, box);
    ctx.drawImage(sprite, dest.x, dest.y, dest.w, dest.h);
    return;
  }
  ctx.fillStyle = ink;
  ctx.font = '600 11px "Source Sans 3", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(figureInitials(name), x, y);
}

export function drawBoard(ctx: CanvasRenderingContext2D, scene: BoardScene, layout: BoardLayout): void {
  const { board, view, nameOf, spriteUrlOf, highlights } = scene;
  const flip = scene.flip === true;
  const NODE_R = nodeRadius(layout);
  ctx.save();
  ctx.fillStyle = FELT;
  ctx.fillRect(0, 0, layout.width, layout.height);

  const table = ctx.createRadialGradient(
    layout.width / 2,
    layout.height / 2,
    24,
    layout.width / 2,
    layout.height / 2,
    Math.max(layout.width, layout.height) * 0.52,
  );
  table.addColorStop(0, '#243044');
  table.addColorStop(0.62, FELT);
  table.addColorStop(1, FELT_INK);
  ctx.fillStyle = table;
  ctx.beginPath();
  ctx.ellipse(layout.width / 2, layout.height / 2, layout.width * 0.46, layout.height * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.strokeStyle = CORRIDOR;
  ctx.lineWidth = Math.max(8, NODE_R * 0.55);
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
    ctx.fillStyle = node.kind === 'goal' ? '#1a1408' : node.kind === 'entry' ? '#14202c' : '#1c2836';
    ctx.fill();
    ctx.lineWidth = node.kind === 'entry' ? 2.6 : node.kind === 'goal' ? 2.2 : 1.6;
    ctx.strokeStyle = node.kind === 'goal' ? '#e0b84a' : node.kind === 'entry' ? '#4fd0e0' : '#5a6e82';
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
      if (node.kind !== 'point') {
        ctx.fillStyle = IVORY;
        ctx.font = `600 ${Math.max(8, Math.round(NODE_R * 0.42))}px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.kind === 'goal' ? `G${node.owner === 0 ? 'A' : 'B'}` : `E${node.owner === 0 ? 'A' : 'B'}`, x, y);
      }
    } else {
      const seat = sideOf(occupant.owner, view.you);
      const r = NODE_R - 2;
      ctx.save();
      ctx.shadowColor = seat.rim;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = seat.fill;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = seat.rim;
      ctx.lineWidth = Math.max(3, r * 0.16);
      ctx.stroke();
      ctx.restore();

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

      drawTokenArt(ctx, x, y, r, nameOf(occupant), spriteUrlOf(occupant), seat.ink);

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
