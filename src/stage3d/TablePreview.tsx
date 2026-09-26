import { useEffect, useRef } from 'react';
import { BOARD } from '../engine/index.js';
import type { Table3dScene } from './Table3d.js';
import { Table3d } from './Table3d.js';

interface Props {
  readonly scene: Omit<Table3dScene, 'board' | 'nameOf' | 'mpOf' | 'clocks' | 'turnPlayer'> &
    Partial<Pick<Table3dScene, 'nameOf' | 'mpOf' | 'clocks' | 'turnPlayer'>>;
  readonly height?: number;
}

export function TablePreview({ scene, height = 560 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tableRef = useRef<Table3d | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (canvas === null || wrap === null) return;
    const table = new Table3d(canvas);
    tableRef.current = table;
    const fit = (): void => {
      table.setSize(wrap.clientWidth, wrap.clientHeight);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      table.dispose();
      tableRef.current = null;
    };
  }, []);

  useEffect(() => {
    tableRef.current?.setScene({
      board: BOARD,
      nameOf: scene.nameOf ?? (() => 'Figure'),
      mpOf: scene.mpOf ?? (() => 2),
      clocks: scene.clocks ?? [300_000, 300_000],
      turnPlayer: scene.turnPlayer ?? 0,
      ...scene,
    });
  }, [scene]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height, background: '#1a0e0a' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}
