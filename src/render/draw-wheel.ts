import type { ResolvedSegment } from '../engine/index.js';
import { WHEEL_TOTAL_UNITS } from '../rules/constants.js';
import { IVORY, WHEEL_COLORS, type WheelColor } from './palette.js';

/** Player wheel, bottom: pointer on the top rim, toward the clash. */
export const YOU_POINTER_TURNS = 0;

/** Rival wheel, top: pointer on the bottom rim, toward the clash. */
export const RIVAL_POINTER_TURNS = 0.5;

/** Official Pokémon Duel disc palette (matches pokemon-duel-webgl). */
const DUEL_COLORS: Record<WheelColor, string> = {
  white: '#f3f4f6',
  gold: '#ffc107',
  purple: '#b24dff',
  blue: '#4fc3f7',
  miss: '#e53935',
};

export interface WheelDraw {
  readonly segments: readonly ResolvedSegment[];
  readonly rotationTurns: number;
  readonly landedUnit: number | null;
  readonly pointerLabel: string;
  /** Offset of the pointer from 12 o'clock, in turns. 0 = top. */
  readonly pointerTurns?: number;
  /** `full` prints move names and damage; `letters` is the compact inspector mark. */
  readonly labels?: 'letters' | 'full';
  /** Battle overlay draws one shared pin; inspector wheels keep a per-face mark. */
  readonly showPointer?: boolean;
  /** Hub caption. `null` hides the /96 disc label. */
  readonly hubLabel?: string | null;
  /** `duel` = official disc art; `table` = inspector / rules-table look. */
  readonly look?: 'table' | 'duel';
  /** Additive white/gold damage shown on duel discs (e.g. X Attack). */
  readonly damageBonus?: number;
}

function isWheelColor(color: string): color is WheelColor {
  return color in WHEEL_COLORS;
}

/** Damage, stars, or colour tag drawn on a wedge. */
export function segmentCallout(segment: ResolvedSegment): string {
  if (segment.stars !== null) return `${segment.stars}★`;
  if (segment.damage !== null) return `${segment.damage}${segment.isMultiplier ? '×' : ''}`;
  if (segment.color === 'miss') return 'MISS';
  if (segment.color === 'blue') return 'BLUE';
  return WHEEL_COLORS[segment.color]?.letter ?? '';
}

/**
 * Wheel rotation that parks `unit` under a pointer `pointerTurns` clockwise of 12 o'clock,
 * plus extra full turns so the spin reads as a spin. Always positive (clockwise),
 * matching pokemon-duel-webgl `animateWheelSpin`.
 */
export function spinTargetTurns(unit: number, pointerTurns: number, extraTurns = 6): number {
  let turns = pointerTurns - unit / WHEEL_TOTAL_UNITS;
  while (turns <= 0) turns += 1;
  return turns + extraTurns;
}

