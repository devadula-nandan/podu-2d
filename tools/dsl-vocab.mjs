// Extract the exact surface forms the DSL has to parse. Designing the grammar from
// guessed phrasings is how you end up with a compiler that handles 40% of the corpus,
// so every construct below is enumerated from the real clauses.
import { readFile } from 'node:fs/promises';

const corpus = JSON.parse(await readFile('data/raw/clause-corpus.json', 'utf8'));
const dashes = (s) => s.replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-');

// Re-split into atomic clauses exactly as tools/inventory.mjs does.
function splitClauses(text) {
  return dashes(text).replace(/\s+/g, ' ')
    .split(/(?<=[.;])\s+(?=[A-Z(])|\s+(?:Also,|In addition,|And,|Additionally,)\s+/g)
    .map(s => s.trim().replace(/^[,.;*]\s*/, '')).filter(s => s.length > 3);
}
const clauses = corpus.flatMap(c => splitClauses(c.text));
console.log(`clauses: ${clauses.length}\n`);

/** Tally every distinct capture of a regex across the corpus. */
function shapes(label, re, limit = 30) {
  const hits = {};
  for (const c of clauses) for (const m of c.matchAll(re)) {
    const key = (m[1] ?? m[0]).toLowerCase().trim().replace(/\s+/g, ' ');
    hits[key] = (hits[key] || 0) + 1;
  }
  const sorted = Object.entries(hits).sort((a, b) => b[1] - a[1]);
  console.log(`=== ${label} (${sorted.length} distinct) ===`);
  sorted.slice(0, limit).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  if (sorted.length > limit) console.log(`  ... ${sorted.length - limit} more`);
  console.log();
  return sorted;
}

// What gets applied to a target?
shapes('CONDITION APPLICATION verbs', /\b(becomes?|fall[s]? asleep|is|are|gains?|gets?|now has|attach(?:es)?|recovers? from)\b\s+(?:an?\s+)?(?:asleep|burned|frozen|confused|paralyzed|poisoned|noxious)?/gi, 12);
shapes('MARKER attachment', /attach(?:es)?\s+(?:an?\s+)?([A-Za-z ]*?(?:marker|Wait))/gi, 15);
shapes('WAIT forms', /\b(gains? Wait(?: \d+)?|now has Wait(?: \d+)?|must (?:then )?Wait(?: \d+)?|Wait \d+)/gi, 15);

// How are targets named?
shapes('SELECTOR head nouns', /\b((?:this|the|a|an|any|all|one|another|other|your|opposing|opponent's)\s+(?:other\s+)?(?:friendly\s+)?(?:opposing\s+)?Pok[eé]mon)\b/gi, 20);
shapes('SPATIAL qualifiers', /\b(adjacent to [a-z' ]+|within \d+ steps?(?: of [a-z' ]+)?|\d+ steps? away|in a straight line (?:directly )?behind[a-z' ]*|a succession of [a-z' ]+|on the field|on the bench|in (?:your |the )?P\.C\.|in the Ultra Space)/gi, 20);

// Conditionals and spin results
shapes('SPIN-RESULT predicates', /\bspins? (?:a |an )?([A-Za-z-]+(?: Attack)?(?: of \d+ damage or (?:more|higher))?)/gi, 20);
shapes('IF-clause openers', /^(?:if|when|while|until|unless)\s+([a-z' ]{3,40})/gi, 20);
shapes('TIMING phrases', /\b(after (?:the )?battle|before (?:the )?battle|at the start of (?:your |the )?turn|at the end of (?:your |the )?turn|on the next turn|until the end of (?:your )?next turn|during battle)/gi, 15);
shapes('DURATION phrases', /\b(for \d+ turns?|\d+ turns? later|returning to the bench \d+ turns? later|until [a-z' ]{3,40})/gi, 15);

// Movement and displacement
shapes('MOVEMENT verbs', /\b(moves? to (?:the )?(?:bench|a point \d+ steps? away|an open spot)|moves? \d+ steps? away|is knocked \d+ steps? back|switch(?:es)? (?:places? )?with|jumps over|MP moves?|move over|move under|move through)/gi, 20);

// Damage modification
shapes('DAMAGE modifiers', /\b(deals? [+-]?\d+ damage|deals? [x\u00d7]\d+ damage|takes? no damage|damage is multiplied by[a-z ]*|[+-]\d+ damage)/gi, 20);

// Global / aura scoping
shapes('AURA scoping', /\b(while this Pok[eé]mon is on the field|when this Pok[eé]mon is on the field|if this Pok[eé]mon is on the field|this effect does not stack|effects? (?:is|are) nullified)/gi, 15);

// Outcomes
shapes('OUTCOME verbs', /\b(is knocked out|are knocked out|knocks out|is not knocked out|excluded from the duel|temporarily excluded|Mega Evolve|Evolve[sd]?|change form|cannot be|may not|your turn ends|spin again)/gi, 25);
