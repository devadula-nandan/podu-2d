import * as THREE from 'three';

export type WoodTheme = 'dark' | 'light';

/** Wood grain for the duel board slab — charcoal night / oak day. */
export function createWoodTexture(size = 1024, theme: WoodTheme = 'dark'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const day = theme === 'light';

  ctx.fillStyle = day ? '#c4a882' : '#0c0b0a';
  ctx.fillRect(0, 0, size, size);

  // Vertical plank strips with varied tone
  const plankW = size / 14;
  for (let p = 0; p < 14; p++) {
    const x0 = p * plankW;
    const base = day
      ? 155 + (p % 3) * 8 + Math.floor(Math.random() * 12)
      : 14 + (p % 3) * 4 + Math.floor(Math.random() * 6);
    for (let x = 0; x < plankW; x++) {
      const edge = Math.min(x, plankW - x) / plankW;
      const darken = edge < 0.04 ? (day ? 18 : 8) : 0;
      const n =
        Math.sin((x0 + x) * 0.035) * (day ? 10 : 6) +
        Math.sin((x0 + x) * 0.11) * (day ? 6 : 4) +
        Math.sin((x0 + x) * 0.4) * 2 +
        (Math.random() - 0.5) * 4;
      if (day) {
        const tone = Math.max(120, Math.min(210, base + n - darken));
        ctx.fillStyle = `rgb(${tone},${tone - 18},${tone - 42})`;
      } else {
        const tone = Math.max(6, Math.min(48, base + n - darken));
        ctx.fillStyle = `rgb(${tone},${tone - 1},${tone - 2})`;
      }
      ctx.fillRect(x0 + x, 0, 1, size);
    }
    // Plank seam
    ctx.fillStyle = day ? 'rgba(90,55,30,0.35)' : 'rgba(0,0,0,0.45)';
    ctx.fillRect(x0, 0, 1.5, size);
  }

  // Soft wavy grain lines
  for (let k = 0; k < 48; k++) {
    const x0 = Math.random() * size;
    ctx.beginPath();
    for (let y = 0; y < size; y += 2) {
      const x =
        x0 +
        Math.sin(y * 0.016 + k) * 18 +
        Math.sin(y * 0.055) * 8 +
        (Math.random() - 0.5) * 1.5;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (day) {
      const g = 110 + Math.floor(Math.random() * 40);
      ctx.strokeStyle = `rgba(${g},${g - 22},${g - 48},${0.1 + Math.random() * 0.16})`;
    } else {
      const g = 28 + Math.floor(Math.random() * 22);
      ctx.strokeStyle = `rgba(${g},${g - 1},${g - 3},${0.12 + Math.random() * 0.18})`;
    }
    ctx.lineWidth = 0.6 + Math.random() * 2.4;
    ctx.stroke();
  }

  // Pores / flecks
  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = day
      ? `rgba(80,50,25,${0.08 + Math.random() * 0.18})`
      : `rgba(0,0,0,${0.2 + Math.random() * 0.4})`;
    ctx.fillRect(x, y, 1, 1 + Math.random() * 2.5);
  }
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = day
      ? `rgba(255,240,210,${0.06 + Math.random() * 0.1})`
      : `rgba(55,50,45,${0.08 + Math.random() * 0.12})`;
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Grayscale bump from the same grain pattern for soft relief. */
export function createWoodBumpTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const plankW = size / 14;
  for (let p = 0; p < 14; p++) {
    const x0 = p * plankW;
    ctx.fillStyle = '#404040';
    ctx.fillRect(x0, 0, 1.5, size);
    for (let k = 0; k < 3; k++) {
      const x = x0 + plankW * (0.2 + Math.random() * 0.6);
      ctx.beginPath();
      for (let y = 0; y < size; y += 2) {
        const xx = x + Math.sin(y * 0.02 + k) * 10;
        if (y === 0) ctx.moveTo(xx, y);
        else ctx.lineTo(xx, y);
      }
      ctx.strokeStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
