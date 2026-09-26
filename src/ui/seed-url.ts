/** Shareable duel seeds live on `?seed=`. Starting seat is still `seed % 2`. */

export type UrlPlayMode = 'hotseat' | 'vsAi';

export function parseModeParam(raw: string | null): UrlPlayMode | null {
  if (raw === 'hotseat') return 'hotseat';
  if (raw === 'vsAi' || raw === 'vs-ai') return 'vsAi';
  return null;
}

export function readModeFromSearch(search: string = window.location.search): UrlPlayMode | null {
  return parseModeParam(new URLSearchParams(search).get('mode'));
}

export function parseSeedParam(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = /^(?:0x)?[0-9a-f]+$/i.test(trimmed)
    ? trimmed.startsWith('0x') || trimmed.startsWith('0X')
      ? Number.parseInt(trimmed, 16)
      : Number(trimmed)
    : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return n >>> 0;
}

export function readSeedFromSearch(search: string = window.location.search): number | null {
  return parseSeedParam(new URLSearchParams(search).get('seed'));
}

export function seedShareUrl(seed: number, href: string = window.location.href): string {
  const url = new URL(href);
  url.searchParams.set('seed', String(seed >>> 0));
  return url.toString();
}

export function writeModeToUrl(mode: UrlPlayMode): void {
  const next = new URL(window.location.href);
  next.searchParams.set('mode', mode);
  const path = `${next.pathname}${next.search}${next.hash}`;
  window.history.replaceState(null, '', path);
}

export function writeSeedToUrl(seed: number): void {
  const next = new URL(window.location.href);
  next.searchParams.set('seed', String(seed >>> 0));
  const path = `${next.pathname}${next.search}${next.hash}`;
  window.history.replaceState(null, '', path);
}

/** Keep `?seed=` (and any other query) when hopping `/3d` ↔ `/dev`. */
export function pathWithSearch(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

export function searchWithSeed(search: string, seed: number): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.set('seed', String(seed >>> 0));
  const encoded = params.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

export async function copySeedUrl(seed: number): Promise<string> {
  const url = seedShareUrl(seed);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* clipboard can be missing; the caller still gets the URL to show */
  }
  return url;
}