/** Degrees for a CSS `transform: rotate(...)` spin (same math as `spinTargetTurns`). */
export function spinTargetDegrees(unit: number, pointerTurns: number, extraTurns = 6): number {
  return spinTargetTurns(unit, pointerTurns, extraTurns) * 360;
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

function shortenName(name: string, units: number): string {
  const cap = units >= 20 ? 14 : units >= 12 ? 10 : 7;
  return name.length <= cap ? name : `${name.slice(0, Math.max(3, cap - 1))}…`;
}

function drawWedgeLabel(
  ctx: CanvasRenderingContext2D,
  segment: ResolvedSegment,
  cx: number,
  cy: number,
  r: number,
  mid: number,
  rotationTurns: number,
  size: number,
  mode: 'letters' | 'full',
): void {
  const color = isWheelColor(segment.color) ? segment.color : 'miss';
  const paint = WHEEL_COLORS[color];
  const lx = cx + Math.cos(mid) * (r * 0.62);
  const ly = cy + Math.sin(mid) * (r * 0.62);
  ctx.save();
  ctx.translate(lx, ly);
  ctx.rotate(-rotationTurns * Math.PI * 2);
  ctx.fillStyle = paint.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (mode === 'letters' || segment.size < 6) {
    ctx.font = `700 ${Math.max(9, size * 0.038)}px "IBM Plex Mono", monospace`;
    ctx.fillText(paint.letter, 0, 0);
    ctx.restore();
    return;
  }
  const callout = segmentCallout(segment);
  const dmgPx = Math.max(12, Math.min(size * 0.072, size * (0.038 + segment.size * 0.0016)));
  ctx.font = `800 ${dmgPx}px Tektur, sans-serif`;
  ctx.fillText(callout, 0, segment.size >= 12 ? 5 : 0);
  if (segment.size >= 12) {
    ctx.font = `700 ${Math.max(8, size * 0.032)}px Sora, sans-serif`;
    ctx.fillText(shortenName(segment.moveName, segment.size), 0, -dmgPx * 0.7);
  }
  ctx.restore();
}

function drawPointer(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, pointerTurns: number): void {
  const ang = -Math.PI / 2 + pointerTurns * Math.PI * 2;
  const tipR = r - 2;
  const baseR = r + 15;
  const tx = cx + Math.cos(ang) * tipR;
  const ty = cy + Math.sin(ang) * tipR;
  const bx = cx + Math.cos(ang) * baseR;
  const by = cy + Math.sin(ang) * baseR;
  const px = -Math.sin(ang) * 8;
  const py = Math.cos(ang) * 8;
  ctx.fillStyle = IVORY;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx + px, by + py);
  ctx.lineTo(bx - px, by - py);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(13, 19, 28, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Unit 0 sits at 12 o'clock; positive units run clockwise. */
export function unitAngle(unit: number): number {
  return -Math.PI / 2 + (unit / WHEEL_TOTAL_UNITS) * Math.PI * 2;
}

function drawArcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  midAngle: number,
  maxSweep: number,
  fill: string,
  fontSize: number,
): void {
  const chars = [...text];
  if (chars.length === 0) return;
  const charAngle = fontSize / radius;
  const total = Math.min(maxSweep * 0.82, charAngle * chars.length);
  let a = midAngle - total / 2;
  const step = chars.length > 1 ? total / (chars.length - 1) : 0;
  ctx.fillStyle = fill;
  ctx.font = `800 ${fontSize}px Tektur, Figtree, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const ch of chars) {
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += step;
  }
}

/**
 * Official duel disc (pokemon-duel-webgl `createWheelCanvas`): thick rim, zebra wedges,
 * curved labels, damage numerals. Labels ride with the disc — pair with CSS spin.
 */
function drawDuelWheel(
  ctx: CanvasRenderingContext2D,
  spec: WheelDraw,
  size: number,
): void {
  const damageBonus = spec.damageBonus ?? 0;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.495;
  const rim = size * 0.028;
  const innerR = r - rim;
  const total = spec.segments.reduce((sum, seg) => sum + seg.size, 0) || WHEEL_TOTAL_UNITS;

  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0d0d0d';
  ctx.fill();

  let angle = -Math.PI / 2;
  let cursor = 0;
  for (const seg of spec.segments) {
    const sweep = (seg.size / total) * Math.PI * 2;
    const mid = angle + sweep / 2;
    const color = isWheelColor(seg.color) ? seg.color : 'miss';
    const fill = DUEL_COLORS[color];
    const darkText = color === 'white' || color === 'gold' || color === 'blue';
    const ink = darkText ? '#111111' : '#ffffff';
    const landed =
      spec.landedUnit !== null &&
      spec.landedUnit >= cursor &&
      spec.landedUnit < cursor + seg.size;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, innerR, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, innerR, angle, angle + sweep);
    ctx.closePath();
    ctx.clip();
    const stripeCount = Math.max(10, Math.floor((seg.size / total) * 140));
    const zebraDark =
      color === 'white'
        ? 'rgba(0, 0, 0, 0.05)'
        : color === 'gold'
          ? 'rgba(0, 0, 0, 0.06)'
          : color === 'blue'
            ? 'rgba(0, 0, 0, 0.06)'
            : color === 'purple'
              ? 'rgba(0, 0, 0, 0.07)'
              : 'rgba(0, 0, 0, 0.05)';
    for (let i = 0; i < stripeCount; i++) {
      if (i % 2 === 0) continue;
      const a0 = angle + (sweep * i) / stripeCount;
      const a1 = angle + (sweep * (i + 1)) / stripeCount;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, innerR, a0, a1);
      ctx.closePath();
      ctx.fillStyle = zebraDark;
      ctx.fill();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.strokeStyle = landed ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)';
    ctx.lineWidth = landed ? Math.max(2.5, size * 0.004) : Math.max(1.5, size * 0.0025);
    ctx.stroke();

    const name = seg.moveName || '';
    if (color === 'miss') {
      drawArcText(
        ctx,
        'Miss',
        cx,
        cy,
        innerR * 0.9,
        mid,
        sweep,
        ink,
        Math.max(16, Math.min(34, sweep * innerR * 0.42)),
      );
    } else if (color === 'blue') {
      drawArcText(
        ctx,
        name.slice(0, 16),
        cx,
        cy,
        innerR * 0.9,
        mid,
        sweep,
        ink,
        Math.max(15, Math.min(30, sweep * innerR * 0.36)),
      );
    } else if (color === 'purple') {
      const stars = '★'.repeat(Math.max(1, seg.stars ?? 1));
      drawArcText(
        ctx,
        `${name.slice(0, 12)} ${stars}`,
        cx,
        cy,
        innerR * 0.9,
        mid,
        sweep,
        ink,
        Math.max(14, Math.min(28, sweep * innerR * 0.34)),
      );
    } else {
      const base = seg.damage ?? 0;
      const shown = base + (color === 'white' || color === 'gold' ? damageBonus : 0);
      const dmg =
        color === 'gold' && base
          ? `${shown}${seg.isMultiplier ? '×' : ''}*`
          : `${shown}${seg.isMultiplier ? '×' : ''}`;
      const dmgSize = Math.max(22, Math.min(64, sweep * innerR * 0.55));
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * innerR * 0.42, cy + Math.sin(mid) * innerR * 0.42);
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = ink;
      ctx.font = `900 ${dmgSize}px Tektur, Figtree, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, dmgSize * 0.08);
      ctx.strokeStyle = color === 'white' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.35)';
      ctx.strokeText(dmg, 0, 0);
      ctx.fillText(dmg, 0, 0);
      if (damageBonus > 0 && (color === 'white' || color === 'gold') && base > 0) {
        ctx.fillStyle = '#ff6b35';
        ctx.font = `800 ${Math.max(12, dmgSize * 0.38)}px Tektur, Figtree, system-ui, sans-serif`;
        ctx.fillText(`+${Math.round(damageBonus)}`, 0, dmgSize * 0.55);
      }
      ctx.restore();

      if (name) {
        const label = color === 'gold' ? `${name} *` : name;
        drawArcText(
          ctx,
          label.slice(0, 18),
          cx,
          cy,
          innerR * 0.9,
          mid,
          sweep,
          ink,
          Math.max(14, Math.min(26, sweep * innerR * 0.3)),
        );
      }
    }

    angle += sweep;
    cursor += seg.size;
  }

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1.5, size * 0.0025);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.strokeStyle = '#0d0d0d';
  ctx.lineWidth = Math.max(2, size * 0.004);
  ctx.stroke();

  const hub = r * 0.085;
  ctx.beginPath();
  ctx.arc(cx, cy, hub, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0a0a';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, hub * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = Math.max(2, size * 0.003);
  ctx.stroke();
}

