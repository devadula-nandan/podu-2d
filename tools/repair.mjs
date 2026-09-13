// Serebii keeps every historical wheel as a version tab. For the 22 figures whose
// latest tab is mis-transcribed, parse ALL tabs: a neighbouring tab that sums to 96
// both confirms the real wheel and pinpoints which segment was fat-fingered.
import { readFile, writeFile } from 'node:fs/promises';

const ENTITIES = { eacute: 'é', amp: '&', quot: '"', apos: "'", nbsp: ' ', star: '★', rsquo: '\u2019' };
const decode = (s) => s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
const strip = (h) => decode(h.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const gaps = JSON.parse(await readFile('data/raw/gaps.json', 'utf8'));

/** Parse one version tab into its non-Z segments. */
function parseTab(chunk) {
  const segs = [];
  for (const row of chunk.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)];
    if (cells.length < 5 || cells[0][1] === 'fooevo') continue;
    const size = Number.parseInt(strip(cells[0][2]), 10);
    const name = strip(cells[1][2]);
    if (!Number.isFinite(size) && !name) continue;
    if (Number.isFinite(size) && size >= 96) continue;            // Z-Move
    if (/Z-Move/i.test(strip(cells[2][2]))) continue;
    segs.push({ size: Number.isFinite(size) ? size : null, name, color: strip(cells[2][2]) });
  }
  return segs;
}

const report = [];
for (const g of gaps) {
  const html = await readFile(`tools/cache/${g.slug}.html`, 'utf8');
  const movesDiv = html.slice(html.indexOf('<div id="moves"'));
  const chunks = movesDiv.split(/<li class="tabs[^"]*"/).slice(1);

  const tabs = chunks.map(c => {
    const version = (c.match(/title="([^"]+)"/) || [])[1] ?? '?';
    const segs = parseTab(c);
    return { version, segs, sum: segs.reduce((n, s) => n + (s.size ?? 0), 0) };
  });

  const good = tabs.filter(t => t.sum === 96);
  console.log(`\n=== ${g.id} ${g.name} (latest ${tabs[0]?.version ?? '-'} sums ${g.wheelSum}) ===`);
  if (!tabs.length) { console.log('  NO TABS AT ALL - Serebii has no move data'); report.push({ ...g, repair: null, reason: 'no tabs' }); continue; }
  for (const t of tabs) {
    const flag = t.sum === 96 ? 'OK ' : '   ';
    console.log(`  ${flag}${t.version.padEnd(12)} sum=${String(t.sum).padStart(3)}  ${t.segs.map(s => `${s.size}:${s.name}`).join(' | ')}`);
  }

  if (good.length) {
    // Diff the latest broken tab against the newest sound one to locate the typo.
    const latest = tabs[0], ref = good[0];
    const diffs = [];
    const byName = new Map(ref.segs.map(s => [s.name, s.size]));
    for (const s of latest.segs) {
      const refSize = byName.get(s.name);
      if (refSize !== undefined && refSize !== s.size) diffs.push(`${s.name}: ${s.size} -> ${refSize}`);
      if (refSize === undefined) diffs.push(`${s.name}: ${s.size} -> ABSENT in ${ref.version}`);
    }
    for (const s of ref.segs) if (!latest.segs.some(l => l.name === s.name)) diffs.push(`${s.name}: MISSING in latest (${s.size} in ${ref.version})`);
    console.log(`  => nearest sound tab ${ref.version}; differences: ${diffs.length ? diffs.join('; ') : 'none (identical segment names/sizes)'}`);
    report.push({ ...g, repair: { fromVersion: ref.version, wheel: ref.segs, diffs } });
  } else {
    console.log('  => NO tab sums to 96; needs an external source');
    report.push({ ...g, repair: null, reason: 'no sound tab' });
  }
}

const repairable = report.filter(r => r.repair);
console.log(`\n\n==== SUMMARY ====`);
console.log(`repairable from Serebii history : ${repairable.length}/${report.length}`);
console.log(`still needing another source    : ${report.length - repairable.length}`);
for (const r of report.filter(x => !x.repair)) console.log(`   - ${r.id} ${r.name} (${r.reason})`);
await writeFile('data/raw/repair-candidates.json', JSON.stringify(report, null, 2));
