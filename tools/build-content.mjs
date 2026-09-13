// Turn data/raw into the adjudicated content layer in data/content.
// Every judgement is declared here with its reasoning so it is visible, reviewable
// and trivially reversible - no silent coin-flips buried in the data.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const merged = JSON.parse(await readFile('data/raw/merged-figures.json', 'utf8'));
const plates = JSON.parse(await readFile('data/raw/plates.json', 'utf8'));
const abilities = JSON.parse(await readFile('data/raw/abilities-merged.json', 'utf8'));
await mkdir('data/content', { recursive: true });

// ---------------------------------------------------------------------------
// Adjudication rules
// ---------------------------------------------------------------------------

/**
 * Bulbapedia is the default winner on every contested field. That is not a
 * preference, it is what the evidence showed: it was correct on all six disputed
 * type sets (Serebii had Landorus as Fire/Psychic and Stakataka as Fighting/Ghost,
 * both flatly wrong), it corrects every spelling error, and it carries newer
 * version data in most conflicts. Fields where that reasoning does not settle the
 * matter are listed explicitly below.
 */

/** Type SETS come from Bulbapedia, but ORDER is unreliable in both sources
 *  (Bulbapedia inverts Durant and Toxapex; Serebii inverts Stunfisk), so order is
 *  pinned to the National Dex and must never be load-bearing in engine logic. */
const TYPE_ORDER = {
  284: ['Grass', 'Dragon'],    // Mega Sceptile - Serebii omitted Dragon entirely
  311: ['Ground', 'Electric'], // Stunfisk - Serebii inverted
  315: ['Bug', 'Steel'],       // Durant - Bulbapedia inverted
  433: ['Poison', 'Water'],    // Toxapex - Bulbapedia inverted
  523: ['Rock', 'Steel'],      // Stakataka - Serebii had Fighting/Ghost
  581: ['Ground', 'Flying'],   // Landorus - Serebii had Fire/Psychic
};

/**
 * Rarity CANNOT be derived from cost. It looks tempting - C=250, UC=450, R=1800,
 * EX=4000, UX=5000 covers most of the roster - but tools/check-rarity.mjs shows the
 * relation is one-to-many: R exists at both 1800 and 2700, EX at 3000/4000/6000/8000,
 * UX at 5000/7500/10000, C at 250 and 375. Those look like 1.5x and 2x variant tiers.
 * An earlier version of this file used cost to override rarity and silently rewrote
 * five figures on a pattern that does not hold. Rarity is therefore taken as-is, and
 * genuine conflicts are flagged rather than resolved.
 */

/** Fields with only two witnesses that disagree. Serebii's index and its figure page
 *  always agree with each other, so majority voting is impossible. These take
 *  Bulbapedia by the default rule but are flagged so a single edit flips them. */
const CONTESTED = {
  mp: new Set([44, 179, 279, 315, 523, 542, 543, 566]),
  rarity: new Set([44, 90]),
};

/** Scrafty totals 92/96 identically on Bulbapedia, on live Serebii, and in all 11
 *  Internet Archive snapshots of Serebii from 2019-2024. The deficit is padded with
 *  a Miss: Miss is the neutral outcome so this invents no power, and Scrafty already
 *  carries 4- and 8-unit Miss segments, making a third idiomatic. */
const WHEEL_PATCHES = {
  461: { append: { size: 4, moveName: 'Miss', color: 'miss', damage: null, notes: null },
         reason: 'both sources and 11 archived snapshots agree on 92/96; padded with a neutral Miss' },
};

/**
 * Z-Move colours the sources do not state.
 *
 * Serebii writes a Z-Move's colour as a qualifier on the type cell ("White Z-Move"),
 * which tools/parse-all.mjs resolves. Fourteen rows are labelled bare "Z-Move" with no
 * colour word at all, and one of them survives into the content layer: Pikachu (557)
 * takes its wheel from Serebii, so nothing downstream can recover the colour.
 *
 * 557 Catastropika -> White, on two independent arguments:
 *
 *   1. Bulbapedia's page for the SAME figure id gives Catastropika movecol=white,
 *      power 220 - identical to its sibling Z-Move Gigavolt Havoc on the same figure.
 *      This is not cross-figure inference; it is the second witness to one row, and
 *      the only reason it is not simply used is that 557's wheel is Serebii-sourced.
 *   2. Colour and damage notation are perfectly correlated across all 956 Z-Move
 *      segments: every one of the 172 Purple Z-Moves carries stars, and Serebii
 *      renders stars as &star; glyphs in the damage cell. Catastropika's cell is
 *      empty, so it cannot be Purple. White is the only other colour a Z-Move takes
 *      (719 White, 0 Gold/Blue/Miss), and five White Z-Moves already carry no damage.
 *
 * Confidence: high. The two arguments are independent and agree, and there is no
 * evidence on the other side. The damage value is deliberately NOT patched from
 * Bulbapedia here - this rules on colour only, which is what the engine's
 * colour-comparison step requires.
 */
