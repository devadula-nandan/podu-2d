import { useEffect, useRef } from 'react';
import type { CanvasTexture } from 'three';

interface Props {
  readonly make: () => CanvasTexture;
  readonly label: string;
  readonly size?: number;
}

/** Flattens a procedural Three.js canvas texture so Storybook can show the map. */
export function TextureCard({ make, label, size = 320 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const dest = ref.current;
    if (dest === null) return;
    const tex = make();
    const src = tex.image;
    if (!(src instanceof HTMLCanvasElement)) return;
    dest.width = size;
    dest.height = size;
    const ctx = dest.getContext('2d');
    if (ctx === null) return;
    ctx.drawImage(src, 0, 0, size, size);
    tex.dispose();
  }, [make, size]);

  return (
    <figure style={{ margin: 0, color: '#efe6d6', fontFamily: 'ui-sans-serif, system-ui' }}>
      <canvas ref={ref} width={size} height={size} style={{ display: 'block', width: size, height: size, borderRadius: 8 }} />
      <figcaption style={{ marginTop: 8, fontSize: 13, letterSpacing: '0.04em' }}>{label}</figcaption>
    </figure>
  );
}
