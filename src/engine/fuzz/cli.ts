/**
 * Soak-runner entry. Invoked via `tools/fuzz.mjs` → vite-node, not by `npm test`.
 *
 * Default: 10,000 games or ~3 minutes, whichever comes first. Prints the histogram
 * and exits 1 on any invariant failure.
 */
import { createFuzzEngine } from './content.js';
import { fuzzPools } from './pool.js';
import { formatReport } from './report.js';
import { DEFAULT_BASE_SEED, SOAK_BUDGET_MS, SOAK_FUZZ_GAMES, runFuzz } from './run.js';
import { DEFAULT_COMMAND_CAP } from './walk.js';

function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`expected a positive integer, got ${raw}`);
  return n;
}

export function parseCli(args: readonly string[]): {
  games: number;
  budgetMs: number;
  baseSeed: number;
  commandCap: number;
} {
  const positional = args.find((arg, index) => {
    if (arg.startsWith('-')) return false;
    const prev = args[index - 1];
    return prev !== '--games' && prev !== '--ms' && prev !== '--seed' && prev !== '--cap';
  });
  return {
    games: parsePositiveInt(
      argValue(args, '--games') ?? positional ?? process.env.FUZZ_GAMES,
      SOAK_FUZZ_GAMES,
    ),
    budgetMs: parsePositiveInt(argValue(args, '--ms') ?? process.env.FUZZ_BUDGET_MS, SOAK_BUDGET_MS),
    baseSeed: parsePositiveInt(argValue(args, '--seed') ?? process.env.FUZZ_SEED, DEFAULT_BASE_SEED),
    commandCap: parsePositiveInt(argValue(args, '--cap') ?? process.env.FUZZ_CAP, DEFAULT_COMMAND_CAP),
  };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const opts = parseCli(argv);
  const engine = createFuzzEngine();
  const pools = fuzzPools(engine);
  console.log(
    `fuzz soak: games≤${opts.games} budgetMs=${opts.budgetMs} cap=${opts.commandCap} seed=${opts.baseSeed}`,
  );
  console.log(
    `  pools: no-ability=${pools.noAbility.length} with-ability=${pools.withAbility.length} plates=${pools.plates.length}`,
  );
  console.log(
    `  coverage: ${engine.registry.totals.figuresImplemented}/${engine.registry.totals.figures} figures, ${engine.registry.totals.platesImplemented}/${engine.registry.totals.plates} plates`,
  );

  const report = runFuzz(engine, {
    games: opts.games,
    budgetMs: opts.budgetMs,
    baseSeed: opts.baseSeed,
    commandCap: opts.commandCap,
  });
  console.log(formatReport(report));
  return report.invariantFailures === 0 ? 0 : 1;
}

// vite-node strips the script path from `process.argv`, so this module is an
// entry point: importing it from a test would start a soak. Don't.
process.exitCode = main();
