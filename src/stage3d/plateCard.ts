import * as THREE from 'three';

/** Title/icon accents — vivid plate themes (not rarity). */
const PLATE_ACCENTS = [
  '#c77dff',
  '#ffd166',
  '#4cc9f0',
  '#ef476f',
  '#06d6a0',
  '#f72585',
  '#ff9f1c',
  '#7bdff2',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function plateAccent(name: string): string {
  return PLATE_ACCENTS[hashStr(name) % PLATE_ACCENTS.length] ?? '#e8a860';
}

function rarityMetalStops(rarity: string): string[] {
  switch (rarity) {
    case 'UX':
      return ['#fff6ff', '#ff66cc', '#a0e9ff', '#ffe066', '#ff66cc', '#ffffff'];
    case 'EX':
      return ['#ffffff', '#7ef9ff', '#ff7ae9', '#ffe566', '#7ef9ff', '#ffffff'];
    case 'R':
      return ['#f3e8ff', '#e0c3fc', '#c77dff', '#9b5de5', '#e0c3fc', '#ffffff'];
    case 'UC':
      return ['#e8f4ff', '#90caf9', '#42a5f5', '#1e88e5', '#bbdefb', '#ffffff'];
    default:
      return ['#f5f5f5', '#cfd8dc', '#90a4ae', '#607d8b', '#cfd8dc', '#ffffff'];
  }
}

function metalLinear(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: string[],
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const n = Math.max(1, stops.length - 1);
  stops.forEach((c, i) => {
    g.addColorStop(i / n, c);
  });
  return g;
}

/** Original duel plate silhouette: chamfered top-left, rounded elsewhere. */
function platePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  chamfer: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  const ch = Math.min(chamfer, w * 0.35, h * 0.28);
  ctx.beginPath();
  ctx.moveTo(x + ch, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + ch);
  ctx.closePath();
}

function drawPlateIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  accent: string,
  name: string,
  used: boolean,
): void {
  const ring = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  ring.addColorStop(0, used ? '#3a3a3a' : '#2a2a2e');
  ring.addColorStop(0.55, used ? '#1a1a1a' : '#0c0c0e');
  ring.addColorStop(1, '#050506');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.strokeStyle = used ? '#555' : accent;
  ctx.lineWidth = Math.max(4, r * 0.08);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = used ? '#777' : accent;
  ctx.fillStyle = used ? '#777' : accent;
  ctx.lineWidth = Math.max(5, r * 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const kind = hashStr(name) % 6;
  const s = r * 0.55;
  if (kind === 0) {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.85, 0.35, Math.PI * 1.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, s * 0.75);
    ctx.lineTo(-s * 0.7, s * 0.35);
    ctx.lineTo(-s * 0.05, s * 0.15);
    ctx.fill();
  } else if (kind === 1) {
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.lineTo(s, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 2) {
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.25, Math.sin(a) * s * 0.25);
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      ctx.stroke();
    }
  } else if (kind === 3) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, s * 0.55);
    ctx.lineTo(0, -s * 0.75);
    ctx.lineTo(s * 0.7, s * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.45, s * 0.15);
    ctx.lineTo(0, -s * 0.35);
    ctx.lineTo(s * 0.45, s * 0.15);
    ctx.stroke();
  } else if (kind === 4) {
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s, -s * 0.6, s * 0.85, s * 0.2);
    ctx.quadraticCurveTo(0, s * 1.05, -s * 0.85, s * 0.2);
    ctx.quadraticCurveTo(-s, -s * 0.6, 0, -s);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.7, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.7, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.45);
    ctx.lineTo(s * 0.35, 0);
    ctx.lineTo(0, s * 0.45);
    ctx.lineTo(-s * 0.35, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxY?: number,
): void {
  const words = text.split(/\s+/);
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line === '' ? word : `${line} ${word}`;
    if (ctx.measureText(test).width > maxW && line !== '') {
      if (maxY !== undefined && yy + lineH > maxY) {
        const clipped = line.replace(/\s+\S*$/, '') || line;
        ctx.fillText(`${clipped}…`, x, yy);
        return;
      }
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineH;
    } else {
      line = test;
    }
  }
  if (line !== '') {
    if (maxY !== undefined && yy > maxY) return;
    ctx.fillText(line, x, yy);
  }
}

