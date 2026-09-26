import { containedDrawRect, figureInitials, TOKEN_ART_INSET } from '../content/sprites.js';
import type { BoardGraph, BoardNode, FigureState, FigureUid, NodeId, PlayerView } from '../engine/index.js';
import { projectNode, type BoardLayout } from '../render/draw-board.js';
import { BATTLE_STROKE, IVORY, REACH_STROKE, SELECT_STROKE, SURROUND_STROKE, sideOf } from '../render/palette.js';
import { getSpriteImage } from '../render/sprite-images.js';
import { easeInOutCubic, walkSample } from './motion.js';
import { drawFigureStatus } from './status-fx.js';

export interface FieldHighlights {
  readonly reachable: ReadonlySet<string>;
  readonly battleNodes: ReadonlySet<string>;
  readonly surroundUids: ReadonlySet<number>;
  readonly selectedUid: FigureUid | null;
  readonly selectedNode: NodeId | null;
  readonly movableUids: ReadonlySet<number>;
  readonly focusNode: NodeId | null;
  readonly animByUid: ReadonlyMap<number, { readonly nodes: readonly NodeId[]; readonly t: number }>;
  readonly surroundPulse: number;
}

export interface FieldScene {
  readonly board: BoardGraph;
  readonly view: PlayerView;
  readonly nameOf: (figure: FigureState) => string;
  readonly spriteUrlOf: (figure: FigureState) => string | null;
  readonly highlights: FieldHighlights;
  readonly flip?: boolean;
  readonly now?: number;
}

const NODE_R = 15;
const TOKEN_R = 20;

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
  ctx.font = '700 10px Tektur, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(figureInitials(name), x, y - 2);
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

function drawToken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  occupant: FigureState,
  name: string,
  spriteUrl: string | null,
  highlights: FieldHighlights,
  you: 0 | 1,
  now: number,
): void {
  const seat = sideOf(occupant.owner, you);
  const r = TOKEN_R;
  const pulse = highlights.surroundUids.has(occupant.uid) ? highlights.surroundPulse : 0;
  const asleep = occupant.condition === 'asleep';
  const frozen = occupant.condition === 'frozen';
  const waiting = occupant.wait > 0;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + 6, r + 1, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  ctx.shadowColor = seat.rim;
  ctx.shadowBlur = 12 + pulse * 12;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = seat.fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = seat.rim;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r - 3.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  if (highlights.surroundUids.has(occupant.uid)) {
    drawHatch(ctx, x, y, r + pulse * 3, SURROUND_STROKE);
    ctx.strokeStyle = SURROUND_STROKE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 8);
    ctx.lineTo(x + 8, y + 8);
    ctx.moveTo(x + 8, y - 8);
    ctx.lineTo(x - 8, y + 8);
    ctx.stroke();
  }

  if (highlights.selectedUid === occupant.uid || highlights.movableUids.has(occupant.uid)) {
    ctx.setLineDash(highlights.selectedUid === occupant.uid ? [] : [3, 2]);
    ctx.strokeStyle = highlights.selectedUid === occupant.uid ? SELECT_STROKE : REACH_STROKE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 6 + pulse * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save();
  if (asleep || waiting) ctx.globalAlpha = 0.72;
  if (frozen) ctx.filter = 'saturate(0.4) brightness(1.25)';
  drawTokenArt(ctx, x, y - 3, r + 1, name, spriteUrl, seat.ink);
  ctx.restore();

  drawFigureStatus(ctx, x, y, r, occupant, now);
}

function drawEmptyNode(ctx: CanvasRenderingContext2D, node: BoardNode, x: number, y: number): void {
  const glow = node.kind === 'goal' ? '#f0b429' : node.kind === 'entry' ? '#4fd0e0' : '#7aa0b8';
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = node.kind === 'point' ? 8 : 14;
  ctx.beginPath();
  ctx.arc(x, y, NODE_R, 0, Math.PI * 2);
  ctx.fillStyle = node.kind === 'goal' ? '#1a1408' : '#101820';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = node.kind === 'entry' ? 2.4 : 1.4;
  ctx.strokeStyle = glow;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(243, 234, 216, 0.72)';
  ctx.font = '600 8px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tag =
    node.kind === 'goal' ? `G${node.owner === 0 ? 'A' : 'B'}` : node.kind === 'entry' ? `E${node.owner === 0 ? 'A' : 'B'}` : '';
  if (tag !== '') ctx.fillText(tag, x, y);
}

