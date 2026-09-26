import * as THREE from 'three';

export type ArenaTheme = 'dark' | 'light';

/**
 * Procedural rocky arena albedo.
 * Keep the pixel noise cheap — a 1024² triple-fbm pass was multi-hundred-ms on
 * desktop and multi-second on iPad, freezing the coin-flip intro on the main thread.
 */
export function createArenaFloorTexture(
  size = 512,
  theme: ArenaTheme = 'dark',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const day = theme === 'light';

  ctx.fillStyle = day ? '#c8b8a0' : '#22140e';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = (0.04 + Math.random() * 0.12) * size;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (day) {
      const tone = 170 + Math.floor(Math.random() * 45);
      const warm = Math.floor(Math.random() * 28);
      g.addColorStop(0, `rgba(${tone + warm},${tone + 4},${tone - 18},0.45)`);
    } else {
      const tone = 26 + Math.floor(Math.random() * 40);
      const warm = Math.floor(Math.random() * 22);
      g.addColorStop(0, `rgba(${tone + warm},${tone - 2},${tone - 8},0.5)`);
    }
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 160; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = (0.008 + Math.random() * 0.028) * size;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (day) {
      const t = 150 + Math.floor(Math.random() * 55);
      const a = 0.1 + Math.random() * 0.22;
      g.addColorStop(0, `rgba(${t + 18},${t + 6},${t - 12},${a})`);
    } else {
      const t = 20 + Math.floor(Math.random() * 55);
      const a = 0.12 + Math.random() * 0.28;
      g.addColorStop(0, `rgba(${t + 10},${t},${t - 6},${a})`);
    }
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const seed = (Math.random() * 1e9) | 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbm2(x * 0.07, y * 0.07, seed) * 26 + (hash2(x, y, seed + 99) - 0.5) * 12;
      const r = d[i] ?? 0;
      const g = d[i + 1] ?? 0;
      const b = d[i + 2] ?? 0;
      if (day) {
        d[i] = clampByte(r + n * 0.85 + 4);
        d[i + 1] = clampByte(g + n * 0.75 + 2);
        d[i + 2] = clampByte(b + n * 0.55 - 6);
      } else {
        d[i] = clampByte(r + n + 3);
        d[i + 1] = clampByte(g + n * 0.92);
        d[i + 2] = clampByte(b + n * 0.78 - 2);
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const crackInk = day ? '90,65,40' : '6,3,2';
  for (let i = 0; i < 40; i++) {
    strokeCrack(ctx, size, 2.2 + Math.random() * 3.5, day ? 0.12 + Math.random() * 0.18 : 0.22 + Math.random() * 0.3, !day, crackInk);
  }
  for (let i = 0; i < 80; i++) {
    strokeCrack(ctx, size, 0.6 + Math.random() * 1.4, day ? 0.06 + Math.random() * 0.1 : 0.1 + Math.random() * 0.18, false, crackInk);
  }

  for (let i = 0; i < 500; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.4 + Math.random() * 2.8;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.45 + Math.random() * 0.7), Math.random() * Math.PI, 0, Math.PI * 2);
    const lit = Math.random() > 0.55;
    if (day) {
      ctx.fillStyle = lit
        ? `rgba(${200 + Math.random() * 40},${185 + Math.random() * 30},${150 + Math.random() * 25},${0.18 + Math.random() * 0.3})`
        : `rgba(${120 + Math.random() * 40},${100 + Math.random() * 30},${70 + Math.random() * 25},${0.15 + Math.random() * 0.28})`;
    } else {
      ctx.fillStyle = lit
        ? `rgba(${55 + Math.random() * 55},${40 + Math.random() * 35},${28 + Math.random() * 22},${0.2 + Math.random() * 0.35})`
        : `rgba(${12 + Math.random() * 20},${8 + Math.random() * 14},${5 + Math.random() * 10},${0.25 + Math.random() * 0.4})`;
    }
    ctx.fill();
  }

  for (let i = 0; i < 300; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = day
      ? `rgba(255,245,220,${0.05 + Math.random() * 0.12})`
      : `rgba(210,160,110,${0.04 + Math.random() * 0.1})`;
    ctx.fillRect(x, y, 1, 1);
  }

  const vig = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.74);
  if (day) {
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.65, 'rgba(140,110,80,0.06)');
    vig.addColorStop(1, 'rgba(100,78,55,0.28)');
  } else {
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.7, 'rgba(0,0,0,0.12)');
    vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  }
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Matching roughness map: brighter = rougher. */
export function createArenaRoughnessTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const seed = (Math.random() * 1e9) | 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbm2(x * 0.08, y * 0.08, seed) * 0.7 + hash2(x, y, seed) * 0.3;
      const v = clampByte(110 + n * 130);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function strokeCrack(
  ctx: CanvasRenderingContext2D,
  size: number,
  width: number,
  alpha: number,
  ember: boolean,
  inkRgb: string,
) {
  let x = Math.random() * size;
  let y = Math.random() * size;
  const segs = 4 + Math.floor(Math.random() * 8);
  const step = size * (0.012 + Math.random() * 0.03);
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let s = 0; s < segs; s++) {
    x += (Math.random() - 0.5) * step * 2;
    y += (Math.random() - 0.5) * step * 2;
    ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `rgba(${inkRgb},${alpha})`;
  ctx.lineWidth = width;
  ctx.stroke();
  if (ember && Math.random() > 0.55) {
    ctx.strokeStyle = `rgba(190,75,28,${0.05 + Math.random() * 0.09})`;
    ctx.lineWidth = Math.max(0.5, width * 0.35);
    ctx.stroke();
  }
}

function hash2(x: number, y: number, seed: number) {
  let n = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x: number, y: number, seed: number) {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 2; i++) {
    v += smoothNoise(x * freq, y * freq, seed + i * 101) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v * 2 - 1;
}

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}
