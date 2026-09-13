/** Same-origin sync. Production (`npm run start`) serves `/sync` on the page host. */
export function sameOriginSyncUrl(href: string): string {
  const page = new URL(href);
  const protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${page.host}/sync`;
}

/** Vite sidecar. Never put this port in the page URL. */
export function sidecarSyncUrl(href: string, port = 8787): string {
  const page = new URL(href);
  const protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${page.hostname}:${port}/sync`;
}

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Dev: Vite's `/sync` proxy drops LAN (and often localhost) upgrades.
 * Phone on `http://192.168.x.x:5173` talks to `:8787` directly.
 * Production: only same-origin `/sync`.
 */
export function syncUrlCandidates(
  href: string,
  opts: { readonly dev?: boolean; readonly sidecarPort?: number } = {},
): string[] {
  const same = sameOriginSyncUrl(href);
  if (opts.dev !== true) return [same];
  return [sidecarSyncUrl(href, opts.sidecarPort ?? 8787)];
}

/** Both players open this. Seed is the room id. */
export function roomShareUrl(seed: number, href: string): string {
  const page = new URL(href);
  page.pathname = '/2d';
  page.search = '';
  page.hash = '';
  page.searchParams.set('seed', String(seed >>> 0));
  return page.toString();
}
