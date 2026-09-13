// Enumerate exactly which figures Serebii under-reports, and how, so each one
// can be targeted at a second source rather than guessed at.
import { readFile, writeFile } from 'node:fs/promises';
const figs = JSON.parse(await readFile('data/raw/figures.json', 'utf8'));

const gaps = figs.filter(f => !f.dataComplete).map(f => ({
  id: f.id, slug: f.slug, name: f.name, rarity: f.rarity, mp: f.mp,
  types: f.types, wheelSum: f.wheelSum, segments: f.wheel.length,
  version: f.wheelVersion,
  kind: f.wheelSum === 0 ? 'no-data' : f.wheelSum > 96 ? 'over' : 'under',
  missing: 96 - f.wheelSum,
  wheel: f.wheel.map(s => ({ size: s.size, name: s.moveName, color: s.color })),
}));

for (const kind of ['no-data', 'under', 'over']) {
  const set = gaps.filter(g => g.kind === kind);
  console.log(`\n=== ${kind.toUpperCase()} (${set.length}) ===`);
  for (const g of set) {
    console.log(`  ${String(g.id).padStart(3)} ${g.name.padEnd(24)} ${g.rarity.padEnd(3)} sum=${String(g.wheelSum).padStart(3)} segs=${g.segments} ver=${g.version ?? '-'}`);
    console.log(`      ${g.wheel.map(s => `${s.size}:${s.name}`).join(' | ') || '(nothing)'}`);
  }
}
console.log(`\nTOTAL INCOMPLETE: ${gaps.length} of ${figs.length}`);
await writeFile('data/raw/gaps.json', JSON.stringify(gaps, null, 2));
