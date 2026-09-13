import { useEffect, useRef } from 'react';
import type { GameState } from '../engine/index.js';
import { isWaitingPhase, PHASE_MACHINE_MERMAID } from '../engine/phase-machine.js';
import { markActivePhase } from './phase-machine-mark.js';
import { phaseLabel, seatLabel } from './model.js';
import { useTheme } from './theme.js';

let renderSeq = 0;

interface Props {
  readonly host: GameState;
}

export function PhaseMachine({ host }: Props) {
  const svgRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(host.phase);
  const { theme } = useTheme();
  const phase = host.phase;

  useEffect(() => {
    phaseRef.current = phase;
    if (svgRef.current !== null) markActivePhase(svgRef.current, phase);
  }, [phase]);

  useEffect(() => {
    const el = svgRef.current;
    if (el === null) return;
    let cancelled = false;
    const svgId = `phase-machine-${++renderSeq}`;

    void import('mermaid').then(async (mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'default',
        fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
      });
      try {
        const { svg } = await mermaid.render(svgId, PHASE_MACHINE_MERMAID);
        if (cancelled || svgRef.current === null) return;
        svgRef.current.innerHTML = svg;
        markActivePhase(svgRef.current, phaseRef.current);
      } catch (error) {
        if (cancelled || svgRef.current === null) return;
        const message = error instanceof Error ? error.message : 'Mermaid failed to render.';
        svgRef.current.textContent = message;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [theme]);

  const waiting = isWaitingPhase(phase);
  const over = host.result !== null || phase === 'gameOver';

  return (
    <div
      className="phase-machine"
      data-testid="phase-machine"
      data-phase={phase}
      data-player={host.turn.player}
      data-over={over ? '1' : '0'}
    >
      <p className="kicker">Phase machine</p>
      <p className="note" data-testid="phase-machine-caption">
        {phaseLabel(phase)} · {seatLabel(host.turn.player)}
        {over && host.result !== null
          ? ` · ${host.result.reason}`
          : waiting
            ? ' · waiting'
            : ' · auto'}
      </p>
      <div className="phase-machine-svg" ref={svgRef} data-testid="phase-machine-svg" />
    </div>
  );
}
