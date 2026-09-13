// Rebuild the clause corpus from the MERGED figure set. Bulbapedia's effect text is
// cleaner than Serebii's (it fixes typos like "Eartne Rapids" and renders markers as
// "MP -2"), and the merge covers 596 figures rather than 593.
import { readFile, writeFile } from 'node:fs/promises';

const merged = JSON.parse(await readFile('data/raw/merged-figures.json', 'utf8'));
const plates = JSON.parse(await readFile('data/raw/plates.json', 'utf8'));
const serAbil = JSON.parse(await readFile('data/raw/abilities.json', 'utf8'));

// Abilities: prefer the per-figure text from the merge (Bulbapedia-sourced where
// available), then backfill anything only the Serebii listing knows about.
const abilities = new Map();
for (const f of merged) {
  if (f.ability?.name && !abilities.has(f.ability.name)) {
    abilities.set(f.ability.name, { name: f.ability.name, text: f.ability.text ?? null, source: 'figure' });
  }
}
let backfilled = 0;
for (const a of serAbil) {
  if (!abilities.has(a.name)) { abilities.set(a.name, { name: a.name, text: a.text, source: 'serebii-listing' }); backfilled++; }
}

const corpus = [];
for (const f of merged) {
  for (const s of [...f.wheel, ...f.zMoves]) {
    if (s.notes) corpus.push({ source: `figure:${f.id}`, kind: 'move', move: s.moveName, text: s.notes });
  }
}
for (const a of abilities.values()) if (a.text) corpus.push({ source: `ability:${a.name}`, kind: 'ability', move: a.name, text: a.text });
for (const p of plates) if (p.effect) corpus.push({ source: `plate:${p.id}`, kind: 'plate', move: p.name, text: p.effect });

await writeFile('data/raw/clause-corpus.json', JSON.stringify(corpus, null, 2));
await writeFile('data/raw/abilities-merged.json', JSON.stringify([...abilities.values()], null, 2));

const byKind = corpus.reduce((a, c) => { a[c.kind] = (a[c.kind] || 0) + 1; return a; }, {});
console.log(`figures            : ${merged.length}`);
console.log(`abilities (merged) : ${abilities.size}  (${backfilled} backfilled from the Serebii listing only)`);
console.log(`plates             : ${plates.length}`);
console.log(`corpus entries     : ${corpus.length}  ${JSON.stringify(byKind)}`);
