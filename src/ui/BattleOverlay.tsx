import { useEffect, useRef, useState } from 'react';
import { WHEEL_TOTAL_UNITS } from '../rules/constants.js';
import { drawWheel } from '../render/draw-wheel.js';
import { describeSegment, landedSegment, seatLabel, type BattleSnap } from './model.js';
import { FigureSprite } from './FigureSprite.js';
import { MatchupOdds, WheelOdds } from './WheelOdds.js';

interface Props {
  readonly snap: BattleSnap;
  readonly attackerName: string;
  readonly defenderName: string;
  readonly attackerSprite: string | null;
  readonly defenderSprite: string | null;
  readonly canSpin: boolean;
  readonly awaitingRespin: boolean;
  readonly onSpin: () => void;
  readonly onClose: () => void;
}

function useSpinTurns(unit: number | null): number {
  const [turns, setTurns] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (unit === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = -unit / WHEEL_TOTAL_UNITS - 2;
    const start = fromRef.current;
    const delta = target - start;
    const begun = performance.now();
    const duration = reduce ? 0 : 1100;
    let frame = 0;
    const tick = (now: number): void => {
      const t = duration === 0 ? 1 : Math.min(1, (now - begun) / duration);
      const eased = 1 - (1 - t) ** 3;
      const value = start + delta * eased;
      setTurns(value);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [unit]);

  return turns;
}

function WheelFace({
  label,
  portraitUrl,
  portraitName,
  segments,
  unit,
  pointer,
}: {
  readonly label: string;
  readonly portraitUrl: string | null;
  readonly portraitName: string;
  readonly segments: BattleSnap['attackerWheel'];
  readonly unit: number | null;
  readonly pointer: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const turns = useSpinTurns(unit);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const size = 280;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawWheel(ctx, { segments, rotationTurns: turns, landedUnit: unit, pointerLabel: pointer }, size);
  }, [pointer, segments, turns, unit]);

  return (
    <div className="wheel-col">
      <p className="kicker battle-face">
        <FigureSprite url={portraitUrl} name={portraitName} className="battle-portrait" />
        {label}
      </p>
      <canvas ref={canvasRef} width={280} height={280} />
    </div>
  );
}

export function BattleOverlay({
  snap,
  attackerName,
  defenderName,
  attackerSprite,
  defenderSprite,
  canSpin,
  awaitingRespin,
  onSpin,
  onClose,
}: Props) {
  const atkSeg = landedSegment(snap.attackerWheel, snap.attackerLanded?.index ?? null);
  const defSeg = landedSegment(snap.defenderWheel, snap.defenderLanded?.index ?? null);

  return (
    <div className="overlay" role="dialog" aria-label="Battle wheel">
      <div className="battle">
        <p className="kicker">Battle · initiator {seatLabel(snap.initiator)}</p>
        <div className="wheels">
          <WheelFace
            label={`Attacker · ${attackerName}`}
            portraitUrl={attackerSprite}
            portraitName={attackerName}
            segments={snap.attackerWheel}
            unit={snap.attackerLanded?.unit ?? null}
            pointer="ATK"
          />
          <WheelFace
            label={`Defender · ${defenderName}`}
            portraitUrl={defenderSprite}
            portraitName={defenderName}
            segments={snap.defenderWheel}
            unit={snap.defenderLanded?.unit ?? null}
            pointer="DEF"
          />
        </div>
        <div className="odds-row">
          <WheelOdds segments={snap.attackerWheel} caption="Attacker odds" />
          <WheelOdds segments={snap.defenderWheel} caption="Defender odds" />
        </div>
        <MatchupOdds attacker={snap.attackerWheel} defender={snap.defenderWheel} />
        <p>
          <strong>Landed:</strong> {describeSegment(atkSeg)} vs {describeSegment(defSeg)}
        </p>
        {snap.attackerLanded?.shiftedFrom !== null && snap.attackerLanded !== null ? (
          <p className="note">Attacker confusion-shifted from unit {snap.attackerLanded.shiftedFrom}.</p>
        ) : null}
        {snap.defenderLanded?.shiftedFrom !== null && snap.defenderLanded !== null ? (
          <p className="note">Defender confusion-shifted from unit {snap.defenderLanded.shiftedFrom}.</p>
        ) : null}
        {snap.attackerDamage !== null || snap.defenderDamage !== null ? (
          <p>
            Damage {snap.attackerDamage?.final ?? '—'} / {snap.defenderDamage?.final ?? '—'}
          </p>
        ) : null}
        {snap.outcome !== null ? (
          <p data-testid="battle-outcome">
            <strong>
              {snap.outcome.winner === null ? 'Draw' : snap.outcome.winner === 'attacker' ? 'Attacker' : 'Defender'}{' '}
              · colour {snap.outcome.decidedBy}
            </strong>
            <span className="muted"> — {snap.outcome.reason}</span>
          </p>
        ) : canSpin ? (
          <p className="note">Both wheels are built. Spin to land a /96 unit on each.</p>
        ) : awaitingRespin ? (
          <p className="note">A respin is available. Use respin or keep the spin from the HUD or command list.</p>
        ) : snap.attackerLanded !== null && snap.defenderLanded !== null ? (
          <p className="note">Spins landed. Confirm hand-off or continue to see the next window.</p>
        ) : (
          <p className="note">Waiting for the wheel to settle…</p>
        )}
        <div className="actions">
          {canSpin ? (
            <button type="button" className="primary" data-testid="overlay-spin" onClick={onSpin}>
              Spin both wheels
            </button>
          ) : null}
          <button type="button" className={snap.outcome !== null ? 'primary' : 'ghost'} onClick={onClose}>
            Continue
          </button>
        </div>
        <p className="help">W / G / P / B / M letters plus hatch mark colour. Segments sized in /96 units.</p>
      </div>
    </div>
  );
}
