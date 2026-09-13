// Stage 3: split every effect text into atomic clauses, normalize away the
// parameters, and frequency-rank the resulting patterns. The cumulative coverage
// curve is what tells us how much of the roster a given amount of work buys.
import { readFile, writeFile } from 'node:fs/promises';

const corpus = JSON.parse(await readFile('data/raw/clause-corpus.json', 'utf8'));
const figures = JSON.parse(await readFile('data/raw/merged-figures.json', 'utf8'));

const TYPES = ['Grass', 'Fire', 'Water', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy',
  'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel'];
// Longest names first so "Mega Sceptile" wins over "Sceptile".
const MON_NAMES = [...new Set(figures.map(f => f.name).filter(Boolean))].sort((a, b) => b.length - a.length);

/** Break an effect blob into independently-implementable clauses. */
function splitClauses(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;])\s+(?=[A-Z(])|\s+(?:Also,|In addition,|And,|Additionally,)\s+/g)
    .map(s => s.trim().replace(/^[,.;]\s*/, ''))
    .filter(s => s.length > 3);
}

/**
 * Both wikis use different words for identical mechanics. Folding these measured
 * synonyms first stops one mechanic fragmenting into several "distinct" patterns.
 */
const SYNONYMS = [
  [/\bfaints?\b/gi, 'is knocked out'],
  [/\bneighbou?r(ing|s)?\b/gi, 'adjacent'],
  [/\bswitch(es)? places?\b/gi, 'swaps positions'],
  [/\bnoxious\b/gi, 'toxic'],
  [/\bopponetn'?s\b/gi, "opponent's"],          // Serebii typo, 52 occurrences
  [/\bPok[eé]mon\s*(?=[a-z])/g, 'Pokémon '],    // missing space after "Pokémon"
];

/** Strip the parameters so structurally identical clauses collapse together. */
function normalize(clause) {
  let s = ' ' + clause + ' ';
  for (const [re, to] of SYNONYMS) s = s.replace(re, to);
  for (const m of MON_NAMES) s = s.split(m).join('{MON}');
  for (const t of TYPES) s = s.replace(new RegExp(`\\b${t}\\b`, 'g'), '{TYPE}');
  return s
    .replace(/[★☆]+/g, '{STAR}')
    .replace(/\bMP\s*[-+]\s*\d+/gi, 'MP{N}')
    .replace(/\bMP\s*\d+/gi, 'MP{N}')
    .replace(/[-+]\d+/g, '{N}')
    .replace(/\b\d+\b/g, '{N}')
    .replace(/\{MON\}(\s*,?\s*(or|and)?\s*\{MON\})+/g, '{MON}')
    .replace(/\{TYPE\}(-type)?(\s*,?\s*(or|and)?\s*\{TYPE\}(-type)?)+/g, '{TYPE}')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const patterns = new Map();     // normalized -> { count, example, sources:Set }
let totalClauses = 0;

for (const entry of corpus) {
  for (const clause of splitClauses(entry.text)) {
    totalClauses++;
    const key = normalize(clause);
    if (!patterns.has(key)) patterns.set(key, { count: 0, example: clause, sources: new Set() });
    const p = patterns.get(key);
    p.count++;
    p.sources.add(entry.source.split(':')[0]);
  }
}

const ranked = [...patterns].map(([pattern, p]) => ({
  pattern, count: p.count, example: p.example, kinds: [...p.sources].sort().join('+'),
})).sort((a, b) => b.count - a.count);

// Cumulative coverage: implementing the top K patterns covers what share of all clauses?
let acc = 0;
const curve = [];
ranked.forEach((r, i) => {
  acc += r.count;
  if ([10, 25, 50, 100, 150, 200, 300, 400, 500, 750, 1000].includes(i + 1)) {
    curve.push({ topK: i + 1, clausesCovered: acc, pct: +(100 * acc / totalClauses).toFixed(1) });
  }
});

console.log(`raw effect texts        : ${corpus.length}`);
console.log(`atomic clauses          : ${totalClauses}`);
console.log(`DISTINCT patterns       : ${ranked.length}`);
console.log(`singletons (count == 1) : ${ranked.filter(r => r.count === 1).length}`);
console.log(`\n=== CUMULATIVE COVERAGE CURVE ===`);
console.log('  topK   clauses   % of all clauses');
for (const c of curve) console.log(`  ${String(c.topK).padStart(4)}   ${String(c.clausesCovered).padStart(7)}   ${c.pct}%`);

console.log(`\n=== TOP 30 PATTERNS ===`);
ranked.slice(0, 30).forEach((r, i) => {
  console.log(`${String(i + 1).padStart(3)}. [${String(r.count).padStart(4)}x ${r.kinds}] ${r.example.slice(0, 105)}`);
});

await writeFile('data/raw/clause-patterns.json', JSON.stringify(ranked, null, 2));
await writeFile('data/raw/coverage-curve.json', JSON.stringify({ totalClauses, distinct: ranked.length, curve }, null, 2));
