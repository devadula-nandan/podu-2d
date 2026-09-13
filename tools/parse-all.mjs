// Stage 2: parse the cached HTML into normalized JSON.
// Only the FIRST version tab is read - Serebii orders tabs newest-first, verified
// across the sample (dialga/charizard/heatran/toxapex/noivern all descend).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE = 'tools/cache';
const OUT = 'data/raw';
await mkdir(OUT, { recursive: true });

const ENTITIES = {
  eacute: 'é', Eacute: 'É', amp: '&', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '"', rdquo: '"',
  ndash: '\u2013', mdash: '\u2014', hellip: '…', deg: '°', times: '×',
  star: '★', bull: '\u2022', lt: '<', gt: '>',
};
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);

const strip = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Damage cells carry four distinct shapes; collapsing them to a number loses information. */
function parseDamage(raw) {
  const stars = (raw.match(/&star;/g) || []).length;
  if (stars) return { kind: 'stars', stars };
  const text = strip(raw);
  if (!text) return null;
  let m;
  if ((m = text.match(/^(\d+)\+$/)))  return { kind: 'variable',   base: +m[1] };  // "90+"
  if ((m = text.match(/^(\d+)x$/i)))  return { kind: 'multiplier', base: +m[1] };  // "20x"
  if ((m = text.match(/^(\d+)$/)))    return { kind: 'fixed',      base: +m[1] };
  return { kind: 'unknown', text };
}

// Serebii is inconsistent about capitalisation ("purple" appears lowercase on 3 figures).
const COLORS = { white: 'white', gold: 'gold', purple: 'purple', blue: 'blue', red: 'miss' };

/**
 * Ordinary rows put the bare colour in the type cell ("White"); Z-Move rows qualify it
 * ("White Z-Move", "Purple Z-Move"). Drop the qualifier and resolve whatever colour word
 * is left, so the colour survives the label it is wrapped in - matching on the remaining
 * word rather than on the whole cell also covers a "Gold Z-Move" if a patch ever adds one.
 * A cell of bare "Z-Move" carries no colour word and stays null; that is a real gap in the
 * source, not a parse failure, and tools/build-content.mjs rules on the one that matters.
 */
const colorOf = (label) => COLORS[label.replace(/z-?moves?/gi, '').trim().toLowerCase()] ?? null;

