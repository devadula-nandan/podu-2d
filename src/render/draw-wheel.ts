import type { ResolvedSegment } from '../engine/index.js';
import { WHEEL_TOTAL_UNITS } from '../rules/constants.js';
import { IVORY, WHEEL_COLORS, type WheelColor } from './palette.js';

export interface WheelDraw {
  readonly segments: readonly ResolvedSegment[];
  readonly rotationTurns: number;
  readonly landedUnit: number | null;
  readonly pointerLabel: string;
}

function isWheelColor(color: string): color is WheelColor {
  return color in WHEEL_COLORS;
}

function paintPattern(
  ctx: CanvasRenderingContext2D,
  color: WheelColor,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): void {
  const spec = WHEEL_COLORS[color];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, a0, a1);
  ctx.closePath();
  ctx.clip();

  if (spec.pattern === 'dots') {
    ctx.fillStyle = 'rgba(42, 36, 24, 0.28)';
    for (let y = cy - r; y < cy + r; y += 6) {
      for (let x = cx - r; x < cx + r; x += 6) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (spec.pattern === 'diag') {
    ctx.strokeStyle = 'rgba(244, 239, 228, 0.28)';
    ctx.lineWidth = 1.5;
    for (let i = -r * 2; i < r * 2; i += 6) {
      ctx.beginPath();
      ctx.moveTo(cx + i, cy - r);
      ctx.lineTo(cx + i + r, cy + r);
      ctx.stroke();
    }
  } else if (spec.pattern === 'horiz') {
    ctx.strokeStyle = 'rgba(244, 239, 228, 0.3)';
    ctx.lineWidth = 1.5;
    for (let y = cy - r; y < cy + r; y += 5) {
      ctx.beginPath();
      ctx.moveTo(cx - r, y);
      ctx.lineTo(cx + r, y);
      ctx.stroke();
    }
  } else if (spec.pattern === 'cross') {
    ctx.strokeStyle = 'rgba(244, 239, 228, 0.35)';
    ctx.lineWidth = 1.2;
    for (let i = -r; i < r; i += 6) {
      ctx.beginPath();
      ctx.moveTo(cx + i, cy - r);
      ctx.lineTo(cx + i, cy + r);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + i);
      ctx.lineTo(cx + r, cy + i);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Unit 0 sits at 12 o'clock; positive units run clockwise. */
export function unitAngle(unit: number): number {
  return -Math.PI / 2 + (unit / WHEEL_TOTAL_UNITS) * Math.PI * 2;
}

export function drawWheel(ctx: CanvasRenderingContext2D, spec: WheelDraw, size: number): void {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(cx, cy);
  ctx.rotate(spec.rotationTurns * Math.PI * 2);
  ctx.translate(-cx, -cy);

  let cursor = 0;
  for (const segment of spec.segments) {
    const a0 = unitAngle(cursor);
    const a1 = unitAngle(cursor + segment.size);
    const color = isWheelColor(segment.color) ? segment.color : 'miss';
    const paint = WHEEL_COLORS[color];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = paint.fill;
    ctx.fill();
    paintPattern(ctx, color, cx, cy, r, a0, a1);
    ctx.strokeStyle = 'rgba(13, 19, 28, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const mid = (a0 + a1) / 2;
    const lx = cx + Math.cos(mid) * (r * 0.62);
    const ly = cy + Math.sin(mid) * (r * 0.62);
    ctx.fillStyle = paint.ink;
    ctx.font = '700 9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(paint.letter, lx, ly);
    cursor += segment.size;
  }

  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fillStyle = '#0d131c';
  ctx.fill();
  ctx.strokeStyle = IVORY;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = IVORY;
  ctx.font = '700 9px "Sora", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('/96', cx, cy);
  ctx.restore();

  ctx.fillStyle = IVORY;
  ctx.beginPath();
  ctx.moveTo(cx, 4);
  ctx.lineTo(cx - 7, 16);
  ctx.lineTo(cx + 7, 16);
  ctx.closePath();
  ctx.fill();
  ctx.font = '600 10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(spec.pointerLabel, cx, size - 4);
}
