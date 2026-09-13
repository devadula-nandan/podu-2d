// Cross-validate Serebii against Bulbapedia and merge into one authoritative set.
// Bulbapedia wins by default: it is structured wikitext with explicit stars, prob,
// evostage and dual types, and its wheels sum correctly far more often. Serebii
// fills the gaps and backstops the figures Bulbapedia lacks.
import { readFile, writeFile } from 'node:fs/promises';

const ser = JSON.parse(await readFile('data/raw/figures.json', 'utf8'));
const bul = JSON.parse(await readFile('data/raw/bulbapedia-figures.json', 'utf8'));
const S = new Map(ser.map(f => [f.id, f]));
const B = new Map(bul.map(f => [f.id, f]));
const ids = [...new Set([...S.keys(), ...B.keys()])].sort((a, b) => a - b);

const norm = (s) => (s ?? '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
const RARITY = { common: 'C', uncommon: 'UC', rare: 'R', ex: 'EX', ux: 'UX', c: 'C', uc: 'UC', r: 'R' };

const merged = [], disagreements = [], stillBroken = [];
let fromB = 0, fromS = 0;

for (const id of ids) {
  const b = B.get(id), s = S.get(id);
  const bOk = b && b.wheelSum === 96;
  const sOk = s && s.wheelSum === 96;

  // Pick the wheel source: a sound wheel always beats an unsound one.
  const useB = bOk || (!sOk && !!b);
  const src = useB ? b : s;
  if (!src) continue;
  if (useB) fromB++; else fromS++;

  const wheel = (useB ? b.wheel : s.wheel).map(g => ({
    size: g.size,
    moveName: g.moveName,
    color: g.color,
    damage: g.damage ?? null,
    notes: g.notes ?? null,
  }));
  const wheelSum = wheel.reduce((n, g) => n + (g.size ?? 0), 0);

  const rec = {
    id,
    name: b?.name ?? s?.name ?? null,
    form: b?.form ?? null,
    rarity: RARITY[norm(b?.rarity ?? s?.rarity)] ?? (b?.rarity ?? s?.rarity ?? null),
    types: (b?.types?.length ? b.types : s?.types) ?? [],
    mp: b?.mp ?? s?.mp ?? null,
    evoStage: b?.evoStage ?? null,
    materialCost: b?.materialCost ?? s?.materialCost ?? null,
    gems: b?.gems ?? null,
    league: b?.league ?? null,
    booster: b?.booster ?? null,
    ability: b?.ability ?? s?.ability ?? null,
    wheel,
    zMoves: (useB ? b.zMoves : s.zMoves) ?? [],
    wheelSum,
    wheelSource: useB ? 'bulbapedia' : 'serebii',
    diskVersion: (useB ? b.diskVersion : s.wheelVersion) ?? null,
    sources: [b && 'bulbapedia', s && 'serebii'].filter(Boolean),
    dataComplete: wheelSum === 96,
  };
  merged.push(rec);
  if (!rec.dataComplete) stillBroken.push({ id, name: rec.name, sum: wheelSum, serebii: s?.wheelSum ?? null, bulba: b?.wheelSum ?? null });

  // Flag substantive field conflicts between the two sources.
  if (b && s) {
    const conflicts = [];
    if (b.mp !== null && s.mp !== null && b.mp !== s.mp) conflicts.push(`mp ${s.mp}(ser) vs ${b.mp}(bul)`);
    const sr = RARITY[norm(s.rarity)] ?? norm(s.rarity), br = RARITY[norm(b.rarity)] ?? norm(b.rarity);
    if (sr && br && sr !== br) conflicts.push(`rarity ${sr}(ser) vs ${br}(bul)`);
    if (b.types.length && s.types.length && norm(b.types.join()) !== norm(s.types.join())) {
      conflicts.push(`types ${s.types.join('/')}(ser) vs ${b.types.join('/')}(bul)`);
    }
    if (b.ability && s.ability && norm(b.ability.name) !== norm(s.ability.name)) {
      conflicts.push(`ability "${s.ability.name}"(ser) vs "${b.ability.name}"(bul)`);
    }
    if (conflicts.length) disagreements.push({ id, name: rec.name, conflicts });
  }
}

// ---- repair tier: shiny variants mirror their base figure ----------------
// Serebii's own historical tab for Shiny Mimikyu (V6.1.1) lists exactly base
// Mimikyu's wheel, so mirroring is corroborated rather than assumed. Shiny
// Vaporeon has no wheel on either source; its donor is chosen by matching rarity,
// which is weaker evidence, so it is flagged for review.
const SHINY_DONORS = {
  628: { base: 363, evidence: "serebii's own V6.1.1 tab matches base Mimikyu's wheel exactly" },
  513: { base: 187, evidence: 'rarity-matched base Vaporeon (R); no wheel on either source - REVIEW' },
};
const byId = new Map(merged.map(f => [f.id, f]));
for (const [idStr, { base, evidence }] of Object.entries(SHINY_DONORS)) {
  const target = byId.get(+idStr), donor = byId.get(base);
  if (!target || !donor || target.dataComplete || !donor.dataComplete) continue;
  target.wheel = donor.wheel.map(s => ({ ...s }));
  target.zMoves = donor.zMoves.map(s => ({ ...s }));
  target.wheelSum = donor.wheelSum;
  target.dataComplete = true;
  target.wheelSource = `mirrored:${base}`;
  target.inferred = evidence;
}

await writeFile('data/raw/merged-figures.json', JSON.stringify(merged, null, 2));
await writeFile('data/raw/disagreements.json', JSON.stringify(disagreements, null, 2));

const bothOk = merged.filter(f => f.sources.length === 2).length;
console.log(`=== COVERAGE ===`);
console.log(`  Serebii figures        : ${ser.length}`);
console.log(`  Bulbapedia figures     : ${bul.length}`);
console.log(`  merged union           : ${merged.length}`);
console.log(`    present in both      : ${bothOk}`);
console.log(`    Serebii only         : ${merged.filter(f => f.sources.length === 1 && f.sources[0] === 'serebii').length}`);
console.log(`    Bulbapedia only      : ${merged.filter(f => f.sources.length === 1 && f.sources[0] === 'bulbapedia').length}`);
console.log(`\n=== WHEEL INTEGRITY ===`);
console.log(`  complete (sum == 96)   : ${merged.filter(f => f.dataComplete).length}/${merged.length}  (${(100 * merged.filter(f => f.dataComplete).length / merged.length).toFixed(1)}%)`);
console.log(`  wheel taken from bulba : ${fromB}`);
console.log(`  wheel taken from serebii: ${fromS}`);
console.log(`\n=== ENRICHMENT ===`);
console.log(`  dual-typed             : ${merged.filter(f => f.types.length > 1).length}`);
console.log(`  with evolution stage   : ${merged.filter(f => f.evoStage !== null).length}`);
console.log(`  with ability           : ${merged.filter(f => f.ability).length}`);
console.log(`  with form name         : ${merged.filter(f => f.form).length}`);
console.log(`  purple segs with stars : ${merged.flatMap(f => f.wheel).filter(g => g.damage?.kind === 'stars').length}`);

const repaired = merged.filter(f => f.inferred);
console.log(`\n=== REPAIRED BY MIRRORING (${repaired.length}) ===`);
repaired.forEach(f => console.log(`  ${String(f.id).padStart(3)} ${String(f.name).padEnd(20)} <- ${f.wheelSource}  (${f.inferred})`));

const unresolved = merged.filter(f => !f.dataComplete);
console.log(`\n=== UNRESOLVED (${unresolved.length}) ===`);
for (const f of unresolved) {
  const b = stillBroken.find(x => x.id === f.id);
  console.log(`  ${String(f.id).padStart(3)} ${String(f.name).padEnd(26)} sum=${f.wheelSum} (short ${96 - f.wheelSum})  serebii=${b?.serebii}  bulba=${b?.bulba}`);
}

console.log(`\n=== SOURCE DISAGREEMENTS (${disagreements.length}) ===`);
disagreements.slice(0, 20).forEach(d => console.log(`  ${String(d.id).padStart(3)} ${String(d.name).padEnd(24)} ${d.conflicts.join(' | ')}`));
if (disagreements.length > 20) console.log(`  ... and ${disagreements.length - 20} more in data/raw/disagreements.json`);