function drawTableWheel(ctx: CanvasRenderingContext2D, spec: WheelDraw, size: number): void {
  const pointerTurns = spec.pointerTurns ?? 0;
  const labels = spec.labels ?? 'letters';
  const showPointer = spec.showPointer !== false;
  const hubLabel = spec.hubLabel === undefined ? '/96' : spec.hubLabel;
  const inset = showPointer ? 18 : Math.max(8, size * 0.038);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - inset;
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
    const landed =
      spec.landedUnit !== null && spec.landedUnit >= cursor && spec.landedUnit < cursor + segment.size;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = paint.fill;
    ctx.fill();
    paintPattern(ctx, color, cx, cy, r, a0, a1);
    ctx.strokeStyle = landed ? IVORY : 'rgba(13, 19, 28, 0.45)';
    ctx.lineWidth = landed ? 2.4 : 1;
    ctx.stroke();

    const mid = (a0 + a1) / 2;
    drawWedgeLabel(ctx, segment, cx, cy, r, mid, spec.rotationTurns, size, labels);
    cursor += segment.size;
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#101418';
  ctx.lineWidth = Math.max(6, size * 0.03);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - Math.max(2, size * 0.008), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(244, 239, 228, 0.28)';
  ctx.lineWidth = Math.max(1, size * 0.004);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(18, size * 0.08), 0, Math.PI * 2);
  ctx.fillStyle = '#0d131c';
  ctx.fill();
  ctx.strokeStyle = IVORY;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (hubLabel !== null) {
    ctx.fillStyle = IVORY;
    ctx.font = `700 ${Math.max(8, size * 0.032)}px Sora, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hubLabel, cx, cy);
  }
  ctx.restore();

  if (!showPointer) return;
  drawPointer(ctx, cx, cy, r, pointerTurns);
  const pang = -Math.PI / 2 + pointerTurns * Math.PI * 2;
  const lx = cx + Math.cos(pang) * (r + 22);
  const ly = cy + Math.sin(pang) * (r + 22);
  ctx.fillStyle = IVORY;
  ctx.font = '600 10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.pointerLabel, lx, ly);
}

export function drawWheel(ctx: CanvasRenderingContext2D, spec: WheelDraw, size: number): void {
  if (spec.look === 'duel') {
    drawDuelWheel(ctx, spec, size);
    return;
  }
  drawTableWheel(ctx, spec, size);
}
