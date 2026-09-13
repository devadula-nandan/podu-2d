import { browserSessionStorage, type SessionStorageLike } from '../ui/session-persist.js';

export const SEAT_SESSION_PREFIX = 'podu:net:seat:v1:';
export const SEAT_RECLAIM_PREFIX = 'podu:net:reclaim:v1:';

export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function seatSessionKey(seed: number): string {
  return `${SEAT_SESSION_PREFIX}${seed >>> 0}`;
}

export function seatReclaimKey(seed: number): string {
  return `${SEAT_RECLAIM_PREFIX}${seed >>> 0}`;
}

export function browserLocalStorage(): SessionStorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readSeatHello(
  seed: number,
  session: SessionStorageLike | null = browserSessionStorage(),
  local: SessionStorageLike | null = browserLocalStorage(),
): { token: string | null; reclaim: string | null } {
  const token = session?.getItem(seatSessionKey(seed)) ?? null;
  const reclaim = local?.getItem(seatReclaimKey(seed)) ?? null;
  return {
    token: token !== null && token !== '' ? token : null,
    reclaim: reclaim !== null && reclaim !== '' ? reclaim : null,
  };
}

export function writeSeatClaim(
  seed: number,
  token: string,
  session: SessionStorageLike | null = browserSessionStorage(),
  local: SessionStorageLike | null = browserLocalStorage(),
): void {
  session?.setItem(seatSessionKey(seed), token);
  local?.setItem(seatReclaimKey(seed), token);
}

export function clearSeatClaim(
  seed: number,
  session: SessionStorageLike | null = browserSessionStorage(),
  local: SessionStorageLike | null = browserLocalStorage(),
): void {
  session?.removeItem(seatSessionKey(seed));
  local?.removeItem(seatReclaimKey(seed));
}