// ---- index: id, name, rarity, mp, material cost ----------------------------
const indexHtml = await readFile(join(CACHE, '_figures-index.html'), 'utf8');
const indexRows = new Map();
for (const row of indexHtml.matchAll(/<tr>\s*<td class="cen">ID\s*-\s*(\d+)<\/td>([\s\S]*?)<\/tr>/g)) {
  const id = +row[1];
  const cells = [...row[2].matchAll(/<td class="[^"]*"[^>]*>([\s\S]*?)<\/td>/g)].map(c => strip(c[1]));
  const slug = (row[2].match(/href="figures\/(\d+-[a-z0-9.'-]+)\.shtml"/i) || [])[1];
  indexRows.set(id, {
    id, slug,
    name: cells[1] || null,
    rarity: (cells[2] || '').trim(),
    mp: Number.parseInt(cells[3], 10),
    materialCost: Number.parseInt((cells[4] || '').replace(/\D/g, ''), 10) || null,
  });
}

// ---- canonical ability text (for cross-validation) -------------------------
const abilitiesHtml = await readFile(join(CACHE, '_abilities.html'), 'utf8');
const abilityTable = new Map();
for (const row of abilitiesHtml.matchAll(/<tr>\s*<td class="fooinfo">([\s\S]*?)<\/td>\s*<td class="fooinfo">([\s\S]*?)<\/td>/g)) {
  const name = strip(row[1]), text = strip(row[2]);
  if (name && name !== 'Ability Name') abilityTable.set(name, text);
}

// ---- figures ---------------------------------------------------------------
const slugs = JSON.parse(await readFile(join(CACHE, '_slugs.json'), 'utf8'));
const figures = [], anomalies = [];

for (const slug of slugs) {
  const id = +slug.split('-')[0];
  const html = await readFile(join(CACHE, `${slug}.html`), 'utf8');

  const header = html.match(/<b>Movement<\/b>:\s*([\s\S]*?)<\/p>/);
  const grab = (label) => {
    const m = (header ? header[0] : html).match(new RegExp(`<b>${label}</b>:\\s*([^<]*)`));
    return m ? decode(m[1]).trim() : null;
  };

  const typeRaw = grab('Type');
  const abilityRaw = grab('Special Ability');
  let abilityName = null, abilityText = null;
  if (abilityRaw && abilityRaw !== 'None') {
    const cut = abilityRaw.indexOf(' - ');
    abilityName = cut === -1 ? abilityRaw : abilityRaw.slice(0, cut).trim();
    abilityText = cut === -1 ? (abilityTable.get(abilityRaw) ?? null) : abilityRaw.slice(cut + 3).trim();
  }

  // Latest version tab only.
  const movesDiv = html.slice(html.indexOf('<div id="moves"'));
  const tabChunks = movesDiv.split(/<li class="tabs[^"]*"/).slice(1);
  const version = tabChunks.length ? (tabChunks[0].match(/title="([^"]+)"/) || [])[1] ?? null : null;
  const firstTab = tabChunks[0] ?? '';

  const wheel = [], zMoves = [];
  for (const row of firstTab.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)];
    if (cells.length < 5) continue;
    if (cells[0][1] === 'fooevo') continue;                     // column-header row
    const sizeText = strip(cells[0][2]);
    const parsedSize = Number.parseInt(sizeText, 10);
    const moveName = strip(cells[1][2]);
    // Serebii sometimes leaves the size cell blank (e.g. Mega Garchomp's Draco Meteor).
    // Keep the row with a null size and infer it later from the 96-unit total rather
    // than dropping a real segment.
    if (!Number.isFinite(parsedSize) && !moveName) continue;    // header / filler row
    const size = Number.isFinite(parsedSize) ? parsedSize : null;
    const typeCell = strip(cells[2][2]);
    // A size-96 row always means a Z-Move: it occupies the entire wheel, and Miss is
    // floored above zero so no ordinary segment can reach 96. Several figures carry a
    // unique Z-Move labelled plainly "White" (e.g. Mew's Genesis Supernova).
    const isZMove = /Z-Move/i.test(typeCell) || size >= 96;
    const seg = {
      size,
      moveName,
      colorRaw: typeCell,
      color: colorOf(typeCell),
      isZMove,
      notes: strip(cells[3][2]) || null,
      damage: parseDamage(cells[4][2]),
      patchFlag: cells[4][1] === 'fooben' ? 'boosted' : cells[4][1] === 'foohin' ? 'weakened' : null,
    };
    if (seg.isZMove) zMoves.push(seg); else wheel.push(seg);
  }

  const meta = indexRows.get(id) || {};

  // Recover a single blank size from the 96-unit invariant.
  const blanks = wheel.filter(s => s.size === null);
  let sizeInferred = false;
  if (blanks.length === 1) {
    const known = wheel.reduce((n, s) => n + (s.size ?? 0), 0);
    if (known < 96) { blanks[0].size = 96 - known; sizeInferred = true; }
  }

  const wheelSum = wheel.reduce((n, s) => n + (s.size ?? 0), 0);
  const fig = {
    id, slug,
    name: meta.name ?? null,
    rarity: meta.rarity ?? null,
    materialCost: meta.materialCost ?? null,
    mp: Number.isFinite(meta.mp) ? meta.mp : Number.parseInt(grab('Movement'), 10),
    types: typeRaw ? typeRaw.split('/').map(t => t.trim()).filter(Boolean) : [],
    ability: abilityName ? { name: abilityName, text: abilityText } : null,
    wheelVersion: version,
    wheel, zMoves, wheelSum, sizeInferred,
    dataComplete: wheelSum === 96 && wheel.length > 0,
  };
  figures.push(fig);

  if (wheelSum !== 96) anomalies.push({ slug, issue: `wheel sums to ${wheelSum}, not 96` });
  if (!wheel.length) anomalies.push({ slug, issue: 'no wheel segments parsed' });
  if (!fig.types.length) anomalies.push({ slug, issue: 'no types parsed' });
  if (!Number.isFinite(fig.mp)) anomalies.push({ slug, issue: 'no MP parsed' });
  // Z-Moves are checked alongside the wheel: they were excluded here once, which is how
  // a colour-resolution bug that hit only Z-Move rows went unreported for the whole run.
  for (const s of [...wheel, ...zMoves]) {
    if (!s.color) anomalies.push({ slug, issue: `unmapped color "${s.colorRaw}"` });
    if (s.damage?.kind === 'unknown') anomalies.push({ slug, issue: `unparsed damage "${s.damage.text}"` });
  }
  for (const s of wheel) {
    if (s.size === null) anomalies.push({ slug, issue: `segment "${s.moveName}" has no size and could not be inferred` });
  }
}

