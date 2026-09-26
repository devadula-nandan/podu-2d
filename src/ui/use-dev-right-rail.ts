import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import {
  clampRightRailPx,
  persistRightRailPx,
  readRightRailPx,
  type StorageLike,
} from './dev-right-rail.js';

const KEY_STEP_REM = 1;

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function useDevRightRail(): {
  readonly dragging: boolean;
  readonly railStyle: CSSProperties;
  readonly onSplitterPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onSplitterPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onSplitterPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onSplitterKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const [widthPx, setWidthPx] = useState(() => readRightRailPx(browserStorage(), window.innerWidth, remPx()));
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(widthPx);
  const dragRef = useRef<{ pointerId: number; startX: number; startW: number } | null>(null);
  widthRef.current = widthPx;

  useEffect(() => {
    const onResize = (): void => {
      setWidthPx((current) => clampRightRailPx(current, window.innerWidth, remPx()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const commit = useCallback((next: number): void => {
    const clamped = clampRightRailPx(next, window.innerWidth, remPx());
    setWidthPx(clamped);
    persistRightRailPx(browserStorage(), clamped, remPx());
  }, []);

  const onSplitterPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startW: widthRef.current };
    setDragging(true);
  }, []);

  const onSplitterPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    setWidthPx(clampRightRailPx(drag.startW + (drag.startX - event.clientX), window.innerWidth, remPx()));
  }, []);

  const onSplitterPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    persistRightRailPx(browserStorage(), widthRef.current, remPx());
  }, []);

  const onSplitterKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        commit(widthRef.current + KEY_STEP_REM * remPx());
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        commit(widthRef.current - KEY_STEP_REM * remPx());
      } else if (event.key === 'Home') {
        event.preventDefault();
        commit(22 * remPx());
      }
    },
    [commit],
  );

  return {
    dragging,
    railStyle: { ['--dev-right-rail']: `${widthPx}px` } as CSSProperties,
    onSplitterPointerDown,
    onSplitterPointerMove,
    onSplitterPointerUp,
    onSplitterKeyDown,
  };
}
