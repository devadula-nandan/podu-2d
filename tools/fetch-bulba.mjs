// Bulbapedia stores each figure as machine-readable wikitext templates, including
// `prob` (the /96 wheel size), explicit `stars`, and `evostage`. That makes it a
// better primary source than Serebii's hand-typed HTML tables.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';

const UA = { 'User-Agent': 'podu2d-research/1.0' };
const CACHE = 'tools/cache-bulba';
await mkdir(CACHE, { recursive: true });

const api = async (params) => {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://bulbapedia.bulbagarden.net/w/api.php?format=json&${params}`, { headers: UA });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 3) throw e;
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
};

// ---- 1. enumerate the figure category ----
const listPath = `${CACHE}/_titles.json`;
let titles;
try { await access(listPath); titles = JSON.parse(await readFile(listPath, 'utf8')); }
catch {
  titles = [];
  let cont = '';
  do {
    const j = await api(`action=query&list=categorymembers&cmtitle=${encodeURIComponent('Category:Pokémon Duel figures')}&cmlimit=500${cont}`);
    titles.push(...j.query.categorymembers.map(m => m.title));
    cont = j.continue?.cmcontinue ? `&cmcontinue=${encodeURIComponent(j.continue.cmcontinue)}` : '';
  } while (cont);
  titles = titles.filter(t => /\(Duel \d+\)$/.test(t));
  await writeFile(listPath, JSON.stringify(titles, null, 2));
}
console.log(`figure pages in category: ${titles.length}`);

// ---- 2. batch-fetch wikitext, 50 titles per request ----
const wtPath = `${CACHE}/_wikitext.json`;
let store;
try { await access(wtPath); store = JSON.parse(await readFile(wtPath, 'utf8')); console.log('using cached wikitext'); }
catch {
  store = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const j = await api(`action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(batch.join('|'))}`);
    for (const p of Object.values(j.query.pages)) {
      if (p.revisions?.[0]?.slots?.main?.['*']) store[p.title] = p.revisions[0].slots.main['*'];
    }
    console.log(`  fetched ${Math.min(i + 50, titles.length)}/${titles.length}`);
    await new Promise(r => setTimeout(r, 300));
  }
  await writeFile(wtPath, JSON.stringify(store));
}
console.log(`wikitext pages cached: ${Object.keys(store).length}`);

// ---- 3. brace-aware template parsing ----
/**
 * Find every {{name|...}} invocation, brace-matched so nested templates survive.
 * Bulbapedia is inconsistent about capitalising template names ({{DuelAttack}} and
 * {{duelAttack}} both occur) and often puts a newline after the name, so match
 * case-insensitively and tolerate whitespace. Requiring the next meaningful char to
 * be `|` or `}` keeps DuelAttack from swallowing DuelAttack/Header.
 */
function findTemplates(text, name) {
  const out = [];
  const re = new RegExp(`\\{\\{\\s*${name.replace(/\//g, '\\/')}\\s*(?=[|}])`, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    let depth = 0, i = m.index;
    for (; i < text.length; i++) {
      if (text.startsWith('{{', i)) { depth++; i++; }
      else if (text.startsWith('}}', i)) { depth--; i++; if (depth === 0) { i++; break; } }
    }
    out.push({ start: m.index, body: text.slice(m.index + 2, i - 2) });
    re.lastIndex = i;
  }
  return out;
}

/**
 * Return the newest revision of a top-level section. Most pages subdivide into
 * `===Version N===` blocks ordered newest-first, but some (Alakazam) hold the
 * templates directly under the heading with no version split.
 */
function latestSection(wt, heading) {
  const start = wt.search(new RegExp(`^==\\s*${heading}\\s*==\\s*$`, 'mi'));
  if (start === -1) return { body: '', version: null };
  const rest = wt.slice(start).replace(/^==[^=][\s\S]*?$/m, '');
  const nextTop = rest.search(/^==[^=]/m);
  const body = nextTop === -1 ? rest : rest.slice(0, nextTop);
  const parts = body.split(/^===+\s*Version\s*([^=\n]*?)\s*===+\s*$/mi);
  // split() yields [preamble, version1, body1, version2, body2, ...]
  if (parts.length >= 3) return { body: parts[2], version: parts[1].trim() || null };
  return { body, version: null };
}

/** Split a template body on top-level pipes and read key=value params. */
function params(body) {
  const parts = [];
  let depth = 0, link = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith('{{', i)) { depth++; cur += '{{'; i++; continue; }
    if (body.startsWith('}}', i)) { depth--; cur += '}}'; i++; continue; }
    if (body.startsWith('[[', i)) { link++; cur += '[['; i++; continue; }
    if (body.startsWith(']]', i)) { link--; cur += ']]'; i++; continue; }
    if (body[i] === '|' && depth === 0 && link === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  const kv = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) kv[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
  }
  return kv;
}

const ENTITIES = { mdash: '\u2014', ndash: '\u2013', nbsp: ' ', amp: '&', quot: '"',
  star: '★', times: '×', minus: '-', hellip: '…', eacute: 'é', rsquo: '\u2019', lsquo: '\u2018' };

