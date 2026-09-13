import { chooseCommand, type Difficulty } from '../ai/index.js';
import type { Command, Engine, GameState, PlayerId } from '../engine/index.js';
import type { AiChooseRequest, AiChooseResponse } from './ai-protocol.js';

const WORKER_TIMEOUT_MS = 30_000;

export type ChooseFn = (
  state: GameState,
  playerId: PlayerId,
  seed: number,
  difficulty: Difficulty,
) => Promise<Command>;

interface Pending {
  readonly resolve: (command: Command) => void;
  readonly reject: (error: Error) => void;
  readonly timer: number;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      if (typeof window !== 'undefined') window.setTimeout(resolve, 0);
      else resolve();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(finish);
      });
    } else {
      finish();
    }
  });
}

function settlePending(id: number): Pending | null {
  const row = pending.get(id);
  if (row === undefined) return null;
  pending.delete(id);
  if (typeof window !== 'undefined') window.clearTimeout(row.timer);
  return row;
}

function attachWorker(instance: Worker): void {
  instance.addEventListener('message', (event: MessageEvent<AiChooseResponse>) => {
    const response = event.data;
    const row = settlePending(response.id);
    if (row === null) return;
    if (response.ok) row.resolve(response.command);
    else row.reject(new Error(response.message));
  });
  instance.addEventListener('error', () => {
    workerFailed = true;
    for (const [id, row] of pending) {
      pending.delete(id);
      if (typeof window !== 'undefined') window.clearTimeout(row.timer);
      row.reject(new Error('AI worker failed'));
    }
  });
}

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (worker !== null) return worker;
  try {
    const instance = new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' });
    attachWorker(instance);
    worker = instance;
    return instance;
  } catch {
    workerFailed = true;
    return null;
  }
}

function postChoose(
  instance: Worker,
  state: GameState,
  playerId: PlayerId,
  seed: number,
  difficulty: Difficulty,
): Promise<Command> {
  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const timer =
      typeof window !== 'undefined'
        ? window.setTimeout(() => {
            pending.delete(id);
            reject(new Error('AI worker timed out'));
          }, WORKER_TIMEOUT_MS)
        : 0;
    pending.set(id, { resolve, reject, timer });
    const request: AiChooseRequest = { id, state, playerId, difficulty, seed };
    instance.postMessage(request);
  });
}

/**
 * Off-thread `chooseCommand` so Hard (~1.3s on a 2v2 opening) can paint a thinking
 * state instead of freezing the tab. Falls back to a yielded main-thread search when
 * workers are unavailable.
 */
export function createChooser(engine: Engine): ChooseFn {
  return async (state, playerId, seed, difficulty) => {
    const instance = getWorker();
    if (instance !== null) {
      try {
        return await postChoose(instance, state, playerId, seed, difficulty);
      } catch {
        /* fall through to the local engine so a worker crash is not a stuck HUD */
      }
    }
    await yieldToPaint();
    return chooseCommand(state, playerId, { engine, difficulty, seed });
  };
}

export function warmAiWorker(): void {
  getWorker();
}

export function delayAfterAiCommand(kind: Command['kind']): number {
  if (kind === 'initiateBattle') return 280;
  if (kind === 'spin') return 850;
  if (kind === 'useRespin' || kind === 'declineRespin') return 400;
  return 0;
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return yieldToPaint();
  return new Promise((resolve) => {
    if (typeof window !== 'undefined') window.setTimeout(resolve, ms);
    else resolve();
  });
}
