import { useEffect, useRef, useState } from 'react';
import { drawWheel, spinTargetDegrees } from '../render/draw-wheel.js';
import {
  landedPower,
  landedSegment,
  viewingWin,
  winBanner,
  type BattleSnap,
} from '../ui/model.js';
import { CLASH_MS, motionMs, RESULT_HOLD_MS, SPIN_HOLD_MS, SPIN_MS } from './motion.js';
import { playSfx } from './sfx.js';

/** WebGL diagonal duel: you bottom-left → NE (45°), rival top-right → SW (225°). */
const YOU_DIAG_POINTER_TURNS = 45 / 360;
const RIVAL_DIAG_POINTER_TURNS = 225 / 360;

interface Props {
  readonly snap: BattleSnap;
  readonly attackerName: string;
  readonly defenderName: string;
  readonly attackerSprite: string | null;
  readonly defenderSprite: string | null;
  readonly youAreAttacker: boolean;
  readonly awaitingRespin: boolean;
  readonly muted: boolean;
  readonly onClose: () => void;
}

function WheelFace({
  label,
  segments,
  unit,
  pointerTurns,
  seat,
  muted,
}: {
  readonly label: string;
  readonly segments: BattleSnap['attackerWheel'];
  readonly unit: number | null;
  readonly pointerTurns: number;
  readonly seat: 'you' | 'rival';
  readonly muted: boolean;
}) {
  return (
    <WheelFaceInner
      key={unit === null ? 'idle' : String(unit)}
      label={label}
      segments={segments}
      unit={unit}
      pointerTurns={pointerTurns}
      seat={seat}
      muted={muted}
    />
  );
}