/** Reduce wiki markup and HTML entities in effect text to plain prose. */
const plain = (s) => (s ?? '')
  .replace(/\{\{(?:DL|dl)\|[^|}]*\|([^}]*)\}\}/g, '$1')
  .replace(/\{\{(?:m|p|type|TFG|tb|mp|pkmn)\|([^}]*)\}\}/g, '$1')
  .replace(/\{\{mp\}\}/g, 'MP')
  .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
  .replace(/\[\[([^\]]*)\]\]/g, '$1')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m)
  .replace(/'''?/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Damage notation uses Unicode punctuation: `power=40×` carries U+00D7 MULTIPLICATION
 * SIGN (a repeat-until-miss multiplier), not an ASCII "x". Missing this silently
 * demoted 38 multiplier segments to plain fixed damage.
 */
function parsePower(raw) {
  if (!raw) return null;
  const t = raw.replace(/[\u00D7\u2715\u2716]/g, 'x').replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-').trim();
  const base = parseInt(t, 10);
  if (!Number.isFinite(base)) return { kind: 'unknown', text: raw };
  if (/x$/i.test(t)) return { kind: 'multiplier', base };
  if (/\+$/.test(t)) return { kind: 'variable', base };
  return { kind: 'fixed', base };
}

// Bulbapedia typos are baked into the wikitext, in both the parameter name
// ("moveocl" for "movecol", 4 rows) and the value ("whie" for "white", 4 rows).
const COLOR = { white: 'white', whie: 'white', gold: 'gold', purple: 'purple', blue: 'blue', red: 'miss' };
// Bulbapedia currently writes a bare colour on every row, Z-Move or not, but Serebii
// qualifies Z-Move colours ("White Z-Move") and the two sources copy each other's
// conventions over time. Stripping the qualifier before the lookup costs nothing and
// resolves the colour word wherever it is embedded, including a future "Gold Z-Move".
const colorOf = (p) =>
  COLOR[(p.movecol ?? p.moveocl ?? '').replace(/z-?moves?/gi, '').toLowerCase().trim()] ?? null;

// ---- 4. parse each figure, latest data-disk section only ----
const figures = [], problems = [];
for (const [title, wt] of Object.entries(store)) {
  const id = +(title.match(/\(Duel (\d+)\)/) || [])[1];
  const hdr = params(findTemplates(wt, 'DuelInfobox/Header')[0]?.body ?? '');
  const fig = params(findTemplates(wt, 'DuelInfobox/Figure')[0]?.body ?? '');

  // Abilities are versioned on some pages too (Keldeo has four revisions).
  const abilSection = latestSection(wt, 'Abilities');
  const abilT = findTemplates(abilSection.body, 'DuelAbility')[0] ?? findTemplates(wt, 'DuelAbility')[0];
  const abil = abilT ? params(abilT.body) : null;

  const { body: latest, version } = latestSection(wt, 'Data Disk');

  const seg = (t, isZ) => {
    const p = params(t.body);
    const stars = p.stars ? +p.stars : null;
    return {
      size: p.prob ? +p.prob : (isZ ? 96 : null),
      moveName: plain(p.name),
      jname: p.jname ?? null,
      color: colorOf(p),
      damage: stars ? { kind: 'stars', stars } : parsePower(p.power),
      notes: plain(p.effect) || null,
      isZMove: isZ,
    };
  };

  const wheel = findTemplates(latest, 'DuelAttack').map(t => seg(t, false));
  const zMoves = findTemplates(latest, 'DuelZMove').map(t => seg(t, true));
  const wheelSum = wheel.reduce((n, s) => n + (s.size ?? 0), 0);

  const record = {
    id, title, name: plain(hdr.name) || null,
    form: plain(hdr.form) || null,
    types: [hdr.type, hdr.type2].filter(Boolean)
      .map(t => plain(t)).map(t => t[0].toUpperCase() + t.slice(1).toLowerCase()),
    mp: hdr.mp !== undefined ? +hdr.mp : null,
    rarity: plain(hdr.rarity) || null,
    evoStage: hdr.evostage !== undefined ? +hdr.evostage : null,
    materialCost: (fig.mats ?? hdr.mats) ? +(fig.mats ?? hdr.mats) : null,
    gems: (fig.gems ?? hdr.gems) ? +(fig.gems ?? hdr.gems) : null,
    league: plain(fig.league ?? hdr.league) || null,
    booster: plain(fig.special ?? hdr.special) || null,
    introducedVersion: plain(fig.version ?? hdr.version) || null,
    ability: abil && plain(abil.name) !== 'None'
      ? { name: plain(abil.name), text: plain(abil.effect), jname: abil.jname ?? null } : null,
    diskVersion: version,
    wheel, zMoves, wheelSum,
    dataComplete: wheelSum === 96,
  };
  figures.push(record);
  if (wheelSum !== 96) problems.push({ id, title, wheelSum, segs: wheel.length, version });
}

figures.sort((a, b) => a.id - b.id);
await writeFile('data/raw/bulbapedia-figures.json', JSON.stringify(figures, null, 2));

console.log(`\nparsed figures      : ${figures.length}`);
console.log(`  wheel == 96       : ${figures.filter(f => f.dataComplete).length}`);
console.log(`  dual-typed        : ${figures.filter(f => f.types.length > 1).length}`);
console.log(`  with ability      : ${figures.filter(f => f.ability).length}`);
console.log(`  with evoStage     : ${figures.filter(f => f.evoStage !== null).length}`);
console.log(`  with Z-Move       : ${figures.filter(f => f.zMoves.length).length}`);
console.log(`\nnon-96 (${problems.length}):`);
problems.forEach(p => console.log(`  ${String(p.id).padStart(3)} ${p.title.padEnd(34)} sum=${p.wheelSum} segs=${p.segs} ver=${p.version}`));
