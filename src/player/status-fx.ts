import type { FigureState } from '../engine/index.js';

type Condition = NonNullable<FigureState['condition']>;

export const CONDITION_FX: Record<
  Condition,
  { readonly color: string; readonly glow: string; readonly glyph: string; readonly label: string }
> = {
  paralyzed: { color: '#f5d442', glow: 'rgba(245, 212, 66, 0.85)', glyph: '⚡', label: 'PAR' },
  burned: { color: '#ff6a1a', glow: 'rgba(255, 106, 26, 0.85)', glyph: '🔥', label: 'BRN' },
  asleep: { color: '#8ec8ff', glow: 'rgba(142, 200, 255, 0.85)', glyph: 'Z', label: 'SLP' },
  frozen: { color: '#9ee7ff', glow: 'rgba(158, 231, 255, 0.9)', glyph: '❄', label: 'FRZ' },
  poisoned: { color: '#c45adf', glow: 'rgba(196, 90, 223, 0.85)', glyph: '●', label: 'PSN' },
  noxious: { color: '#7a1aa0', glow: 'rgba(122, 26, 160, 0.9)', glyph: '◉', label: 'NOX' },
  confused: { color: '#ff7ad9', glow: 'rgba(255, 122, 217, 0.85)', glyph: '?', label: 'CNF' },
};

export function markerShort(id: string, value: number | null): string {
  if (id === 'mpModifier') return value !== null && value < 0 ? `MP${value}` : `MP+${value ?? 0}`;
  if (id === 'cracked') return 'CRK';
  if (id === 'curse') return 'CRS';
  if (id === 'charge') return value !== null ? `CHG${value}` : 'CHG';
  return id.slice(0, 3).toUpperCase();
}

export function drawWaitBadge(ctx: CanvasRenderingContext2D, x: number, y: number, wait: number, r: number): void {
  if (wait <= 0) return;
  const br = Math.max(8, r * 0.42);
  const bx = x + r * 0.72;
  const by = y + r * 0.62;
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1408';
  ctx.fill();
  ctx.strokeStyle = '#f0c14a';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = '#f0c14a';
  ctx.font = `800 ${Math.max(9, br)}px Tektur, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(wait), bx, by + 0.5);
  ctx.restore();
}

export function drawMarkerChip(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, label: string): void {
  ctx.save();
  ctx.font = `700 ${Math.max(7, r * 0.32)}px Tektur, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.max(r * 0.9, ctx.measureText(label).width + 6);
  const h = Math.max(10, r * 0.42);
  const bx = x - r * 0.7;
  const by = y + r * 0.7;
  ctx.fillStyle = '#0d131c';
  ctx.strokeStyle = '#e8dcc4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx - w / 2, by - h / 2, w, h, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8dcc4';
  ctx.fillText(label, bx, by + 0.5);
  ctx.restore();
}

function sparks(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, now: number, kind: Condition): void {
  const t = now / 180;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  if (kind === 'paralyzed') {
    for (let i = 0; i < 3; i++) {
      const a = t + i * ((Math.PI * 2) / 3);
      const x0 = x + Math.cos(a) * (r + 2);
      const y0 = y + Math.sin(a) * (r + 2);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(a + 0.8) * 7, y0 + Math.sin(a + 1.4) * 7);
      ctx.lineTo(x0 + Math.cos(a) * 11, y0 + Math.sin(a) * 11);
      ctx.stroke();
    }
  } else if (kind === 'burned') {
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + i * 0.55 - 0.8 + Math.sin(t + i) * 0.12;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2) - 2);
      ctx.lineTo(x + Math.cos(a) * (r + 6 + (i % 2) * 3), y + Math.sin(a) * (r + 4) - 8);
      ctx.lineTo(x + Math.cos(a + 0.25) * (r - 1), y + Math.sin(a + 0.2) * (r - 1));
      ctx.closePath();
      ctx.globalAlpha = 0.75;
      ctx.fill();
    }
  } else if (kind === 'asleep') {
    ctx.font = `800 ${Math.max(8, r * 0.38)}px Tektur, sans-serif`;
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t);
    ctx.fillText('Z', x + r * 0.55, y - r * 0.85);
    ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t + 1);
    ctx.font = `800 ${Math.max(7, r * 0.3)}px Tektur, sans-serif`;
    ctx.fillText('z', x + r * 0.95, y - r * 1.15);
  } else if (kind === 'frozen') {
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 6; i++) {
      const a = i * (Math.PI / 3) + t * 0.08;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3));
      ctx.stroke();
    }
  } else if (kind === 'poisoned' || kind === 'noxious') {
    const n = kind === 'noxious' ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const a = t * 0.7 + i * ((Math.PI * 2) / n);
      const lift = ((t * 6 + i * 8) % 18) - 4;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (r * 0.7), y - lift, kind === 'noxious' ? 3.2 : 2.4, 0, Math.PI * 2);
      ctx.globalAlpha = 0.7;
      ctx.fill();
    }
  } else if (kind === 'confused') {
    ctx.font = `800 ${Math.max(10, r * 0.45)}px Tektur, sans-serif`;
    const a = t;
    ctx.fillText('?', x + Math.cos(a) * 8, y - r - 4 + Math.sin(a) * 3);
    ctx.fillText('?', x - Math.cos(a) * 10, y - r + Math.sin(a + 1) * 3);
  }
  ctx.restore();
}

export function drawConditionFx(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  condition: FigureState['condition'],
  now: number,
): void {
  if (condition === null) return;
  const fx = CONDITION_FX[condition];
  ctx.save();
  ctx.shadowColor = fx.glow;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = fx.color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  sparks(ctx, x, y, r, fx.color, now, condition);
}

export function drawFigureStatus(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  figure: FigureState,
  now: number,
): void {
  drawConditionFx(ctx, x, y, r, figure.condition, now);
  if (figure.marker !== null) drawMarkerChip(ctx, x, y, r, markerShort(figure.marker.id, figure.marker.value));
  drawWaitBadge(ctx, x, y, figure.wait, r);
}