function WheelFaceInner({
  label,
  segments,
  unit,
  pointerTurns,
  seat,
  muted,
}: {
  readonly label: string;
  readonly segments: BattleSnap['attackerWheel'];
  readonly unit: number | null;
  readonly pointerTurns: number;
  readonly seat: 'you' | 'rival';
  readonly muted: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const spinRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [px, setPx] = useState(480);
  const [settled, setSettled] = useState(unit === null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const fit = (): void => {
      const box = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const edge = Math.max(160, Math.floor(Math.min(box.width, box.height) * dpr));
      setPx(edge);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawWheel(
      ctx,
      {
        segments,
        rotationTurns: 0,
        landedUnit: settled ? unit : null,
        pointerLabel: '',
        pointerTurns,
        labels: 'full',
        showPointer: false,
        hubLabel: null,
        look: 'duel',
      },
      px,
    );
  }, [pointerTurns, px, segments, settled, unit]);

  useEffect(() => {
    const spin = spinRef.current;
    if (spin === null || unit === null) return;
    playSfx('spin', muted);
    const duration = motionMs(SPIN_MS);
    const hold = motionMs(SPIN_HOLD_MS);
    const target = spinTargetDegrees(unit, pointerTurns);
    let holdTimer = 0;
    let tickTimer = 0;
    let endTimer = 0;

    spin.style.transition = 'none';
    spin.style.transform = 'rotate(0deg)';
    void spin.offsetWidth;
    spin.style.transition = `transform ${duration}ms cubic-bezier(0.1, 0.7, 0.08, 1)`;
    spin.style.transform = `rotate(${target}deg)`;

    const tickEvery = 70;
    const begun = performance.now();
    const tick = (): void => {
      const elapsed = performance.now() - begun;
      if (elapsed < duration) {
        playSfx('tick', muted);
        tickTimer = window.setTimeout(tick, tickEvery);
      }
    };
    tickTimer = window.setTimeout(tick, tickEvery);

    endTimer = window.setTimeout(() => {
      holdTimer = window.setTimeout(() => {
        setSettled(true);
      }, hold);
    }, duration);

    return () => {
      window.clearTimeout(tickTimer);
      window.clearTimeout(endTimer);
      window.clearTimeout(holdTimer);
    };
  }, [muted, pointerTurns, unit]);

  return (
    <div className="play-wheel" data-seat={seat} ref={wrapRef}>
      <div className="play-wheel-spin" ref={spinRef}>
        <canvas ref={canvasRef} width={px} height={px} aria-label={`${seat} ${label} wheel`} />
      </div>
    </div>
  );
}

export function PlayBattle({
  snap,
  attackerName,
  defenderName,
  youAreAttacker,
  awaitingRespin,
  muted,
  onClose,
}: Props) {
  const atkUnit = snap.attackerLanded?.unit ?? null;
  const defUnit = snap.defenderLanded?.unit ?? null;
  const spinning = atkUnit !== null || defUnit !== null;
  const spinKey = spinning ? `${String(atkUnit)}-${String(defUnit)}` : 'idle';
  const onCloseRef = useRef(onClose);
  const introOnce = useRef(false);
  const [intro, setIntro] = useState(true);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (introOnce.current) {
      setIntro(false);
      return;
    }
    introOnce.current = true;
    playSfx('hit', muted);
    const timer = window.setTimeout(() => {
      setIntro(false);
    }, motionMs(CLASH_MS));
    return () => {
      window.clearTimeout(timer);
    };
  }, [muted]);

  useEffect(() => {
    if (intro || !spinning) return;
    const wait = motionMs(SPIN_MS) + motionMs(SPIN_HOLD_MS);
    const timer = window.setTimeout(() => {
      setReveal(true);
      playSfx('hit', muted);
    }, wait);
    return () => {
      window.clearTimeout(timer);
    };
  }, [intro, muted, spinKey, spinning]);

  useEffect(() => {
    if (intro || awaitingRespin || snap.outcome === null) return;
    const wait = spinning
      ? motionMs(SPIN_MS) + motionMs(SPIN_HOLD_MS) + RESULT_HOLD_MS
      : RESULT_HOLD_MS;
    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, wait);
    return () => {
      window.clearTimeout(timer);
    };
  }, [awaitingRespin, intro, snap.outcome, spinKey, spinning]);

  useEffect(() => {
    if (intro || spinning || snap.outcome === null) return;
    setReveal(true);
  }, [intro, snap.outcome, spinning]);

  const youName = youAreAttacker ? attackerName : defenderName;
  const rivalName = youAreAttacker ? defenderName : attackerName;
  const youWheel = youAreAttacker ? snap.attackerWheel : snap.defenderWheel;
  const rivalWheel = youAreAttacker ? snap.defenderWheel : snap.attackerWheel;
  const youUnit = intro ? null : youAreAttacker ? atkUnit : defUnit;
  const rivalUnit = intro ? null : youAreAttacker ? defUnit : atkUnit;
  const atkSeg = landedSegment(snap.attackerWheel, snap.attackerLanded?.index ?? null);
  const defSeg = landedSegment(snap.defenderWheel, snap.defenderLanded?.index ?? null);
  const youSeg = youAreAttacker ? atkSeg : defSeg;
  const rivalSeg = youAreAttacker ? defSeg : atkSeg;
  const youDmg = youAreAttacker ? snap.attackerDamage?.final ?? null : snap.defenderDamage?.final ?? null;
  const rivalDmg = youAreAttacker ? snap.defenderDamage?.final ?? null : snap.attackerDamage?.final ?? null;
  const win = viewingWin(snap.outcome, youAreAttacker);
  const showResult = reveal && spinning && win !== null;

  return (
    <div className="play-battle" role="dialog" aria-label="Battle wheels" data-testid="play-battle">
      <div className="play-battle-card" data-phase={intro ? 'clash' : showResult ? 'result' : 'spin'}>
        <div className="play-wheels">
          <WheelFace
            label={rivalName}
            segments={rivalWheel}
            unit={rivalUnit}
            pointerTurns={RIVAL_DIAG_POINTER_TURNS}
            seat="rival"
            muted={muted}
          />
          <WheelFace
            label={youName}
            segments={youWheel}
            unit={youUnit}
            pointerTurns={YOU_DIAG_POINTER_TURNS}
            seat="you"
            muted={muted}
          />
          <div className="play-clash" aria-hidden>
            <span className="play-clash-pin" data-testid="play-clash" />
          </div>
        </div>
        <p className="play-landed" data-testid="play-landed" hidden={!reveal}>
          {reveal
            ? `${youSeg?.moveName ?? '—'} ${landedPower(youSeg, youDmg)} vs ${rivalSeg?.moveName ?? '—'} ${landedPower(rivalSeg, rivalDmg)}`
            : `${youName} vs ${rivalName}`}
        </p>
        {showResult && win !== null ? (
          <div className="play-result" data-testid="battle-outcome" data-win={win}>
            <strong>{winBanner(win)}</strong>
            <b>
              {landedPower(youSeg, youDmg)}
              <span>vs</span>
              {landedPower(rivalSeg, rivalDmg)}
            </b>
          </div>
        ) : null}
        {awaitingRespin ? <p className="play-note">A respin is available.</p> : null}
      </div>
    </div>
  );
}
