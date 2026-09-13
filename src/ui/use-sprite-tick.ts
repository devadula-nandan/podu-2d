import { useEffect, useState } from 'react';
import { subscribeSpriteLoads } from '../render/sprite-images.js';

/** Bumps when a canvas sprite finishes loading (or fails) so boards can repaint. */
export function useSpriteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(
    () =>
      subscribeSpriteLoads(() => {
        setTick((n) => n + 1);
      }),
    [],
  );
  return tick;
}
