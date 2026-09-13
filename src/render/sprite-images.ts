/**
 * Shared HTMLImage cache for canvas tokens. A miss draws the 2-letter disc;
 * a later load notifies subscribers so the board can repaint.
 */
type Slot = { readonly img: HTMLImageElement } | { readonly status: 'loading' | 'failed' };

const cache = new Map<string, Slot>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeSpriteLoads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSpriteImage(url: string): HTMLImageElement | null {
  const hit = cache.get(url);
  if (hit !== undefined && 'img' in hit) return hit.img;
  if (hit !== undefined) return null;

  const img = new Image();
  cache.set(url, { status: 'loading' });
  img.onload = () => {
    cache.set(url, { img });
    notify();
  };
  img.onerror = () => {
    cache.set(url, { status: 'failed' });
    notify();
  };
  img.src = url;
  return null;
}

export function spriteLoadFailed(url: string): boolean {
  const hit = cache.get(url);
  return hit !== undefined && 'status' in hit && hit.status === 'failed';
}
