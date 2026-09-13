// Stage 4: the pattern count overstates the work, because 1329 patterns are
// combinations of a far smaller set of primitives, selectors and state vocabulary.
// This pass measures that actual DSL surface area.
import { readFile, writeFile } from 'node:fs/promises';

const corpus = JSON.parse(await readFile('data/raw/clause-corpus.json', 'utf8'));
// Bulbapedia renders "MP −2" with U+2212 MINUS SIGN and uses en/em dashes freely,
// while Serebii uses ASCII hyphens. Unify dashes before any counting or matching.
const dashes = (s) => s.replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-');
const all = corpus.map(c => dashes(c.text));
const blob = all.join('\n');

const tally = (label, probes) => {
  const rows = Object.entries(probes)
    .map(([name, re]) => [name, (blob.match(re) || []).length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  console.log(`\n=== ${label} (${rows.length} distinct) ===`);
  for (const [name, n] of rows) console.log(`  ${String(n).padStart(5)}  ${name}`);
  return Object.fromEntries(rows);
};

const conditions = tally('SPECIAL CONDITIONS', {
  'asleep':    /\b(falls? asleep|becomes? asleep|is asleep|Asleep)\b/gi,
  'burned':    /\bburned\b/gi,
  'confused':  /\bconfused\b/gi,
  'frozen':    /\bfrozen\b/gi,
  'paralyzed': /\bparaly[sz]ed\b/gi,
  'poisoned':  /\bpoisoned\b/gi,
  'noxious/toxic': /\bnoxious\b|\btoxic\b/gi,
  'infatuated':/\binfatuat/gi,
});

const markers = tally('MARKERS', {
  'Cracked':      /\bCracked\b/g,
  'Curse':        /\bCurse\b/g,
  'MP-1':         /\bMP\s?-\s?1\b/g,
  'MP-2':         /\bMP\s?-\s?2\b/g,
  'MP+1':         /\bMP\s?\+\s?1\b/g,
  'Wait':         /\bWait\b/g,
  'Poison marker':/\bPoison marker\b/gi,
  'generic marker':/\bmarker\b/gi,
});

const selectors = tally('TARGET SELECTORS', {
  'battle opponent':          /\bbattle opponent\b/gi,
  'this Pokémon':             /\bthis Pok[eé]mon\b/gi,
  'adjacent to':              /\badjacent\b/gi,
  'within N steps':           /\bwithin \d+ steps?\b/gi,
  'N steps away':             /\b\d+ steps? away\b/gi,
  "within N steps' range":    /\bwithin \d+ steps'? range\b/gi,
  'straight line behind':     /\bstraight line (directly )?behind\b/gi,
  'succession':               /\bsuccession\b/gi,
  'connected':                /\bconnected\b/gi,
  'all opposing Pokémon':     /\ball opposing Pok[eé]mon\b/gi,
  'on the field':             /\bon the field\b/gi,
  'on the bench':             /\bon the bench\b/gi,
  'in the P.C.':              /\bP\.C\.\b/gi,
  'Ultra Space':              /\bUltra Space\b/gi,
  'your entry point':         /\bentry point\b/gi,
  'goal':                     /\bgoal\b/gi,
  'Ultra Beast':              /\bUltra Beast\b/gi,
  'opposing goal-adjacent':   /\bnext to (your|the) goal\b/gi,
});

const primitives = tally('ACTION PRIMITIVES', {
  'spin':                     /\bspins?\b/gi,
  'spin again / respin':      /\bspin again\b/gi,
  'knock out':                /\bknock(s|ed)? out\b/gi,
  'move to bench':            /\bmoves? .{0,30}to the bench\b/gi,
  'move to P.C.':             /\bmoves? .{0,30}to the P\.C\.\b/gi,
  'temporarily excluded':     /\btemporarily excluded\b/gi,
  'damage +N':                /\bdeals? \+\d+ damage\b/gi,
  'damage -N':                /\bdeals? -\d+ damage\b/gi,
  'damage halved':            /\bhalve|half (the|of) .{0,20}damage\b/gi,
  'damage doubled':           /\bdouble.{0,20}damage\b/gi,
  'damage nullified':         /\bdamage is nullified\b/gi,
  'nullify (general)':        /\bnullif/gi,
  'prevent/cannot':           /\bcannot\b/gi,
  'may (optional)':           /\byou may\b/gi,
  'Evolve':                   /\bEvolve|Evolution\b/gi,
  'Mega Evolve':              /\bMega Evolve|Mega Evolved\b/gi,
  'change form':              /\bchange .{0,20}form\b/gi,
  'Z-Move gauge':             /\bZ-Move gauge\b/gi,
  'swap places':              /\bswitch(es)? places\b/gi,
  'knocked back N steps':     /\bknocked back \d+ steps?\b/gi,
  'drawn N steps closer':     /\bdrawn \d+(-\d+)? steps?\b/gi,
  'jump over':                /\bjump over\b/gi,
  'instead of an MP move':    /\binstead of an MP move\b/gi,
  'at the start of your turn':/\bat the start of your turn\b/gi,
  'before using this Pokémon':/\bbefore using this Pok[eé]mon\b/gi,
  'after battle':             /\bafter (the )?battle\b/gi,
  'when knocked out':         /\bwhen this Pok[eé]mon is knocked out\b/gi,
  'cure/remove conditions':   /\bremoves? all special conditions\b/gi,
  'plate lock':               /\bcannot use plates?\b/gi,
  'wheel size change':        /\b(white|purple|gold|blue|miss) attacks?.{0,40}(wider|narrower)\b/gi,
  'becomes type':             /\bbecomes? a .{0,20}-type\b/gi,
  'MP change':                /\bgets? (an? )?MP[-+]\d+\b/gi,
  'turn ends':                /\byour turn ends\b/gi,
});

console.log('\n=== NUMERIC RANGES OBSERVED ===');
const ranges = {};
const rangeProbe = (label, re, cap = 1) => {
  const vals = [...blob.matchAll(re)].map(m => +m[cap]).filter(Number.isFinite);
  const uniq = [...new Set(vals)].sort((a, b) => a - b);
  ranges[label] = uniq;
  console.log(`  ${label.padEnd(26)} ${uniq.join(', ')}`);
};
rangeProbe('Wait N',            /\bWait (\d+)/gi);
rangeProbe('within N steps',    /\bwithin (\d+) steps?/gi);
rangeProbe('N steps away',      /\b(\d+) steps? away/gi);
rangeProbe('damage +N',         /\bdeals? \+(\d+) damage/gi);
rangeProbe('Mega Evolve N turns',/\bMega Evolve it for (\d+) turns?/gi);
rangeProbe('knocked back N',    /\bknocked back (\d+) steps?/gi);
rangeProbe('excluded N turns',  /returning to the bench after (\d+) turns?/gi);

// Which figures/plates have effect text that no primitive probe matched at all?
const unmatched = corpus.filter(c => {
  const t = c.text;
  return !/spin|knock|move|damage|bench|P\.C\.|Wait|marker|condition|burn|confus|froz|paraly|poison|asleep|Evol|form|gauge|plate|MP|step|type|turn ends|nullif/i.test(t);
});
console.log(`\n=== EFFECT TEXTS MATCHING NO KNOWN PRIMITIVE (${unmatched.length}/${corpus.length}) ===`);
unmatched.slice(0, 15).forEach(u => console.log(`  [${u.source}] ${u.text.slice(0, 100)}`));

await writeFile('data/raw/primitive-vocabulary.json',
  JSON.stringify({ conditions, markers, selectors, primitives, ranges, unmatchedCount: unmatched.length }, null, 2));