/** WebGL-style duel plate card (stack + open-hand detailed). */
export function createPlateCardTexture(
  name: string,
  cost: number,
  rarity: string,
  used: boolean,
  description?: string,
  detailed = false,
  disabled = false,
): THREE.CanvasTexture {
  const w = 512;
  const h = detailed ? 768 : 640;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return new THREE.CanvasTexture(canvas);

  const locked = used || disabled;
  const accent = locked ? '#888888' : plateAccent(name);
  const metal = rarityMetalStops(rarity);
  const pad = 10;
  const x = pad;
  const y = pad;
  const pw = w - pad * 2;
  const ph = h - pad * 2;
  const cornerR = 22;
  const chamfer = 78;

  platePath(ctx, x, y, pw, ph, cornerR, chamfer);
  const body = ctx.createLinearGradient(x, y, x + pw, y + ph);
  if (locked) {
    body.addColorStop(0, '#2a2a2c');
    body.addColorStop(1, '#141416');
  } else {
    body.addColorStop(0, '#1a1a1e');
    body.addColorStop(0.45, '#0a0a0c');
    body.addColorStop(1, '#050506');
  }
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  platePath(ctx, x, y, pw, ph, cornerR, chamfer);
  ctx.clip();
  const inset = ctx.createLinearGradient(x, y, x, y + ph * 0.35);
  inset.addColorStop(0, 'rgba(255,255,255,0.07)');
  inset.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = inset;
  ctx.fillRect(x, y, pw, ph * 0.4);

  if (!locked) {
    ctx.save();
    ctx.translate(x + pw * 0.15, y + ph * 0.02);
    ctx.rotate((-28 * Math.PI) / 180);
    const gloss = ctx.createLinearGradient(0, 0, pw * 0.55, 0);
    gloss.addColorStop(0, 'rgba(255,255,255,0)');
    gloss.addColorStop(0.35, 'rgba(255,255,255,0.14)');
    gloss.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    gloss.addColorStop(0.65, 'rgba(255,255,255,0.1)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, pw * 0.55, ph * 0.55);
    ctx.restore();
  }

  const wash = ctx.createRadialGradient(x + pw - 36, y + 40, 4, x + pw - 20, y + 36, 110);
  wash.addColorStop(0, locked ? 'rgba(120,120,120,0.15)' : `${metal[2] ?? '#fff'}33`);
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(x + pw * 0.45, y, pw * 0.55, ph * 0.28);

  const iconR = detailed ? 78 : 88;
  const iconCy = y + (detailed ? 118 : 130);
  drawPlateIcon(ctx, x + pw / 2, iconCy, iconR, accent, name, locked);

  const rarLabel = rarity.toUpperCase();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${detailed ? 42 : 48}px Syne, system-ui, sans-serif`;
  const rarX = x + pw - 28;
  const rarY = y + 22;
  if (!locked) {
    ctx.shadowColor = metal[2] ?? '#fff';
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = locked ? '#666' : metalLinear(ctx, rarX - 70, rarY, rarX + 10, rarY + 40, metal);
  ctx.fillText(rarLabel, rarX, rarY);
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold ${detailed ? 40 : 44}px Syne, system-ui, sans-serif`;
  ctx.fillStyle = accent;
  const titleY = iconCy + iconR + (detailed ? 48 : 52);
  wrapText(ctx, name, x + pw / 2, titleY, pw - 56, detailed ? 44 : 48);

  if (detailed && description !== undefined && description !== '') {
    ctx.textAlign = 'left';
    ctx.font = '26px "Source Sans 3", system-ui, sans-serif';
    ctx.fillStyle = locked
      ? '#666'
      : metalLinear(ctx, x, titleY + 40, x + pw, titleY + 220, [
          '#ffffff',
          '#d8dee6',
          '#aeb8c4',
          '#e8eef5',
          '#c5ced8',
        ]);
    wrapText(ctx, description, x + 36, titleY + 52, pw - 72, 34, y + ph - 78);
  }

  const badgeY = y + ph - (detailed ? 52 : 58);
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px "Source Sans 3", system-ui, sans-serif';
  ctx.fillStyle = locked ? '#555' : 'rgba(255,255,255,0.35)';
  ctx.fillText(used ? 'USED' : `COST  ${cost}`, x + pw / 2, badgeY);

  if (detailed && !used && !disabled) {
    ctx.font = 'bold 22px "Source Sans 3", system-ui, sans-serif';
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillText('Tap to play', x + pw / 2, badgeY + 28);
    ctx.globalAlpha = 1;
  } else if (detailed && disabled && !used) {
    ctx.font = 'bold 22px "Source Sans 3", system-ui, sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('Unavailable', x + pw / 2, badgeY + 28);
  }

  if (disabled && !used) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, pw, ph);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + pw * 0.18, y + ph * 0.22);
    ctx.lineTo(x + pw * 0.82, y + ph * 0.78);
    ctx.stroke();
  }
  ctx.restore();

  platePath(ctx, x, y, pw, ph, cornerR, chamfer);
  ctx.strokeStyle = locked ? '#555' : metalLinear(ctx, x, y, x + pw, y + ph, metal);
  ctx.lineWidth = 7;
  ctx.stroke();
  platePath(ctx, x + 1.5, y + 1.5, pw - 3, ph - 3, cornerR - 1, chamfer - 1);
  ctx.strokeStyle = locked ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
