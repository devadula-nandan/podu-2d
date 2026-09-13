import { useEffect, useRef, useState } from 'react';
import { WHEEL_TOTAL_UNITS } from '../rules/constants.js';
import { drawWheel } from '../render/draw-wheel.js';
import { FigureSprite } from '../ui/FigureSprite.js';
import { describeSegment, landedSegment, type BattleSnap } from '../ui/model.js';
import { easeOutCubic, motionMs, RESULT_HOLD_MS, SPIN_HOLD_MS, SPIN_MS } from './motion.js';
import { playSfx } from './sfx.js';

interface Props {
  readonly snap: BattleSnap;
  readonly attackerName: string;
  readonly defenderName: string;
  readonly attackerSprite: string | null;
  readonly defenderSprite: string | null;
  readonly awaitingRespin: boolean;
  readonly muted: boolean;
  readonly onClose: () => void;
}

function WheelFace({
  label,
  portraitUrl,
  segments,
  unit,
  pointer,
  muted,
}: {
  readonly label: string;
  readonly portraitUrl: string | null;
  readonly segments: BattleSnap['attackerWheel'];
  readonly unit: number | null;
  readonly pointer: string;
  readonly muted: boolean;
}) {
  return (
    <WheelFaceInner
      key={unit === null ? 'idle' : String(unit)}
      label={label}
      portraitUrl={portraitUrl}
      segments={segments}
      unit={unit}
      pointer={pointer}
      muted={muted}
    />
  );
}

function WheelFaceInner({
  label,
  portraitUrl,
  segments,
  unit,
  pointer,
  muted,
}: {
  readonly label: string;
  readonly portraitUrl: string | null;
  readonly segments: BattleSnap['attackerWheel'];
  readonly unit: number | null;
  readonly pointer: string;
  readonly muted: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [turns, setTurns] = useState(0);
  const [settled, setSettled] = useState(unit === null);
  const fromRef = useRef(0);

  useEffect(() => {
    if (unit === null) return;
    playSfx('spin', muted);
    const target = -unit / WHEEL_TOTAL_UNITS - 2;
    const start = fromRef.current;
    const delta = target - start;
    const begun = performance.now();
    const duration = motionMs(SPIN_MS);
    const hold = motionMs(SPIN_HOLD_MS);
    let frame = 0;
    let tickAt = 0;
    let holdTimer = 0;
    const tick = (now: number): void => {
      const t = duration === 0 ? 1 : Math.min(1, (now - begun) / duration);
      setTurns(start + delta * easeOutCubic(t));
      if (now - tickAt > 70 && t < 1) {
        playSfx('tick', muted);
        tickAt = now;
      }
      if (t < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      fromRef.current = target;
      holdTimer = window.setTimeout(() => {
        setSettled(true);
      }, hold);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(holdTimer);
    };
  }, [muted, unit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const size = 240;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawWheel(ctx, { segments, rotationTurns: turns, landedUnit: settled ? unit : null, pointerLabel: pointer }, size);
  }, [pointer, segments, settled, turns, unit]);

  return (
    <div className="play-wheel">
      <p className="battle-face">
        <FigureSprite url={portraitUrl} name={label} className="battle-portrait" />
        {label}
      </p>
      <canvas ref={canvasRef} width={240} height={240} />
    </div>
  );
}

function BattleCopy({
  snap,
  attackerName,
  defenderName,
  spinning,
  muted,
}: {
  readonly snap: BattleSnap;
  readonly attackerName: string;
  readonly defenderName: string;
  readonly spinning: boolean;
  readonly muted: boolean;
}) {
  const atkUnit = snap.attackerLanded?.unit ?? null;
  const defUnit = snap.defenderLanded?.unit ?? null;
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (atkUnit === null || defUnit === null) return;
    const wait = motionMs(SPIN_MS) + motionMs(SPIN_HOLD_MS);
    const timer = window.setTimeout(() => {
      setReveal(true);
      playSfx('hit', muted);
    }, wait);
    return () => {
      window.clearTimeout(timer);
    };
  }, [atkUnit, defUnit, muted]);

  const atkSeg = landedSegment(snap.attackerWheel, snap.attackerLanded?.index ?? null);
  const defSeg = landedSegment(snap.defenderWheel, snap.defenderLanded?.index ?? null);
  const showLanded = reveal && spinning;

  return (
    <>
      {showLanded ? (
        <p className="play-landed" data-testid="play-landed">
          {describeSegment(atkSeg)} vs {describeSegment(defSeg)}
        </p>
      ) : (
        <p className="play-landed is-wait">Wheels spinning…</p>
      )}
      {showLanded && snap.outcome !== null ? (
        <p data-testid="battle-outcome">
          <strong>
            {snap.outcome.winner === null ? 'Draw' : snap.outcome.winner === 'attacker' ? attackerName : defenderName}
          </strong>
          <span> · {snap.outcome.decidedBy}</span>
        </p>
      ) : null}
    </>
  );
}

export function PlayBattle({
  snap,
  attackerName,
  defenderName,
  attackerSprite,
  defenderSprite,
  awaitingRespin,
  muted,
  onClose,
}: Props) {
  const atkUnit = snap.attackerLanded?.unit ?? null;
  const defUnit = snap.defenderLanded?.unit ?? null;
  const spinning = atkUnit !== null || defUnit !== null;
  const spinKey = spinning ? `${String(atkUnit)}-${String(defUnit)}` : 'idle';
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!spinning) return;
    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, motionMs(SPIN_MS) + motionMs(SPIN_HOLD_MS) + RESULT_HOLD_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [spinKey, spinning]);

  return (
    <div className="play-battle" role="dialog" aria-label="Battle wheels" data-testid="play-battle">
      <div className="play-battle-card">
        <p className="play-battle-kicker">Battle</p>
        <div className="play-wheels">
          <WheelFace
            label={attackerName}
            portraitUrl={attackerSprite}
            segments={snap.attackerWheel}
            unit={atkUnit}
            pointer="ATK"
            muted={muted}
          />
          <WheelFace
            label={defenderName}
            portraitUrl={defenderSprite}
            segments={snap.defenderWheel}
            unit={defUnit}
            pointer="DEF"
            muted={muted}
          />
        </div>
        <BattleCopy
          key={spinKey}
          snap={snap}
          attackerName={attackerName}
          defenderName={defenderName}
          spinning={spinning}
          muted={muted}
        />
        {awaitingRespin ? <p className="play-landed is-wait">A respin is available.</p> : null}
        <p className="play-wheel-help">W / G / P / B / M plus hatch — colour is never the only signal.</p>
      </div>
    </div>
  );
}
