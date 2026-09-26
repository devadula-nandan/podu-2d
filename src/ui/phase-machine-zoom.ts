export const PHASE_ZOOM_MIN = 0.5;
export const PHASE_ZOOM_MAX = 3;
export const PHASE_ZOOM_STEP = 0.25;
export const PHASE_ZOOM_DEFAULT = 1;

export function clampPhaseZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return PHASE_ZOOM_DEFAULT;
  return Math.min(PHASE_ZOOM_MAX, Math.max(PHASE_ZOOM_MIN, zoom));
}

export function stepPhaseZoom(zoom: number, direction: 1 | -1): number {
  return clampPhaseZoom(zoom + direction * PHASE_ZOOM_STEP);
}

export function zoomFromWheel(zoom: number, deltaY: number): number {
  const factor = Math.exp(-deltaY * 0.00175);
  return clampPhaseZoom(zoom * factor);
}