const Z_MOVE_COLORS = {
  557: {
    moveName: 'Catastropika',
    color: 'white',
    reason:
      'Serebii labels the row bare "Z-Move"; Bulbapedia gives movecol=white for the same figure and move, and an empty damage cell rules out Purple (all 172 Purple Z-Moves carry stars)',
  },
};

// ---------------------------------------------------------------------------

const decisions = [];
const figures = merged.map((f) => {
  const g = structuredClone(f);
  const note = (field, value, reason) => decisions.push({ id: f.id, name: f.name, field, value, reason });

  if (TYPE_ORDER[f.id]) {
    const before = g.types.join('/');
    g.types = TYPE_ORDER[f.id];
    note('types', g.types.join('/'), `National Dex typing (was ${before}); order is not load-bearing`);
  }

  for (const field of ['mp', 'rarity']) {
    if (CONTESTED[field].has(f.id)) {
      g.contested = [...(g.contested ?? []), field];
      note(field, g[field], 'two witnesses disagree and neither can be outvoted; took Bulbapedia by default rule - flagged contested');
    }
  }

  const patch = WHEEL_PATCHES[f.id];
  if (patch && g.wheelSum !== 96) {
    g.wheel = [...g.wheel, patch.append];
    g.wheelSum = g.wheel.reduce((n, s) => n + s.size, 0);
    g.dataComplete = g.wheelSum === 96;
    g.inferred = patch.reason;
    note('wheel', `+${patch.append.size} Miss`, patch.reason);
  }

  const zRule = Z_MOVE_COLORS[f.id];
  if (zRule) {
    const target = g.zMoves.find((s) => s.moveName === zRule.moveName && s.color === null);
    if (target) {
      target.color = zRule.color;
      g.inferred = [g.inferred, `Z-Move "${zRule.moveName}" ruled ${zRule.color}: ${zRule.reason}`]
        .filter(Boolean).join('; ');
      note('zMoveColor', `${zRule.moveName} -> ${zRule.color}`, zRule.reason);
    }
  }

  // Purple segments with no star value cannot be resolved from either source.
  for (const s of g.wheel) {
    if (s.color === 'purple' && s.damage?.kind !== 'stars') {
      g.contested = [...(g.contested ?? []), `stars:${s.moveName}`];
    }
  }
  return g;
});

await writeFile('data/content/figures.json', JSON.stringify(figures, null, 2));
await writeFile('data/content/plates.json', JSON.stringify(plates, null, 2));
await writeFile('data/content/abilities.json', JSON.stringify(abilities, null, 2));
await writeFile('data/content/decisions.json', JSON.stringify(decisions, null, 2));

const byField = decisions.reduce((a, d) => { a[d.field] = (a[d.field] || 0) + 1; return a; }, {});
console.log(`figures written    : ${figures.length}`);
console.log(`  complete wheels  : ${figures.filter(f => f.dataComplete).length}/${figures.length}`);
console.log(`  contested fields : ${figures.filter(f => f.contested?.length).length} figures`);
console.log(`  inferred fields  : ${figures.filter(f => f.inferred).length}`);
console.log(`  colourless Z-Move: ${figures.flatMap(f => f.zMoves).filter(s => s.color === null).length}`);
console.log(`plates written     : ${plates.length}`);
console.log(`abilities written  : ${abilities.length}`);
console.log(`\ndecisions recorded : ${decisions.length}  ${JSON.stringify(byField)}`);
for (const d of decisions) {
  console.log(`  ${String(d.id).padStart(3)} ${String(d.name).padEnd(20)} ${d.field.padEnd(7)} -> ${String(d.value).padEnd(16)} ${d.reason}`);
}
