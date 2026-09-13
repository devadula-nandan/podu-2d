/**
 * Run N seeded games (or as many as finish inside a time budget) on one engine.
 */
import type { Engine } from '../dispatch.js';
import { failureFromError } from './report.js';
import type { FuzzFailure, FuzzReport } from './report.js';
import { accumulate } from './report.js';
import { fuzzPools } from './pool.js';
import { DEFAULT_COMMAND_CAP, playFuzzGame } from './walk.js';
import type { GameWalk } from './walk.js';

export const CI_FUZZ_GAMES = 32;
/** Target for `npm run fuzz`. On this machine ~28 games/s, so 10k needs ~6 minutes. */
export const SOAK_FUZZ_GAMES = 10_000;
/** Default soak wall clock. 180s finished 5,050 games here (2026-09-12, Windows / Node 24). */
export const SOAK_BUDGET_MS = 180_000;
export const DEFAULT_BASE_SEED = 0x66757a7a;

export interface RunFuzzOptions {
  readonly games: number;
  readonly baseSeed?: number;
  readonly commandCap?: number;
  /** Stop scheduling new games after this many milliseconds. In-flight game still finishes. */
  readonly budgetMs?: number;
}

export function runFuzz(engine: Engine, opts: RunFuzzOptions): FuzzReport {
  const pools = fuzzPools(engine);
  const baseSeed = opts.baseSeed ?? DEFAULT_BASE_SEED;
  const commandCap = opts.commandCap ?? DEFAULT_COMMAND_CAP;
  const started = Date.now();
  const walks: GameWalk[] = [];
  const failures: FuzzFailure[] = [];

  for (let i = 0; i < opts.games; i++) {
    if (opts.budgetMs !== undefined && Date.now() - started >= opts.budgetMs) break;
    const seed = (baseSeed + i) >>> 0;
    try {
      walks.push(playFuzzGame(engine, seed, { commandCap }, pools));
    } catch (error) {
      const failure = failureFromError(error);
      failures.push(failure.seed >= 0 ? failure : { ...failure, seed });
    }
  }

  return accumulate(walks, failures, Date.now() - started);
}
