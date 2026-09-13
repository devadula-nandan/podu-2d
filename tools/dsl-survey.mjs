// Compact view of the ranked clause patterns, for designing the DSL against.
import { readFile } from 'node:fs/promises';
const pats = JSON.parse(await readFile('data/raw/clause-patterns.json', 'utf8'));
const N = Number(process.argv[2] ?? 120);

let cum = 0;
const total = pats.reduce((n, p) => n + p.count, 0);
console.log(`top ${N} of ${pats.length} patterns (${total} clauses total)\n`);
pats.slice(0, N).forEach((p, i) => {
  cum += p.count;
  console.log(`${String(i + 1).padStart(3)}. ${String(p.count).padStart(3)}x ${((cum / total) * 100).toFixed(1).padStart(4)}%  ${p.example}`);
});

// Which syntactic frames recur? These become the DSL's clause constructors.
const frames = {
  'conditional (if X, Y)':        /^if\b|,? if /i,
  'spin-check (targets spin)':    /\bspins?\.$/i,
  'spin-result follow-up':        /^(those|any|the ones|if it spins|if they spin)/i,
  'timing: after battle':         /after (the )?battle/i,
  'timing: start of turn':        /(at the )?start of (your |the )?turn/i,
  'timing: end of turn':          /end of (your |the )?turn/i,
  'optional (you may / can)':     /\byou (may|can)\b/i,
  'nullify':                      /\bnullif|\bhas no effect|\bcannot be affected/i,
  'no-stack':                     /does not stack|effect does not stack/i,
  'duration (for N turns)':       /for \d+ turns?|\d+ turns?\b/i,
  'per-turn limit':               /once per turn|per turn/i,
};
const counts = {}, matched = new Set();
for (const p of pats) {
  for (const [name, re] of Object.entries(frames)) {
    if (re.test(p.example)) { counts[name] = (counts[name] || 0) + p.count; matched.add(p.pattern); }
  }
}
console.log('\n=== RECURRING SYNTACTIC FRAMES (by clause count) ===');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
const plainCount = pats.filter(p => !matched.has(p.pattern)).reduce((n, p) => n + p.count, 0);
console.log(`  ${String(plainCount).padStart(5)}  plain imperative (no frame)`);
