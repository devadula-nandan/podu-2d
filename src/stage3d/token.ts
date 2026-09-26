import * as THREE from 'three';

function canvas2d(size: number, h = size): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  return { canvas, ctx };
}

export function createMpBadgeTexture(mp: number, teamCss: string): THREE.CanvasTexture {
  const made = canvas2d(128);
  const canvas = made?.canvas ?? document.createElement('canvas');
  const ctx = made?.ctx;
  if (ctx !== undefined) {
    ctx.fillStyle = teamCss;
    ctx.fillRect(0, 0, 128, 128);
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 8;
    ctx.strokeText(String(mp), 64, 68);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(mp), 64, 68);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createWaitBadgeTexture(wait: number): THREE.CanvasTexture {
  const made = canvas2d(128);
  const canvas = made?.canvas ?? document.createElement('canvas');
  const ctx = made?.ctx;
  if (ctx !== undefined) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fillStyle = '#1565c0';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(Math.max(1, Math.floor(wait))), 64, 68);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const STATUS_DOT: Record<string, string> = {
  poison: '#ab47bc',
  noxious: '#6a1b9a',
  paralysis: '#fdd835',
  sleep: '#90caf9',
  frozen: '#4fc3f7',
  burn: '#ff7043',
  confusion: '#f48fb1',
  curse: '#212121',
};

export function createStatusIconsTexture(statuses: readonly string[]): THREE.CanvasTexture {
  const made = canvas2d(256, 64);
  const canvas = made?.canvas ?? document.createElement('canvas');
  const ctx = made?.ctx;
  if (ctx !== undefined) {
    ctx.clearRect(0, 0, 256, 64);
    const list = statuses.slice(0, 6);
    const r = 14;
    const gap = 6;
    const total = list.length * (r * 2) + Math.max(0, list.length - 1) * gap;
    let x = (256 - total) / 2 + r;
    for (const status of list) {
      ctx.beginPath();
      ctx.arc(x, 32, r, 0, Math.PI * 2);
      ctx.fillStyle = STATUS_DOT[status] ?? '#fff';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((status[0] ?? '?').toUpperCase(), x, 33);
      x += r * 2 + gap;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createNameBandTexture(name: string): THREE.CanvasTexture {
  const made = canvas2d(2048, 128);
  const canvas = made?.canvas ?? document.createElement('canvas');
  const ctx = made?.ctx;
  if (ctx !== undefined) {
    ctx.clearRect(0, 0, 2048, 128);
    const label = name.length > 16 ? `${name.slice(0, 15)}…` : name;
    ctx.font = '500 102px Syne, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${label}      ·      ${label}      ·      `, 1024, 67);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
