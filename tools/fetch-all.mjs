// Stage 1: cache every Serebii Duel page to disk.
// Fetching is separated from parsing so the parser can be iterated on for free.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const UA = { 'User-Agent': 'Mozilla/5.0 (podu2d research)' };
const CACHE = 'tools/cache';
const CONCURRENCY = 6;

await mkdir(CACHE, { recursive: true });

async function cached(name, url) {
  const path = join(CACHE, name);
  try { await access(path); return { path, hit: true, text: await readFile(path, 'utf8') }; }
  catch { /* miss */ }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length < 2000) throw new Error(`suspiciously short: ${text.length} bytes`);
      await writeFile(path, text, 'utf8');
      return { path, hit: false, text };
    } catch (err) {
      if (attempt === 4) throw new Error(`${url} failed after 4 attempts: ${err.message}`, { cause: err });
      await new Promise(r => setTimeout(r, 500 * attempt ** 2));
    }
  }
}

// Listing pages first; the figure index is also our source of figure URLs.
const index = await cached('_figures-index.html', 'https://www.serebii.net/duel/figures.shtml');
await cached('_plates.html', 'https://www.serebii.net/duel/plates.shtml');
await cached('_abilities.html', 'https://www.serebii.net/duel/abilities.shtml');
await cached('_mechanics.html', 'https://www.serebii.net/duel/mechanics.shtml');

const slugs = [...new Set(
  [...index.text.matchAll(/href="figures\/(\d+-[a-z0-9.'-]+)\.shtml"/gi)].map(m => m[1])
)];
console.log(`figure pages to cache: ${slugs.length}`);

let done = 0, fresh = 0;
const failures = [];
const queue = [...slugs];

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const slug = queue.shift();
    try {
      const r = await cached(`${slug}.html`, `https://www.serebii.net/duel/figures/${slug}.shtml`);
      if (!r.hit) { fresh++; await new Promise(res => setTimeout(res, 120)); }
    } catch (err) {
      failures.push({ slug, error: err.message });
    }
    if (++done % 50 === 0) console.log(`  ${done}/${slugs.length}`);
  }
}));

console.log(`\ncached ${done} pages (${fresh} newly fetched, ${done - fresh} from cache)`);
if (failures.length) {
  console.log(`FAILURES (${failures.length}):`);
  failures.forEach(f => console.log(`  ${f.slug}: ${f.error}`));
} else {
  console.log('no failures - 100% of figure pages cached');
}
await writeFile(join(CACHE, '_slugs.json'), JSON.stringify(slugs, null, 2));