// ---- plates ----------------------------------------------------------------
const platesHtml = await readFile(join(CACHE, '_plates.html'), 'utf8');
const plates = [];
for (const row of platesHtml.matchAll(/<tr>\s*<td class="[^"]*"[^>]*>\s*ID-(\d+)\s*<\/td>([\s\S]*?)<\/tr>/g)) {
  const cellsRaw = [...row[2].matchAll(/<td class="[^"]*"[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]);
  const cells = cellsRaw.map(strip);
  // The icon column encodes a plate colour category (platepurple.png alt="Purple").
  const category = (cellsRaw[0]?.match(/alt="([^"]+)"/) || [])[1] ?? null;
  const effect = cells[cells.length - 1];
  plates.push({
    id: +row[1],
    category,
    name: cells[1],
    rarity: cells[2],
    cost: Number.parseInt(cells[3], 10) || null,
    effect,
    endsTurn: /your turn ends|this ends your turn/i.test(effect),
  });
}

// The listing page and the figure pages each hold one ability the other lacks
// (Flame Evolution / Control Mask), so the union is the authoritative set.
const merged = new Map(abilityTable);
for (const f of figures) {
  if (f.ability?.name && !merged.has(f.ability.name)) merged.set(f.ability.name, f.ability.text ?? null);
}
const abilities = [...merged].map(([name, text]) => ({
  name, text,
  source: abilityTable.has(name) ? (figures.some(f => f.ability?.name === name) ? 'both' : 'listing-only') : 'figure-only',
}));

await writeFile(join(OUT, 'figures.json'), JSON.stringify(figures, null, 2));
await writeFile(join(OUT, 'plates.json'), JSON.stringify(plates, null, 2));
await writeFile(join(OUT, 'abilities.json'), JSON.stringify(abilities, null, 2));
// data/raw/clause-corpus.json is NOT written here. tools/corpus.mjs owns it and builds
// it from the merged set, whose effect text is cleaner and covers 596 figures instead of
// 593. This script used to write a Serebii-only corpus to the same path, so running it
// on its own silently replaced the merged corpus with a smaller, differently shaped one
// and moved the DSL coverage number underneath the tests that read it.

const withAbility = figures.filter(f => f.ability).length;
console.log(`figures        : ${figures.length}`);
console.log(`  dual-typed   : ${figures.filter(f => f.types.length > 1).length}`);
console.log(`  with ability : ${withAbility}  (none: ${figures.length - withAbility})`);
console.log(`  with Z-Move  : ${figures.filter(f => f.zMoves.length).length}`);
console.log(`  wheel == 96  : ${figures.filter(f => f.wheelSum === 96).length}/${figures.length}`);
console.log(`  size inferred: ${figures.filter(f => f.sizeInferred).length}`);
console.log(`  dataComplete : ${figures.filter(f => f.dataComplete).length}`);
console.log(`plates         : ${plates.length}  (endsTurn: ${plates.filter(p => p.endsTurn).length})`);
console.log(`abilities      : ${abilities.length}`);
console.log(`\nanomalies      : ${anomalies.length}`);
const grouped = {};
for (const a of anomalies) (grouped[a.issue.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N')] ||= []).push(a.slug);
for (const [issue, slugList] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  [${slugList.length}] ${issue}  e.g. ${slugList.slice(0, 5).join(', ')}`);
}
await writeFile(join(OUT, 'anomalies.json'), JSON.stringify(anomalies, null, 2));
