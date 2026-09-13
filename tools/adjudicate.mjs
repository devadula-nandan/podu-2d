// Gather the evidence needed to settle each source disagreement.
// MP and rarity have THREE independent witnesses - Serebii's index row, Serebii's
// own figure-page header, and Bulbapedia's infobox - so those can be majority-voted.
// Ability-name conflicts are settled by comparing effect TEXT: identical text means a
// rename, divergent text means the ability itself changed between versions.
import { readFile, writeFile } from 'node:fs/promises';

const disagreements = JSON.parse(await readFile('data/raw/disagreements.json', 'utf8'));
const ser = new Map(JSON.parse(await readFile('data/raw/figures.json', 'utf8')).map(f => [f.id, f]));
const bul = new Map(JSON.parse(await readFile('data/raw/bulbapedia-figures.json', 'utf8')).map(f => [f.id, f]));

const decode = (s) => s.replace(/&eacute;/g, 'é').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
const RARITY = { common: 'C', uncommon: 'UC', rare: 'R', ex: 'EX', ux: 'UX' };
const rnorm = (r) => RARITY[(r ?? '').toLowerCase().trim()] ?? (r ?? '').toUpperCase().trim();

/** Re-read MP and rarity straight from Serebii's per-figure page header. */
async function serebiiPage(slug) {
  try {
    const html = await readFile(`tools/cache/${slug}.html`, 'utf8');
    const grab = (label) => {
      const m = html.match(new RegExp(`<b>${label}</b>:\\s*([^<]*)`));
      return m ? decode(m[1]).trim() : null;
    };
    return { mp: Number.parseInt(grab('Movement'), 10), rarity: grab('Rarity'), types: grab('Type') };
  } catch { return { mp: NaN, rarity: null, types: null }; }
}

const out = [];
for (const d of disagreements) {
  const s = ser.get(d.id), b = bul.get(d.id);
  const page = s ? await serebiiPage(s.slug) : { mp: NaN, rarity: null, types: null };

  const entry = {
    id: d.id, name: d.name, conflicts: d.conflicts,
    mp: { serebiiIndex: s?.mp ?? null, serebiiPage: Number.isFinite(page.mp) ? page.mp : null, bulbapedia: b?.mp ?? null },
    rarity: { serebiiIndex: rnorm(s?.rarity), serebiiPage: rnorm(page.rarity), bulbapedia: rnorm(b?.rarity) },
    types: { serebii: s?.types ?? [], bulbapedia: b?.types ?? [] },
    ability: {
      serebii: s?.ability ? { name: s.ability.name, text: s.ability.text } : null,
      bulbapedia: b?.ability ? { name: b.ability.name, text: b.ability.text } : null,
    },
    version: { serebiiWheel: s?.wheelVersion ?? null, bulbapediaDisk: b?.diskVersion ?? null, bulbapediaIntro: b?.introducedVersion ?? null },
  };
  out.push(entry);

  console.log(`\n${'='.repeat(78)}\n${d.id} ${d.name}  [${d.conflicts.join(' | ')}]`);
  const mpVotes = [entry.mp.serebiiIndex, entry.mp.serebiiPage, entry.mp.bulbapedia].filter(v => v !== null);
  if (new Set(mpVotes).size > 1) {
    console.log(`  MP      serebii-index=${entry.mp.serebiiIndex}  serebii-page=${entry.mp.serebiiPage}  bulbapedia=${entry.mp.bulbapedia}`);
  }
  const rVotes = [entry.rarity.serebiiIndex, entry.rarity.serebiiPage, entry.rarity.bulbapedia].filter(Boolean);
  if (new Set(rVotes).size > 1) {
    console.log(`  RARITY  serebii-index=${entry.rarity.serebiiIndex}  serebii-page=${entry.rarity.serebiiPage}  bulbapedia=${entry.rarity.bulbapedia}`);
  }
  if (d.conflicts.some(c => c.startsWith('types'))) {
    console.log(`  TYPES   serebii=[${entry.types.serebii.join(', ')}]  serebii-page="${page.types}"  bulbapedia=[${entry.types.bulbapedia.join(', ')}]`);
  }
  if (d.conflicts.some(c => c.startsWith('ability'))) {
    console.log(`  ABILITY serebii   : "${entry.ability.serebii?.name}"`);
    console.log(`          text      : ${(entry.ability.serebii?.text ?? '').slice(0, 150)}`);
    console.log(`          bulbapedia: "${entry.ability.bulbapedia?.name}"`);
    console.log(`          text      : ${(entry.ability.bulbapedia?.text ?? '').slice(0, 150)}`);
    const a = (entry.ability.serebii?.text ?? '').replace(/\W/g, '').toLowerCase();
    const c = (entry.ability.bulbapedia?.text ?? '').replace(/\W/g, '').toLowerCase();
    console.log(`          => effect text ${a && c ? (a === c ? 'IDENTICAL (pure rename)' : 'DIFFERS (version drift)') : 'unavailable'}`);
  }
  console.log(`  VERSION serebii wheel=${entry.version.serebiiWheel}  bulbapedia disk=${entry.version.bulbapediaDisk}`);
}

await writeFile('data/raw/adjudication-evidence.json', JSON.stringify(out, null, 2));

// Where all three MP/rarity witnesses exist, how often does Serebii's index stand alone?
let pageAgreesBulba = 0;
for (const e of out) {
  const { serebiiIndex, serebiiPage, bulbapedia } = e.mp;
  if ([serebiiIndex, serebiiPage, bulbapedia].every(v => v !== null) && serebiiPage === bulbapedia && serebiiIndex !== bulbapedia) {
    pageAgreesBulba++;
  }
}
console.log(`\n\n${'='.repeat(78)}`);
console.log(`MP conflicts where Serebii's PAGE agrees with Bulbapedia against Serebii's INDEX: ${pageAgreesBulba}`);
