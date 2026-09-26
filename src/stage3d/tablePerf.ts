/** Runtime quality knobs — keep meshes smooth; only drop costly GPU features on tablets. */
export type TablePerf = {
  readonly dpr: number;
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly softShadows: boolean;
  /** Skip MeshPhysical clearcoat + shadow maps (GPU), not mesh density. */
  readonly lite: boolean;
  readonly hitHz: number;
};

function isTouchTabletOrPhone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const multiTouch = navigator.maxTouchPoints > 1;
  // iPadOS 13+ often reports as MacIntel desktop — maxTouchPoints is the tell.
  const iPadOsDesktopUa = navigator.platform === 'MacIntel' && multiTouch;
  const appleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent);
  return coarse || noHover || appleMobile || iPadOsDesktopUa;
}

export function detectTablePerf(): TablePerf {
  if (typeof window === 'undefined') {
    return { dpr: 1, antialias: true, shadows: true, softShadows: true, lite: false, hitHz: 30 };
  }
  const saveData =
    'connection' in navigator &&
    Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  const constrained = isTouchTabletOrPhone() || saveData;
  // Smooth edges matter more than raw pixel density on Retina tablets.
  const dprCap = constrained ? 1.5 : 2;
  return {
    dpr: Math.min(dprCap, window.devicePixelRatio || 1),
    antialias: true,
    shadows: !constrained,
    softShadows: !constrained,
    lite: constrained,
    hitHz: 30,
  };
}
