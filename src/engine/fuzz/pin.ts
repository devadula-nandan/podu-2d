/**
 * One-shot helper: print fixture hashes (and optional walker recordings).
 * Not imported by tests.
 */
import { hashState } from '../hash.js';
import { createFuzzEngine } from './content.js';
import { FUZZ_GOLDENS } from './fixtures.js';
import { replayCommands } from './walk.js';

const engine = createFuzzEngine();

for (const golden of FUZZ_GOLDENS) {
  try {
    const final = replayCommands(engine, golden.setup, golden.commands, golden.setup.seed);
    console.log(
      `${golden.name} hash=${hashState(final)} pinned=${golden.hash} phase=${final.phase} result=${final.result?.reason ?? 'null'}`,
    );
  } catch (error) {
    console.log(`${golden.name} FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}
