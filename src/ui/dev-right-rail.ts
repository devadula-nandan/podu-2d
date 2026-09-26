/** Persisted width of the /dev Machine + Commands column. */
export const DEV_RIGHT_RAIL_KEY = 'podu:dev-right-rail';
export const DEV_RIGHT_RAIL_MIN_REM = 22;
export const DEV_RIGHT_RAIL_DEFAULT_REM = 27;
const INSPECT_MIN_REM = 16.5;
const MID_MIN_REM = 12;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseRightRailRem(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function remPxOf(fontSizePx: number): number {
  return Number.isFinite(fontSizePx) && fontSizePx > 0 ? fontSizePx : 16;
}

/** Keep the rail readable without collapsing the board. */
export function clampRightRailPx(widthPx: number, viewportWidth: number, remPx: number): number {
  const rem = remPxOf(remPx);
  const hardMin = DEV_RIGHT_RAIL_MIN_REM * rem;
  const maxVw = viewportWidth * 0.5;
  const reserved = (INSPECT_MIN_REM + MID_MIN_REM) * rem;
  const room = viewportWidth - reserved;
  let max = Math.min(maxVw, room);
  let min = hardMin;
  if (max < min) {
    min = Math.max(8 * rem, Math.min(hardMin, maxVw));
    max = Math.max(min, maxVw);
  }
  const width = Number.isFinite(widthPx) ? widthPx : hardMin;
  return Math.min(max, Math.max(min, width));
}

export function readRightRailPx(
  storage: StorageLike | null,
  viewportWidth: number,
  remPx: number,
): number {
  const rem = remPxOf(remPx);
  const stored = parseRightRailRem(storage?.getItem(DEV_RIGHT_RAIL_KEY) ?? null);
  return clampRightRailPx((stored ?? DEV_RIGHT_RAIL_DEFAULT_REM) * rem, viewportWidth, rem);
}

export function persistRightRailPx(storage: StorageLike | null, widthPx: number, remPx: number): void {
  if (storage === null) return;
  const rem = remPxOf(remPx);
  storage.setItem(DEV_RIGHT_RAIL_KEY, (widthPx / rem).toFixed(2));
}
