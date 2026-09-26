import { useEffect, useRef } from 'react';
import type { Figure, WheelSegment } from '../content/schema.js';
import { resolvePrintedWheel } from '../engine/index.js';
import { WHEEL_COLORS } from '../render/palette.js';
import { drawWheel } from '../render/draw-wheel.js';

function printedPower(segment: WheelSegment): string {
  if (segment.damage === null) return '—';
  switch (segment.damage.kind) {
    case 'stars':
      return `${segment.damage.stars}★`;
    case 'multiplier':
      return `${segment.damage.base}×`;
    case 'variable':
      return `${segment.damage.base}+`;
    case 'fixed':
      return String(segment.damage.base);
  }
}

export function FigureWheelBody({ figure }: { readonly figure: Figure }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resolved = resolvePrintedWheel(figure.wheel);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const size = 280;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawWheel(
      ctx,
      { segments: resolved, rotationTurns: 0, landedUnit: null, pointerLabel: 'WHEEL', labels: 'full' },
      size,
    );
  }, [resolved]);

  return (
    <div className="fig-wheel-body">
      <canvas ref={canvasRef} width={280} height={280} />
      <ol className="fig-wheel-list">
        {figure.wheel.map((segment, index) => {
          const color = segment.color in WHEEL_COLORS ? segment.color : 'miss';
          const paint = WHEEL_COLORS[color];
          return (
            <li key={`${segment.moveName}-${index}`} data-color={segment.color}>
              <span className="fig-wheel-swatch" style={{ background: paint.fill, color: paint.ink }}>
                {paint.letter}
              </span>
              <span>
                <strong>{segment.moveName}</strong>
                <em>
                  {segment.color} · {segment.size}/96 · {printedPower(segment)}
                </em>
                {segment.notes !== null ? <small>{segment.notes}</small> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function FigureWheelPopout({
  figure,
  onClose,
}: {
  readonly figure: Figure;
  readonly onClose: () => void;
}) {
  return (
    <div
      className="fig-wheel-overlay"
      role="dialog"
      aria-label={`${figure.name} wheel`}
      data-testid="figure-wheel"
      onClick={onClose}
    >
      <div
        className="fig-wheel-panel"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="fig-wheel-head">
          <p>{figure.name} wheel</p>
          <button type="button" className="ghost" data-testid="figure-wheel-close" onClick={onClose}>
            Close
          </button>
        </div>
        <FigureWheelBody figure={figure} />
      </div>
    </div>
  );
}
