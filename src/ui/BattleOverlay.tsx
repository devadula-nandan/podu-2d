import { useEffect, useRef, useState } from 'react';
import {
  RIVAL_POINTER_TURNS,
  YOU_POINTER_TURNS,
  drawWheel,
  spinTargetTurns,
} from '../render/draw-wheel.js';
import {
  describeSegment,
  landedPower,
  landedSegment,
  viewSeatName,
  viewingWin,
  winBanner,
  type BattleSnap,
} from './model.js';
import { FigureSprite } from './FigureSprite.js';
import { MatchupOdds, WheelOdds } from './WheelOdds.js';

interface Props {
  readonly snap: BattleSnap;
  readonly attackerName: string;
  readonly defenderName: string;
  readonly attackerSprite: string | null;
  readonly defenderSprite: string | null;
  readonly youAreAttacker: boolean;
  readonly canSpin: boolean;
  readonly awaitingRespin: boolean;
  readonly onSpin: () => void;
  readonly onClose: () => void;
  readonly you: 0 | 1;
}

function useSpinTurns(unit: number | null, pointerTurns: number): number {
  const [turns, setTurns] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (unit === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = spinTargetTurns(unit, pointerTurns);
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
  }, [pointerTurns, unit]);

  return turns;
}

function WheelFace({
  label,
  portraitUrl,
  portraitName,
  segments,
  unit,
  pointer,
  pointerTurns,
  seat,
}: {
  readonly label: string;
  readonly portraitUrl: string | null;
  readonly portraitName: string;
  readonly segments: BattleSnap['attackerWheel'];
  readonly unit: number | null;
  readonly pointer: string;
  readonly pointerTurns: number;
  readonly seat: 'you' | 'rival';
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const turns = useSpinTurns(unit, pointerTurns);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const size = 320;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawWheel(
      ctx,
      {
        segments,
        rotationTurns: turns,
        landedUnit: unit,
        pointerLabel: pointer,
        pointerTurns,
        labels: 'full',
      },
      size,
    );
  }, [pointer, pointerTurns, segments, turns, unit]);

  return (
    <div className="wheel-col" data-seat={seat}>
      <p className="kicker battle-face">
        <FigureSprite url={portraitUrl} name={portraitName} className="battle-portrait" />
        {label}
      </p>
      <canvas ref={canvasRef} width={320} height={320} />
    </div>
  );
}

export function BattleOverlay({
  snap,
  attackerName,
  defenderName,
  attackerSprite,
  defenderSprite,
  youAreAttacker,
  canSpin,
  awaitingRespin,
  onSpin,
  onClose,
  you,
}: Props) {
  const atkSeg = landedSegment(snap.attackerWheel, snap.attackerLanded?.index ?? null);
  const defSeg = landedSegment(snap.defenderWheel, snap.defenderLanded?.index ?? null);
  const youName = youAreAttacker ? attackerName : defenderName;
  const rivalName = youAreAttacker ? defenderName : attackerName;
  const youSprite = youAreAttacker ? attackerSprite : defenderSprite;
  const rivalSprite = youAreAttacker ? defenderSprite : attackerSprite;
  const youWheel = youAreAttacker ? snap.attackerWheel : snap.defenderWheel;
  const rivalWheel = youAreAttacker ? snap.defenderWheel : snap.attackerWheel;
  const youUnit = youAreAttacker ? (snap.attackerLanded?.unit ?? null) : (snap.defenderLanded?.unit ?? null);
  const rivalUnit = youAreAttacker ? (snap.defenderLanded?.unit ?? null) : (snap.attackerLanded?.unit ?? null);
  const youSeg = youAreAttacker ? atkSeg : defSeg;
  const rivalSeg = youAreAttacker ? defSeg : atkSeg;
  const youDmg = youAreAttacker ? snap.attackerDamage?.final ?? null : snap.defenderDamage?.final ?? null;
  const rivalDmg = youAreAttacker ? snap.defenderDamage?.final ?? null : snap.attackerDamage?.final ?? null;
  const win = viewingWin(snap.outcome, youAreAttacker);

  return (
    <div className="overlay" role="dialog" aria-label="Battle wheel">
      <div className="battle">
        <p className="kicker">Battle · initiator {viewSeatName(snap.initiator, you)}</p>
        <div className="wheels">
          <WheelFace
            label={`Rival · ${rivalName}`}
            portraitUrl={rivalSprite}
            portraitName={rivalName}
            segments={rivalWheel}
            unit={rivalUnit}
            pointer="RIV"
            pointerTurns={RIVAL_POINTER_TURNS}
            seat="rival"
          />
          <WheelFace
            label={`You · ${youName}`}
            portraitUrl={youSprite}
            portraitName={youName}
            segments={youWheel}
            unit={youUnit}
            pointer="YOU"
            pointerTurns={YOU_POINTER_TURNS}
            seat="you"
          />
        </div>
        {win !== null ? (
          <div className="battle-result" data-testid="battle-outcome" data-win={win}>
            <strong>{winBanner(win)}</strong>
            <b>
              {landedPower(youSeg, youDmg)}
              <span>vs</span>
              {landedPower(rivalSeg, rivalDmg)}
            </b>
            <p>
              {youSeg?.moveName ?? '—'} · {rivalSeg?.moveName ?? '—'}
            </p>
            <small>{snap.outcome?.reason}</small>
          </div>
        ) : (
          <p>
            <strong>Landed:</strong> {describeSegment(atkSeg)} vs {describeSegment(defSeg)}
          </p>
        )}
        <div className="odds-row">
          <WheelOdds segments={youWheel} caption="Your odds" />
          <WheelOdds segments={rivalWheel} caption="Rival odds" />
        </div>
        <MatchupOdds attacker={snap.attackerWheel} defender={snap.defenderWheel} />
        {snap.attackerLanded?.shiftedFrom !== null && snap.attackerLanded !== null ? (
          <p className="note">Attacker confusion-shifted from unit {snap.attackerLanded.shiftedFrom}.</p>
        ) : null}
        {snap.defenderLanded?.shiftedFrom !== null && snap.defenderLanded !== null ? (
          <p className="note">Defender confusion-shifted from unit {snap.defenderLanded.shiftedFrom}.</p>
        ) : null}
        {canSpin ? (
          <p className="note">Both wheels are built. Spin to land a /96 unit on each.</p>
        ) : awaitingRespin ? (
          <p className="note">A respin is available. Use respin or keep the spin from the HUD or command list.</p>
        ) : snap.attackerLanded !== null && snap.defenderLanded !== null && snap.outcome === null ? (
          <p className="note">Spins landed. Confirm hand-off or continue to see the next window.</p>
        ) : snap.outcome === null ? (
          <p className="note">Waiting for the wheel to settle…</p>
        ) : null}
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
      </div>
    </div>
  );
}
