// The rarity overrides only hold if cost maps 1:1 to rarity. Verify that against
// the whole roster before trusting it as a tiebreak.
import { readFile } from 'node:fs/promises';
const merged = JSON.parse(await readFile('data/raw/merged-figures.json', 'utf8'));

const pairs = {};
for (const f of merged) {
  const key = `${f.rarity ?? '?'} @ ${f.materialCost ?? '?'}`;
  (pairs[key] ||= []).push(f);
}
console.log('=== (rarity, materialCost) pairs across all figures ===');
for (const [k, v] of Object.entries(pairs).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(v.length).padStart(4)}  ${k}${v.length <= 6 ? '   e.g. ' + v.map(f => `${f.id} ${f.name}`).join('; ') : ''}`);
}

console.log('\n=== gem cost as a second witness ===');
const gems = {};
for (const f of merged) if (f.gems) (gems[`${f.rarity} @ ${f.gems} gems`] ||= []).push(f.name);
for (const [k, v] of Object.entries(gems).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(v.length).padStart(4)}  ${k}${v.length <= 6 ? '   e.g. ' + v.slice(0, 6).join('; ') : ''}`);
}
