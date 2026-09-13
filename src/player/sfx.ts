export const SFX_MUTE_KEY = 'podu.sfx.muted';

export type SfxName = 'select' | 'move' | 'tick' | 'spin' | 'hit' | 'ko' | 'goal' | 'illegal';

export function readSfxMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SFX_MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSfxMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SFX_MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode */
  }
}

type OscKind = OscillatorType;

interface Tone {
  readonly freq: number;
  readonly endFreq?: number;
  readonly type: OscKind;
  readonly dur: number;
  readonly gain: number;
  readonly delay?: number;
}

const CUES: Record<SfxName, readonly Tone[]> = {
  select: [{ freq: 740, type: 'sine', dur: 0.05, gain: 0.07 }],
  move: [{ freq: 220, endFreq: 420, type: 'triangle', dur: 0.18, gain: 0.08 }],
  tick: [{ freq: 1180, type: 'square', dur: 0.018, gain: 0.035 }],
  spin: [
    { freq: 320, endFreq: 640, type: 'sawtooth', dur: 0.22, gain: 0.04 },
    { freq: 880, type: 'square', dur: 0.02, gain: 0.03, delay: 0.08 },
    { freq: 920, type: 'square', dur: 0.02, gain: 0.03, delay: 0.16 },
    { freq: 980, type: 'square', dur: 0.02, gain: 0.03, delay: 0.24 },
  ],
  hit: [
    { freq: 90, endFreq: 48, type: 'square', dur: 0.16, gain: 0.1 },
    { freq: 210, type: 'triangle', dur: 0.08, gain: 0.05 },
  ],
  ko: [{ freq: 180, endFreq: 55, type: 'sawtooth', dur: 0.42, gain: 0.09 }],
  goal: [
    { freq: 523, type: 'sine', dur: 0.16, gain: 0.08 },
    { freq: 784, type: 'sine', dur: 0.22, gain: 0.08, delay: 0.14 },
  ],
  illegal: [{ freq: 130, type: 'sawtooth', dur: 0.09, gain: 0.07 }],
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx === null) ctx = new AudioContext();
  return ctx;
}

function playTone(ac: AudioContext, tone: Tone, when: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = tone.type;
  osc.frequency.setValueAtTime(tone.freq, when);
  if (tone.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, tone.endFreq), when + tone.dur);
  }
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(tone.gain, when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + tone.dur);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(when);
  osc.stop(when + tone.dur + 0.02);
}

export function playSfx(name: SfxName, muted: boolean): void {
  if (muted) return;
  const ac = audio();
  if (ac === null) return;
  if (ac.state === 'suspended') void ac.resume();
  const now = ac.currentTime;
  for (const tone of CUES[name]) {
    playTone(ac, tone, now + (tone.delay ?? 0));
  }
}

export function unlockSfx(): void {
  const ac = audio();
  if (ac === null) return;
  if (ac.state === 'suspended') void ac.resume();
}
