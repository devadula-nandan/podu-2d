// Assert the invariants the engine relies on. Exits non-zero on violation so this
// can be wired straight into CI.
//
// The invariants themselves are NOT defined here. They live in the zod schemas in
// src/content/schema.ts, which the content loader also uses, so the tool and the
// engine cannot disagree about what "valid" means. This file is the human-facing
// half: it reads the files, reports the schema's errors in groups, adds the soft
// warnings that are informational rather than fatal, and prints the dataset summary.
//
// Imported with an explicit `.ts` extension because Node (>= 22.18) strips types
// natively but does not rewrite extensions. That is the whole trick that lets a
// plain .mjs pipeline script share code with the typed source tree.
import { readFile } from 'node:fs/promises';
import { ContentError } from '../src/content/schema.ts';
import { parseContent } from '../src/content/load.ts';

// Defaults to the adjudicated content layer; pass "raw" to check the merge instead.
const dir = process.argv[2] === 'raw' ? 'data/raw' : 'data/content';
const figFile = dir === 'data/raw' ? 'merged-figures.json' : 'figures.json';
const abilFile = dir === 'data/raw' ? 'abilities-merged.json' : 'abilities.json';
console.log(`validating ${dir}/ against src/content/schema.ts\n`);

const raw = {
  figures: JSON.parse(await readFile(`${dir}/${figFile}`, 'utf8')),
  plates: JSON.parse(await readFile(`${dir}/plates.json`, 'utf8')),
  abilities: JSON.parse(await readFile(`${dir}/${abilFile}`, 'utf8')),
};

/** Collapse near-identical messages so one broken parser rule reads as one line. */
const group = (list) => {
  const g = {};
  for (const w of list) {
    const key = w
      .replace(/^(figure|plate|ability) [^:]*?(?= (wheel|zMoves)\[|:)/, '$1')
      .replace(/\[\d+\]/g, '[N]')
      .replace(/"[^"]*"/g, '"…"')
      .replace(/\d+/g, 'N');
    (g[key] ||= []).push(w);
  }
  return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
};

const report = (label, list, sampleLimit) => {
  console.log(`\n=== ${label} (${list.length}) ===`);
  for (const [key, members] of group(list)) {
    console.log(`  [${members.length}] ${key}`);
    members.slice(0, members.length <= 3 ? 3 : sampleLimit).forEach((m) => console.log(`        ${m}`));
  }
};

let bundle;
try {
  bundle = parseContent(raw);
} catch (error) {
  if (!(error instanceof ContentError)) throw error;
  report('ERRORS', [...error.details], 5);
  console.log(`\nFAILED with ${error.details.length} errors`);
  process.exit(1);
}

const { figures, plates, abilities } = bundle;

// Soft signals. None of these is a content bug - they are the places where the data
// is knowingly imperfect, and they are printed every run so the imperfection stays
// visible instead of becoming folklore.
const warnings = [];
for (const f of figures) {
  const at = `figure ${f.id} (${f.name})`;
  if (!f.dataComplete) warnings.push(`${at}: incomplete wheel (${f.wheelSum}/96)`);
  if (f.inferred) warnings.push(`${at}: inferred - ${f.inferred} (wheel from ${f.wheelSource})`);
  if (f.contested) warnings.push(`${at}: contested ${f.contested.join(', ')}`);
  for (const s of f.wheel) {
    if (s.color === 'purple' && s.damage?.kind !== 'stars') {
      warnings.push(`${at} segment "${s.moveName}": Purple without a star value`);
    }
  }
}

const count = (items, key) =>
  JSON.stringify(items.reduce((acc, item) => ((acc[key(item)] = (acc[key(item)] ?? 0) + 1), acc), {}));

const allSegments = figures.flatMap((f) => [...f.wheel, ...f.zMoves]);
const stars = allSegments.filter((s) => s.damage?.kind === 'stars');

console.log('=== DATASET ===');
console.log(`  figures            : ${figures.length}`);
console.log(`  complete wheels    : ${figures.filter((f) => f.dataComplete).length}/${figures.length}`);
console.log(
  `  plates             : ${plates.length}  (${plates.filter((p) => p.cost !== null).length} with a cost)`,
);
console.log(
  `  abilities          : ${abilities.length}  (${figures.filter((f) => f.ability).length} figures carry one)`,
);
console.log(
  `  star segments      : ${stars.length}  (max ${Math.max(...stars.map((s) => s.damage.stars))}★)`,
);
console.log(`  MP distribution    : ${count(figures, (f) => f.mp)}`);
console.log(`  segments per wheel : ${count(figures, (f) => f.wheel.length)}`);
console.log(`  Z-Moves per figure : ${count(figures, (f) => f.zMoves.length)}`);
console.log(`  damage shapes      : ${count(allSegments, (s) => s.damage?.kind ?? 'none')}`);
console.log(
  `  segment colours    : ${count(
    figures.flatMap((f) => f.wheel),
    (s) => s.color,
  )}`,
);
// Printed separately because Z-Move colours were the blind spot: they were never
// counted here, and 65 of them were null for as long as nobody looked.
console.log(
  `  Z-Move colours     : ${count(
    figures.flatMap((f) => f.zMoves),
    (s) => s.color,
  )}`,
);
console.log(`  types in use       : ${[...new Set(figures.flatMap((f) => f.types))].sort().join(', ')}`);

report('WARNINGS', warnings, 3);

console.log('\nAll invariants hold.');