export function drawField(ctx: CanvasRenderingContext2D, scene: FieldScene, layout: BoardLayout): void {
  const { board, view, nameOf, spriteUrlOf, highlights } = scene;
  const flip = scene.flip === true;
  const now = scene.now ?? 0;
  ctx.save();
  ctx.fillStyle = '#070b12';
  ctx.fillRect(0, 0, layout.width, layout.height);

  const g = ctx.createRadialGradient(
    layout.width / 2,
    layout.height / 2,
    20,
    layout.width / 2,
    layout.height / 2,
    Math.max(layout.width, layout.height) * 0.55,
  );
  g.addColorStop(0, '#14202c');
  g.addColorStop(1, '#070b12');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(layout.width / 2, layout.height / 2, layout.width * 0.44, layout.height * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(79, 208, 224, 0.22)';
  ctx.lineWidth = 7;
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

  const flying: FigureState[] = [];

  for (const node of board.nodes) {
    const { x, y } = projectNode(node, layout, flip);
    const occupant = occupied.get(node.id) ?? null;
    const reachable = highlights.reachable.has(node.id);
    const battle = highlights.battleNodes.has(node.id);
    const selectedHere = highlights.selectedNode === node.id;
    const focused = highlights.focusNode === node.id;
    const anim = occupant === null ? undefined : highlights.animByUid.get(occupant.uid);

    drawEmptyNode(ctx, node, x, y);

    if (reachable) {
      ctx.strokeStyle = REACH_STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = REACH_STROKE;
      ctx.beginPath();
      ctx.moveTo(x, y - NODE_R - 12);
      ctx.lineTo(x - 4, y - NODE_R - 6);
      ctx.lineTo(x + 4, y - NODE_R - 6);
      ctx.closePath();
      ctx.fill();
    }
    if (battle) {
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = BATTLE_STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = BATTLE_STROKE;
      ctx.font = '700 8px Tektur, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('VS', x, y - NODE_R - 14);
    }
    if (selectedHere) {
      ctx.strokeStyle = SELECT_STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R + 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (focused) {
      ctx.setLineDash([1, 2]);
      ctx.strokeStyle = IVORY;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R + 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (occupant !== null) {
      if (anim !== undefined) flying.push(occupant);
      else drawToken(ctx, x, y, occupant, nameOf(occupant), spriteUrlOf(occupant), highlights, view.you, now);
    }
  }

  for (const occupant of flying) {
    const anim = highlights.animByUid.get(occupant.uid);
    if (anim === undefined || anim.nodes.length === 0) continue;
    const pts = anim.nodes.flatMap((id) => {
      const node = board.byId.get(id);
      return node === undefined ? [] : [projectNode(node, layout, flip)];
    });
    if (pts.length === 0) continue;
    const hops = Math.max(1, pts.length - 1);
    const { index, local } = walkSample(anim.t, hops);
    const a = pts[index] ?? pts[0];
    const b = pts[index + 1] ?? a;
    if (a === undefined) continue;
    const u = easeInOutCubic(local);
    const lift = Math.sin(u * Math.PI) * 12;
    const x = a.x + ((b?.x ?? a.x) - a.x) * u;
    const y = a.y + ((b?.y ?? a.y) - a.y) * u - lift;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(79, 208, 224, 0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p === undefined) continue;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(243, 234, 216, 0.85)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b?.x ?? a.x, b?.y ?? a.y);
    ctx.stroke();
    const landing = b ?? a;
    const pulse = 0.35 + 0.65 * Math.sin(u * Math.PI);
    ctx.strokeStyle = `rgba(79, 208, 224, ${0.35 + pulse * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(landing.x, landing.y, NODE_R + 4 + pulse * 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    const pop = 1 + 0.08 * Math.sin(u * Math.PI);
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    ctx.translate(-x, -y);
    drawToken(ctx, x, y, occupant, nameOf(occupant), spriteUrlOf(occupant), highlights, view.you, now);
    ctx.restore();
  }

  ctx.restore();
}
