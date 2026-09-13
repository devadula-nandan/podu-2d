/**
 * Compiles the wikis' English effect text into DSL clauses.
 *
 * This exists to keep the grammar honest. A hand-written DSL always looks like it fits
 * the data; running it over all 3,863 real clauses and counting what fails to parse is
 * the only way to find out. Anything unrecognised becomes an explicit
 * `unimplemented` node rather than being dropped, so the coverage report cannot
 * flatter itself and the deck builder can refuse the affected figures.
 *
 * The compiler is deliberately not a general parser. The corpus is a closed set of
 * 2,614 texts written by two wikis in a narrow house style, so ordered pattern rules
 * beat a grammar here: they are readable, individually testable, and fail locally.
 */
import type { ClauseId, SegmentColor, SpecialCondition, Zone } from './primitives.js';
import { SPECIAL_CONDITIONS, marker, POKEMON_TYPES, type PokemonType } from './primitives.js';
import type { Filter, Selector, SpinPredicate } from './selectors.js';
import type { Action, Clause, Condition, Duration, Trigger } from './effects.js';

// --- normalisation ----------------------------------------------------------

/**
 * Both wikis use Unicode punctuation inconsistently and Serebii uses different words
 * for identical mechanics. Folding both before parsing removes an entire class of
 * near-miss failure - the dash pass alone was hiding 8x the real MP marker count.
 */
export function normalize(text: string): string {
  return text
    .replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-')
    .replace(/[\u00D7\u2715\u2716]/g, 'x')
    .replace(/[\u2018\u2019]/g, "'")
    // Serebii leaks MediaWiki link templates as "Special Condition|poisoned" - 160
    // occurrences, every one of which hid an otherwise ordinary condition clause.
    .replace(/\b[A-Z][A-Za-z ]{2,20}\|(?=[a-z])/g, '')
    .replace(/\{\{t\|([^}|]+)\}\}/gi, '$1')
    .replace(/\{\{tt\|([^}|]+)\|[^}]*\}\}/gi, '$1')
    .replace(/\bchoose on of\b/gi, 'choose one of')
    .replace(/\bfight-type\b/gi, 'Fighting-type')
    .replace(/opponent'\s+s/gi, "opponent's")
    .replace(/\bfainted\b/gi, 'knocked out')
    .replace(/\bfaints?\b/gi, 'is knocked out')
    .replace(/\bneighbou?r(?:ing|s)?\b/gi, 'adjacent')
    .replace(/\bswitch(es)? places?(?:\s+with)?\b/gi, 'switches with')
    .replace(/\bparalysed\b/gi, 'paralyzed')
    .replace(/\bparlyzed\b/gi, 'paralyzed')
    .replace(/\bopposion\b/gi, 'opposing')
    .replace(/\bopen slot\b/gi, 'open spot')
    .replace(/\bno longer confusion\b/gi, 'no longer confused')
    .replace(/turn end\.s/gi, 'turn ends')
    .replace(/\bdo note stack\b/gi, 'do not stack')
    .replace(/\bevolveit\b/gi, 'evolve it')
    .replace(/\blands of miss\b/gi, 'lands on miss')
    .replace(/\bsharmin\b/gi, 'Shaymin')
    .replace(/\bburne\.d\b/gi, 'burned')
    .replace(/\bda,age\b/gi, 'damage')
    .replace(/\bchoosed\b/gi, 'chosen')
    .replace(/\bmow roton\b/gi, 'Mow Rotom')
    .replace(/\bwithin\s*x\s*[=+]\s*/gi, 'within X+')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Abbreviations containing periods that must not be treated as sentence ends.
 * "P.C." alone appears 108 times and was splitting clauses into fragments like
 * "to the bench" and "after battle" that could never compile.
 */
const ABBREVIATIONS: readonly (readonly [RegExp, string])[] = [
  [/\bP\.C\./g, '\u0001PC\u0001'],
  [/\bMr\./g, '\u0001MR\u0001'],
];

const protect = (s: string): string => ABBREVIATIONS.reduce((acc, [re, tok]) => acc.replace(re, tok), s);
// The U+0001 sentinels are the point: they cannot occur in card text, so they are a
// safe placeholder while sentence splitting runs.
// eslint-disable-next-line no-control-regex
const restore = (s: string): string => s.replace(/\u0001PC\u0001/g, 'P.C.').replace(/\u0001MR\u0001/g, 'Mr.');

/** Split an effect text into atomic clauses on sentence and conjunction boundaries. */
export function splitClauses(text: string): string[] {
  return protect(normalize(text))
    .split(/(?<=[.;])\s+(?=[A-Za-z])|(?<=\))\s+(?=For this turn\b)|(?<=\.\))\s+(?=[A-Z])|\s+(?:Also,|In addition,|And,|Additionally,)\s+|\s+and\s+(?=moves all your)/gi)
    .map((s) => restore(s).trim().replace(/^[,.;*\s]+/, '').replace(/\s*\.$/, ''))
    .filter((s) => s.length > 3);
}

// --- small parsers ----------------------------------------------------------

const num = (s: string | undefined, fallback: number): number => {
  const n = Number.parseInt(s ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const COLOR_WORDS: Record<string, SegmentColor> = {
  white: 'white', gold: 'gold', purple: 'purple', blue: 'blue', miss: 'miss', red: 'miss',
};

const MARKER_ALIASES: Readonly<Record<string, string>> = {
  wait: 'wait',
  cracked: 'cracked',
  curse: 'curse',
  photon: 'photon',
  'final song': 'finalSong',
  branded: 'branded',
  imprisoned: 'imprisoned',
  pumpkin: 'pumpkin',
  'clinging gas': 'clingingGas',
  'weak armor': 'weakArmor',
  symbiont: 'symbiont',
  disguise: 'disguise',
  'forest mischief': 'forestMischief',
  'lock on': 'lockOn',
  'lock-on': 'lockOn',
  charge: 'charge',
  mummy: 'mummy',
  slime: 'slime',
  alchemy: 'alchemy',
};

const MARKER_STOPWORDS = new Set(['the', 'a', 'an', 'this', 'that', 'its', 'their', 'new']);

/** Canonical camelCase marker id, matching `MARKER_DEFINITIONS`. */
export function markerIdFromName(raw: string): ReturnType<typeof marker> {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^attach(?:es)?(?: an?)? /, '');
  const aliased = MARKER_ALIASES[slug];
  if (aliased !== undefined) return marker(aliased);
  const camel = slug.replace(/ ([a-z])/g, (_, c: string) => c.toUpperCase());
  return marker(camel);
}

function isPlausibleMarkerName(name: string): boolean {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (slug.length === 0 || MARKER_STOPWORDS.has(slug)) return false;
  if (MARKER_ALIASES[slug] !== undefined) return true;
  if (/\b(pok|with|while|which|turn|condition|special|any|that|this|has|have)\b/.test(slug)) return false;
  return slug.split(' ').length <= 3;
}

function parseTypes(s: string): PokemonType[] {
  const found: PokemonType[] = [];
  for (const t of POKEMON_TYPES) {
    if (new RegExp(`\\b${t}\\b`, 'i').test(s)) found.push(t);
  }
  return found;
}

/** "a Miss or a White Attack of 120 damage or more" and its simpler cousins. */
export function parseSpinPredicate(raw: string): SpinPredicate {
  const t = raw.toLowerCase();
  const parts: SpinPredicate[] = [];

  for (const m of t.matchAll(/\b(white|gold|purple|blue|miss|red)\b(?:\s+attacks?)?(\s+of\s+(\d+)\s+damage\s+or\s+(?:more|higher|greater))?/g)) {
    const color = COLOR_WORDS[m[1] as string];
    if (!color) continue;
    parts.push(m[3]
      ? { kind: 'damage', colors: [color], op: 'gte', value: num(m[3], 0) }
      : { kind: 'color', colors: [color] });
  }

  const other = t.match(/an?\s+attack\s+other\s+than\s+([a-z' -]+?)\s+is\s+spun/);
  if (other?.[1]) return { kind: 'not', of: { kind: 'move', names: [other[1].trim()] } };

  const notLand = t.match(/until\s+([a-z' -]+?)\s+does\s+not\s+land/);
  if (notLand?.[1]) return { kind: 'move', names: [notLand[1].trim()] };

  const anyDamage = t.match(/an?\s+attack\s+of\s+(\d+)(?:\s+damage)?\s+or\s+(?:more|higher|greater)/);
  if (anyDamage?.[1] && parts.length === 0) {
    return { kind: 'damage', colors: ['white', 'gold'], op: 'gte', value: num(anyDamage[1], 10) };
  }

  if (parts.length === 1) return parts[0] as SpinPredicate;
  if (parts.length > 1) return { kind: 'anyOf', of: parts };
  return { kind: 'any' };
}

/** Spatial and attribute qualifiers trailing a selector's head noun. */
function parseFilters(raw: string): Filter[] {
  const t = raw.toLowerCase();
  const filters: Filter[] = [];

  if (/\bopposing\b|\bopponent's\b/.test(t)) filters.push({ kind: 'allegiance', of: 'opposing' });
  else if (/\byour\b|\bfriendly\b/.test(t)) filters.push({ kind: 'allegiance', of: 'ally' });

  const zones: Zone[] = [];
  if (/\bfield\b/.test(t)) zones.push('field');
  if (/\bbench\b/.test(t)) zones.push('bench');
  if (/\bp\.c\.?\b/.test(t)) zones.push('pc');
  if (/\bultra space\b/.test(t)) zones.push('ultraSpace');
  if (zones.length > 0) filters.push({ kind: 'inZone', zones });

  // Anchored spatial relations. `it` resolves to whatever the clause established.
  const anchor = (s: string | undefined): Selector =>
    /battle opponent/i.test(s ?? '') ? { kind: 'battleOpponent' }
      : /this pok/i.test(s ?? '') ? { kind: 'self' }
      : { kind: 'antecedent' };

  let m: RegExpMatchArray | null;
  if ((m = t.match(/\ba succession of[^,.]*?adjacent to ([a-z' ]+)/))) {
    filters.push({ kind: 'succession', from: anchor(m[1]) });
  } else if ((m = t.match(/\bwithin x\+(\d+) steps/))) {
    filters.push({
      kind: 'within',
      steps: num(m[1], 1),
      of: { kind: 'self' },
      plusZone: 'ultraSpace',
    });
  } else if ((m = t.match(/\bwithin (\d+) steps?(?: of ([a-z' ]+?))?(?:\b|$)/))) {
    filters.push({ kind: 'within', steps: num(m[1], 2), of: anchor(m[2]) });
  } else if ((m = t.match(/\badjacent to ([a-z' ]+)/))) {
    filters.push({ kind: 'adjacentTo', of: anchor(m[1]) });
  } else if (/\badjacent\b/.test(t)) {
    filters.push({ kind: 'adjacentTo', of: { kind: 'self' } });
    if (!zones.length) filters.push({ kind: 'inZone', zones: ['field'] });
  } else if ((m = t.match(/\bin a straight line (?:directly )?behind ([a-z' ]+)/))) {
    filters.push({ kind: 'straightLineBehind', of: anchor(m[1]) });
  } else if ((m = t.match(/\b(\d+) steps? away(?: from ([a-z' ]+))?/))) {
    filters.push({ kind: 'stepsAway', steps: num(m[1], 1), from: anchor(m[2]) });
  }

  const types = parseTypes(t);
  if (types.length && /type|pok/.test(t)) filters.push({ kind: 'hasType', types });

  const cond = SPECIAL_CONDITIONS.filter((c) => new RegExp(`\\b${c}\\b`).test(t));
  if (cond.length) {
    if (/\b(?:that is |that are |and is not )\b/.test(t) && /\bnot\b/.test(t)) {
      filters.push({ kind: 'not', filter: { kind: 'hasCondition', conditions: cond } });
    } else {
      filters.push({ kind: 'hasCondition', conditions: cond });
    }
  }

  if (/\bultra beasts?\b/.test(t)) filters.push({ kind: 'isUltraBeast' });
  if (/\bon your entry point\b/.test(t)) filters.push({ kind: 'atEntryPoint', whose: 'controller' });
  else if (/\bat an entry point\b/.test(t)) filters.push({ kind: 'atEntryPoint' });
  if (/\bmega evolved\b/.test(t)) filters.push({ kind: 'isMegaEvolved', value: !/\bnot\b.*mega evolved/.test(t) });
  if (/\bnewly moved\b|\bmoved this turn\b/.test(t)) filters.push({ kind: 'movedThisTurn', value: true });

  const markerName = t.match(/\b(?:a |an |the )?([a-z]+(?:[ -][a-z]+){0,2}) marker\b/);
  if (markerName?.[1] && isPlausibleMarkerName(markerName[1])) {
    filters.push({ kind: 'hasMarker', marker: markerIdFromName(markerName[1]) });
  } else if (/\b(?:has|have|with) wait\b/.test(t)) {
    filters.push({ kind: 'hasMarker', marker: marker('wait') });
  }

  return filters;
}

/** Species names after "your" / "opposing", so "your Reuniclus" is not every ally. */
function namedFigures(raw: string): string[] {
  const m = raw.match(
    /\b(?:one of )?(?:your|opposing|each|all)\s+(.+?)(?=\s+on the|\s+in the|\s+within|\s+adjacent|\s+that is|\s+and (?:change|mega|evolve|move)|$)/i,
  );
  if (!m?.[1]) {
    const lone = raw.trim().match(/^(?:the|an?)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)$/);
    if (!lone?.[1]) return [];
    const cleaned = lone[1].trim();
    if (/\btype\b|\bpok[eé]mon\b/i.test(cleaned)) return [];
    if (POKEMON_TYPES.some((type) => type.toLowerCase() === cleaned.toLowerCase())) return [];
    return [cleaned];
  }
  const names: string[] = [];
  for (const part of m[1].split(/\s*(?:,|\bor\b|\/)\s*/i)) {
    const cleaned = part.replace(/^(?:an?|the|one)\s+/i, '').replace(/\s*\([^)]*\)/g, '').trim();
    if (!/^[A-Z]/.test(cleaned)) continue;
    if (/\btype\b|\bpok[eé]mon\b/i.test(cleaned)) continue;
    if (POKEMON_TYPES.some((type) => type.toLowerCase() === cleaned.toLowerCase())) continue;
    names.push(cleaned);
  }
  return names;
}

/** The head noun plus its qualifiers, including top-level "A and B" unions. */
export function parseSelector(raw: string): Selector {
  const normalized = normalize(raw).replace(/\s*\.$/, '').trim();
  const t = normalized.toLowerCase();

  // "The battle opponent and opposing Pokemon within 2 steps of it" - 81 clauses.
  const conj = t.match(/^(.*?\bbattle opponent)\s+and\s+(?:the\s+|a\s+)?(.+)$/);
  if (conj?.[1] && conj[2] && /pok|succession/i.test(conj[2])) {
    return { kind: 'union', of: [{ kind: 'battleOpponent' }, parseSelector(conj[2])] };
  }

  // "... other than this Pokemon" - 80 clauses on the adjacency idiom alone.
  const other = t.match(/^(.*?)\s*\(?\bother than this pok[eé]mon\)?\s*(.*)$/);
  if (other?.[1]) {
    return { kind: 'except', from: parseSelector(other[1] + ' ' + (other[2] ?? '')), remove: { kind: 'self' } };
  }
  const otherNamed = normalized.match(/^(.*?)\s+other than ([A-Z][A-Za-z][A-Za-z -]*?)(?:\s+spins?|$)/);
  if (otherNamed?.[1] && otherNamed[2]) {
    return {
      kind: 'except',
      from: parseSelector(otherNamed[1]),
      remove: { kind: 'all', where: [{ kind: 'named', names: [otherNamed[2].trim()] }] },
    };
  }

  if (/^(?:this pok[eé]mon|it)$/.test(t)) return { kind: 'self' };
  if (/^this pok[eé]mon\b/.test(t)) return { kind: 'self' };
  if (/^(?:the |your |its |this pok[eé]mon'?s )?battle opponent\b/.test(t)) return { kind: 'battleOpponent' };
  if (/^your opponent$/.test(t)) return { kind: 'battleOpponent' };
  if (/^(?:it|they|that pok[eé]mon|those pok[eé]mon|the ones)\b/.test(t)) return { kind: 'antecedent' };

  if (/^those that spin|^any that spin|^the ones that spin/.test(t)) {
    return { kind: 'spunResult', match: parseSpinPredicate(t) };
  }

  const filters = parseFilters(t);
  const named = namedFigures(normalized);
  if (named.length > 0) filters.push({ kind: 'named', names: named });
  if (!filters.length && !/pok[eé]mon/.test(t)) return { kind: 'none' };

  // "A/an/one Pokemon ..." is a choice; "all/any/every" is the whole set.
  const choose = t.match(/^(?:choose\s+)?(?:(?:up to )?(one|an?|two|\d+)\b)(?!\s*steps)/);
  const exceptSelf = /\bother\b/.test(t) && /pok/.test(t) && !/other than/.test(t);
  if (choose && !/^all|^any|^every/.test(t)) {
    const word = choose[1] ?? 'one';
    const chosen: Selector = {
      kind: 'choose',
      count: word === 'two' ? 2 : num(word, 1),
      upTo: /up to/.test(t),
      chooser: /\brandom\b/.test(t) ? 'random' : 'controller',
      where: filters,
    };
    return exceptSelf ? { kind: 'except', from: chosen, remove: { kind: 'self' } } : chosen;
  }
  const all: Selector = { kind: 'all', where: filters };
  return exceptSelf ? { kind: 'except', from: all, remove: { kind: 'self' } } : all;
}

// --- action rules -----------------------------------------------------------

const INSTANT: Duration = { kind: 'instant' };

/** A rule maps a recognised phrase to an action. Ordered most specific first. */
interface Rule {
  readonly re: RegExp;
  readonly build: (m: RegExpMatchArray, subject: Selector) => Action | readonly Action[] | null;
}

const RULES: readonly Rule[] = [
  // --- declarative, non-effect clauses --------------------------------------
  // Matched first: these read like effects but are attributes or metadata, and
  // leaving them to fall through inflates the unimplemented count misleadingly.
  { re: /^ultra beasts?$/i, build: () => ({ do: 'tag', tag: 'ultraBeast' }) },
  { re: /^restored pok[eé]mon(?: \(if evolved\))?$/i, build: () => ({ do: 'tag', tag: 'restored' }) },
  { re: /^this (?:effect|ability)'?s? (?:effects? )?does not stack$/i, build: () => ({ do: 'noStack' }) },
  { re: /^this effect does not stack$/i, build: () => ({ do: 'noStack' }) },
  { re: /^(?:you can )?use this pok[eé]mon immediately$/i, build: (_m, subject) => ({ do: 'readyImmediately', target: subject }) },
  { re: /^(?:you may )?use this ability at the start of your turn$/i, build: () => ({ do: 'tag', tag: 'activableStartOfTurn' }) },
  { re: /^neither player's remaining time changes$/i, build: () => ({ do: 'tag', tag: 'preserveClocks' }) },
  {
    re: /until the end of your opponent's next turn, neither player can use time travel/i,
    build: () => ({ do: 'tag', tag: 'lockTimeTravel' }),
  },
  { re: /^this pok[eé]mon is not affected by taunt$/i, build: (_m, subject) => ({
    do: 'prevent',
    target: subject,
    what: 'namedEffect',
    named: 'Taunt',
    duration: { kind: 'untilEndOfDuel' },
  }) },
  {
    re: /negates status effects for your opponent's white attacks/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'gainConditions',
      duration: { kind: 'untilEndOfDuel' },
      fromColor: 'white',
    }),
  },
  {
    re: /add \+(\d+) spin to the spin-again attacks of your pok[eé]mon/i,
    build: (m) => ({
      do: 'bonusRespin',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }] },
      delta: num(m[1], 1),
    }),
  },
  {
    re: /the added damage and number of persistent turns of attack effects of (?:this pok[eé]mon|.*) are multiplied by x\+(\d+)/i,
    build: (m, subject) => ({
      do: 'scaleAttackEffects',
      target: subject,
      plus: num(m[1], 1),
      of: { kind: 'figures', of: { kind: 'all', where: [{ kind: 'inZone', zones: ['ultraSpace'] }] } },
    }),
  },
  {
    re: /(?:instead of an mp move, )?(?:you can )?move (?:this pok[eé]mon|it) through an adjacent electric pok[eé]mon and a succession of electric-type pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'beyondSuccession', types: ['Electric'], chooser: 'controller' },
    }),
  },
  {
    re: /when this pok[eé]mon surrounds an opposing pok[eé]mon, if there are three or more opposing pok[eé]mon on the field or bench with the same name as the surrounded pok[eé]mon is excluded/i,
    build: () => ({
      do: 'exclude',
      target: { kind: 'antecedent' },
      returnTo: null,
      returnAfterTurns: null,
    }),
  },
  {
    re: /if there are three or more opposing pok[eé]mon on the field or (?:on your opponent's )?bench with the same name as the surrounded pok[eé]mon, (?:remove the surrounded pok[eé]mon from the game|the surrounded pok[eé]mon is excluded)/i,
    build: () => ({
      do: 'exclude',
      target: { kind: 'antecedent' },
      returnTo: null,
      returnAfterTurns: null,
    }),
  },
  {
    re: /mega evolution does not end via passage of turns for (?:the|this) pok[eé]mon of the player whose entry point it is/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'isMegaEvolved', value: true },
          { kind: 'ownedByEntryOf', of: { kind: 'self' } },
        ],
      },
      what: 'megaTick',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /your pok[eé]mon do not move to the ultra space from the effects of abilities and attacks of opposing pok[eé]mon/i,
    build: () => ({
      do: 'prevent',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }] },
      what: 'moveToUltraSpace',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /ultra beasts do not move from the ultra space to the field by the effects of abilities or attacks/i,
    build: () => ({
      do: 'prevent',
      target: { kind: 'all', where: [{ kind: 'isUltraBeast' }] },
      what: 'leaveUltraSpace',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /opposing pok[eé]mon cannot use the effect of air balloon to mp move over other pok[eé]mon/i,
    build: () => ({
      do: 'denyNamedGrant',
      movers: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      nameIncludes: 'Air Balloon',
      grant: 'overOthers',
    }),
  },
  {
    re: /opposing pok[eé]mon cannot mp move through a point next to this pok[eé]mon to pass it/i,
    build: (_m, subject) => ({
      do: 'denyAdjacentPass',
      movers: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      around: subject,
    }),
  },
  {
    re: /when this pok[eé]mon leaves the field, it returns to the form it was before it changed forms/i,
    build: (_m, subject) => ({ do: 'revertForm', target: subject }),
  },
  {
    re: /it returns to the form it was before it changed forms/i,
    build: (_m, subject) => ({ do: 'revertForm', target: subject }),
  },
  {
    re: /(?:before battle, )?any effects on the battle opponent that prevent it from being knocked out in battle are negated, and the battle opponent loses any markers with effects that prevent it from being knocked out/i,
    build: () => ({ do: 'stripKoPrevention', target: { kind: 'battleOpponent' } }),
  },
  {
    re: /pok[eé]mon that have battled this pok[eé]mon become (?:grass|{{t\|grass}}) type while they are on the field/i,
    build: () => ({
      do: 'setType',
      target: { kind: 'battleOpponent' },
      types: ['Grass'],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /by an attack, the pok[eé]mon that caused the condition will also become it/i,
    build: () => ({ do: 'copyReceivedCondition', to: { kind: 'battleOpponent' } }),
  },
  {
    re: /the pok[eé]mon that caused the condition will also become it/i,
    build: () => ({ do: 'copyReceivedCondition', to: { kind: 'battleOpponent' } }),
  },
  {
    re: /each player moves one benched pok[eé]mon to its respective entry point/i,
    build: () => [
      {
        do: 'move',
        target: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'opponent',
          where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'inZone', zones: ['bench'] }],
        },
        to: { kind: 'respectiveEntry' },
      },
      {
        do: 'move',
        target: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['bench'] }],
        },
        to: { kind: 'respectiveEntry' },
      },
    ],
  },
  {
    re: /if there is an opponent's pok[eé]mon on your entry point, and this pok[eé]mon is on the bench, at the beginning of your turn, this pok[eé]mon can move next to that pok[eé]mon and battle/i,
    build: (_m, subject) => [
      {
        do: 'select',
        target: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [
            { kind: 'allegiance', of: 'opposing' },
            { kind: 'inZone', zones: ['field'] },
            { kind: 'atEntryPoint', whose: 'controller' },
          ],
        },
        chooser: 'controller',
      },
      { do: 'move', target: subject, to: { kind: 'openSpotAdjacentTo', of: { kind: 'antecedent' }, chooser: 'controller' } },
      { do: 'forceBattle', target: subject, against: { kind: 'antecedent' } },
      {
        do: 'armTrigger',
        target: subject,
        trigger: 'afterBattle',
        when: [{ kind: 'inZone', target: { kind: 'self' }, zones: ['field'] }],
        then: [{ do: 'move', target: { kind: 'self' }, to: { kind: 'zone', zone: 'bench' } }],
        duration: { kind: 'untilEndOfTurn' },
      },
    ],
  },
  {
    re: /this pok[eé]mon can move next to that pok[eé]mon and battle/i,
    build: (_m, subject) => [
      {
        do: 'select',
        target: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [
            { kind: 'allegiance', of: 'opposing' },
            { kind: 'inZone', zones: ['field'] },
            { kind: 'atEntryPoint', whose: 'controller' },
          ],
        },
        chooser: 'controller',
      },
      { do: 'move', target: subject, to: { kind: 'openSpotAdjacentTo', of: { kind: 'antecedent' }, chooser: 'controller' } },
      { do: 'forceBattle', target: subject, against: { kind: 'antecedent' } },
      {
        do: 'armTrigger',
        target: subject,
        trigger: 'afterBattle',
        when: [{ kind: 'inZone', target: { kind: 'self' }, zones: ['field'] }],
        then: [{ do: 'move', target: { kind: 'self' }, to: { kind: 'zone', zone: 'bench' } }],
        duration: { kind: 'untilEndOfTurn' },
      },
    ],
  },
  {
    re: /(?:in (?:this pok[eé]mon'?s )?first battle after moving to the field, )?it can attack pok[eé]mon that are two steps away/i,
    build: (_m, subject) => ({
      do: 'setBattleRange',
      target: subject,
      range: 2,
      duration: { kind: 'untilFirstBattle' },
    }),
  },
  {
    re: /when it does, this pok[eé]mon'?s attacks have range 2/i,
    build: (_m, subject) => ({
      do: 'setBattleRange',
      target: subject,
      range: 2,
      duration: { kind: 'untilFirstBattle' },
    }),
  },
  {
    re: /the blue attacks of your steel pok[eé]mon are not lost from the effects of abilities or z-moves/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'hasType', types: ['Steel'] },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      what: 'recolorAttacks',
      fromColor: 'blue',
      duration: { kind: 'untilFirstBattle' },
    }),
  },
  {
    re: /(?:after its first battle since moving to the field, )?it poisons its battle opponent and each pok[eé]mon that has a special condition/i,
    build: () => [
      { do: 'applyCondition', target: { kind: 'battleOpponent' }, condition: 'poisoned' },
      {
        do: 'applyCondition',
        target: { kind: 'all', where: [{ kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] }, { kind: 'inZone', zones: ['field'] }] },
        condition: 'poisoned',
      },
    ],
  },
  {
    re: /(?:until it engages in its first battle after moving to the field, at the start of your turn, )?(?:this pok[eé]mon )?may move to a point by moving over an adjacent pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'pointStepsAway', steps: 2, chooser: 'controller' },
    }),
  },
  {
    re: /move (?:one of )?your pok[eé]mon in the ultra space or p\.c\. next to (?:this pok[eé]mon|it)/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'inZone', zones: ['ultraSpace', 'pc'] },
        ],
      },
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'self' }, chooser: 'controller' },
    }),
  },
  {
    re: /(?:if this pok[eé]mon is on the field and is not affected by a special condition, )?attack damage-increasing effects on flying battle opponents of your flying-type pok[eé]mon are negated/i,
    build: () => ({
      do: 'nullify',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'hasType', types: ['Flying'] },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      duration: { kind: 'untilEndOfDuel' },
      scope: 'damageModifiers',
      onlyVsAllyTypes: ['Flying'],
    }),
  },
  {
    re: /your pok[eé]mon cannot become affected by special conditions, and your fairy pok[eé]mon that are not affected by a special condition are not knocked out either by attack damage from dragon pok[eé]mon or by knockout-causing attack effects from dark pok[eé]mon/i,
    build: () => [
      {
        do: 'prevent',
        target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }] },
        what: 'gainConditions',
        duration: { kind: 'untilEndOfDuel' },
      },
      {
        do: 'prevent',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'hasType', types: ['Fairy'] },
            { kind: 'not', filter: { kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] } },
          ],
        },
        what: 'beKnockedOut',
        duration: { kind: 'untilEndOfDuel' },
        vsTypes: ['Dragon'],
        vsCause: 'attackDamage',
      },
      {
        do: 'prevent',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'hasType', types: ['Fairy'] },
            { kind: 'not', filter: { kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] } },
          ],
        },
        what: 'instantKoFromAttacks',
        duration: { kind: 'untilEndOfDuel' },
        vsTypes: ['Dark'],
        vsCause: 'attackEffect',
      },
    ],
  },
  {
    re: /your fairy pok[eé]mon that are not affected by a special condition are not knocked out either by attack damage from dragon pok[eé]mon or by knockout-causing attack effects from dark pok[eé]mon/i,
    build: () => [
      {
        do: 'prevent',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'hasType', types: ['Fairy'] },
            { kind: 'not', filter: { kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] } },
          ],
        },
        what: 'beKnockedOut',
        duration: { kind: 'untilEndOfDuel' },
        vsTypes: ['Dragon'],
        vsCause: 'attackDamage',
      },
      {
        do: 'prevent',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'hasType', types: ['Fairy'] },
            { kind: 'not', filter: { kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] } },
          ],
        },
        what: 'instantKoFromAttacks',
        duration: { kind: 'untilEndOfDuel' },
        vsTypes: ['Dark'],
        vsCause: 'attackEffect',
      },
    ],
  },
  {
    re: /until it engages in its first battle after moving to the field, at the start of your turn, this pok[eé]mon may move to a point three steps away/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'pointStepsAway', steps: 3, chooser: 'controller' },
    }),
  },
  {
    re: /is not subject to spin-inducing effects of attacks/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'spinFromAttacks',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /your pok[eé]mon adjacent to (?:this pok[eé]mon|it) are not knocked out by gold attacks from their battle opponents/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'union',
        of: [
          { kind: 'self' },
          {
            kind: 'all',
            where: [
              { kind: 'allegiance', of: 'ally' },
              { kind: 'adjacentTo', of: { kind: 'self' } },
              { kind: 'inZone', zones: ['field'] },
            ],
          },
        ],
      },
      what: 'goldAttackKo',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /your fighting pok[eé]mon and your steel pok[eé]mon are not knocked out by gold attacks/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'hasType', types: ['Fighting', 'Steel'] },
          { kind: 'inZone', zones: ['field'] },
          { kind: 'not', filter: { kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] } },
        ],
      },
      what: 'goldAttackKo',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /(?:it is |this pok[eé]mon is )?not knocked out by gold attacks from its battle opponents/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'goldAttackKo',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /one of your used mega evolution plates becomes usable/i,
    build: () => ({ do: 'refreshPlate', count: 1, player: 'controller', megaOnly: true }),
  },
  {
    re: /for effects that move (?:this pok[eé]mon|it)'?s battle opponent, you decide/i,
    build: (_m, subject) => ({ do: 'seizeMoveEffects', target: subject }),
  },
  {
    re: /deals? \+(\d+) attack damage for each pok[eé]mon in the ultra space/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: {
        kind: 'flatByCount',
        amount: num(m[1], 29),
        of: { kind: 'figures', of: { kind: 'all', where: [{ kind: 'inZone', zones: ['ultraSpace'] }] } },
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /gets? \+(\d+) mp for each pok[eé]mon in the ultra space(?:\s*\(to a maximum of mp\s*(\d+)\))?/i,
    build: (m, subject) => ({
      do: 'modifyMp',
      target: subject,
      delta: num(m[1], 1),
      duration: { kind: 'untilEndOfDuel' },
      of: { kind: 'figures', of: { kind: 'all', where: [{ kind: 'inZone', zones: ['ultraSpace'] }] } },
      ...(m[2] !== undefined ? { cap: num(m[2], 4) } : {}),
    }),
  },
  {
    re: /mp cannot be (\d+) or lower/i,
    build: (m, subject) => ({ do: 'floorMp', target: subject, min: num(m[1], 2) + 1 }),
  },
  {
    re: /any effect of (?:this pok[eé]mon|it)'?s battle opponent'?s ability that would increase attack damage decrease it instead/i,
    build: () => ({
      do: 'invertAbilityIncreases',
      target: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /^(?:mp\s+)?move through other pok[eé]mon on the field/i,
    build: (_m, subject) => ({ do: 'grantMovement', target: subject, grant: 'throughOthers' }),
  },
  {
    re: /^(?:mp\s+)?move past fire pok[eé]mon and burned pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'grantMovement',
      target: subject,
      grant: 'throughOthers',
      over: {
        kind: 'union',
        of: [
          { kind: 'all', where: [{ kind: 'hasType', types: ['Fire'] }, { kind: 'inZone', zones: ['field'] }] },
          { kind: 'all', where: [{ kind: 'hasCondition', conditions: ['burned'] }, { kind: 'inZone', zones: ['field'] }] },
        ],
      },
    }),
  },
  {
    re: /^moves? to the bench$/i,
    build: (_m, subject) => ({ do: 'move', target: subject, to: { kind: 'zone', zone: 'bench' } }),
  },
  {
    re: /^to do so, use (?:this pok[eé]mon|it)$/i,
    build: () => ({ do: 'tag', tag: 'useToActivate' }),
  },
  {
    re: /allows one (?:of )?friendly ([A-Za-z]+) to be chosen/i,
    build: (m) => ({
      do: 'select',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'named', names: [m[1] ?? ''] }],
      },
      chooser: 'controller',
    }),
  },
  {
    re: /opposing paralyzed pok[eé]mon have mp\s*([+-]\s*\d+)/i,
    build: (m) => ({
      do: 'modifyMp',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'hasCondition', conditions: ['paralyzed'] },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      delta: num((m[1] ?? '-1').replace(/\s+/g, ''), -1),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /opposing flying and dragon pok[eé]mon each have mp\s*([+-]\s*\d+)/i,
    build: (m) => ({
      do: 'modifyMp',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'hasType', types: ['Flying', 'Dragon'] },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      delta: num((m[1] ?? '-1').replace(/\s+/g, ''), -1),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the gold attacks of battle opponents of your dragon and psychic pok[eé]mon become white attacks/i,
    build: () => ({
      do: 'recolorAttacks',
      target: { kind: 'battleOpponent' },
      from: 'gold',
      to: 'white',
      except: [],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /gold attacks of battle opponents that have an? mp-reducing marker become white attacks/i,
    build: () => ({
      do: 'recolorAttacks',
      target: { kind: 'all', where: [{ kind: 'hasMpReducer' }, { kind: 'inZone', zones: ['field'] }] },
      from: 'gold',
      to: 'white',
      except: [],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /all gold attacks of battle opponents with mp-reducing markers attached will all be misses/i,
    build: () => ({
      do: 'recolorAttacks',
      target: { kind: 'all', where: [{ kind: 'hasMpReducer' }, { kind: 'inZone', zones: ['field'] }] },
      from: 'gold',
      to: 'miss',
      except: [],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /plates cannot be used on opposing pok[eé]mon next to (?:this pok[eé]mon|it)/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      what: 'usePlates',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /(?:knocked out )?by damage in battle, the next turn will always be yours/i,
    build: () => ({ do: 'forceNextTurn', player: 'controller' }),
  },
  {
    re: /opposing pok[eé]mon cannot tag any other pok[eé]mon/i,
    build: () => ({
      do: 'prevent',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'inZone', zones: ['field'] }] },
      what: 'beTagged',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /opposing pok[eé]mon adjacent to (?:this pok[eé]mon|it) cannot tag or be tagged/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      what: 'beTagged',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /sleeping pok[eé]mon within (\d+) steps of it cannot be tagged/i,
    build: (m) => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'hasCondition', conditions: ['asleep'] },
          { kind: 'within', steps: num(m[1], 2), of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      what: 'beTagged',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the frozen condition of pok[eé]mon within two steps of (?:this pok[eé]mon|it) cannot be removed by tagging/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'hasCondition', conditions: ['frozen'] },
          { kind: 'within', steps: 2, of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      what: 'beTagged',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /choose one pok[eé]mon on the field$/i,
    build: () => ({
      do: 'select',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'inZone', zones: ['field'] }],
      },
      chooser: 'controller',
    }),
  },
  {
    re: /knock that opposing pok[eé]mon out/i,
    build: () => ({ do: 'knockOut', target: { kind: 'antecedent' } }),
  },
  {
    re: /^spin (?:this pok[eé]mon|it|a pok[eé]mon)$/i,
    build: (_m, subject) => ({ do: 'spinCheck', target: subject, then: [] }),
  },
  {
    re: /this effect repeats for each time (?:this pok[eé]mon|it) has evolved/i,
    build: () => ({
      do: 'repeatTimes',
      times: { kind: 'evolutionCount', of: { kind: 'self' } },
      then: [],
    }),
  },
  {
    re: /must mp move as far as its mp range will allow/i,
    build: (_m, subject) => ({ do: 'forceFullMp', target: subject }),
  },
  {
    re: /opposing pok[eé]mon that battle (?:this pok[eé]mon|it) will be paralyzed/i,
    build: () => ({ do: 'applyCondition', target: { kind: 'battleOpponent' }, condition: 'paralyzed' }),
  },
  {
    re: /can(?:no|'?)t be paralyzed/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'gainConditions',
      duration: { kind: 'untilEndOfDuel' },
      conditions: ['paralyzed'],
    }),
  },
  {
    re: /opposing ([a-z]+) and ([a-z]+) pok[eé]mon within (\d+) steps of (?:this pok[eé]mon|it) have mp\s*([+-]\s*\d+)/i,
    build: (m) => {
      const types = [...parseTypes(m[1] ?? ''), ...parseTypes(m[2] ?? '')];
      if (!types.length) return null;
      return {
        do: 'modifyMp',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'opposing' },
            { kind: 'hasType', types },
            { kind: 'within', steps: num(m[3], 2), of: { kind: 'self' } },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        delta: num((m[4] ?? '-1').replace(/\s+/g, ''), -1),
        duration: { kind: 'untilEndOfDuel' },
      };
    },
  },
  {
    re: /^(?:mp\s+)?move over opposing non-flying pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'grantMovement',
      target: subject,
      grant: 'overOthers',
      over: {
        kind: 'except',
        from: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'inZone', zones: ['field'] }] },
        remove: { kind: 'all', where: [{ kind: 'hasType', types: ['Flying'] }] },
      },
    }),
  },
  {
    re: /respin just once/i,
    build: () => ({ do: 'respin', until: { kind: 'any' }, max: 1 }),
  },
  {
    re: /respin x the number of your other ([A-Za-z]+) on the field/i,
    build: (m) => ({
      do: 'repeatFor',
      of: {
        kind: 'except',
        from: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'named', names: [m[1] ?? ''] },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        remove: { kind: 'self' },
      },
      then: [{ do: 'respin', until: { kind: 'any' }, max: 1 }],
    }),
  },
  {
    re: /burned pok[eé]mon have mp\s*\+(\d+) to a maximum of mp\s*(\d+)/i,
    build: (m) => ({
      do: 'modifyMp',
      target: { kind: 'all', where: [{ kind: 'hasCondition', conditions: ['burned'] }, { kind: 'inZone', zones: ['field'] }] },
      delta: num(m[1], 1),
      duration: { kind: 'untilEndOfDuel' },
      cap: num(m[2], 4),
    }),
  },
  {
    re: /your water-type pok[eé]mon and ground-type pok[eé]mon get \+(\d+) ?mp \(up to a maximum of mp\s*(\d+)\)/i,
    build: (m) => ({
      do: 'modifyMp',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'hasType', types: ['Water', 'Ground'] },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      delta: num(m[1], 1),
      duration: { kind: 'untilEndOfDuel' },
      cap: num(m[2], 3),
    }),
  },
  {
    re: /your water-type pok[eé]mon and your ground-type pok[eé]mon deal ([+-]\d+) damage/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'hasType', types: ['Water', 'Ground'] },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      modifier: { kind: 'flat', amount: num(m[1], 10) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /always attack after moving/i,
    build: (_m, subject) => ({ do: 'forceBattle', target: subject }),
  },
  {
    re: /move (?:this pok[eé]mon|it) through an adjacent pok[eé]mon to a point next to that pok/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'openSpotAdjacentTo',
        of: { kind: 'all', where: [{ kind: 'adjacentTo', of: { kind: 'self' } }, { kind: 'inZone', zones: ['field'] }] },
        chooser: 'controller',
      },
    }),
  },
  {
    re: /move an adjacent pok[eé]mon to a point (\d+) steps? away from (?:this pok[eé]mon|it)/i,
    build: (m) => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'adjacentTo', of: { kind: 'self' } }, { kind: 'inZone', zones: ['field'] }],
      },
      to: {
        kind: 'pointWithinSteps',
        min: num(m[1], 3),
        max: num(m[1], 3),
        of: { kind: 'self' },
        chooser: 'controller',
      },
    }),
  },
  {
    re: /move to a point by passing through adjacent pok[eé]mon that have wait/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'openSpotAdjacentTo',
        of: {
          kind: 'all',
          where: [
            { kind: 'adjacentTo', of: { kind: 'self' } },
            { kind: 'hasMarker', marker: marker('wait') },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        chooser: 'controller',
      },
    }),
  },
  {
    re: /those adjacent pok[eé]mon move to the ultra space/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'all',
        where: [
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'hasMarker', marker: marker('wait') },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      to: { kind: 'zone', zone: 'ultraSpace' },
    }),
  },
  {
    re: /move ([a-z, -]+?) pok[eé]mon from your p\.c\. to the bench/i,
    build: (m) => {
      const types = parseTypes(m[1] ?? '');
      if (!types.length) return null;
      return {
        do: 'move',
        target: {
          kind: 'all',
          where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types }, { kind: 'inZone', zones: ['pc'] }],
        },
        to: { kind: 'zone', zone: 'bench' },
      };
    },
  },
  {
    re: /spin for each opposing pok[eé]mon on an entry point/i,
    build: () => ({
      do: 'spinCheck',
      target: {
        kind: 'all',
        where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'atEntryPoint' }],
      },
      then: [],
    }),
  },
  {
    re: /abilities of opposing pok[eé]mon that have a cracked marker are lost/i,
    build: () => ({
      do: 'nullify',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'hasMarker', marker: marker('cracked') },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /not affected by effects of the battle opponent that would apply any markers/i,
    build: () => ({
      do: 'redirectInflictions',
      target: { kind: 'self' },
      to: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /spins when it attacks its battle opponent/i,
    build: (_m, subject) => ({ do: 'spinCheck', target: subject, then: [] }),
  },
  {
    re: /abilities of opposing electric pok[eé]mon and opposing paralyzed pok[eé]mon that allow passing/i,
    build: () => ({
      do: 'denyPassThrough',
      movers: {
        kind: 'union',
        of: [
          {
            kind: 'all',
            where: [
              { kind: 'allegiance', of: 'opposing' },
              { kind: 'hasType', types: ['Electric'] },
              { kind: 'inZone', zones: ['field'] },
            ],
          },
          {
            kind: 'all',
            where: [
              { kind: 'allegiance', of: 'opposing' },
              { kind: 'hasCondition', conditions: ['paralyzed'] },
              { kind: 'inZone', zones: ['field'] },
            ],
          },
        ],
      },
      blockers: {
        kind: 'except',
        from: { kind: 'all', where: [{ kind: 'inZone', zones: ['field'] }] },
        remove: { kind: 'self' },
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /cannot change forms with an ability/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      what: 'changeForm',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /one additional space on the board when moving from the bench/i,
    build: (_m, subject) => ({ do: 'grantMovement', target: subject, grant: 'extraStep' }),
  },
  {
    re: /your pok[eé]mon will be boosted from 0-1 mp to 2 mp, and your opponent's pok[eé]mon will be reduced from 3\+ mp to 2 mp/i,
    build: () => [
      {
        do: 'setMp',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'adjacentTo', of: { kind: 'self' } },
            { kind: 'mp', op: 'lte', value: 1 },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        value: 2,
        duration: { kind: 'untilEndOfDuel' },
      },
      {
        do: 'setMp',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'opposing' },
            { kind: 'adjacentTo', of: { kind: 'self' } },
            { kind: 'mp', op: 'gte', value: 3 },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        value: 2,
        duration: { kind: 'untilEndOfDuel' },
      },
    ],
  },
  {
    re: /protected from instant knock out effects of attacks/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'union',
        of: [
          { kind: 'self' },
          {
            kind: 'all',
            where: [
              { kind: 'allegiance', of: 'ally' },
              { kind: 'adjacentTo', of: { kind: 'self' } },
              { kind: 'inZone', zones: ['field'] },
            ],
          },
        ],
      },
      what: 'instantKoFromAttacks',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /receives a damage boost of \+(\d+)/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: { kind: 'flat', amount: num(m[1], 50) },
      duration: INSTANT,
    }),
  },
  {
    re: /move this pok[eé]mon on the bench next to one of your ([A-Z][A-Za-z]+) on the field/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'openSpotAdjacentTo',
        of: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'named', names: [m[1] ?? ''] },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        chooser: 'controller',
      },
    }),
  },
  {
    re: /^(?:this pok[eé]mon'?s |its )?mp is (\d+)$/i,
    build: (m, subject) => ({
      do: 'setMp',
      target: subject,
      value: num(m[1], 1),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the damage it deals to this pok[eé]mon is reduced by (\d+)/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: { kind: 'battleOpponent' },
      modifier: { kind: 'flat', amount: -num(m[1], 30) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /cannot win you the duel by moving to the goal point but can mp move through other pok/i,
    build: (_m, subject) => [
      { do: 'lockGoal', target: subject, locked: true },
      { do: 'grantMovement', target: subject, grant: 'throughOthers' },
    ],
  },
  {
    re: /effects of energy plates are negated/i,
    build: () => ({
      do: 'nullify',
      target: { kind: 'all', where: [{ kind: 'inZone', zones: ['field'] }] },
      duration: { kind: 'untilEndOfDuel' },
      plateNameIncludes: 'Energy',
    }),
  },
  {
    re: /^(?:it|this pok[eé]mon|that pok[eé]mon) moves to the ultra space(?: outside of the field)?$/i,
    build: (_m, subject) => ({ do: 'move', target: subject, to: { kind: 'zone', zone: 'ultraSpace' } }),
  },
  {
    re: /instead of knocking it out, remove the marker and any special conditions affecting (?:this pok[eé]mon|it)/i,
    build: (_m, subject) => ({ do: 'surviveByClearing', target: subject }),
  },
  {
    re: /can mp move past fire pok[eé]mon and burned pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'grantMovement',
      target: subject,
      grant: 'throughOthers',
      over: {
        kind: 'union',
        of: [
          { kind: 'all', where: [{ kind: 'hasType', types: ['Fire'] }, { kind: 'inZone', zones: ['field'] }] },
          { kind: 'all', where: [{ kind: 'hasCondition', conditions: ['burned'] }, { kind: 'inZone', zones: ['field'] }] },
        ],
      },
    }),
  },
  {
    re: /the battle opponent'?s spins are shifted by one segment clockwise/i,
    build: () => ({
      do: 'rotateWheel',
      target: { kind: 'battleOpponent' },
      segments: 1,
    }),
  },
  {
    re: /its opponents deal ([+-]\d+) attack damage to it/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: { kind: 'battleOpponent' },
      modifier: { kind: 'flat', amount: num(m[1], -20) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /pok[eé]mon that are not poison pok[eé]mon or steel pok[eé]mon deal (\d+) less damage/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: {
        kind: 'except',
        from: { kind: 'all', where: [{ kind: 'inZone', zones: ['field'] }] },
        remove: { kind: 'all', where: [{ kind: 'hasType', types: ['Poison', 'Steel'] }] },
      },
      modifier: { kind: 'flat', amount: -num(m[1], 10) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /it may move to the bench$/i,
    build: (_m, subject) => ({ do: 'move', target: subject, to: { kind: 'zone', zone: 'bench' } }),
  },
  {
    re: /your water pok[eé]mon can mp move through other water-type pok/i,
    build: () => ({
      do: 'grantMovement',
      target: {
        kind: 'all',
        where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types: ['Water'] }, { kind: 'inZone', zones: ['field'] }],
      },
      grant: 'throughOthers',
      over: { kind: 'all', where: [{ kind: 'hasType', types: ['Water'] }, { kind: 'inZone', zones: ['field'] }] },
    }),
  },
  {
    re: /whenever your water pok[eé]mon move from the bench, they may only move to a point one step away from an entry point/i,
    build: () => ({
      do: 'restrictDeploy',
      target: {
        kind: 'all',
        where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types: ['Water'] }],
      },
    }),
  },
  {
    re: /the attack damage dealt to this pok[eé]mon by its opponents is cut in half/i,
    build: () => ({
      do: 'modifyDamage',
      target: { kind: 'battleOpponent' },
      modifier: { kind: 'multiply', factor: 0.5 },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /sleeping opposing pok[eé]mon next to this pok[eé]mon are knocked out/i,
    build: () => ({
      do: 'knockOut',
      target: {
        kind: 'except',
        from: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'opposing' },
            { kind: 'hasCondition', conditions: ['asleep'] },
            { kind: 'adjacentTo', of: { kind: 'self' } },
          ],
        },
        remove: { kind: 'all', where: [{ kind: 'passedThroughBy', of: { kind: 'self' } }] },
      },
    }),
  },
  {
    re: /can switch its position with an adjacent ice pok[eé]mon or frozen pok[eé]mon/i,
    build: () => ({
      do: 'move',
      target: { kind: 'self' },
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [{ kind: 'adjacentTo', of: { kind: 'self' } }, { kind: 'inZone', zones: ['field'] }],
          from: {
            kind: 'union',
            of: [
              { kind: 'all', where: [{ kind: 'hasType', types: ['Ice'] }] },
              { kind: 'all', where: [{ kind: 'hasCondition', conditions: ['frozen'] }] },
            ],
          },
        },
      },
    }),
  },
  {
    re: /can mp move through other pok[eé]mon on the field/i,
    build: (_m, subject) => ({ do: 'grantMovement', target: subject, grant: 'throughOthers' }),
  },
  {
    re: /can mp move from the bench past ghost pok[eé]mon and pok[eé]mon affected by special conditions/i,
    build: (_m, subject) => ({
      do: 'grantMovement',
      target: subject,
      grant: 'throughOthers',
      over: {
        kind: 'union',
        of: [
          { kind: 'all', where: [{ kind: 'hasType', types: ['Ghost'] }, { kind: 'inZone', zones: ['field'] }] },
          { kind: 'all', where: [{ kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] }, { kind: 'inZone', zones: ['field'] }] },
        ],
      },
    }),
  },
  {
    re: /if the battle opponent is an electric pok[eé]mon, the damage it deals to this pok[eé]mon is reduced by (\d+)/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: { kind: 'battleOpponent' },
      modifier: { kind: 'flat', amount: -num(m[1], 20) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /do not attach markers to this pok[eé]mon from the attacks of (?:its )?battle opponents?/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'gainMarkers',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /pok[eé]mon within two steps of this pok[eé]mon are not affected by new special conditions/i,
    build: () => ({
      do: 'prevent',
      target: { kind: 'all', where: [{ kind: 'within', steps: 2, of: { kind: 'self' } }] },
      what: 'gainConditions',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the gold attacks of (?:this pok[eé]mon'?s )?battle opponents become white attacks/i,
    build: () => ({
      do: 'recolorAttacks',
      target: { kind: 'battleOpponent' },
      from: 'gold',
      to: 'white',
      except: [],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /^(?:this pok[eé]mon )?has mp\s*(\d+)$/i,
    build: (m, subject) => ({
      do: 'setMp',
      target: subject,
      value: num(m[1], 1),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /grass pok[eé]mon and fairy pok[eé]mon cannot pass by this pok[eé]mon by means of the effects of their abilities/i,
    build: () => ({
      do: 'denyPassThrough',
      movers: {
        kind: 'all',
        where: [{ kind: 'hasType', types: ['Grass', 'Fairy'] }, { kind: 'inZone', zones: ['field'] }],
      },
      blockers: { kind: 'self' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /battle opponents have the in-battle effects of their abilities nullified/i,
    build: () => ({
      do: 'nullify',
      target: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /mp becomes (\d+) and its blue attacks becomes? misses/i,
    build: (m, subject) => [
      { do: 'setMp', target: subject, value: num(m[1], 3), duration: { kind: 'untilEndOfDuel' } },
      {
        do: 'recolorAttacks',
        target: subject,
        from: 'blue',
        to: 'miss',
        except: [],
        duration: { kind: 'untilEndOfDuel' },
      },
    ],
  },
  {
    re: /move one of your pok[eé]mon in ultra space or one of your solgaleo or lunala next to this pok[eé]mon/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [],
        from: {
          kind: 'union',
          of: [
            { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['ultraSpace'] }] },
            {
              kind: 'all',
              where: [
                { kind: 'allegiance', of: 'ally' },
                { kind: 'named', names: ['Solgaleo', 'Lunala'] },
              ],
            },
          ],
        },
      },
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'self' }, chooser: 'controller' },
    }),
  },
  {
    re: /one bug pok[eé]mon on the field, or one other pok[eé]mon within (\d+) steps, moves? (\d+) steps?/i,
    build: (m) => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [],
        from: {
          kind: 'union',
          of: [
            { kind: 'all', where: [{ kind: 'hasType', types: ['Bug'] }, { kind: 'inZone', zones: ['field'] }] },
            {
              kind: 'except',
              from: {
                kind: 'all',
                where: [{ kind: 'inZone', zones: ['field'] }, { kind: 'within', steps: num(m[1], 3), of: { kind: 'self' } }],
              },
              remove: { kind: 'self' },
            },
          ],
        },
      },
      to: { kind: 'pointStepsAway', steps: num(m[2], 1), chooser: 'controller' },
    }),
  },
  {
    re: /can only be used by its opposing player/i,
    build: () => ({ do: 'tag', tag: 'opposingPlayerMp' }),
  },
  {
    re: /this marker can be removed by tagging/i,
    build: () => ({ do: 'tag', tag: 'tagRemove' }),
  },
  {
    re: /boosted by the amount of any attack damage increases from the battle opponent'?s ability/i,
    build: (_m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: { kind: 'copyAbilityIncreases', from: { kind: 'battleOpponent' } },
      duration: INSTANT,
    }),
  },
  {
    re: /not knocked out by damage from white attacks/i,
    build: (_m, subject) => ({ do: 'surviveByClearing', target: subject, vs: 'whiteDamage' }),
  },
  {
    re: /metal coat effects are lost, and metal coat counts as having been used/i,
    build: () => ({
      do: 'nullifyInUsePlate',
      player: 'opponent',
      exceptMega: false,
      nameIncludes: 'Metal Coat',
    }),
  },
  {
    re: /this does not cause it to return to its previous evolution/i,
    build: () => ({ do: 'tag', tag: 'noDevolve' }),
  },
  {
    re: /(?:if any )?sphere plates have been used on the battle opponent, then this pok[eé]mon also gains those effects/i,
    build: (_m, subject) => ({
      do: 'copyPlateEffects',
      target: subject,
      from: { kind: 'battleOpponent' },
      nameIncludes: 'Sphere',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /moves? one opposing pok[eé]mon (?:that is )?in the ultra space to a point of your choosing on the field/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'inZone', zones: ['ultraSpace'] }],
      },
      to: { kind: 'anyOpenField', chooser: 'controller' },
    }),
  },
  {
    re: /this pok[eé]mon moves to the ultra space outside of the field and one of your pok[eé]mon that is in the ultra space moves to a point (\d+) or (\d+) steps? away/i,
    build: (m) => [
      {
        do: 'move',
        target: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['ultraSpace'] }],
        },
        to: {
          kind: 'pointWithinSteps',
          min: Math.min(num(m[1], 2), num(m[2], 3)),
          max: Math.max(num(m[1], 2), num(m[2], 3)),
          of: { kind: 'self' },
          chooser: 'controller',
        },
      },
      { do: 'move', target: { kind: 'self' }, to: { kind: 'zone', zone: 'ultraSpace' } },
    ],
  },
  {
    re: /an opposing pok[eé]mon within x\+(\d+) steps spins/i,
    build: (m) => ({
      do: 'spinCheck',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'inZone', zones: ['field'] },
          { kind: 'within', steps: num(m[1], 1), of: { kind: 'self' }, plusZone: 'ultraSpace' },
        ],
      },
      then: [],
    }),
  },
  {
    re: /any opposing pok[eé]mon with a marker that reduces mp is now burned/i,
    build: () => ({
      do: 'applyCondition',
      target: {
        kind: 'all',
        where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'hasMpReducer' }],
      },
      condition: 'burned',
    }),
  },
  {
    re: /force them to respin/i,
    build: () => ({ do: 'respin', until: { kind: 'any' }, max: 1, forced: true, who: 'opponent', oncePerTurn: true }),
  },
  {
    re: /route move to a point that is three steps? away and adjacent to an opponent'?s pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'route',
        minSteps: 3,
        maxSteps: 3,
        straight: false,
        adjacentTo: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'inZone', zones: ['field'] }] },
        chooser: 'controller',
      },
    }),
  },
  {
    re: /route move to a point (\d+)\s*[-\u2013]\s*(\d+) steps? away in a straight line/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'route',
        minSteps: Math.min(num(m[1], 1), num(m[2], 4)),
        maxSteps: Math.max(num(m[1], 1), num(m[2], 4)),
        straight: true,
        chooser: 'controller',
      },
    }),
  },
  {
    re: /when moving this pok[eé]mon from the bench, it can only move to one space away from the entry point/i,
    build: (_m, subject) => ({ do: 'restrictDeploy', target: subject }),
  },
  {
    re: /will move back to the bench/i,
    build: (_m, subject) => ({ do: 'move', target: subject, to: { kind: 'zone', zone: 'bench' } }),
  },
  {
    re: /any opposing pok[eé]mon that has used an mp move to move next to this pok[eé]mon must attack it/i,
    build: () => ({
      do: 'forceBattle',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'movedThisTurn', value: true },
        ],
      },
      against: { kind: 'self' },
    }),
  },
  {
    re: /counts as having already battled/i,
    build: () => ({ do: 'markBattled' }),
  },
  {
    re: /opposing ghost pok[eé]mon cannot use the effect of an ability to pass through your dark pok[eé]mon/i,
    build: () => ({
      do: 'denyPassThrough',
      movers: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'hasType', types: ['Ghost'] }] },
      blockers: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types: ['Dark'] }] },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /loses any ability effects that allow it to mp move through other pok[eé]mon/i,
    build: () => ({
      do: 'denyPassThrough',
      movers: { kind: 'battleOpponent' },
      blockers: {
        kind: 'except',
        from: { kind: 'all', where: [{ kind: 'inZone', zones: ['field'] }] },
        remove: { kind: 'battleOpponent' },
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /can move to your goal point instead of making an? mp move/i,
    build: (_m, subject) => [
      { do: 'move', target: subject, to: { kind: 'goal' } },
      { do: 'endTurn' },
    ],
  },
  {
    re: /moves? (\d+) spaces? away/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'pointStepsAway', steps: num(m[1], 1), chooser: 'controller' },
    }),
  },
  {
    re: /pok[eé]mon next to this pok[eé]mon cannot move using the effects of (?:moves|attacks), abilities,? or energy/i,
    build: () => ({
      do: 'prevent',
      target: { kind: 'all', where: [{ kind: 'adjacentTo', of: { kind: 'self' } }, { kind: 'inZone', zones: ['field'] }] },
      what: 'beMoved',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /markers from the attacks of the battle opponent cannot be attached/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'gainMarkers',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /frozen pok[eé]mon next to this pok[eé]mon cannot be tagged/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'hasCondition', conditions: ['frozen'] },
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      what: 'beTagged',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the (?:asleep|sleep) condition is not removed by the effects of (?:other )?abilities/i,
    build: () => ({
      do: 'prevent',
      target: { kind: 'all', where: [] },
      what: 'loseConditions',
      conditions: ['asleep'],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /your opponent'?s spins are shifted by two segments? in a clockwise direction/i,
    build: () => ({
      do: 'rotateWheel',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      segments: 2,
    }),
  },
  {
    re: /your ([a-z]+(?:-type)? pok[eé]mon) gains? (?:a )?\+(\d+)\s*[★*]/i,
    build: (m) => ({
      do: 'modifyStars',
      target: parseSelector(`your ${m[1] ?? 'Psychic Pokémon'}`),
      delta: num(m[2], 1),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the gold attacks of pok[eé]mon within (\d+) steps of this pok[eé]mon become white attacks/i,
    build: (m) => ({
      do: 'recolorAttacks',
      target: {
        kind: 'all',
        where: [{ kind: 'inZone', zones: ['field'] }, { kind: 'within', steps: num(m[1], 2), of: { kind: 'self' } }],
      },
      from: 'gold',
      to: 'white',
      except: [],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /move this pok[eé]mon to a spot next to an adjacent grass pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'openSpotAdjacentTo',
        of: {
          kind: 'all',
          where: [
            { kind: 'hasType', types: ['Grass'] },
            { kind: 'adjacentTo', of: { kind: 'self' } },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        chooser: 'controller',
      },
    }),
  },
  {
    re: /move this pok[eé]mon to a spot adjacent to any of them/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'openSpotAdjacentTo',
        of: {
          kind: 'all',
          where: [
            { kind: 'hasType', types: ['Grass'] },
            { kind: 'inZone', zones: ['field'] },
            {
              kind: 'succession',
              from: {
                kind: 'all',
                where: [
                  { kind: 'hasType', types: ['Grass'] },
                  { kind: 'adjacentTo', of: { kind: 'self' } },
                ],
              },
            },
          ],
        },
        chooser: 'controller',
      },
    }),
  },
  {
    re: /^\(this effect is not cumulative\.?\)$/i,
    build: () => ({ do: 'noStack' }),
  },
  {
    re: /(?:mp\s+)?move over pok[eé]mon on the field that don't have soar/i,
    build: (_m, subject) => ({ do: 'grantMovement', target: subject, grant: 'overOthers' }),
  },
  {
    re: /one pok[eé]mon within (\d+) steps'? range is drawn (\d+)[-–](\d+) steps closer to this pok[eé]mon(?: and (?:is given an? mp\s*([+-]?\d+) marker|gains wait))?/i,
    build: (m) => {
      const move = {
        do: 'move' as const,
        target: {
          kind: 'choose' as const,
          count: 1,
          upTo: false,
          chooser: 'controller' as const,
          where: [
            { kind: 'inZone' as const, zones: ['field' as const] },
            { kind: 'within' as const, steps: num(m[1], 3), of: { kind: 'self' as const } },
          ],
        },
        to: {
          kind: 'drawCloser' as const,
          min: Math.min(num(m[2], 1), num(m[3], 2)),
          max: Math.max(num(m[2], 1), num(m[3], 2)),
          toward: { kind: 'self' as const },
          chooser: 'controller' as const,
        },
      };
      const given = (m[4] ?? '').replace(/\s+/g, '');
      if (given.length > 0) {
        return [move, { do: 'modifyMp', target: { kind: 'antecedent' }, delta: num(given, -1), duration: INSTANT }];
      }
      if (/gains wait/i.test(m[0])) {
        return [move, {
          do: 'attachMarker',
          target: { kind: 'antecedent' },
          marker: marker('wait'),
          value: null,
          duration: INSTANT,
        }];
      }
      return move;
    },
  },
  {
    re: /the attack that is spun takes the place of this attack/i,
    build: (_m, subject) => ({
      do: 'replaceSegment',
      target: subject,
      moveName: '*spun*',
      duration: INSTANT,
    }),
  },
  {
    re: /return as many plates as were switched/i,
    build: () => ({
      do: 'armTrigger',
      target: { kind: 'self' },
      trigger: 'onLeaveField',
      when: [],
      then: [{ do: 'refreshPlate', count: 0, player: 'opponent', accounted: true }],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /attack an opposing pok[eé]mon again/i,
    build: () => ({ do: 'grantExtraBattle' }),
  },
  {
    re: /this pok[eé]mon and optionally the opponent pok[eé]mon may respin one time/i,
    build: () => [
      { do: 'respin', until: { kind: 'any' }, max: 1, who: 'self' },
      { do: 'optional', chooser: 'controller', then: [{ do: 'respin', until: { kind: 'any' }, max: 1, who: 'opponent' }] },
    ],
  },
  {
    re: /both pok[eé]mon spin twice/i,
    build: () => ({ do: 'respin', until: { kind: 'any' }, max: 1, forced: true, who: 'both' }),
  },
  {
    re: /^(?:it misses|spins the same attack both times, it misses)$/i,
    build: () => ({
      do: 'replaceSegment',
      target: { kind: 'battleOpponent' },
      moveName: 'Miss',
      duration: INSTANT,
    }),
  },
  {
    re: /switch(?:es)? (.+?) for (?:one of )?(your|the opponent's|an opposing) pok[eé]mon on the field, bench, or in a p\.c/i,
    build: (m) => {
      const raw = (m[1] ?? '').trim();
      const yours = /your/i.test(m[2] ?? '');
      const target = /this pok/i.test(raw) ? { kind: 'self' as const }
        : /battle opponent/i.test(raw) ? { kind: 'battleOpponent' as const }
        : parseSelector(raw);
      return {
        do: 'move',
        target,
        to: {
          kind: 'swapWith',
          with: {
            kind: 'choose',
            count: 1,
            upTo: false,
            chooser: 'controller',
            where: [
              { kind: 'allegiance', of: yours ? 'ally' : 'opposing' },
              { kind: 'inZone', zones: ['field', 'bench', 'pc'] },
            ],
          },
        },
      };
    },
  },
  {
    re: /switch(?:es)? with one of your pok[eé]mon on the field, bench, or in a p\.c/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'inZone', zones: ['field', 'bench', 'pc'] },
          ],
        },
      },
    }),
  },
  {
    re: /(?:may be |be )?moved within (?:their|its) mp range/i,
    build: (m) => {
      const head = m.input?.slice(0, m.index).replace(/^(?:you\s+)?(?:may|can)\s+/i, '').trim() ?? '';
      const target = head.length > 0 ? parseSelector(head) : { kind: 'antecedent' as const };
      return {
        do: 'move',
        target,
        to: { kind: 'withinMpRange', chooser: 'controller' },
      };
    },
  },
  {
    re: /move one of your ([A-Z][A-Za-z]+) on the field next to this pok[eé]mon/i,
    build: (m) => ({
      do: 'move',
      target: parseSelector(`one of your ${m[1] ?? ''} on the field`),
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'self' }, chooser: 'controller' },
    }),
  },
  {
    re: /move one pok[eé]mon that is on your bench within its mp range/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['bench'] }],
      },
      to: { kind: 'withinMpRange', chooser: 'controller' },
    }),
  },
  { re: /^\+(\d+) damage$/i, build: (m, subject) => ({ do: 'modifyDamage', target: subject, modifier: { kind: 'flat', amount: num(m[1], 0) }, duration: INSTANT }) },
  {
    re: /switch(?:es)? this pok[eé]mon with another pok[eé]mon on the field$/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [{ kind: 'inZone', zones: ['field'] }],
        },
      },
    }),
  },
  {
    re: /move (?:the|this) pok[eé]mon adjacent to the battle opponent \(excluding this one\) to (?:their|the) bench/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'except',
        from: { kind: 'all', where: [{ kind: 'adjacentTo', of: { kind: 'battleOpponent' } }] },
        remove: { kind: 'self' },
      },
      to: { kind: 'zone', zone: 'bench' },
    }),
  },
  {
    re: /this attack'?s damage is cut in half/i,
    build: (_m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: { kind: 'multiply', factor: 0.5 },
      duration: INSTANT,
    }),
  },
  {
    re: /spin for adjacent opposing pok[eé]mon/i,
    build: () => ({
      do: 'spinCheck',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      then: [],
    }),
  },
  {
    re: /any attacks spun become misses/i,
    build: () => ({
      do: 'replaceSegment',
      target: { kind: 'spunResult', match: { kind: 'any' } },
      moveName: 'Miss',
      duration: { kind: 'untilEndOfNextTurn' },
    }),
  },
  {
    re: /this pok[eé]mon moves to the point the battle opponent was on/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'vacatedBy', of: { kind: 'battleOpponent' } },
    }),
  },
  {
    re: /move the battle opponent and opposing pok[eé]mon adjacent to the battle opponent to (?:their |the )?(p\.c\.?|pc|bench)/i,
    build: (m) => ({
      do: 'move',
      target: parseSelector('the battle opponent and opposing Pokémon adjacent to the battle opponent'),
      to: { kind: 'zone', zone: /bench/i.test(m[1] ?? '') ? 'bench' : 'pc' },
    }),
  },
  {
    re: /the dodges of opposing pok[eé]mon adjacent to this pok[eé]mon becomes? misses/i,
    build: () => ({
      do: 'replaceSegment',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'adjacentTo', of: { kind: 'self' } },
        ],
      },
      moveName: 'Miss',
      replaces: 'Dodge',
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /any pok[eé]mon adjacent to this pok[eé]mon will do \+(\d+) damage/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: {
        kind: 'all',
        where: [{ kind: 'adjacentTo', of: { kind: 'self' } }, { kind: 'inZone', zones: ['field'] }],
      },
      modifier: { kind: 'flat', amount: num(m[1], 10) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the damage that this pok[eé]mon deals is increased by (\d+) for each water pok[eé]mon in either player'?s p\.c/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: {
        kind: 'flatByCount',
        amount: num(m[1], 10),
        of: {
          kind: 'figures',
          of: { kind: 'all', where: [{ kind: 'inZone', zones: ['pc'] }, { kind: 'hasType', types: ['Water'] }] },
        },
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /(?:can )?mp move past burned pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'grantMovement',
      target: subject,
      grant: 'throughOthers',
      over: { kind: 'all', where: [{ kind: 'hasCondition', conditions: ['burned'] }] },
    }),
  },
  {
    re: /^this pok[eé]mon cannot battle$/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'attack',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /all poisoned and noxious pok[eé]mon have mp\s*([+-]?\d+)/i,
    build: (m) => ({
      do: 'modifyMp',
      target: { kind: 'all', where: [{ kind: 'hasCondition', conditions: ['poisoned', 'noxious'] }] },
      delta: num((m[1] ?? '-1').replace(/\s+/g, ''), -1),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /your opponent'?s dark(?:-type)? pok[eé]mon will do ([+-]?\d+) damage/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'hasType', types: ['Dark'] },
        ],
      },
      modifier: { kind: 'flat', amount: num((m[1] ?? '-10').replace(/\s+/g, ''), -10) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /cannot pass by this pok[eé]mon nor a continuous succession of your pok[eé]mon adjacent to it/i,
    build: () => ({
      do: 'denyPassThrough',
      movers: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      blockers: {
        kind: 'all',
        where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'succession', from: { kind: 'self' } }],
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /(?:it will )?shift(?:s)? (?:the spin )?to an attack next to it instead/i,
    build: (_m, subject) => ({
      do: 'shiftSpinResult',
      target: subject,
      until: { kind: 'not', of: { kind: 'color', colors: ['miss'] } },
      duration: INSTANT,
    }),
  },
  {
    re: /if this pok[eé]mon has evolved, and its attack lands on miss, it will shift to an attack next to it instead/i,
    build: (_m, subject) => ({
      do: 'shiftSpinResult',
      target: subject,
      until: { kind: 'not', of: { kind: 'color', colors: ['miss'] } },
      duration: INSTANT,
    }),
  },
  {
    re: /(?:all of )?(?:this pok[eé]mon'?s )?white attacks become gold attacks/i,
    build: (_m, subject) => ({
      do: 'recolorAttacks',
      target: subject,
      from: 'white',
      to: 'gold',
      except: [],
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /^(?:it |this pok[eé]mon )?must attack(?: if able)?$/i,
    build: (_m, subject) => ({ do: 'forceBattle', target: subject }),
  },
  {
    re: /any pok[eé]mon adjacent to it, except for flying pok[eé]mon, will be unable to use mp move/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'except',
        from: { kind: 'all', where: [{ kind: 'adjacentTo', of: { kind: 'self' } }, { kind: 'inZone', zones: ['field'] }] },
        remove: { kind: 'all', where: [{ kind: 'hasType', types: ['Flying'] }] },
      },
      what: 'mpMove',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /your opponent will be unable to use plates/i,
    build: () => ({
      do: 'prevent',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      what: 'usePlates',
      duration: { kind: 'untilEndOfNextTurn' },
    }),
  },
  {
    re: /^spin this pok[eé]mon$/i,
    build: (_m, subject) => ({ do: 'spinCheck', target: subject, then: [] }),
  },
  {
    re: /pok[eé]mon that have pumpkin markers are also knocked out/i,
    build: () => ({
      do: 'knockOut',
      target: { kind: 'all', where: [{ kind: 'hasMarker', marker: marker('pumpkin') }] },
    }),
  },
  {
    re: /its form changes to shield forme/i,
    build: (_m, subject) => ({ do: 'changeForm', target: subject, into: ['Shield Forme'] }),
  },
  {
    re: /gold attacks of battle opponents of this pok[eé]mon become white attacks/i,
    build: () => ({
      do: 'recolorAttacks',
      target: { kind: 'battleOpponent' },
      from: 'gold',
      to: 'white',
      except: [],
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /opposing pok[eé]mon moved over in this way are now burned/i,
    build: () => ({
      do: 'applyCondition',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'passedThroughBy', of: { kind: 'self' } },
        ],
      },
      condition: 'burned',
    }),
  },
  {
    re: /if a battle opponent uses an attack that attaches a marker or causes a special condition, that effect will be caused on the battle opponent instead/i,
    build: () => ({
      do: 'redirectInflictions',
      target: { kind: 'self' },
      to: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfTurn' },
    }),
  },


  {
    re: /moves? one pok[eé]mon that is both adjacent to this pok[eé]mon and not its battle opponent to a point (\w+) steps? away/i,
    build: (m) => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      to: { kind: 'pointStepsAway', steps: /three/i.test(m[1] ?? '') ? 3 : num(m[1], 3), chooser: 'controller' },
    }),
  },
  {
    re: /the selected pok[eé]mon and opposing pok[eé]mon with the same name have no abilities/i,
    build: () => ({
      do: 'nullify',
      target: {
        kind: 'union',
        of: [
          { kind: 'antecedent' },
          { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'sameNameAs', of: { kind: 'antecedent' } }] },
        ],
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /a random pok[eé]mon on your bench other than ([A-Z][A-Za-z]+) spins/i,
    build: (m) => ({
      do: 'spinCheck',
      target: {
        kind: 'except',
        from: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'random',
          where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['bench'] }],
        },
        remove: { kind: 'all', where: [{ kind: 'named', names: [m[1] ?? 'Liepard'] }] },
      },
      then: [],
    }),
  },
  {
    re: /^(?:a pok[eé]mon that is knocked out in this condition is excluded from the duel)$/i,
    build: () => ({ do: 'exclude', target: { kind: 'antecedent' }, returnTo: null, returnAfterTurns: null }),
  },
  {
    re: /can move up to (\d+) steps? in a straight line/i,
    build: (m, subject) => ({ do: 'grantStraightMp', target: subject, steps: num(m[1], 2) }),
  },
  {
    re: /cannot enter the field using an mp move/i,
    build: (_m, subject) => ({ do: 'denyDeploy', target: subject }),
  },
  {
    re: /any effects of (?:its |the )?battle opponent'?s ability that would increase damage decrease that damage instead/i,
    build: () => ({
      do: 'invertAbilityIncreases',
      target: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfNextTurn' },
    }),
  },
  {
    re: /cannot move by effects other than the attacks?(?: effects)? of (?:this|those) pok[eé]mon/i,
    build: () => ({
      do: 'restrictMoves',
      target: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /the marker and any special conditions (?:on|affecting) (?:this pok[eé]mon|the pok[eé]mon|it) are removed instead of it being knocked out/i,
    build: (_m, subject) => ({ do: 'surviveByClearing', target: subject }),
  },
  {
    re: /(?:are|is) treated as though they have newly moved/i,
    build: () => ({
      do: 'treatAsNewlyMoved',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'isUltraBeast' }, { kind: 'inZone', zones: ['field'] }] },
    }),
  },
  {
    re: /(?:this pok[eé]mon'?s )?type becomes the type of the chosen pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'copyType',
      target: subject,
      from: { kind: 'antecedent' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /repeat this effect for each pok[eé]mon in the ultra space/i,
    build: () => ({
      do: 'repeatFor',
      of: { kind: 'all', where: [{ kind: 'inZone', zones: ['ultraSpace'] }] },
      then: [],
    }),
  },
  {
    re: /(?:this pok[eé]mon'?s )?([A-Z][A-Za-z' -]+?) gains? \+(\d+) damage for each pok[eé]mon in your p\.c/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      named: (m[1] ?? '').trim(),
      modifier: {
        kind: 'flatByCount',
        amount: num(m[2], 20),
        of: {
          kind: 'figures',
          of: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['pc'] }] },
        },
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /move (one other .+?) to a point not more than (\d+) or (\d+) steps? away/i,
    build: (m) => ({
      do: 'move',
      target: parseSelector(m[1] ?? ''),
      to: {
        kind: 'pointWithinSteps',
        min: Math.min(num(m[2], 1), num(m[3], 2)),
        max: Math.max(num(m[2], 1), num(m[3], 2)),
        of: { kind: 'self' },
        chooser: 'controller',
      },
    }),
  },
  {
    re: /they will (?:faint|be knocked out)/i,
    build: () => ({
      do: 'knockOut',
      target: { kind: 'all', where: [{ kind: 'passedThroughBy', of: { kind: 'self' } }] },
    }),
  },
  { re: /^this effect is not cumulative$/i, build: () => ({ do: 'noStack' }) },
  {
    re: /(?:this pok[eé]mon|it) is eliminated from the duel/i,
    build: (_m, subject) => ({ do: 'exclude', target: subject, returnTo: null, returnAfterTurns: null }),
  },
  {
    re: /removes? wait from all(?: of)? your pok[eé]mon/i,
    build: () => ({
      do: 'removeMarker',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['field'] }] },
      marker: marker('wait'),
    }),
  },
  {
    re: /jumps? over (?:its |the )?battle opponent and lands? one step away/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'jumpOver', over: { kind: 'battleOpponent' }, minSteps: 1, maxSteps: 1 },
    }),
  },
  {
    re: /your ([a-z]+) pok[eé]mon receive a \+(\d+) boost to attack damage/i,
    build: (m) => {
      const types = parseTypes(m[1] ?? '');
      if (!types.length) return null;
      return {
        do: 'modifyDamage',
        target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types }] },
        modifier: { kind: 'flat', amount: num(m[2], 10) },
        duration: { kind: 'untilEndOfDuel' },
      };
    },
  },
  {
    re: /switches? the battle opponent with a(?:n)? adjacent opponent pok[eé]mon/i,
    build: () => ({
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'adjacentTo', of: { kind: 'battleOpponent' } }],
        },
      },
    }),
  },
  {
    re: /(?:the opponent|the battle opponent) is moved (\d+) steps? behind/i,
    build: (m) => ({
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: { kind: 'knockBack', steps: num(m[1], 1), chooser: 'controller' },
    }),
  },
  {
    re: /choose one pok[eé]mon in your p\.c\. and move it to the bench/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['pc'] }],
      },
      to: { kind: 'zone', zone: 'bench' },
    }),
  },
  {
    re: /if it spins a purple attack, knock it out/i,
    build: () => ({ do: 'knockOut', target: { kind: 'antecedent' } }),
  },
  {
    re: /if the result is anything other than a blue attack, knock it out/i,
    build: () => ({ do: 'knockOut', target: { kind: 'self' } }),
  },
  {
    re: /moves? the battle opponent to a point one step behind/i,
    build: () => ({
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: { kind: 'knockBack', steps: 1, chooser: 'controller' },
    }),
  },
  {
    re: /knocks? the battle opponent back as far as it can move/i,
    build: () => ({
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: { kind: 'knockBack', steps: Number.MAX_SAFE_INTEGER, chooser: 'opponent' },
    }),
  },
  {
    re: /this pok[eé]mon and its battle opponent move to the ultra space/i,
    build: (_m, subject) => ({
      do: 'move',
      target: { kind: 'union', of: [subject, { kind: 'battleOpponent' }] },
      to: { kind: 'zone', zone: 'ultraSpace' },
    }),
  },
  {
    re: /in the battle opponent'?s next battle, that pok[eé]mon'?s (purple|white|gold|blue) attacks becomes? misses/i,
    build: (m) => ({
      do: 'recolorAttacks',
      target: { kind: 'battleOpponent' },
      from: (m[1] ?? 'purple').toLowerCase() as 'purple' | 'white' | 'gold' | 'blue',
      to: 'miss',
      except: [],
      duration: { kind: 'untilEndOfNextTurn' },
    }),
  },
  {
    re: /you may move one of your ([A-Z][A-Za-z]+) on the field next to this pok[eé]mon/i,
    build: (m) => ({
      do: 'move',
      target: parseSelector(`one of your ${m[1] ?? ''} on the field`),
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'self' }, chooser: 'controller' },
    }),
  },
  {
    re: /if there is an electric pok[eé]mon next to this pok[eé]mon, \+(\d+) damage/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: { kind: 'flat', amount: num(m[1], 20) },
      duration: INSTANT,
    }),
  },
  {
    re: /that pok[eé]mon returns to the bench after (\d+) turns/i,
    build: (m) => ({
      do: 'exclude',
      target: { kind: 'antecedent' },
      returnTo: 'bench',
      returnAfterTurns: num(m[1], 7),
    }),
  },
  {
    re: /your ([a-z]+) pok[eé]mon receive a \+(\d+) boost/i,
    build: (m) => {
      const types = parseTypes(m[1] ?? '');
      if (!types.length) return null;
      return {
        do: 'modifyDamage',
        target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types }] },
        modifier: { kind: 'flat', amount: num(m[2], 10) },
        duration: { kind: 'untilEndOfDuel' },
      };
    },
  },

  // --- selection binding ----------------------------------------------------
  // "Choose one of your X" on its own binds a referent for the clauses that follow.
  // Bails out when the sentence continues into an action ("..., and Mega Evolve it"),
  // letting a later rule claim it instead - `null` means "not my clause".
  {
    re: /^(?:choose|select)\s+(.+)$/i,
    build: (m) => (/\band\s+(mega|change|evolve|move|exclude)/i.test(m[1] ?? '')
      || /,\s*and\s+[a-z]/i.test(m[1] ?? '')
      ? null
      : { do: 'select', target: parseSelector(m[1] ?? ''), chooser: 'controller' }),
  },

  // --- respins ---------------------------------------------------------------
  // Ordered BEFORE the spin check deliberately. "...damage is multiplied by the number
  // of Bullet Seed spins" also ends in "spins", so a leading spin-check rule would
  // claim all 44 repeat-until-miss segments and compile them as group spin checks.
  {
    re: /spin again until an attack other than ([a-z' -]+?) is spun/i,
    build: (m) => ({ do: 'respin', until: { kind: 'not', of: { kind: 'move', names: [(m[1] ?? '').trim()] } }, max: null }),
  },
  {
    re: /spin again until ([a-z' -]+?) does not land/i,
    build: (m) => ({ do: 'respin', until: { kind: 'move', names: [(m[1] ?? '').trim()] }, max: null }),
  },
  { re: /\bspin again\b/i, build: () => ({ do: 'respin', until: { kind: 'any' }, max: null }) },

  // --- spin checks -----------------------------------------------------------
  {
    // Anchored to the whole clause AND required to name a target, so it cannot absorb a
    // sentence that merely mentions spins in passing.
    re: /^(.*pok[eé]mon.*?|the battle opponent)\s+spins?$/i,
    build: (m) => {
      const target = parseSelector(m[1] ?? '');
      return target.kind === 'none' ? null : { do: 'spinCheck', target, then: [] };
    },
  },

  // --- conditions -----------------------------------------------------------
  {
    re: /^(.*?)\s+(?:becomes?|becomes|fall[s]? asleep|is|are|now (?:is|has))\s+(?:an?\s+)?(asleep|burned|frozen|confused|paralyzed|poisoned|noxious)\b/i,
    build: (m, subject) => {
      const condition = (m[2] ?? '').toLowerCase() as SpecialCondition;
      const head = (m[1] ?? '').trim();
      return { do: 'applyCondition', target: head ? parseSelector(head) : subject, condition };
    },
  },
  {
    re: /^(.*?)\s+falls? asleep/i,
    build: (m, subject) => ({
      do: 'applyCondition',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      condition: 'asleep',
    }),
  },
  {
    re: /remove any special conditions and curse markers from (.*)/i,
    build: (m) => [
      { do: 'cureConditions', target: parseSelector(m[1] ?? ''), conditions: [] },
      { do: 'removeMarker', target: parseSelector(m[1] ?? ''), marker: marker('curse') },
    ],
  },
  {
    re: /(?:removes?|recovers? from|cures?)\s+(?:all|any)\s+(?:special conditions?|status effects?)(?:\s+from\s+(.*))?/i,
    build: (m, subject) => ({
      do: 'cureConditions',
      target: m[1] ? parseSelector(m[1]) : subject,
      conditions: [],
    }),
  },

  // --- markers --------------------------------------------------------------
  {
    re: /this pok[eé]mon and the pok[eé]mon that it switched with both gain wait/i,
    build: () => ({
      do: 'attachMarker',
      target: { kind: 'union', of: [{ kind: 'self' }, { kind: 'antecedent' }] },
      marker: marker('wait'),
      value: null,
      duration: INSTANT,
    }),
  },
  {
    re: /^(.*?)\s+(?:gains?|gets?|now has?|must (?:then )?)\s*wait(?:\s+(\d+))?/i,
    build: (m, subject) => ({
      do: 'attachMarker',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      marker: marker('wait'),
      value: m[2] ? num(m[2], 1) : null,
      duration: INSTANT,
    }),
  },
  {
    re: /attach(?:es)?\s+(?:an?\s+|the\s+)?mp\s*([+-]\s*\d+)\s*marker\s*(?:to\s+(.*))?/i,
    build: (m, subject) => ({
      do: 'modifyMp',
      target: m[2] ? parseSelector(m[2]) : subject,
      delta: num((m[1] ?? '').replace(/\s+/g, ''), -1),
      duration: INSTANT,
    }),
  },
  {
    re: /^(.*?)\s+(?:gains?|gets?)\s+an?\s+mp\s*([+-]\s*\d+)\s*marker/i,
    build: (m, subject) => ({
      do: 'modifyMp',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      delta: num((m[2] ?? '').replace(/\s+/g, ''), -1),
      duration: INSTANT,
    }),
  },
  {
    re: /(?:poisons?|poison)\s+and attach(?:es)?\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z -]*?)\s*marker(?:\s+to\s+(.*))?/i,
    build: (m, subject) => {
      const target = m[2] ? parseSelector(m[2]) : subject;
      return [
        { do: 'applyCondition', target, condition: 'poisoned' },
        {
          do: 'attachMarker',
          target,
          marker: markerIdFromName(m[1] ?? 'clingingGas'),
          value: null,
          duration: INSTANT,
        },
      ];
    },
  },
  {
    re: /knocks? out the battle opponent and attach(?:es)?\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z -]*?)\s*marker/i,
    build: (m) => [
      { do: 'knockOut', target: { kind: 'battleOpponent' } },
      {
        do: 'attachMarker',
        target: { kind: 'self' },
        marker: markerIdFromName(m[1] ?? 'finalSong'),
        value: null,
        duration: INSTANT,
      },
    ],
  },
  {
    re: /attach(?:es)?\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z -]*?)\s*marker(?:\s+to\s+(.*))?/i,
    build: (m, subject) => {
      const name = (m[1] ?? '').trim();
      if (!isPlausibleMarkerName(name)) return null;
      return {
        do: 'attachMarker',
        target: m[2] ? parseSelector(m[2]) : subject,
        marker: markerIdFromName(name),
        value: null,
        duration: INSTANT,
      };
    },
  },
  {
    re: /^(.*?)\s+(?:gains?|gets?)\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z -]*?)\s+marker/i,
    build: (m, subject) => {
      const name = (m[2] ?? '').trim();
      if (!isPlausibleMarkerName(name) || /^mp\b/i.test(name) || /^wait$/i.test(name)) return null;
      return {
        do: 'attachMarker',
        target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
        marker: markerIdFromName(name),
        value: null,
        duration: INSTANT,
      };
    },
  },
  {
    re: /remove wait from (.*)/i,
    build: (m) => ({ do: 'removeMarker', target: parseSelector(m[1] ?? ''), marker: marker('wait') }),
  },
  {
    re: /(?:remove|removes|removing)\s+(?:the\s+)?([A-Za-z][A-Za-z -]*?)\s+marker/i,
    build: (m, subject) => {
      const name = (m[1] ?? '').trim();
      if (!isPlausibleMarkerName(name)) return null;
      return { do: 'removeMarker', target: subject, marker: markerIdFromName(name) };
    },
  },

  // --- knock out and exclusion ---------------------------------------------
  {
    re: /(?:may )?change its form to ([A-Za-z][A-Za-z -]+?) without moving to the p\.c\. when it is knocked out/i,
    build: (m, subject) => ({
      do: 'surviveByForm',
      target: subject,
      into: [(m[1] ?? '').trim()],
      vs: 'battleDamage',
    }),
  },
  {
    re: /go back to being ([A-Za-z][A-Za-z -]+?) without moving to the p\.c/i,
    build: (m, subject) => ({
      do: 'surviveByForm',
      target: subject,
      into: [(m[1] ?? '').trim()],
      vs: 'battleDamage',
    }),
  },
  {
    re: /ultra beasts knocked out by its attack damage are excluded from the duel/i,
    build: () => ({
      do: 'exclude',
      target: { kind: 'antecedent' },
      returnTo: 'bench',
      returnAfterTurns: null,
      returnWhenSourceLeaves: true,
    }),
  },
  {
    re: /temporarily excludes? (?:its )?battle opponent from the duel/i,
    build: () => ({
      do: 'exclude',
      target: { kind: 'battleOpponent' },
      returnTo: 'bench',
      returnAfterTurns: 7,
    }),
  },
  {
    re: /(?:it|that pok[eé]mon) cannot attack/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'movedThisTurn', value: true },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      what: 'attack',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /pok[eé]mon knocked out by (?:this attack'?s? damage|the attacks of this pok[eé]mon) are temporarily (?:excluded|removed from the duel)[^.]*?returning to the bench (\d+) turns? later/i,
    build: (m) => ({ do: 'exclude', target: { kind: 'antecedent' }, returnTo: 'bench', returnAfterTurns: num(m[1], 7) }),
  },
  {
    re: /^(.*?)\s+temporarily moves to the ultra space[^.]*?returning to the bench after (\d+) turns?/i,
    build: (m) => ({ do: 'exclude', target: parseSelector(m[1] ?? ''), returnTo: 'bench', returnAfterTurns: num(m[2], 7) }),
  },
  {
    re: /(?:exclude|excluded from the duel)/i,
    build: (_m, subject) => ({ do: 'exclude', target: subject, returnTo: null, returnAfterTurns: null }),
  },
  { re: /^(.*?)\s+is not knocked out/i, build: (m) => ({ do: 'prevent', target: parseSelector(m[1] ?? ''), what: 'beKnockedOut', duration: INSTANT }) },
  { re: /^knocks? out\s+(.*)/i, build: (m) => ({ do: 'knockOut', target: parseSelector(m[1] ?? '') }) },
  { re: /^(.*?)\s+(?:is|are) knocked out/i, build: (m, subject) => ({ do: 'knockOut', target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject }) },
  { re: /^knock (?:it|them|that pok[eé]mon) out/i, build: () => ({ do: 'knockOut', target: { kind: 'antecedent' } }) },

  // --- movement -------------------------------------------------------------
  {
    re: /^(.*?)\s+(?:moves?|is moved|benches)\s+to the bench/i,
    build: (m, subject) => ({ do: 'move', target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject, to: { kind: 'zone', zone: 'bench' } }),
  },
  {
    re: /^moves?\s+(.*?)\s+to the bench/i,
    build: (m) => ({ do: 'move', target: parseSelector(m[1] ?? ''), to: { kind: 'zone', zone: 'bench' } }),
  },
  {
    re: /^(.*?)\s+moves? to a (?:point|spot) (\d+) steps? away/i,
    build: (m, subject) => ({
      do: 'move',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      to: { kind: 'pointStepsAway', steps: num(m[2], 2), chooser: 'controller' },
    }),
  },
  {
    re: /^(.*?)\s+moves? (\d+) steps? away/i,
    build: (m, subject) => ({
      do: 'move',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      to: { kind: 'pointStepsAway', steps: num(m[2], 2), chooser: 'controller' },
    }),
  },
  {
    re: /^(.*?)\s+is knocked (\d+) steps? back/i,
    build: (m) => ({
      do: 'move',
      target: parseSelector(m[1] ?? ''),
      to: { kind: 'knockBack', steps: num(m[2], 1), chooser: 'opponent' },
    }),
  },
  {
    re: /^(.*?)\s+jumps over (.*?) and lands (\d+)\s*[-\u2013]\s*(\d+) steps? away/i,
    build: (m, subject) => ({
      do: 'move',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      to: { kind: 'jumpOver', over: parseSelector(m[2] ?? ''), minSteps: num(m[3], 1), maxSteps: num(m[4], 2) },
    }),
  },
  {
    re: /switch(?:es)? with (?:a |one )?pok[eé]mon on your bench that is neither ([A-Z][a-z]+) nor ([A-Z][a-z]+)/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'inZone', zones: ['bench'] },
            { kind: 'not', filter: { kind: 'named', names: [m[1] ?? '', m[2] ?? ''] } },
          ],
        },
      },
    }),
  },
  {
    re: /switch(?:es)? with (?:with )?an? adjacent pok[eé]mon$/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [
            { kind: 'adjacentTo', of: { kind: 'self' } },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
      },
    }),
  },
  {
    re: /^(?:(.+?)\s+)?switch(?:es)? with (?:with )?(.*)/i,
    build: (m, subject) => {
      const rawTarget = (m[1] ?? '').trim();
      const rawWith = (m[2] ?? '').trim();
      const leftoverPrefix = /just once|would be surrounded|instead of|before this/i.test(rawTarget)
        || /^(?:it|this pok[eé]mon)?\s*(?:may|can)$/i.test(rawTarget);
      const target = leftoverPrefix || rawTarget.length === 0 ? subject : parseSelector(rawTarget);
      const partner = parseSelector(rawWith);
      const vacuous =
        (target.kind === 'all' && target.where.length === 0)
        || (partner.kind === 'all' && partner.where.length === 0)
        || partner.kind === 'none';
      if (vacuous) return null;
      return { do: 'move', target, to: { kind: 'swapWith', with: partner } };
    },
  },
  {
    re: /(.+?)(?:can|may) move over pok[eé]mon affected by special conditions/i,
    build: (m) => ({
      do: 'grantMovement',
      target: parseSelector((m[1] ?? '').trim() || 'your Ghost-type Pokémon'),
      grant: 'overOthers',
      over: { kind: 'all', where: [{ kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] }] },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /mp move over your pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'grantMovement',
      target: subject,
      grant: 'overOthers',
      over: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['field'] }] },
    }),
  },
  {
    re: /(?:can|may) use an mp move to fly over/i,
    build: (_m, subject) => ({ do: 'grantMovement', target: subject, grant: 'overOthers' }),
  },
  {
    // "can", "may" and "can also" all appear; so does "past non-Fairy Pokemon".
    re: /moves? under (?:the )?(?:opponent's |attacking )?pok[eé]mon to (?:another space|a point) next to it/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'battleOpponent' }, chooser: 'controller' },
    }),
  },
  {
    re: /can mp move past ([a-z]+) pok[eé]mon/i,
    build: (m, subject) => {
      const types = parseTypes(m[1] ?? '');
      if (!types.length) return null;
      return {
        do: 'grantMovement',
        target: subject,
        grant: 'throughOthers',
        over: { kind: 'all', where: [{ kind: 'hasType', types }] },
        duration: { kind: 'untilEndOfDuel' },
      };
    },
  },
  {
    re: /^(.*?)(?:can|may)\s+(?:also\s+)?(?:mp\s+)?move\s+(through|over|under|past)\b/i,
    build: (m, subject) => ({
      do: 'grantMovement',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      grant: (m[2] === 'over' ? 'overOthers' : m[2] === 'under' ? 'underOthers' : 'throughOthers'),
      duration: INSTANT,
    }),
  },
  {
    re: /^(?:your )?pok[eé]mon (?:may|can) move over (?:this pok[eé]mon|it)/i,
    build: (_m, subject) => ({ do: 'grantMovement', target: subject, grant: 'overOthers' }),
  },
  {
    re: /moves all your pok[eé]mon that are in a p\.c\. to the bench/i,
    build: () => ({
      do: 'move',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['pc'] }] },
      to: { kind: 'zone', zone: 'bench' },
    }),
  },
  {
    // "moves the battle opponent to its P.C." and "to your P.C." - 8 + 4 clauses.
    re: /^(?:moves?|move)\s+(.+?)\s+to (?:its|your|the) p\.c\.?/i,
    build: (m) => ({ do: 'move', target: parseSelector(m[1] ?? ''), to: { kind: 'zone', zone: 'pc' } }),
  },
  {
    re: /^(.+?)\s+moves? to (?:its|your|the) p\.c\.?/i,
    build: (m) => ({ do: 'move', target: parseSelector(m[1] ?? ''), to: { kind: 'zone', zone: 'pc' } }),
  },
  {
    re: /^benches (?:your )?(.+?)(?:\s*\(|$)/i,
    build: (m) => ({ do: 'move', target: parseSelector(m[1] ?? ''), to: { kind: 'zone', zone: 'bench' } }),
  },
  {
    re: /^(.*?)\s+jumps over (.*?) and lands on a surrounding point/i,
    build: (m, subject) => ({
      do: 'move',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      to: { kind: 'jumpOver', over: parseSelector(m[2] ?? ''), minSteps: 1, maxSteps: 1 },
    }),
  },
  {
    // "shift the result clockwise until a non-Purple, non-Blue Attack comes up" - 10 clauses.
    re: /shift the result clockwise until (.+?)(?: comes up|$)/i,
    build: (m, subject) => ({
      do: 'shiftSpinResult',
      target: subject,
      until: { kind: 'not', of: parseSpinPredicate(m[1] ?? '') },
      duration: { kind: 'untilEndOfNextTurn' },
    }),
  },
  {
    re: /^(.*?)\s+can(?:no|'?)t (?:be|become) ((?:(?:asleep|burned|frozen|confused|paralyzed|poisoned|noxious)(?:\s*(?:,|or)\s*)?)+)/i,
    build: (m, subject) => {
      const named = SPECIAL_CONDITIONS.filter((condition) =>
        new RegExp(`\\b${condition}\\b`, 'i').test(m[2] ?? ''),
      );
      return {
        do: 'prevent',
        target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
        what: 'gainConditions',
        duration: { kind: 'untilEndOfDuel' },
        ...(named.length > 0 ? { conditions: named } : {}),
      };
    },
  },
  {
    re: /cannot be affected by any new special conditions?/i,
    build: (_m, subject) => ({ do: 'prevent', target: subject, what: 'gainConditions', duration: INSTANT }),
  },
  {
    re: /^this attack becomes a miss(?: for the next turn)?/i,
    build: (_m, subject) => ({ do: 'replaceSegment', target: subject, moveName: 'Miss', duration: { kind: 'untilEndOfNextTurn' } }),
  },

  // --- damage ---------------------------------------------------------------
  {
    // The subject is optional: many clauses open straight with the verb ("Deals +50
    // damage if ..."), and requiring a prefix silently failed all of them.
    re: /^(?:(.*?)\s+)?(?:each )?deals? ([+-]\d+) damage/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: (m[1] ?? '').trim() && !/^damage attacks?$/i.test(m[1] as string) ? parseSelector(m[1] as string) : subject,
      modifier: { kind: 'flat', amount: num(m[2], 0) },
      duration: INSTANT,
    }),
  },
  {
    re: /^(?:(.*?)\s+)?gains? ([+-]\d+) ?mp\b/i,
    build: (m, subject) => ({
      do: 'modifyMp',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      delta: num(m[2], 1),
      duration: INSTANT,
    }),
  },
  {
    re: /^(?:(.*?)\s+)?retreats? (?:one|(\d+)) steps?/i,
    build: (m, subject) => ({
      do: 'move',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      to: { kind: 'knockBack', steps: num(m[2], 1), chooser: 'controller' },
    }),
  },
  {
    // "knocked as far back as possible in a straight line" - unbounded knockback, so the
    // distance is resolved by the board rather than carried as a literal.
    re: /^(?:(.*?)\s+)?is knocked as far back as possible/i,
    build: (m, subject) => ({
      do: 'move',
      target: (m[1] ?? '').trim() ? parseSelector(m[1] as string) : subject,
      to: { kind: 'knockBack', steps: Number.MAX_SAFE_INTEGER, chooser: 'opponent' },
    }),
  },
  {
    re: /deals? x(\d+) damage/i,
    build: (_m, subject) => ({ do: 'modifyDamage', target: subject, modifier: { kind: 'multiply', factor: num(_m[1], 2) }, duration: INSTANT }),
  },
  {
    re: /damage is multiplied by the number of ([a-z' -]+?) spins/i,
    build: (_m, subject) => ({ do: 'modifyDamage', target: subject, modifier: { kind: 'multiplyByCount', of: { kind: 'spinRepeats' } }, duration: INSTANT }),
  },
  {
    re: /damage is multiplied by the number of (.*)/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: { kind: 'multiplyByCount', of: { kind: 'figures', of: parseSelector(m[1] ?? '') } },
      duration: INSTANT,
    }),
  },
  {
    re: /takes? no damage and moves? to a spot beyond the battle opponent/i,
    build: (_m, subject) => [
      { do: 'modifyDamage', target: { kind: 'battleOpponent' }, modifier: { kind: 'none' }, duration: INSTANT },
      {
        do: 'move',
        target: subject,
        to: { kind: 'beyond', over: { kind: 'battleOpponent' }, chooser: 'controller' },
      },
    ],
  },
  { re: /takes? no damage/i, build: (_m, subject) => ({ do: 'modifyDamage', target: subject, modifier: { kind: 'none' }, duration: INSTANT }) },

  // --- forms, evolution, turn flow -----------------------------------------
  {
    // "Choose one of your Sceptile on the field, and Mega Evolve it for 7 turns" - the
    // target is the chosen figure, not the source, so the prefix has to be read.
    re: /^(?:choose|select)\s+(.+?),?\s+and mega evolve it(?: for (\d+)\s*turns?)?/i,
    build: (m) => ({ do: 'megaEvolve', target: parseSelector(m[1] ?? ''), turns: num(m[2], 7) }),
  },
  {
    re: /mega evolve (?:it|this pok[eé]mon)?\s*(?:for (\d+)\s*turns?)?/i,
    build: (m, subject) => ({ do: 'megaEvolve', target: subject, turns: num(m[1], 7) }),
  },
  { re: /can change form to one of your ([A-Za-z]+)/i, build: (m, subject) => ({ do: 'changeForm', target: subject, into: [(m[1] ?? '').trim()] }) },
  { re: /^gate$/i, build: () => ({ do: 'usageGate' }) },
  { re: /^(?:your )?turn ends/i, build: () => ({ do: 'endTurn' }) },
  { re: /this (?:ends|will end) your turn|your turn (?:then )?ends/i, build: () => ({ do: 'endTurn' }) },
  { re: /the next turn will always be the other player'?s/i, build: () => ({ do: 'forceNextTurn', player: 'opponent' }) },
  {
    re: /reduces? the opponent'?s z-move gauge by two thirds/i,
    build: () => ({ do: 'adjustZGauge', target: 'opponent', fractionOfMax: -2 / 3, flat: null }),
  },
  { re: /shifts? this pok[eé]mon'?s attacks (\w+) segments? clockwise/i, build: (m, subject) => ({ do: 'rotateWheel', target: subject, segments: /two/i.test(m[1] ?? '') ? 2 : num(m[1], 1) }) },
  {
    re: /cannot (?:be )?(use plates|attack|evolve|mega evolve|be moved|be knocked out)/i,
    build: (m, subject) => {
      const what = /plates/i.test(m[1] ?? '') ? 'usePlates'
        : /moved/i.test(m[1] ?? '') ? 'beMoved'
        : /knocked/i.test(m[1] ?? '') ? 'beKnockedOut'
        : /mega/i.test(m[1] ?? '') ? 'megaEvolve'
        : /evolve/i.test(m[1] ?? '') ? 'evolve' : 'attack';
      return { do: 'prevent', target: subject, what, duration: INSTANT };
    },
  },
  {
    re: /(?:have the effects of their abilities that increase or decrease attack damage|abilities that increase or decrease attack damage) nullified/i,
    build: () => ({
      do: 'nullify',
      target: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfDuel' },
      scope: 'damageModifiers',
    }),
  },
  { re: /(?:is|are) nullified|has no effect/i, build: (_m, subject) => ({ do: 'nullify', target: subject, duration: INSTANT }) },
  { re: /must battle if possible/i, build: (_m, subject) => ({ do: 'forceBattle', target: subject }) },
  { re: /(?:one of your plates|a plate) will switch from used to unused/i, build: () => ({ do: 'refreshPlate', count: 1, player: 'controller' }) },
  { re: /this plate returns to its unused state/i, build: () => ({ do: 'refreshPlate', count: 1, player: 'controller' }) },
  { re: /this plate can be used again/i, build: () => ({ do: 'refreshPlate', count: 1, player: 'controller' }) },
  { re: /all plates from both players(?: except recycle)? become usable/i, build: () => ({ do: 'refreshPlate', count: 99, player: 'both' }) },
  {
    re: /switches? one of the opponent'?s plates from unused to used/i,
    build: () => ({ do: 'consumePlate', player: 'opponent', count: 1, nameIncludes: null }),
  },

  // --- plates, heals, forms, movement extras --------------------------------
  {
    re: /^(?:that pok[eé]mon|it) is no longer (asleep|burned|frozen|confused|paralyzed|poisoned|noxious)(?: or (asleep|burned|frozen|confused|paralyzed|poisoned|noxious))?/i,
    build: (m) => ({
      do: 'cureConditions',
      target: { kind: 'antecedent' },
      conditions: [m[1], m[2]].filter((c): c is SpecialCondition => !!c).map((c) => c.toLowerCase() as SpecialCondition),
    }),
  },
  {
    re: /removes? the (asleep|burned|frozen|confused|paralyzed|poisoned|noxious) condition from (.*)/i,
    build: (m) => ({
      do: 'cureConditions',
      target: parseSelector(m[2] ?? 'all Pokémon'),
      conditions: [(m[1] ?? '').toLowerCase() as SpecialCondition],
    }),
  },
  {
    re: /removes? the (?:burned|poisoned|asleep|frozen|paralyzed|confused) conditions? from all pok[eé]mon/i,
    build: (m) => {
      const cond = (m[0].match(/asleep|burned|frozen|confused|paralyzed|poisoned|noxious/i)?.[0] ?? 'burned').toLowerCase() as SpecialCondition;
      return { do: 'cureConditions', target: { kind: 'all', where: [] }, conditions: [cond] };
    },
  },
  {
    re: /any special conditions are removed from (.*)/i,
    build: (m) => ({ do: 'cureConditions', target: parseSelector(m[1] ?? ''), conditions: [] }),
  },
  {
    re: /removes? the wait(?: condition)? from (.*)/i,
    build: (m) => ({ do: 'removeMarker', target: parseSelector(m[1] ?? ''), marker: marker('wait') }),
  },
  { re: /^return it to the bench/i, build: () => ({ do: 'move', target: { kind: 'antecedent' }, to: { kind: 'zone', zone: 'bench' } }) },
  { re: /appears? on your bench/i, build: (_m, subject) => ({ do: 'move', target: subject.kind === 'self' ? { kind: 'antecedent' } : subject, to: { kind: 'zone', zone: 'bench' } }) },
  {
    re: /move (?:it|that pok[eé]mon) to (?:the |your )?p\.c\.?/i,
    build: () => ({ do: 'move', target: { kind: 'antecedent' }, to: { kind: 'zone', zone: 'pc' } }),
  },
  {
    re: /if there is space in your p\.c\.?, move it there/i,
    build: () => ({ do: 'move', target: { kind: 'antecedent' }, to: { kind: 'zone', zone: 'pc' } }),
  },
  {
    re: /switch(?:es)? (?:the order of )?your pok[eé]mon in the p\.c\.?/i,
    build: () => ({ do: 'reorderPc', player: 'controller' }),
  },
  {
    re: /(?:choose two of your pok[eé]mon on the field or bench and switch their positions|switch 1 of your pok[eé]mon with another of your pok[eé]mon on the field)/i,
    build: () => ({
      do: 'move',
      target: { kind: 'choose', count: 1, upTo: false, chooser: 'controller', where: [{ kind: 'allegiance', of: 'ally' }] },
      to: { kind: 'swapWith', with: { kind: 'choose', count: 1, upTo: false, chooser: 'controller', where: [{ kind: 'allegiance', of: 'ally' }] } },
    }),
  },
  {
    re: /move one pok[eé]mon from your bench to one space away from your entry point/i,
    build: () => ({
      do: 'move',
      target: { kind: 'choose', count: 1, upTo: false, chooser: 'controller', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['bench'] }] },
      to: { kind: 'adjacentToOwnEntry', chooser: 'controller' },
    }),
  },
  {
    re: /move it to your goal point/i,
    build: () => ({ do: 'move', target: { kind: 'antecedent' }, to: { kind: 'goal' } }),
  },
  {
    re: /move (?:it|that pok[eé]mon) over a connected pok[eé]mon/i,
    build: () => ({
      do: 'move',
      target: { kind: 'antecedent' },
      to: { kind: 'jumpOver', over: { kind: 'all', where: [{ kind: 'adjacentTo', of: { kind: 'antecedent' } }] }, minSteps: 1, maxSteps: 1 },
    }),
  },
  {
    re: /move (?:this pok[eé]mon )?to an open spot next to an adjacent figure/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'all', where: [{ kind: 'adjacentTo', of: subject }] }, chooser: 'controller' },
    }),
  },
  {
    re: /(?:can|may) move (?:this pok[eé]mon )?to an open spot next to an adjacent/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'all', where: [{ kind: 'adjacentTo', of: subject }] }, chooser: 'controller' },
    }),
  },
  {
    re: /(?:can|may) move to a point that is (\d+) steps? away/i,
    build: (m, subject) => ({ do: 'grantLeap', target: subject, steps: num(m[1], 2) }),
  },
  {
    re: /jumps? over (?:its |the )?battle opponent and land(?:s)? (\d+) steps? away/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'jumpOver', over: { kind: 'battleOpponent' }, minSteps: num(m[1], 1), maxSteps: num(m[1], 1) },
    }),
  },
  {
    re: /(?:moves?|move) the battle opponent to a point (\d+) steps? away/i,
    build: (m) => ({
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: { kind: 'pointStepsAway', steps: num(m[1], 2), chooser: 'controller' },
    }),
  },
  {
    re: /the battle opponent is moved (?:to a point )?(\d+) steps? away/i,
    build: (m) => ({
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: { kind: 'pointStepsAway', steps: num(m[1], 2), chooser: 'controller' },
    }),
  },
  {
    re: /adjacent opposing pok[eé]mon are knocked (\d+) steps? back/i,
    build: (m) => ({
      do: 'move',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'adjacentTo', of: { kind: 'self' } }] },
      to: { kind: 'knockBack', steps: num(m[1], 1), chooser: 'opponent' },
    }),
  },
  {
    re: /move (?:one of )?your pok[eé]mon that is in the ultra space to a point (\d+) steps? away/i,
    build: (m) => ({
      do: 'move',
      target: { kind: 'choose', count: 1, upTo: false, chooser: 'controller', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['ultraSpace'] }] },
      to: { kind: 'pointStepsAway', steps: num(m[1], 2), chooser: 'controller' },
    }),
  },
  {
    re: /move the battle opponent or one opposing pok[eé]mon that is adjacent to the battle opponent to its p\.c\.?/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'adjacentTo', of: { kind: 'battleOpponent' } }],
      },
      to: { kind: 'zone', zone: 'pc' },
    }),
  },
  { re: /moves? the battle opponent to the p\.c\.?/i, build: () => ({ do: 'move', target: { kind: 'battleOpponent' }, to: { kind: 'zone', zone: 'pc' } }) },
  {
    re: /if this pok[eé]mon is knocked out, so is the battle opponent/i,
    build: () => ({ do: 'knockOut', target: { kind: 'battleOpponent' } }),
  },
  {
    re: /when you do, change (?:this pok[eé]mon)'?s? form/i,
    build: (_m, subject) => ({ do: 'changeForm', target: subject, into: [] }),
  },
  {
    re: /change (?:its |this pok[eé]mon'?s )?form(?: to ([A-Za-z][A-Za-z -]*?))?(?:, if possible)?$/i,
    build: (m, subject) => ({ do: 'changeForm', target: subject.kind === 'self' ? { kind: 'antecedent' } : subject, into: m[1] ? [m[1].trim()] : [] }),
  },
  {
    re: /(?:choose|select)\s+(.+?)\s+and change its form to ([A-Za-z][A-Za-z -]+)/i,
    build: (m) => ({ do: 'changeForm', target: parseSelector(m[1] ?? ''), into: [(m[2] ?? '').trim()] }),
  },
  {
    re: /(?:may|can) change its form to ([A-Za-z][A-Za-z -]+)/i,
    build: (m, subject) => ({ do: 'changeForm', target: subject, into: [(m[1] ?? '').trim()] }),
  },
  { re: /it undergoes primal reversion/i, build: () => ({ do: 'changeForm', target: { kind: 'antecedent' }, into: ['Primal'] }) },
  {
    re: /(?:choose|select)\s+(.+?)\s+and evolve it/i,
    build: (m) => ({ do: 'evolve', target: parseSelector(m[1] ?? '') }),
  },
  { re: /you may choose one of your pok[eé]mon on the field and evolve it/i, build: () => ({ do: 'evolve', target: { kind: 'choose', count: 1, upTo: false, chooser: 'controller', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['field'] }] } }) },
  { re: /^evolve it$/i, build: () => ({ do: 'evolve', target: { kind: 'antecedent' } }) },
  {
    re: /this pok[eé]mon cannot have wait/i,
    build: (_m, subject) => ({ do: 'prevent', target: subject, what: 'gainWait', duration: { kind: 'untilEndOfDuel' } }),
  },
  {
    re: /cannot have wait/i,
    build: (_m, subject) => ({ do: 'prevent', target: subject, what: 'gainWait', duration: INSTANT }),
  },
  {
    re: /cannot have markers attached/i,
    build: (_m, subject) => ({ do: 'prevent', target: subject, what: 'gainMarkers', duration: { kind: 'untilEndOfDuel' } }),
  },
  {
    re: /will not be knocked out/i,
    build: (_m, subject) => ({ do: 'prevent', target: subject, what: 'beKnockedOut', duration: { kind: 'untilEndOfTurn' } }),
  },
  {
    re: /cannot respin|cannot re-spin|spin-again effects are tra[et]ed as single spins/i,
    build: (_m, subject) => ({ do: 'prevent', target: subject, what: 'spinAgain', duration: { kind: 'untilEndOfDuel' } }),
  },
  {
    re: /do not move from effects of opposing attacks that would move them/i,
    build: (m, subject) => ({
      do: 'prevent',
      target: /your /.test(m[0]) ? parseSelector(m[0]) : subject,
      what: 'beMoved',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /is not moved to the ultra space/i,
    build: (_m, subject) => ({ do: 'prevent', target: subject, what: 'beMoved', duration: INSTANT }),
  },
  {
    re: /(?:can|may) re-spin (\d+) times? during battle/i,
    build: (m) => ({ do: 'respin', until: { kind: 'any' }, max: num(m[1], 1) }),
  },
  {
    re: /you can choose to respin once/i,
    build: () => ({ do: 'respin', until: { kind: 'any' }, max: 1 }),
  },
  {
    re: /if (?:your pok[eé]mon'?s move|the attack) lands on miss, it will shift to the (?:move|attack) next to it/i,
    build: (_m, subject) => ({
      do: 'shiftSpinResult',
      target: subject.kind === 'self' ? { kind: 'antecedent' } : subject,
      until: { kind: 'not', of: { kind: 'color', colors: ['miss'] } },
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /if the attack for that pok[eé]mon is a miss that turn, it will shift to the adjacent attack/i,
    build: () => ({
      do: 'shiftSpinResult',
      target: { kind: 'antecedent' },
      until: { kind: 'not', of: { kind: 'color', colors: ['miss'] } },
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /(?:blue|purple|gold|white) attacks(?: of .*)? (?:that are not dodge )?become misses/i,
    build: (m, subject) => {
      const from = (m[0].match(/blue|purple|gold|white/i)?.[0] ?? 'blue').toLowerCase() as SegmentColor;
      return {
        do: 'recolorAttacks',
        target: subject,
        from,
        to: 'miss',
        except: /not dodge/i.test(m[0]) ? ['Dodge'] : [],
        duration: { kind: 'untilEndOfNextTurn' },
      };
    },
  },
  {
    re: /white attacks will be changed to (?:a )?gold/i,
    build: (_m, subject) => ({
      do: 'recolorAttacks',
      target: subject.kind === 'self' ? { kind: 'antecedent' } : subject,
      from: 'white',
      to: 'gold',
      except: [],
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /gold attacks become white attacks/i,
    build: () => ({
      do: 'recolorAttacks',
      target: { kind: 'battleOpponent' },
      from: 'gold',
      to: 'white',
      except: [],
      duration: INSTANT,
    }),
  },
  {
    re: /purple attack becomes the gold attack ([A-Za-z][A-Za-z ]+?)(?:\s+\d+)?$/i,
    build: (m) => ({ do: 'replaceSegment', target: { kind: 'antecedent' }, moveName: (m[1] ?? 'Extreme Speed').trim(), duration: { kind: 'untilEndOfTurn' } }),
  },
  {
    re: /(?:gains?|has|gets?)\s+[★*]+\s*\+(\d+)/i,
    build: (m, subject) => ({ do: 'modifyStars', target: subject.kind === 'self' ? { kind: 'antecedent' } : subject, delta: num(m[1], 1), duration: { kind: 'untilEndOfTurn' } }),
  },
  {
    re: /(?:it also )?gains? damage \+(\d+)/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject.kind === 'self' ? { kind: 'antecedent' } : subject,
      modifier: { kind: 'flat', amount: num(m[1], 20) },
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /this attack'?s damage is boosted by (\d+) for each pok[eé]mon in your p\.c\.?/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: { kind: 'flatByCount', amount: num(m[1], 10), of: { kind: 'figures', of: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['pc'] }] } } },
      duration: INSTANT,
    }),
  },
  {
    re: /attacks have range (\d+)/i,
    build: (m, subject) => ({ do: 'setBattleRange', target: subject, range: num(m[1], 2), duration: { kind: 'untilEndOfDuel' } }),
  },
  {
    re: /mega evolution turns increases by (\d+)/i,
    build: (m, subject) => ({ do: 'adjustMegaTurns', target: subject, delta: num(m[1], 1) }),
  },
  {
    re: /that pok[eé]mon will have mp\s*\+\s*(\d+)/i,
    build: (m) => ({ do: 'modifyMp', target: { kind: 'antecedent' }, delta: num(m[1], 1), duration: { kind: 'untilEndOfTurn' } }),
  },
  {
    re: /get \+(\d+) mp\b/i,
    build: (m, subject) => ({ do: 'modifyMp', target: subject, delta: num(m[1], 1), duration: { kind: 'untilEndOfDuel' } }),
  },
  { re: /this ability is only valid on your turn/i, build: () => ({ do: 'usageGate' }) },
  { re: /the \d+-?\s*pok[eé]mon limit does not apply/i, build: () => ({ do: 'tag', tag: 'noFigureLimit' }) },
  { re: /can only be set as a form/i, build: () => ({ do: 'tag', tag: 'formOnly' }) },
  {
    re: /is not subject to spin-inducing effects of attacks/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'spinFromAttacks',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /and your pok[eé]mon adjacent to (?:this pok[eé]mon|it) are not knocked out by gold attacks from their battle opponents/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'union',
        of: [
          { kind: 'self' },
          {
            kind: 'all',
            where: [
              { kind: 'allegiance', of: 'ally' },
              { kind: 'adjacentTo', of: { kind: 'self' } },
              { kind: 'inZone', zones: ['field'] },
            ],
          },
        ],
      },
      what: 'goldAttackKo',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /your fighting pok[eé]mon and your steel pok[eé]mon are not knocked out by gold attacks from their battle opponents/i,
    build: () => ({
      do: 'prevent',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'hasType', types: ['Fighting', 'Steel'] },
          { kind: 'inZone', zones: ['field'] },
          { kind: 'not', filter: { kind: 'hasCondition', conditions: [...SPECIAL_CONDITIONS] } },
        ],
      },
      what: 'goldAttackKo',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /it is not knocked out by gold attacks from its battle opponents/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'goldAttackKo',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /one of your used mega evolution plates becomes usable/i,
    build: () => ({ do: 'refreshPlate', count: 1, player: 'controller', megaOnly: true }),
  },
  {
    re: /for effects that move (?:this pok[eé]mon|it)'?s battle opponent, you decide/i,
    build: (_m, subject) => ({ do: 'seizeMoveEffects', target: subject }),
  },
  {
    re: /deals? \+(\d+) attack damage for each pok[eé]mon in the ultra space/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: {
        kind: 'flatByCount',
        amount: num(m[1], 29),
        of: { kind: 'figures', of: { kind: 'all', where: [{ kind: 'inZone', zones: ['ultraSpace'] }] } },
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /gets? \+(\d+) mp for each pok[eé]mon in the ultra space(?:\s*\(to a maximum of mp\s*(\d+)\))?/i,
    build: (m, subject) => ({
      do: 'modifyMp',
      target: subject,
      delta: num(m[1], 1),
      duration: { kind: 'untilEndOfDuel' },
      of: { kind: 'figures', of: { kind: 'all', where: [{ kind: 'inZone', zones: ['ultraSpace'] }] } },
      ...(m[2] !== undefined ? { cap: num(m[2], 4) } : {}),
    }),
  },
  {
    re: /mp cannot be (\d+) or lower/i,
    build: (m, subject) => ({ do: 'floorMp', target: subject, min: num(m[1], 2) + 1 }),
  },
  {
    re: /any effect of (?:this pok[eé]mon|it)'?s battle opponent'?s ability that would increase attack damage decrease it instead/i,
    build: () => ({
      do: 'invertAbilityIncreases',
      target: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /can mp move past fire pok[eé]mon and burned pok[eé]mon/i,
    build: (_m, subject) => ({
      do: 'grantMovement',
      target: subject,
      grant: 'throughOthers',
      over: {
        kind: 'union',
        of: [
          { kind: 'all', where: [{ kind: 'hasType', types: ['Fire'] }, { kind: 'inZone', zones: ['field'] }] },
          { kind: 'all', where: [{ kind: 'hasCondition', conditions: ['burned'] }, { kind: 'inZone', zones: ['field'] }] },
        ],
      },
    }),
  },
  {
    re: /(?:if this pok[eé]mon is on the field, )?it may move to the bench/i,
    build: (_m, subject) => ({ do: 'move', target: subject, to: { kind: 'zone', zone: 'bench' } }),
  },
  {
    re: /the battle opponent'?s attacks cannot attach markers to (?:this pok[eé]mon|it)/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'gainMarkers',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the opponent'?s z-move gauge is reduced by half(?: its max value)?/i,
    build: () => ({ do: 'adjustZGauge', target: 'opponent', fractionOfMax: -1 / 2, flat: null }),
  },
  {
    re: /gets? mp \+(\d+)$/i,
    build: (m, subject) => ({
      do: 'modifyMp',
      target: subject,
      delta: num(m[1], 1),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /has mp (\d+) while on the field/i,
    build: (m, subject) => ({
      do: 'setMp',
      target: subject,
      value: num(m[1], 3),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /gets? \+(\d+) mp for each species of regirock, regice, and registeel on the field/i,
    build: (m, subject) => ({
      do: 'modifyMp',
      target: subject,
      delta: num(m[1], 1),
      duration: { kind: 'untilEndOfDuel' },
      of: {
        kind: 'figures',
        of: {
          kind: 'all',
          where: [
            { kind: 'inZone', zones: ['field'] },
            { kind: 'named', names: ['Regirock', 'Regice', 'Registeel'] },
          ],
        },
      },
    }),
  },
  {
    re: /your (?:normal pok[eé]mon and your flying|flying pok[eé]mon and your normal) pok[eé]mon take ([+-]\d+) damage/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'hasType', types: ['Normal', 'Flying'] },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      modifier: { kind: 'flat', amount: num(m[1], -10) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /your fire pok[eé]mon take (\d+) less damage from the attacks of fire-type battle opponents/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'hasType', types: ['Fire'] },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      modifier: { kind: 'flat', amount: -num(m[1], 10) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /opposing ice pok[eé]mon next to your ice-type pok[eé]mon get mp\s*([+-]\s*\d+)/i,
    build: (m) => ({
      do: 'modifyMp',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'hasType', types: ['Ice'] },
          { kind: 'adjacentTo', of: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types: ['Ice'] }] } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      delta: num((m[1] ?? '-1').replace(/\s+/g, ''), -1),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /all grass-type pok[eé]mon within (\d+) steps become burned/i,
    build: (m) => ({
      do: 'applyCondition',
      target: {
        kind: 'all',
        where: [
          { kind: 'hasType', types: ['Grass'] },
          { kind: 'within', steps: num(m[1], 2), of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
      condition: 'burned',
    }),
  },
  {
    re: /your grass pok[eé]mon ignore knockout- and movement-causing effects of opponents'? attacks/i,
    build: () => [
      {
        do: 'prevent',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'hasType', types: ['Grass'] },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        what: 'beKnockedOut',
        duration: { kind: 'untilEndOfDuel' },
      },
      {
        do: 'prevent',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'ally' },
            { kind: 'hasType', types: ['Grass'] },
            { kind: 'inZone', zones: ['field'] },
          ],
        },
        what: 'beMoved',
        duration: { kind: 'untilEndOfDuel' },
      },
    ],
  },
  {
    re: /instead of (?:using |making )?(?:an )?mp move, you may move (?:this pok[eé]mon|it) to a point (\d+) steps? away/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'pointStepsAway', steps: num(m[1], 2), chooser: 'controller' },
    }),
  },
  {
    re: /move (?:this pok[eé]mon|it) to a point (\d+) steps? away instead of an? mp move/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'pointStepsAway', steps: num(m[1], 2), chooser: 'controller' },
    }),
  },
  { re: /the effects of this plate do not stack/i, build: () => ({ do: 'noStack' }) },
  { re: /you cannot select (?:unusable pok[eé]mon|two pok[eé]mon from the bench)/i, build: () => ({ do: 'usageGate' }) },
  {
    re: /opposing pok[eé]mon adjacent to (?:this pok[eé]mon|it) spin, and if they spin a gold attack then they are knocked out/i,
    build: () => ({
      do: 'spinCheck',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'adjacentTo', of: { kind: 'self' } }] },
      then: [{
        id: 'nested-gold-ko' as Clause['id'],
        trigger: 'onAttackResolve',
        when: [{ kind: 'spun', target: { kind: 'antecedent' }, match: { kind: 'color', colors: ['gold'] } }],
        actions: [{ do: 'knockOut', target: { kind: 'antecedent' } }],
        layer: 10,
        noStackKey: null,
        source: 'adjacent gold knock-out',
      }],
    }),
  },
  {
    re: /spin for (?:an opposing pok[eé]mon within (\d+) steps|all opposing pok[eé]mon on the field|this pok[eé]mon within (\d+) steps)/i,
    build: (m) => {
      const steps = num(m[1] ?? m[2], 0);
      const where: Filter[] = [{ kind: 'allegiance', of: 'opposing' }, { kind: 'inZone', zones: ['field'] }];
      if (steps > 0) where.push({ kind: 'within', steps, of: { kind: 'self' } });
      return { do: 'spinCheck', target: { kind: 'all', where }, then: [] };
    },
  },
  { re: /this pok[eé]mon must battle if possible/i, build: (_m, subject) => ({ do: 'forceBattle', target: subject }) },
  {
    re: /(?:if this pok[eé]mon has a special condition, )?that condition is applied to its battle opponent and removed from this pok[eé]mon/i,
    build: () => ({
      do: 'transferConditions',
      from: { kind: 'self' },
      to: { kind: 'battleOpponent' },
    }),
  },
  {
    re: /reduces? the opponetn'?s z-move gauge by two thirds/i,
    build: () => ({ do: 'adjustZGauge', target: 'opponent', fractionOfMax: -2 / 3, flat: null }),
  },
  { re: /^move it there$/i, build: () => ({ do: 'move', target: { kind: 'antecedent' }, to: { kind: 'zone', zone: 'pc' } }) },
  {
    re: /(?:choose|select) (.+?) and move it to your goal point/i,
    build: (m) => ({ do: 'move', target: parseSelector(m[1] ?? ''), to: { kind: 'goal' } }),
  },
  {
    re: /it will shift to the (?:move|attack) next to it/i,
    build: () => ({
      do: 'shiftSpinResult',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['field'] }] },
      until: { kind: 'not', of: { kind: 'color', colors: ['miss'] } },
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /this attack becomes a miss/i,
    build: (_m, subject) => ({
      do: 'replaceSegment',
      target: subject,
      moveName: 'Miss',
      duration: INSTANT,
    }),
  },
  {
    re: /the (blue|purple|gold|white) attacks of .+? will be misses/i,
    build: (m) => ({
      do: 'recolorAttacks',
      target: { kind: 'antecedent' },
      from: (m[1] ?? 'blue').toLowerCase() as SegmentColor,
      to: 'miss',
      except: [],
      duration: { kind: 'untilEndOfNextTurn' },
    }),
  },
  {
    re: /until the end of your next turn, the white attacks of (?:this pok[eé]mon|.*) become gold/i,
    build: (_m, subject) => ({
      do: 'recolorAttacks',
      target: subject.kind === 'self' ? { kind: 'antecedent' } : subject,
      from: 'white',
      to: 'gold',
      except: [],
      duration: { kind: 'untilEndOfNextTurn' },
    }),
  },
  {
    re: /in its first battle after moving to the field, all of (?:this pok[eé]mon|.*)'?s white attacks become gold/i,
    build: (_m, subject) => ({
      do: 'recolorAttacks',
      target: subject,
      from: 'white',
      to: 'gold',
      except: [],
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /increases? your z-move gauge by half (?:of )?its max/i,
    build: () => ({ do: 'adjustZGauge', target: 'controller', fractionOfMax: 0.5, flat: null }),
  },
  {
    re: /poisons? an opposing pok[eé]mon within (\d+) steps/i,
    build: (m) => ({
      do: 'applyCondition',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'inZone', zones: ['field'] },
          { kind: 'within', steps: num(m[1], 2), of: { kind: 'self' } },
        ],
      },
      condition: 'poisoned',
    }),
  },
  {
    re: /cannot win (?:you )?the duel by moving to the goal/i,
    build: (_m, subject) => ({ do: 'lockGoal', target: subject, locked: true }),
  },
  {
    re: /(?:this pok[eé]mon|it) can pass through other pok/i,
    build: (_m, subject) => ({ do: 'grantMovement', target: subject, grant: 'throughOthers' }),
  },
  {
    re: /your pok[eé]mon on the field can pass through (?:this pok[eé]mon|it)/i,
    build: () => ({
      do: 'grantMovement',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['field'] }] },
      grant: 'throughOthers',
    }),
  },
  {
    re: /energy plate-based effects are lost/i,
    build: () => ({ do: 'consumePlate', player: 'opponent', count: 99, nameIncludes: 'Energy' }),
  },
  {
    re: /the effects of energy plates are lost/i,
    build: () => ({ do: 'consumePlate', player: 'both', count: 99, nameIncludes: 'Energy' }),
  },
  {
    re: /if this pok[eé]mon is evolved, it has mp\s*\+\s*(\d+)/i,
    build: (m, subject) => ({ do: 'modifyMp', target: subject, delta: num(m[1], 1), duration: { kind: 'untilEndOfDuel' } }),
  },
  {
    re: /(?:moves?|can take|takes?) (\d+)\s*-\s*(\d+) steps? back/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'knockBack', steps: num(m[2] ?? m[1], 1), chooser: 'controller' },
    }),
  },
  {
    re: /knocks? the battle opponent one step back and claims? its previous spot/i,
    build: () => ({
      do: 'claimSpot',
      knock: { kind: 'battleOpponent' },
      claim: { kind: 'self' },
      steps: 1,
    }),
  },
  {
    re: /knock (?:this pok[eé]mon) (\d+) steps? back and move the battle opponent to (?:this pok[eé]mon|it)'?s previous location/i,
    build: (m) => ({
      do: 'claimSpot',
      knock: { kind: 'self' },
      claim: { kind: 'battleOpponent' },
      steps: num(m[1], 1),
    }),
  },
  {
    re: /if one of your own pok[eé]mon adjacent this pok[eé]mon, the two switch(?:es)?/i,
    build: () => ({
      do: 'move',
      target: { kind: 'self' },
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'adjacentTo', of: { kind: 'self' } }],
        },
      },
    }),
  },
  {
    re: /the battle opponent'?s attack would inflict a marker or special condition on this pok[eé]mon, that effect is instead inflicted on the opponent/i,
    build: () => ({
      do: 'redirectInflictions',
      target: { kind: 'self' },
      to: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /it will be eliminated from the duel/i,
    build: () => ({
      do: 'armTrigger',
      target: { kind: 'antecedent' },
      trigger: 'onOpponentKnockedOut',
      when: [{ kind: 'isBattleWinner' }],
      then: [{ do: 'exclude', target: { kind: 'self' }, returnTo: null, returnAfterTurns: null }],
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /the knocked out opposing pok[eé]mon is (?:an? )?(.+?), the opponent will be removed from the duel/i,
    build: (m) => ({
      do: 'armTrigger',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['field'] }] },
      trigger: 'onOpponentKnockedOut',
      when: [{ kind: 'hasType', target: { kind: 'battleOpponent' }, types: parseTypes(m[1] ?? '') }],
      then: [{ do: 'exclude', target: { kind: 'battleOpponent' }, returnTo: null, returnAfterTurns: null }],
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /the opponent will be removed from the duel/i,
    build: () => ({
      do: 'armTrigger',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'inZone', zones: ['field'] }] },
      trigger: 'onOpponentKnockedOut',
      when: [],
      then: [{ do: 'exclude', target: { kind: 'battleOpponent' }, returnTo: null, returnAfterTurns: null }],
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /(?:it|this pok[eé]mon) has mp\s*\+\s*(\d+)/i,
    build: (m, subject) => ({ do: 'modifyMp', target: subject, delta: num(m[1], 1), duration: { kind: 'untilEndOfDuel' } }),
  },
  {
    re: /the battle opponent is now frozen/i,
    build: () => ({ do: 'applyCondition', target: { kind: 'battleOpponent' }, condition: 'frozen' }),
  },
  {
    re: /can use an mp move to fly over pok[eé]mon that don't have soar/i,
    build: () => ({
      do: 'grantMovement',
      target: { kind: 'antecedent' },
      grant: 'overOthers',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /change the form of each (.+?) on the field/i,
    build: (m) => ({
      do: 'changeForm',
      target: parseSelector(`each ${m[1] ?? ''} on the field`),
      into: [],
    }),
  },
  {
    re: /remove the sleep and frozen conditions, mp-1 and mp -2 markers and wait from all of your fighting-type/i,
    build: () => [
      {
        do: 'cureConditions',
        target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types: ['Fighting'] }] },
        conditions: ['asleep', 'frozen'],
      },
      {
        do: 'removeMarker',
        target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types: ['Fighting'] }] },
        marker: marker('wait'),
      },
    ],
  },
  {
    re: /any pok[eé]mon it collides with are also knocked back/i,
    build: () => ({
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: { kind: 'knockBack', steps: Number.MAX_SAFE_INTEGER, chooser: 'opponent', collide: true },
    }),
  },
  {
    re: /nullifies the effects of one of (?:this pok[eé]mon's battle opponent's |the opponent's |that pok[eé]mon's )in-use(?:, non-mega-evolution)? plates/i,
    build: (m) => ({
      do: 'nullifyInUsePlate',
      player: /opponent/i.test(m[0]) ? 'opponent' : 'opponent',
      exceptMega: /non-mega/i.test(m[0]),
    }),
  },
  {
    re: /the nullified plate counts as having been used/i,
    build: () => ({ do: 'nullifyInUsePlate', player: 'opponent', exceptMega: false }),
  },
  {
    re: /that plate counts as having been used/i,
    build: () => ({ do: 'tag', tag: 'plateCountsUsed' }),
  },
  {
    re: /cannot be affected by ([A-Za-z][A-Za-z -]*)/i,
    build: (m, subject) => ({
      do: 'prevent',
      target: subject.kind === 'self' ? { kind: 'antecedent' } : subject,
      what: 'namedEffect',
      duration: { kind: 'untilEndOfTurn' },
      named: (m[1] ?? 'Whirlwind').trim(),
    }),
  },
  {
    re: /if this pok[eé]mon or its opponent spins a purple attack in battle, they must both spin once again/i,
    build: () => ({
      do: 'armTrigger',
      target: { kind: 'antecedent' },
      trigger: 'duringBattle',
      when: [{
        kind: 'anyOf',
        of: [
          { kind: 'spun', target: { kind: 'self' }, match: { kind: 'color', colors: ['purple'] } },
          { kind: 'spun', target: { kind: 'battleOpponent' }, match: { kind: 'color', colors: ['purple'] } },
        ],
      }],
      then: [{ do: 'respin', until: { kind: 'any' }, max: 1, forced: true, who: 'both' }],
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /when your deoxys is attacked, before the battle, you may switch that deoxys with another of your deoxys on the field or bench/i,
    build: () => ({
      do: 'armTrigger',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'named', names: ['Deoxys'] }] },
      trigger: 'onAttacked',
      when: [{ kind: 'antecedentNamed', names: ['Deoxys'] }],
      then: [{
        do: 'optional',
        chooser: 'controller',
        then: [{
          do: 'move',
          target: { kind: 'antecedent' },
          to: {
            kind: 'swapWith',
            with: {
              kind: 'choose',
              count: 1,
              upTo: false,
              chooser: 'controller',
              where: [
                { kind: 'allegiance', of: 'ally' },
                { kind: 'named', names: ['Deoxys'] },
              ],
            },
          },
        }],
      }],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  { re: /^\(except wait\.?\)$/i, build: () => ({ do: 'tag', tag: 'exceptWait' }) },
  {
    re: /the effect of land's wrath from your zygarde becomes/i,
    build: () => ({
      do: 'replaceSegment',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'named', names: ['Zygarde'] }] },
      moveName: "Land's Wrath",
      duration: { kind: 'untilEndOfDuel' },
      then: [{
        id: 'lands-energy-spin' as Clause['id'],
        trigger: 'onAttackResolve',
        when: [],
        actions: [{
          do: 'spinCheck',
          target: {
            kind: 'all',
            where: [
              { kind: 'allegiance', of: 'opposing' },
              { kind: 'inZone', zones: ['field'] },
              { kind: 'not', filter: { kind: 'hasType', types: ['Flying'] } },
            ],
          },
          then: [{
            id: 'lands-energy-ko' as Clause['id'],
            trigger: 'onAttackResolve',
            when: [{ kind: 'spun', target: { kind: 'antecedent' }, match: { kind: 'color', colors: ['purple'] } }],
            actions: [{ do: 'knockOut', target: { kind: 'antecedent' } }],
            layer: 10,
            noStackKey: null,
            source: "Land's Energy",
          }],
        }],
        layer: 10,
        noStackKey: null,
        source: "Land's Energy",
      }],
    }),
  },
  {
    re: /break energy becomes dragon ascent\s*(\d+)?/i,
    build: (m) => ({
      do: 'replaceSegment',
      target: { kind: 'antecedent' },
      moveName: 'Dragon Ascent',
      duration: { kind: 'untilEndOfDuel' },
      damage: num(m[1], 90),
    }),
  },
  {
    re: /cannot mp move through this pok[eé]mon using the effect of an ability/i,
    build: () => ({
      do: 'denyPassThrough',
      movers: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      blockers: { kind: 'self' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /cannot pass by this pok[eé]mon with an mp move/i,
    build: () => ({
      do: 'denyPassThrough',
      movers: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }] },
      blockers: { kind: 'self' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /(?:it |this pok[eé]mon )?can attack pok[eé]mon that are (\d+) steps away/i,
    build: (m, subject) => ({
      do: 'setBattleRange',
      target: subject,
      range: num(m[1], 2),
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /(?:it may|this pok[eé]mon may) evolve if it'?s on the field/i,
    build: (_m, subject) => ({ do: 'evolve', target: subject }),
  },
  {
    re: /(?:it |this pok[eé]mon )?is removed from the duel/i,
    build: (_m, subject) => ({ do: 'exclude', target: subject, returnTo: null, returnAfterTurns: null }),
  },
  {
    re: /attach the marker to (?:a )?pok[eé]mon within x\+(\d+) steps/i,
    build: (m) => ({
      do: 'attachMarker',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [
          { kind: 'inZone', zones: ['field'] },
          { kind: 'within', steps: num(m[1], 1), of: { kind: 'self' }, plusZone: 'ultraSpace' },
        ],
      },
      marker: marker('photon'),
      value: null,
      duration: INSTANT,
    }),
  },
  {
    re: /the ability of a pok[eé]mon with a phot(?:on|o) marker is nullified/i,
    build: () => ({
      do: 'nullify',
      target: { kind: 'all', where: [{ kind: 'hasMarker', marker: marker('photon') }] },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /gains? \+(\d+)\s*[★*]/i,
    build: (m, subject) => ({ do: 'modifyStars', target: subject, delta: num(m[1], 1), duration: { kind: 'untilEndOfDuel' } }),
  },
  {
    re: /waits? (\d+) turns?/i,
    build: (m, subject) => ({
      do: 'attachMarker',
      target: subject,
      marker: marker('wait'),
      value: num(m[1], 1),
      duration: INSTANT,
    }),
  },
  {
    re: /allows? this pok[eé]mon to respin once/i,
    build: () => ({ do: 'respin', until: { kind: 'any' }, max: 1 }),
  },
  {
    re: /you can move this pok[eé]mon (\d+) steps/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'pointStepsAway', steps: num(m[1], 2), chooser: 'controller' },
    }),
  },
  {
    re: /takes? (\d+) steps? back/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'knockBack', steps: num(m[1], 1), chooser: 'controller' },
    }),
  },
  {
    re: /the next turn will always be your opponent'?s/i,
    build: () => ({ do: 'forceNextTurn', player: 'opponent' }),
  },
  {
    re: /so is this pok[eé]mon/i,
    build: () => ({ do: 'knockOut', target: { kind: 'self' } }),
  },
  {
    re: /cannot pass through your ([A-Za-z]+)-type pok[eé]mon by the effects of abilities/i,
    build: (m) => {
      const blocker = ((m[1] ?? 'Dark').replace(/^./, (c) => c.toUpperCase())) as PokemonType;
      const movers = /ghost-type pok[eé]mon and psychic/i.test(m[0])
        ? (['Ghost', 'Psychic'] as const)
        : (['Flying', 'Fairy'] as const);
      return {
        do: 'denyPassThrough',
        movers: {
          kind: 'all',
          where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'hasType', types: [...movers] }],
        },
        blockers: {
          kind: 'all',
          where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'hasType', types: [blocker] }],
        },
        duration: { kind: 'untilEndOfDuel' },
      };
    },
  },
  {
    re: /plates with sphere in their name, except for frost sphere, have their effects negated on opposing pok[eé]mon within (\d+) steps/i,
    build: (m) => ({
      do: 'nullify',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'inZone', zones: ['field'] },
          { kind: 'within', steps: num(m[1], 3), of: { kind: 'self' } },
        ],
      },
      duration: { kind: 'untilEndOfDuel' },
      plateNameIncludes: 'Sphere',
      exceptPlate: 'Frost Sphere',
    }),
  },
  {
    re: /all pok[eé]mon become ([A-Za-z]+)-type pok[eé]mon for (\d+) turns/i,
    build: (m) => ({
      do: 'setType',
      target: { kind: 'all', where: [] },
      types: parseTypes(m[1] ?? ''),
      duration: { kind: 'turns', count: num(m[2], 9) },
    }),
  },
  {
    re: /cannot be surrounded by ultra beasts/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'beSurroundedByUltraBeasts',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /cannot be surrounded(?: by your opponent's pok[eé]mon| itself)?/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'beSurrounded',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /cannot surround the opponent/i,
    build: (_m, subject) => ({
      do: 'prevent',
      target: subject,
      what: 'surround',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /(?:the battle opponent|this pok[eé]mon|it) returns? to (?:their|its) start-of-the-duel state|returns? (?:the battle opponent|this pok[eé]mon|it) to (?:their|its) start-of-the-duel state/i,
    build: (m) => ({
      do: 'resetToStart',
      target: /battle opponent/i.test(m[0]) ? { kind: 'battleOpponent' } : { kind: 'self' },
      keepEvolution: true,
      keepConditions: /excluding evolution and (?:any )?special conditions/i.test(m.input ?? m[0])
        || /excluding evolution and special/i.test(m.input ?? m[0]),
    }),
  },
  {
    re: /returns to the figure it was at the start of the duel/i,
    build: () => ({
      do: 'resetToStart',
      target: { kind: 'battleOpponent' },
      keepEvolution: true,
      keepConditions: false,
    }),
  },
  {
    re: /(?:if there are 2 or more water-type pok[eé]mon and 2 or more ground-type pok[eé]mon on the field, )?your opponent's pok[eé]mon on the field get \+(\d+) to wait effects that they receive/i,
    build: (m) => ({
      do: 'armTrigger',
      target: { kind: 'self' },
      trigger: 'passive',
      when: [{
        kind: 'allOf',
        of: [
          {
            kind: 'targetCount',
            selector: { kind: 'all', where: [{ kind: 'inZone', zones: ['field'] }, { kind: 'hasType', types: ['Water'] }] },
            op: 'gte',
            value: 2,
          },
          {
            kind: 'targetCount',
            selector: { kind: 'all', where: [{ kind: 'inZone', zones: ['field'] }, { kind: 'hasType', types: ['Ground'] }] },
            op: 'gte',
            value: 2,
          },
        ],
      }],
      then: [{
        do: 'modifyWaitReceived',
        target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'inZone', zones: ['field'] }] },
        delta: num(m[1], 1),
        duration: { kind: 'untilEndOfDuel' },
      }],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /gain \+(\d+) to the damage they deal after those pok[eé]mon move from p\.c\. to bench/i,
    build: (m) => ({
      do: 'armTrigger',
      target: { kind: 'self' },
      trigger: 'onPcToBench',
      when: [{ kind: 'hasType', target: { kind: 'antecedent' }, types: ['Fighting'] }],
      then: [{
        do: 'modifyDamage',
        target: { kind: 'antecedent' },
        modifier: { kind: 'flat', amount: num(m[1], 1) },
        duration: { kind: 'untilEndOfDuel' },
      }],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /whenever one of your bug-type or flying-type pok[eé]mon moves from the p\.c\. to the bench, it can evolve/i,
    build: () => ({
      do: 'armTrigger',
      target: { kind: 'self' },
      trigger: 'onPcToBench',
      when: [{ kind: 'hasType', target: { kind: 'antecedent' }, types: ['Bug', 'Flying'] }],
      then: [{ do: 'evolve', target: { kind: 'antecedent' } }],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /whenever this pok[eé]mon moves from (?:the|a) p\.c\. to the bench, it can evolve/i,
    build: (_m, subject) => ({ do: 'evolve', target: subject }),
  },
  {
    re: /may evolve when it moves from (?:the|a) p\.c\. to the bench/i,
    build: (_m, subject) => ({ do: 'evolve', target: subject }),
  },
  {
    re: /if you choose onix or scyther, evolve it/i,
    build: () => ({ do: 'evolve', target: { kind: 'antecedent' }, onlyNamed: ['Onix', 'Scyther'] }),
  },
  {
    re: /that damage increased by (\d+)/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'hasType', types: ['Electric'] },
          {
            kind: 'adjacentTo',
            of: { kind: 'all', where: [{ kind: 'hasType', types: ['Electric'] }] },
          },
        ],
      },
      modifier: { kind: 'flat', amount: num(m[1], 10) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /abilities that increase or decrease attack damage nullified/i,
    build: () => ({
      do: 'nullify',
      target: { kind: 'battleOpponent' },
      duration: { kind: 'untilEndOfDuel' },
      scope: 'damageModifiers',
    }),
  },
  {
    re: /if there are three or more opposing pok[eé]mon on the field or on your opponent's bench with the same name as the surrounded pok[eé]mon, remove the surrounded pok[eé]mon from the game/i,
    build: () => ({
      do: 'armTrigger',
      target: { kind: 'self' },
      trigger: 'onSurrounded',
      when: [{
        kind: 'targetCount',
        selector: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'opposing' },
            { kind: 'sameNameAs', of: { kind: 'antecedent' } },
          ],
        },
        op: 'gte',
        value: 3,
      }],
      then: [{ do: 'exclude', target: { kind: 'antecedent' }, returnTo: null, returnAfterTurns: null }],
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  { re: /^\(?a battle does not occur\.?\)?$/i, build: () => ({ do: 'tag', tag: 'noBattle' }) },
  { re: /^(?:it |this pok[eé]mon )?(?:may |can )?evolve(?:s)?(?: this pok[eé]mon| it)?$/i, build: (_m, subject) => ({ do: 'evolve', target: subject }) },
  {
    re: /when you do, (?:you may )?evolve this pok[eé]mon/i,
    build: (_m, subject) => ({ do: 'evolve', target: subject }),
  },
  { re: /deal(?:s)? damage x(\d+)/i, build: (m, subject) => ({ do: 'modifyDamage', target: subject, modifier: { kind: 'multiply', factor: num(m[1], 2) }, duration: INSTANT }) },
  {
    re: /move this pok[eé]mon back (two|\d+) steps/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'knockBack', steps: /two/i.test(m[1] ?? '') ? 2 : num(m[1], 2), chooser: 'controller' },
    }),
  },
  {
    re: /move this pok[eé]mon (\d+) steps/i,
    build: (m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'pointStepsAway', steps: num(m[1], 2), chooser: 'controller' },
    }),
  },
  {
    re: /before using this pok[eé]mon, you can switch its position with another one of your own pok[eé]mon in an adjacent space/i,
    build: () => ({
      do: 'move',
      target: { kind: 'self' },
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [{ kind: 'allegiance', of: 'ally' }, { kind: 'adjacentTo', of: { kind: 'self' } }],
        },
      },
    }),
  },
  {
    re: /instead of an mp move, this pok[eé]mon may move one of your (.+?) on the field next to itself/i,
    build: (m) => ({
      do: 'move',
      target: parseSelector(`one of your ${m[1] ?? ''} on the field`),
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'self' }, chooser: 'controller' },
    }),
  },
  {
    re: /move one of your (.+?) on the bench next to this pok[eé]mon/i,
    build: (m) => ({
      do: 'move',
      target: parseSelector(`one of your ${m[1] ?? ''} on the bench`),
      to: { kind: 'openSpotAdjacentTo', of: { kind: 'self' }, chooser: 'controller' },
    }),
  },
  {
    re: /all poisoned pok[eé]mon will do a further ([+-]\d+) damage/i,
    build: (m) => ({
      do: 'modifyDamage',
      target: { kind: 'all', where: [{ kind: 'hasCondition', conditions: ['poisoned'] }] },
      modifier: { kind: 'flat', amount: num(m[1], -20) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /negates abilities that boost or lower attack damage for your opponent/i,
    build: () => ({
      do: 'nullify',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'inZone', zones: ['field'] }] },
      duration: { kind: 'untilEndOfDuel' },
      scope: 'damageModifiers',
    }),
  },
  {
    re: /damage is increased by \+(\d+) for every ([a-z]+) pok[eé]mon it is connected to/i,
    build: (m, subject) => {
      const types = parseTypes(m[2] ?? '');
      if (!types.length) return null;
      return {
        do: 'modifyDamage',
        target: subject,
        modifier: {
          kind: 'flatByCount',
          amount: num(m[1], 10),
          of: {
            kind: 'figures',
            of: { kind: 'all', where: [{ kind: 'hasType', types }, { kind: 'succession', from: { kind: 'self' } }] },
          },
        },
        duration: { kind: 'untilEndOfDuel' },
      };
    },
  },
  {
    re: /gains? \+(\d+) damage$/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: { kind: 'flat', amount: num(m[1], 20) },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /the damage (?:this pok[eé]mon )?deals is increased by (\d+) for each ([A-Z][A-Za-z]+) adjacent to it/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: {
        kind: 'flatByCount',
        amount: num(m[1], 30),
        of: {
          kind: 'figures',
          of: {
            kind: 'all',
            where: [
              { kind: 'named', names: [m[2] ?? ''] },
              { kind: 'adjacentTo', of: { kind: 'self' } },
            ],
          },
        },
      },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /damage \+(\d+) for each of your own adjacent ([A-Z][A-Za-z]+)/i,
    build: (m, subject) => ({
      do: 'modifyDamage',
      target: subject,
      modifier: {
        kind: 'flatByCount',
        amount: num(m[1], 30),
        of: {
          kind: 'figures',
          of: {
            kind: 'all',
            where: [
              { kind: 'allegiance', of: 'ally' },
              { kind: 'named', names: [m[2] ?? ''] },
              { kind: 'adjacentTo', of: { kind: 'self' } },
            ],
          },
        },
      },
      duration: INSTANT,
    }),
  },
  {
    re: /the damage dealt to this pok[eé]mon by its battle opponents is cut in half/i,
    build: () => ({
      do: 'modifyDamage',
      target: { kind: 'battleOpponent' },
      modifier: { kind: 'multiply', factor: 0.5 },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /while that marker is attached, the attack the battle opponent spun this turn becomes a miss/i,
    build: () => ({
      do: 'replaceSegment',
      target: { kind: 'battleOpponent' },
      moveName: 'Miss',
      duration: { kind: 'untilEndOfTurn' },
    }),
  },
  {
    re: /if this pok[eé]mon or its battle opponent spins a blue attack, shift the spin to an attack next to it instead/i,
    build: () => ({
      do: 'shiftSpinResult',
      target: { kind: 'union', of: [{ kind: 'self' }, { kind: 'battleOpponent' }] },
      until: { kind: 'not', of: { kind: 'color', colors: ['blue'] } },
      duration: INSTANT,
    }),
  },
  {
    re: /opposing pok[eé]mon next to this pok[eé]mon cannot make mp moves/i,
    build: () => ({
      do: 'prevent',
      target: { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'adjacentTo', of: { kind: 'self' } }] },
      what: 'mpMove',
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /other pok[eé]mon cannot use fly away to pass over this pok[eé]mon/i,
    build: () => ({
      do: 'denyPassThrough',
      movers: { kind: 'all', where: [] },
      blockers: { kind: 'self' },
      duration: { kind: 'untilEndOfDuel' },
    }),
  },
  {
    re: /spin for (?:a )?pok[eé]mon within (\d+) steps/i,
    build: (m) => ({
      do: 'spinCheck',
      target: {
        kind: 'choose',
        count: 1,
        upTo: false,
        chooser: 'controller',
        where: [{ kind: 'inZone', zones: ['field'] }, { kind: 'within', steps: num(m[1], 2), of: { kind: 'self' } }],
      },
      then: [],
    }),
  },
  {
    re: /all adjacent pok[eé]mon now have wait(?: (\d+))?/i,
    build: (m) => ({
      do: 'attachMarker',
      target: { kind: 'all', where: [{ kind: 'adjacentTo', of: { kind: 'self' } }] },
      marker: marker('wait'),
      value: m[1] ? num(m[1], 1) : null,
      duration: INSTANT,
    }),
  },
  {
    re: /switches? the battle opponent with (?:an? )?opposing pok[eé]mon adjacent to the battle opponent/i,
    build: () => ({
      do: 'move',
      target: { kind: 'battleOpponent' },
      to: {
        kind: 'swapWith',
        with: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'adjacentTo', of: { kind: 'battleOpponent' } }],
        },
      },
    }),
  },
  {
    re: /move the battle opponent and opposing pok[eé]mon adjacent to the battle opponent to their p\.c/i,
    build: () => ({
      do: 'move',
      target: {
        kind: 'union',
        of: [
          { kind: 'battleOpponent' },
          { kind: 'all', where: [{ kind: 'allegiance', of: 'opposing' }, { kind: 'adjacentTo', of: { kind: 'battleOpponent' } }] },
        ],
      },
      to: { kind: 'zone', zone: 'pc' },
    }),
  },
  {
    re: /jumps? over the battle opponent, moving to a spot adjacent to it/i,
    build: (_m, subject) => ({
      do: 'move',
      target: subject,
      to: { kind: 'jumpOver', over: { kind: 'battleOpponent' }, minSteps: 1, maxSteps: 1 },
    }),
  },
  {
    re: /your used plates all return to their unused state/i,
    build: () => ({ do: 'refreshPlate', count: 99, player: 'controller' }),
  },
  {
    re: /opposing ([a-z]+) pok[eé]mon and ([a-z]+) pok[eé]mon within (\d+) steps of this pok[eé]mon have mp\s*([+-]\s*\d+)/i,
    build: (m) => {
      const types = [...parseTypes(m[1] ?? ''), ...parseTypes(m[2] ?? '')];
      if (!types.length) return null;
      return {
        do: 'modifyMp',
        target: {
          kind: 'all',
          where: [
            { kind: 'allegiance', of: 'opposing' },
            { kind: 'hasType', types },
            { kind: 'within', steps: num(m[3], 2), of: { kind: 'self' } },
          ],
        },
        delta: num((m[4] ?? '-1').replace(/\s+/g, ''), -1),
        duration: { kind: 'untilEndOfDuel' },
      };
    },
  },
  {
    re: /in either case, your turn ends/i,
    build: () => ({ do: 'endTurn' }),
  },
];

// --- triggers and guards ----------------------------------------------------

const TRIGGERS: readonly (readonly [RegExp, Trigger])[] = [
  [/^\*?\s*if this pok[eé]mon is knocked out,?\s*/i, 'onSelfKnockedOut'],
  [/^\*?\s*if the battle opponent is knocked out,?\s*/i, 'onOpponentKnockedOut'],
  [/^if this pok[eé]mon knocks out its battle opponent with one of its attacks,?\s*/i, 'onOpponentKnockedOut'],
  [/^if this pok[eé]mon surrounds (?:an opponent'?s|an opposing) pok[eé]mon,?\s*/i, 'onSurrounded'],
  [/^if one of your other pok[eé]mon is knocked out,?\s*/i, 'onFigureKnockedOut'],
  [/^if it mp moves through opposing pok[eé]mon that are frozen,?\s*/i, 'afterMove'],
  [/^if the pok[eé]mon it moved over is an opposing pok[eé]mon,?\s*/i, 'afterMove'],
  [/^if those pok[eé]mon are the opponent'?s pok[eé]mon,?\s*/i, 'afterMove'],
  [/^if this pok[eé]mon burns the battle opponent,?\s*/i, 'onConditionApplied'],
  [/^if this pok[eé]mon makes its battle opponent poisoned or noxious,?\s*/i, 'onConditionApplied'],
  [/^if this pok[eé]mon moves its battle opponent by the effect of an attack,?\s*/i, 'afterBattle'],
  [/^when this pok[eé]mon is attacked,?\s*/i, 'onAttacked'],
  [/^if this pok[eé]mon is attacked,?\s*/i, 'onAttacked'],
  [/^when attacked,?\s*/i, 'onAttacked'],
  [/^if this pok[eé]mon is not knocked out in battle,?\s*/i, 'afterBattle'],
  [/^(?:at the )?start of (?:your |the )?turn,?\s*/i, 'startOfTurn'],
  [/^at the start of (?:your |the )?turn,?\s*/i, 'startOfTurn'],
  [/^(?:at the )?end of (?:your |the )?turn,?\s*/i, 'endOfTurn'],
  [/^before (?:the )?battle,?\s*/i, 'beforeBattle'],
  [/^during (?:the |this )?battle,?\s*/i, 'duringBattle'],
  [/^after (?:making an mp move|moving),?\s*/i, 'afterMove'],
  [/^while this pok[eé]mon is on the field,?\s*/i, 'passive'],
  [/^when this pok[eé]mon moves from the bench to the field,?\s*/i, 'onEnterField'],
  [/^when this pok[eé]mon moves to the field,?\s*/i, 'onEnterField'],
  [/^after this pok[eé]mon battles,?\s*/i, 'afterBattle'],
  [/^when this pok[eé]mon is on the field,?\s*/i, 'passive'],
  [/^if this pok[eé]mon is on the field,?\s*/i, 'passive'],
  [/^while (?:it|that pok[eé]mon) (?:is|does) on the field,?\s*/i, 'passive'],
  [/^until the end of the duel,?\s*/i, 'passive'],
  [/^during this (?:duel|turn),?\s*/i, 'passive'],
  [/^whenever (?:this pok[eé]mon|one of your .+?) moves from (?:the|a) p\.c\. to the bench,?\s*/i, 'onPcToBench'],
  [/^if any of your (.+?) becomes? knocked out,?\s*/i, 'onFigureKnockedOut'],
];

/** Pull a leading trigger phrase off the clause, returning the trigger and the rest. */
function extractTrigger(text: string): { trigger: Trigger; rest: string } {
  // Plate playability, rewritten into an `if`-guarded gate so the shared guard parser
  // handles it. 33 clauses, the largest single uncompiled group before this.
  const gate = text.match(/^this plate can (?:only )?be (?:used|played)\s+(?:when|if)\s+(.+)$/i);
  if (gate?.[1]) return { trigger: 'usageRestriction', rest: `if ${gate[1].replace(/\s*\.$/, '')}, gate` };

  if (/this plate can be used again if the opponent uses a plate that is not/i.test(text)) {
    return { trigger: 'onPlatePlayed', rest: text };
  }
  const namedKo = text.match(/^if any of your (.+?) becomes? knocked out,?\s*(.+)$/i);
  if (namedKo?.[1] && namedKo[2]) {
    return { trigger: 'onFigureKnockedOut', rest: `if the knocked out is ${namedKo[1]}, ${namedKo[2]}` };
  }
  if (/ultra beasts knocked out by its attack damage are excluded/i.test(text)) {
    return {
      trigger: 'onOpponentKnockedOut',
      rest: `If the knocked out Pokémon is an Ultra Beast, ${text}`,
    };
  }
  if (/without moving to the p\.c/i.test(text) && /knocked out/i.test(text)) {
    return { trigger: 'passive', rest: text };
  }
  if (/used an? mp move this turn and is next to this pok/i.test(text) && /cannot attack/i.test(text)) {
    return { trigger: 'passive', rest: text };
  }
  if (/when your deoxys is attacked/i.test(text)) {
    return { trigger: 'passive', rest: text };
  }
  if (/^before using this pok/i.test(text)) {
    return { trigger: 'startOfTurn', rest: text };
  }
  if (
    /^(?:this pok[eé]mon negates abilities|opposing pok[eé]mon next to this|the damage dealt to this pok|opposing [a-z]+ pok[eé]mon and [a-z]+ pok[eé]mon within|all poisoned pok[eé]mon will do|other pok[eé]mon cannot use fly away)/i.test(text)
    || /damage is increased by \+\d+ for every .+ connected to/i.test(text)
    || /gains? \+\d+ damage in battles in your turn/i.test(text)
    || /can move up to \d+ steps? in a straight line/i.test(text)
    || /cannot enter the field using an mp move/i.test(text)
    || /gains? \+\d+ damage for each pok[eé]mon in your p\.c/i.test(text)
    || /type becomes the type of the chosen pok[eé]mon/i.test(text)
    || /the marker and any special conditions/i.test(text)
    || /your [a-z]+ pok[eé]mon receive a \+\d+ boost/i.test(text)
    || /(?:may|can) (?:mp )?move over/i.test(text)
    || /can use an mp move to fly over/i.test(text)
    || /this pok[eé]mon cannot battle/i.test(text)
    || /(?:may|can) (?:mp )?move past/i.test(text)
    || /all poisoned and noxious pok[eé]mon have mp/i.test(text)
    || /any pok[eé]mon adjacent to this pok[eé]mon will do/i.test(text)
    || /the damage that this pok[eé]mon deals is increased/i.test(text)
    || /the attack damage dealt to this pok/i.test(text)
    || /protected from instant knock out/i.test(text)
    || /must mp move as far as its mp range/i.test(text)
    || /can mp move through other pok/i.test(text)
    || /can mp move from the bench past/i.test(text)
    || /do not attach markers to this pok/i.test(text)
    || /within two steps of this pok[eé]mon are not affected by new special/i.test(text)
    || /gold attacks of (?:this pok[eé]mon'?s )?battle opponents become white/i.test(text)
    || /has mp\s*\d+ if it is confused/i.test(text)
    || /cannot pass by this pok[eé]mon by means of the effects of their abilities/i.test(text)
    || /battle opponents have the in-battle effects of their abilities nullified/i.test(text)
    || /sleeping opposing pok[eé]mon next to this pok/i.test(text)
    || /damage it deals to this pok[eé]mon is reduced by/i.test(text)
    || /effects of energy plates are negated/i.test(text)
    || /can mp move past fire pok/i.test(text)
    || /its opponents deal [+-]\d+ attack damage/i.test(text)
    || /pok[eé]mon that are not poison pok[eé]mon or steel pok/i.test(text)
    || /your water pok[eé]mon can mp move through/i.test(text)
    || /whenever your water pok[eé]mon move from the bench/i.test(text)
    || /cannot pass by this pok[eé]mon nor a continuous succession/i.test(text)
    || /your opponent'?s dark(?:-type)? pok[eé]mon will do/i.test(text)
    || /is not subject to spin-inducing/i.test(text)
    || /not knocked out by gold attacks/i.test(text)
    || /for effects that move (?:this pok[eé]mon|it)'?s battle opponent/i.test(text)
    || /deals? \+\d+ attack damage for each pok[eé]mon in the ultra space/i.test(text)
    || /gets? \+\d+ mp for each pok[eé]mon in the ultra space/i.test(text)
    || /mp cannot be \d+ or lower/i.test(text)
    || /can mp move past fire pok/i.test(text)
    || /battle opponent'?s attacks cannot attach markers/i.test(text)
    || /gets? \+\d+ mp for each species of regi/i.test(text)
    || /your (?:normal|flying) pok[eé]mon take [+-]\d+ damage/i.test(text)
    || /your fire pok[eé]mon take \d+ less damage/i.test(text)
    || /opposing ice pok[eé]mon next to your ice/i.test(text)
    || /your grass pok[eé]mon ignore knockout/i.test(text)
    || /any effect of (?:this pok[eé]mon|it)'?s battle opponent'?s ability that would increase attack damage/i.test(text)
    || /has mp \d+ while on the field/i.test(text)
    || /gets? mp \+\d+/i.test(text)
    || /opposing paralyzed pok[eé]mon have mp/i.test(text)
    || /opposing flying and dragon pok[eé]mon each have mp/i.test(text)
    || /gold attacks of battle opponents of your dragon and psychic/i.test(text)
    || /gold attacks of battle opponents that have an? mp-reducing/i.test(text)
    || /gold attacks of battle opponents with mp-reducing/i.test(text)
    || /plates cannot be used on opposing pok/i.test(text)
    || /opposing pok[eé]mon cannot tag/i.test(text)
    || /cannot tag or be tagged/i.test(text)
    || /cannot be removed by tagging/i.test(text)
    || /sleeping pok[eé]mon within \d+ steps/i.test(text)
    || /can(?:no|'?)t be paralyzed/i.test(text)
    || /always attack after moving/i.test(text)
    || /one additional space on the board when moving from the bench/i.test(text)
    || /opposing [a-z]+ and [a-z]+ pok[eé]mon within \d+ steps/i.test(text)
    || /not affected by effects of the battle opponent that would apply any markers/i.test(text)
    || /cannot change forms with an ability/i.test(text)
    || /when placed adjacent to this pok/i.test(text)
    || /your water-type pok[eé]mon and (?:your )?ground-type pok[eé]mon/i.test(text)
    || /burned pok[eé]mon have mp/i.test(text)
    || /abilities of opposing electric pok[eé]mon and opposing paralyzed/i.test(text)
    || /negates status effects for your opponent's white attacks/i.test(text)
    || /add \+\d+ spin to the spin-again attacks/i.test(text)
    || /added damage and number of persistent turns of attack effects/i.test(text)
    || /mega evolution does not end via passage of turns/i.test(text)
    || /do not move to the ultra space from the effects/i.test(text)
    || /ultra beasts do not move from the ultra space/i.test(text)
    || /cannot use the effect of air balloon/i.test(text)
    || /cannot mp move through a point next to this pok/i.test(text)
    || /attack damage-increasing effects on flying battle opponents/i.test(text)
    || /your pok[eé]mon cannot become affected by special conditions/i.test(text)
    || /your fairy pok[eé]mon that are not affected by a special condition are not knocked out/i.test(text)
    || /this pok[eé]mon is not affected by taunt/i.test(text)
  ) {
    return { trigger: 'passive', rest: text };
  }
  if (/^in battles on your turn/i.test(text)) {
    return { trigger: 'duringBattle', rest: text.replace(/^in battles on your turn,?\s*/i, '') };
  }
  if (/respin just once in battles on your turn/i.test(text)) {
    return { trigger: 'duringBattle', rest: text };
  }
  if (/spins when it attacks its battle opponent/i.test(text)) {
    return { trigger: 'beforeBattle', rest: text };
  }
  if (/^if it knocks out a pok[eé]mon with a cracked marker/i.test(text)) {
    return {
      trigger: 'onOpponentKnockedOut',
      rest: text.replace(/^if it knocks out a pok[eé]mon with a cracked marker(?: on it)?,?\s*/i, ''),
    };
  }
  if (/the dodges of opposing pok[eé]mon adjacent/i.test(text)) {
    return { trigger: 'beforeBattle', rest: text };
  }
  if (/white attacks become gold/i.test(text) && /within \d+ steps/i.test(text)) {
    return { trigger: 'beforeBattle', rest: text };
  }
  if (/has evolved, and its attack lands on miss/i.test(text)) {
    return { trigger: 'duringBattle', rest: text };
  }
  if (/gold attacks of battle opponents/i.test(text) && /become white/i.test(text)) {
    return { trigger: 'beforeBattle', rest: text };
  }
  if (/the next turn after using/i.test(text) && /unable to use plates/i.test(text)) {
    return { trigger: 'afterMove', rest: text };
  }
  if (/when this pok[eé]mon leaves the field/i.test(text)) {
    return { trigger: 'onLeaveField', rest: text.replace(/when this pok[eé]mon leaves the field,?\s*/i, '') };
  }
  if (/when this pok[eé]mon surrounds an opposing pok[eé]mon/i.test(text)) {
    return {
      trigger: 'onSurrounded',
      rest: text.replace(/when this pok[eé]mon surrounds an opposing pok[eé]mon,?\s*/i, ''),
    };
  }
  if (/when one or more of your .+ surround an opposing pok[eé]mon/i.test(text)) {
    return { trigger: 'onSurrounded', rest: text };
  }
  if (/pok[eé]mon that have battled this pok[eé]mon become/i.test(text)) {
    return { trigger: 'afterBattle', rest: text };
  }
  if (/when this pok[eé]mon becomes .+ by an attack/i.test(text)) {
    return {
      trigger: 'onConditionApplied',
      rest: text.replace(/^when this pok[eé]mon becomes .+? by an attack,?\s*/i, ''),
    };
  }
  if (/this pok[eé]mon is on the bench, at the beginning of your turn/i.test(text)) {
    return { trigger: 'startOfTurn', rest: text };
  }
  if (/until it engages in its first battle after moving to the field,?\s*at the start of your turn/i.test(text)) {
    return {
      trigger: 'startOfTurn',
      rest: text.replace(/^(?:until it engages in its first battle after moving to the field,?\s*)?(?:at the start of your turn,?\s*)?/i, ''),
    };
  }
  if (/after its first battle since moving to the field/i.test(text)) {
    return {
      trigger: 'afterBattle',
      rest: text.replace(/^after its first battle since moving to the field,?\s*/i, ''),
    };
  }
  if (/in (?:this pok[eé]mon'?s |its )?first battle after moving to the field/i.test(text)
    || /until the end of (?:this pok[eé]mon'?s )?first battle after moving/i.test(text)
    || /until it engages in its first battle after moving/i.test(text)
  ) {
    return { trigger: 'passive', rest: text };
  }
  if (/appears as a mega evolution, and again when its mega evolution ends/i.test(text)) {
    return {
      trigger: 'onMegaStart',
      rest: text.replace(/^when this pok[eé]mon appears as a mega evolution, and again when its mega evolution ends,?\s*/i, ''),
    };
  }
  if (/moved over in this way are now burned/i.test(text)) {
    return { trigger: 'afterMove', rest: text };
  }
  if (/any pok[eé]mon adjacent to it, except for flying/i.test(text)) {
    return { trigger: 'passive', rest: text };
  }
  if (/after moving, .+ attack .+ again/i.test(text)) {
    return { trigger: 'onAttackResolve', rest: text.replace(/^after moving,?\s*/i, '') };
  }
  if (/^both pok[eé]mon spin twice/i.test(text) || /same attack both times/i.test(text)) {
    return { trigger: 'duringBattle', rest: text };
  }
  if (/when this pok[eé]mon is on the field,?\s*at the start of your turn/i.test(text)) {
    return {
      trigger: 'startOfTurn',
      rest: text.replace(/when this pok[eé]mon is on the field,?\s*/i, '').trim(),
    };
  }
  if (/cannot move by effects other than/i.test(text)) {
    return { trigger: 'duringBattle', rest: text };
  }
  if (/^if it changes its form/i.test(text)) {
    return { trigger: 'startOfTurn', rest: text };
  }
  if (/the opponent'?s attack deals more than half/i.test(text)) {
    return { trigger: 'afterBattle', rest: text };
  }
  if (/sweet scent is spun on the field/i.test(text)) {
    return { trigger: 'onNamedSpin', rest: text };
  }
  if (/force them to respin/i.test(text)) {
    return { trigger: 'duringBattle', rest: text };
  }
  if (/when moving this pok[eé]mon from the bench/i.test(text)) {
    return { trigger: 'passive', rest: text };
  }
  if (/must attack it on that turn/i.test(text)) {
    return { trigger: 'passive', rest: text };
  }
  if (/route move/i.test(text) && /start of your turn/i.test(text)) {
    return { trigger: 'startOfTurn', rest: text.replace(/^(?:at the )?start of (?:your |the )?turn,?\s*/i, '') };
  }
  if (/instead of (?:using |making )?(?:an )?mp move/i.test(text) && /start of your turn/i.test(text)) {
    return { trigger: 'startOfTurn', rest: text.replace(/^(?:at the )?start of (?:your |the )?turn,?\s*/i, '') };
  }
  if (/^instead of (?:using |making )?(?:an )?mp move/i.test(text)) {
    return { trigger: 'startOfTurn', rest: text };
  }
  if (/if this pok[eé]mon is on the field and is not affected by a special condition/i.test(text)) {
    return { trigger: 'passive', rest: text };
  }
  if (/finishes an mp move next to/i.test(text)) {
    return { trigger: 'afterMove', rest: text };
  }
  if (
    /your opponent'?s spins are shifted/i.test(text)
    || /cannot move using the effects of (?:moves|attacks), abilities,? or energy/i.test(text)
    || /frozen pok[eé]mon next to this pok[eé]mon cannot be tagged/i.test(text)
    || /the (?:asleep|sleep) condition is not removed/i.test(text)
    || /loses any ability effects that allow it to mp move through/i.test(text)
    || /opposing ghost pok[eé]mon cannot use the effect of an ability/i.test(text)
    || /can move to your goal point instead of making an? mp move/i.test(text)
  ) {
    return { trigger: 'passive', rest: text };
  }
  if (/it passes through/i.test(text)) {
    return { trigger: 'afterMove', rest: text };
  }
  if (/before this pok[eé]mon would be surrounded/i.test(text)) {
    return {
      trigger: 'onSurrounded',
      rest: text
        .replace(/^(?:just once,?\s+)?/i, '')
        .replace(/before this pok[eé]mon would be surrounded,?\s*/i, '')
        .trim(),
    };
  }

  for (const [re, trigger] of TRIGGERS) {
    if (re.test(text)) {
      if (trigger === 'passive' && /\bafter (?:the )?battle\b/i.test(text)) {
        return {
          trigger: 'afterBattle',
          rest: text.replace(/,?\s*\bafter (?:the )?battle\b/i, '').trim(),
        };
      }
      let rest = text.replace(re, '').replace(/,?\s*\bafter (?:the )?battle\b/i, '').trim();
      if (trigger === 'onEnterField') {
        rest = rest.replace(/^or (?:when this pok[eé]mon )?appears as (?:a mega evolution|an? evolution),?\s*/i, '').trim();
      }
      return { trigger, rest };
    }
  }
  // A trailing "after battle" retimes the clause without changing its subject.
  if (/\bafter (?:the )?battle\b/i.test(text)) {
    return { trigger: 'afterBattle', rest: text.replace(/,?\s*\bafter (?:the )?battle\b/i, '').trim() };
  }
  return { trigger: 'onAttackResolve', rest: text };
}

/** Parse a single guard phrase. Shared by `if ...` clauses and plate usage gates. */
export function parseCondition(raw: string): Condition {
  const t = raw.trim();
  let g: RegExpMatchArray | null;

  if ((g = t.match(/^none of (.+?) (?:are|is) mega evolved$/i))) {
    return {
      kind: 'targetCount',
      selector: { kind: 'all', where: [...parseFiltersOf(g[1] ?? ''), { kind: 'isMegaEvolved', value: true }] },
      op: 'eq',
      value: 0,
    };
  }
  if (/there is space in your p\.c/i.test(t)) {
    return { kind: 'pcHasSpace', whose: 'controller' };
  }
  if (/your pok[eé]mon fill either your p\.c\. or your opponent'?s p\.c/i.test(t)) {
    return {
      kind: 'anyOf',
      of: [
        { kind: 'not', of: { kind: 'pcHasSpace', whose: 'controller' } },
        { kind: 'not', of: { kind: 'pcHasSpace', whose: 'opponent' } },
      ],
    };
  }
  if (/the opponent'?s pok[eé]mon is knocked out/i.test(t)) {
    return { kind: 'isBattleWinner' };
  }
  if (/^barrage is spun$/i.test(t)) {
    return { kind: 'namedAttackSpun', names: ['Barrage'] };
  }
  if (/it does either of these things/i.test(t) || /^it does$/i.test(t)) {
    return { kind: 'precedingActionTaken' };
  }
  if (/the battle opponent is under an effect that increases attack damage/i.test(t)) {
    return { kind: 'hasDamageIncrease', target: { kind: 'battleOpponent' } };
  }
  if (/this pok[eé]mon burns the battle opponent/i.test(t)) {
    return { kind: 'appliedCondition', conditions: ['burned'] };
  }
  if (/this pok[eé]mon makes its battle opponent poisoned or noxious/i.test(t)) {
    return { kind: 'appliedCondition', conditions: ['poisoned', 'noxious'] };
  }
  if (/this pok[eé]mon moves its battle opponent by the effect of an attack/i.test(t)) {
    return { kind: 'attackMovedOpponent' };
  }
  if (/those pok[eé]mon are the opponent'?s pok[eé]mon/i.test(t)
    || /the moved pok[eé]mon is one of the opponent'?s pok[eé]mon/i.test(t)) {
    return {
      kind: 'targetExists',
      selector: {
        kind: 'except',
        from: { kind: 'antecedent' },
        remove: { kind: 'all', where: [{ kind: 'allegiance', of: 'ally' }] },
      },
    };
  }
  if (/it is a ([A-Za-z]+)-? or ([A-Za-z]+) pok[eé]mon/i.test(t)) {
    const rockFairy = t.match(/it is a ([A-Za-z]+)-? or ([A-Za-z]+) pok[eé]mon/i);
    const types = parseTypes(`${rockFairy?.[1] ?? ''} ${rockFairy?.[2] ?? ''}`);
    if (types.length) {
      return {
        kind: 'anyOf',
        of: types.map((type) => ({ kind: 'hasType' as const, target: { kind: 'battleOpponent' as const }, types: [type] })),
      };
    }
  }
  if (/the opponent'?s pok[eé]mon used an? mp move this turn and is next to this pok/i.test(t)) {
    return {
      kind: 'targetExists',
      selector: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'movedThisTurn', value: true },
          { kind: 'inZone', zones: ['field'] },
        ],
      },
    };
  }
  if (/the knocked out pok[eé]mon is an? ultra beast/i.test(t)) {
    return {
      kind: 'targetExists',
      selector: {
        kind: 'except',
        from: { kind: 'antecedent' },
        remove: { kind: 'all', where: [{ kind: 'not', filter: { kind: 'isUltraBeast' } }] },
      },
    };
  }
  if (/sweet scent is spun on the field/i.test(t)) {
    return { kind: 'namedAttackSpun', names: ['Sweet Scent'] };
  }
  if (/your opponent spins a purple attack/i.test(t)) {
    return { kind: 'spun', target: { kind: 'battleOpponent' }, match: { kind: 'color', colors: ['purple'] } };
  }
  if (/finishes an mp move next to this pok/i.test(t)) {
    return {
      kind: 'targetExists',
      selector: {
        kind: 'all',
        where: [
          { kind: 'adjacentTo', of: { kind: 'self' } },
          { kind: 'inZone', zones: ['field'] },
          { kind: 'movedThisTurn', value: true },
        ],
      },
    };
  }
  if (/there is a succession of grass types adjacent to the first/i.test(t)) {
    return {
      kind: 'targetExists',
      selector: {
        kind: 'all',
        where: [
          { kind: 'hasType', types: ['Grass'] },
          { kind: 'inZone', zones: ['field'] },
          {
            kind: 'succession',
            from: {
              kind: 'all',
              where: [
                { kind: 'hasType', types: ['Grass'] },
                { kind: 'adjacentTo', of: { kind: 'self' } },
              ],
            },
          },
        ],
      },
    };
  }
  if (/^it is open$/i.test(t)) {
    return { kind: 'goalOpen', whose: 'controller' };
  }
  if (/there are pok[eé]mon at three entry points/i.test(t)) {
    return {
      kind: 'targetCount',
      selector: { kind: 'all', where: [{ kind: 'atEntryPoint' }] },
      op: 'gte',
      value: 3,
    };
  }
  if ((g = t.match(/^there (?:are|is) (.+)$/i))) {
    return { kind: 'targetExists', selector: parseSelector(g[1] ?? '') };
  }
  if (/spins the same attack both times/i.test(t)) {
    return { kind: 'sameAttackBothTimes', target: { kind: 'battleOpponent' } };
  }
  if ((g = t.match(/^(.*?)\s+spins? (.*)$/i))) {
    const head = (g[1] ?? '').trim();
    const target = /^it$/i.test(head) ? { kind: 'antecedent' as const } : parseSelector(head);
    return { kind: 'spun', target, match: parseSpinPredicate(g[2] ?? '') };
  }
  if ((g = t.match(/^(.*?)'?s? attack is (\d+) damage or (?:more|higher)/i))) {
    return { kind: 'spun', target: parseSelector(g[1] ?? ''), match: { kind: 'damage', colors: ['white', 'gold'], op: 'gte', value: num(g[2], 0) } };
  }
  if ((g = t.match(/^(.*?)'?s? attack is (\d+)(?: damage)? or (?:more|higher|greater)/i))) {
    return { kind: 'spun', target: parseSelector(g[1] ?? ''), match: { kind: 'damage', colors: ['white', 'gold'], op: 'gte', value: num(g[2], 0) } };
  }
  if ((g = t.match(/^(.*?)'?s? attack is (\d+)(?: damage)? or below/i))) {
    return { kind: 'spun', target: parseSelector(g[1] ?? ''), match: { kind: 'damage', colors: ['white', 'gold'], op: 'lte', value: num(g[2], 0) } };
  }
  if ((g = t.match(/^(.*?)\s+has mp\s*(\d+) or higher/i))) {
    return { kind: 'mp', target: parseSelector(g[1] ?? ''), op: 'gte', value: num(g[2], 3) };
  }
  if ((g = t.match(/^it is (?:an? )?(asleep|burned|frozen|confused|paralyzed|poisoned|noxious)$/i))) {
    return { kind: 'hasCondition', target: { kind: 'self' }, conditions: [(g[1] ?? 'confused').toLowerCase() as SpecialCondition] };
  }
  if ((g = t.match(/^(.*?)\s+is (?:an? )?(asleep|burned|frozen|confused|paralyzed|poisoned|noxious)$/i))) {
    return { kind: 'hasCondition', target: parseSelector(g[1] ?? ''), conditions: [(g[2] ?? '') as SpecialCondition] };
  }
  if (/does not have any other types/i.test(t)) {
    const types = parseTypes(t);
    const type = types[0];
    if (type !== undefined) {
      return { kind: 'exclusiveType', target: { kind: 'battleOpponent' }, type };
    }
  }
  if (/is (?:an? )?(?:non-)?flying pok/i.test(t) && /non-flying|not a flying/i.test(t)) {
    return { kind: 'not', of: { kind: 'hasType', target: { kind: 'battleOpponent' }, types: ['Flying'] } };
  }
  if (/is not a flying pok/i.test(t)) {
    return { kind: 'not', of: { kind: 'hasType', target: { kind: 'self' }, types: ['Flying'] } };
  }
  if ((g = t.match(/^the battle opponent is ([A-Z][A-Za-z]+)$/))) {
    return { kind: 'targetExists', selector: { kind: 'all', where: [{ kind: 'named', names: [g[1] ?? ''] }] } };
  }
  if (/its battle opponent is not evolved/i.test(t)) {
    return { kind: 'isEvolved', target: { kind: 'battleOpponent' }, value: false };
  }
  if ((g = t.match(/one of your(?: own)? ([A-Z][A-Za-z]+) is within (\d+) steps/i))) {
    return {
      kind: 'targetExists',
      selector: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'named', names: [g[1] ?? ''] },
          { kind: 'within', steps: num(g[2], 2), of: { kind: 'self' } },
        ],
      },
    };
  }
  if ((g = t.match(/any of your other (.+?) (?:is|are) within (\d+) steps/i))) {
    const names = (g[1] ?? '').split(/\s*(?:,|\bor\b)\s*/).map((n) => n.trim()).filter(Boolean);
    return {
      kind: 'targetExists',
      selector: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'named', names },
          { kind: 'within', steps: num(g[2], 2), of: { kind: 'self' } },
        ],
      },
    };
  }
  if ((g = t.match(/^(?:your |one of your )(.+?) is adjacent to this pok/i))) {
    const names = (g[1] ?? '').split(/\s*(?:,|\bor\b)\s*/).map((n) => n.trim()).filter(Boolean);
    return {
      kind: 'targetExists',
      selector: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'ally' },
          { kind: 'named', names },
          { kind: 'adjacentTo', of: { kind: 'self' } },
        ],
      },
    };
  }
  if (/fairy(?:-type)? pok[eé]mon that is not a steel/i.test(t)) {
    return {
      kind: 'allOf',
      of: [
        { kind: 'hasType', target: { kind: 'battleOpponent' }, types: ['Fairy'] },
        { kind: 'not', of: { kind: 'hasType', target: { kind: 'battleOpponent' }, types: ['Steel'] } },
      ],
    };
  }
  if ((g = t.match(/^(.*?)\s+is (?:an? )?([A-Za-z]+)[- ]?type(?: pok[eé]mon)?$/i)) || (g = t.match(/^(.*?)\s+is (?:an? )?([A-Za-z]+) pok[eé]mon$/i))) {
    const types = parseTypes(g[2] ?? '');
    if (types.length) return { kind: 'hasType', target: parseSelector(g[1] ?? ''), types };
  }
  if ((g = t.match(/^(?:the )?(?:knocked out )?(?:opposing |opponent )?pok[eé]mon is (?:an? )?(.+)$/i))) {
    const types = parseTypes(g[1] ?? '');
    if (types.length) return { kind: 'hasType', target: { kind: 'battleOpponent' }, types };
  }
  if (/mega evolved or has evolved or changed its form/i.test(t)) {
    return {
      kind: 'anyOf',
      of: [
        { kind: 'isMegaEvolved', target: { kind: 'battleOpponent' }, value: true },
        { kind: 'isEvolved', target: { kind: 'battleOpponent' }, value: true },
        { kind: 'hasChangedForm', target: { kind: 'battleOpponent' } },
      ],
    };
  }
  if (/battle opponent'?s mp is 0 or less/i.test(t)) {
    return { kind: 'mp', target: { kind: 'battleOpponent' }, op: 'lte', value: 0 };
  }
  if ((g = t.match(/^(.*?)\s+(?:is|are) on the (field|bench)$/i))) {
    return { kind: 'inZone', target: parseSelector(g[1] ?? ''), zones: [(g[2] ?? 'field') === 'bench' ? 'bench' : 'field'] };
  }
  if (/^it does$|^you do$|^it did$/i.test(t)) return { kind: 'precedingActionTaken' };
  if (/^it'?s on the field$/i.test(t)) {
    return { kind: 'inZone', target: { kind: 'self' }, zones: ['field'] };
  }
  if (/not affected(?: by)? a special condition/i.test(t)) {
    const target = /battle opponent/i.test(t) ? { kind: 'battleOpponent' as const }
      : /those pok/i.test(t) ? { kind: 'antecedent' as const }
      : { kind: 'self' as const };
    return { kind: 'not', of: { kind: 'hasCondition', target, conditions: [...SPECIAL_CONDITIONS] } };
  }
  if (/(?:has|is affected by|is affected by a) (?:a )?special condition/i.test(t)) {
    const target = /battle opponent|opposing pok/i.test(t) ? { kind: 'battleOpponent' as const }
      : /an opponent'?s pok/i.test(t)
        ? { kind: 'all' as const, where: [{ kind: 'allegiance' as const, of: 'opposing' as const }, { kind: 'inZone' as const, zones: ['field' as const] }] }
      : { kind: 'self' as const };
    return { kind: 'hasCondition', target, conditions: [...SPECIAL_CONDITIONS] };
  }
  if (/has a charge marker/i.test(t)) {
    return { kind: 'hasMarker', target: { kind: 'self' }, marker: marker('charge') };
  }
  if (/has a cracked marker/i.test(t)) {
    return { kind: 'hasMarker', target: { kind: 'battleOpponent' }, marker: marker('cracked') };
  }
  if (/the battle opponent has wait/i.test(t) || /adjacent to the battle opponent have wait/i.test(t)) {
    return { kind: 'hasWait', target: { kind: 'battleOpponent' } };
  }
  if (/affected by a special condition or has wait/i.test(t)) {
    return {
      kind: 'not',
      of: {
        kind: 'not',
        of: { kind: 'hasCondition', target: { kind: 'battleOpponent' }, conditions: [...SPECIAL_CONDITIONS] },
      },
    };
  }
  if (/battle opponent'?s mp is (?:the same or )?higher than this pok/i.test(t)) {
    const op = /the same or/.test(t) ? 'gte' as const : 'gt' as const;
    return { kind: 'mpCompare', left: { kind: 'battleOpponent' }, op, right: { kind: 'self' } };
  }
  if (/this pok[eé]mon is evolved/i.test(t)) return { kind: 'isEvolved', target: { kind: 'self' }, value: true };
  if (/this pok[eé]mon has changed its form/i.test(t) || /^it changes its form$/i.test(t)) {
    return { kind: 'hasChangedForm', target: { kind: 'self' } };
  }
  if (/the battle is a tie/i.test(t)) return { kind: 'battleTied' };
  if (/only valid on your turn|it is your turn/i.test(t)) return { kind: 'isTurnPlayer', who: 'controller' };
  if (/this pok[eé]mon is at an entry point/i.test(t)) return { kind: 'atEntryPoint', target: { kind: 'self' } };
  if (/you have pok[eé]mon on all of your opponent'?s entry points/i.test(t)) {
    return { kind: 'entryPointsFilled', whose: 'opponent', by: 'ally' };
  }
  if (/you have enemy pok[eé]mon on all of your entry points/i.test(t)) {
    return { kind: 'entryPointsFilled', whose: 'controller', by: 'opposing' };
  }
  if (/opposing pok[eé]mon do not occupy all of your entry points/i.test(t)) {
    return { kind: 'not', of: { kind: 'entryPointsFilled', whose: 'controller', by: 'opposing' } };
  }
  if (/there are opposing pok[eé]mon on all your entry points/i.test(t)) {
    return { kind: 'entryPointsFilled', whose: 'controller', by: 'opposing' };
  }
  if ((g = t.match(/there are no opposing pok[eé]mon within (\d+) steps/i))) {
    return {
      kind: 'targetCount',
      selector: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'inZone', zones: ['field'] },
          { kind: 'within', steps: num(g[1], 2), of: { kind: 'self' } },
        ],
      },
      op: 'eq',
      value: 0,
    };
  }
  if ((g = t.match(/this pok[eé]mon is using the ([A-Za-z][A-Za-z ]+?) plate/i))) {
    return { kind: 'usingPlate', name: (g[1] ?? '').trim() };
  }
  if (/any of your drive plates have been used/i.test(t)) {
    return { kind: 'usingPlate', name: 'Drive' };
  }
  if (/the result is anything other than a blue attack/i.test(t)) {
    return { kind: 'spun', target: { kind: 'self' }, match: { kind: 'not', of: { kind: 'color', colors: ['blue'] } } };
  }
  if (/a purple attack is spun|it lands on purple/i.test(t)) {
    return { kind: 'spun', target: { kind: 'self' }, match: { kind: 'color', colors: ['purple'] } };
  }
  if (/it knocks out a pok[eé]mon with a cracked marker/i.test(t)) {
    return { kind: 'hasMarker', target: { kind: 'battleOpponent' }, marker: marker('cracked') };
  }
  if (/the battle opponent is poisoned or noxious/i.test(t)) {
    return { kind: 'hasCondition', target: { kind: 'battleOpponent' }, conditions: ['poisoned', 'noxious'] };
  }
  if (/this pok[eé]mon is not poisoned or noxious/i.test(t)) {
    return { kind: 'not', of: { kind: 'hasCondition', target: { kind: 'self' }, conditions: ['poisoned', 'noxious'] } };
  }
  if (/it is not noxious/i.test(t)) {
    return { kind: 'not', of: { kind: 'hasCondition', target: { kind: 'self' }, conditions: ['noxious'] } };
  }
  if ((g = t.match(/^(?:your |one of your )([A-Z][A-Za-z]+)$/))) {
    return { kind: 'targetExists', selector: parseSelector(`your ${g[1]}`) };
  }
  if ((g = t.match(/^(.*?)\s+(?:has|have) evolved$/i))) {
    return { kind: 'isEvolved', target: parseSelector(g[1] ?? ''), value: true };
  }
  if (/the battle opponent is a steel pok/i.test(t) || /battle opponent'?s type is steel/i.test(t)) {
    return { kind: 'hasType', target: { kind: 'battleOpponent' }, types: ['Steel'] };
  }
  if (/this pok[eé]mon is not knocked out/i.test(t)) {
    return { kind: 'inZone', target: { kind: 'self' }, zones: ['field'] };
  }
  if ((g = t.match(/^the knocked out is (.+)$/i))) {
    const names = (g[1] ?? '').split(/\s*(?:,|\bor\b)\s*/).map((n) => n.trim()).filter(Boolean);
    return { kind: 'antecedentNamed', names };
  }
  if ((g = t.match(/^the opponent uses a plate that is not (.+)$/i))) {
    return { kind: 'plateJustPlayed', name: (g[1] ?? 'Reveal Glass').trim(), match: 'ne' };
  }
  if (/this pok[eé]mon has changed its form from necrozma/i.test(t)) {
    return { kind: 'changedFormFrom', target: { kind: 'self' }, names: ['Necrozma'] };
  }
  if (/one of your electric-type pok[eé]mon would deal damage/i.test(t)) {
    return { kind: 'hasType', target: { kind: 'self' }, types: ['Electric'] };
  }
  if (/there is an electric-type pok[eé]mon adjacent to it/i.test(t)) {
    return {
      kind: 'targetExists',
      selector: {
        kind: 'all',
        where: [
          { kind: 'hasType', types: ['Electric'] },
          { kind: 'adjacentTo', of: { kind: 'self' } },
        ],
      },
    };
  }
  if (/you choose onix or scyther/i.test(t)) {
    return { kind: 'antecedentNamed', names: ['Onix', 'Scyther'] };
  }
  if (/the opponent'?s attack deals more than half the damage/i.test(t)) {
    return { kind: 'opponentDamageVsSelf', op: 'gt', fraction: 0.5 };
  }
  if ((g = t.match(/it passes through (.+)$/i))) {
    const raw = (g[1] ?? '').toLowerCase();
    const conditions: SpecialCondition[] = [];
    if (/\bpoisoned\b/.test(raw)) conditions.push('poisoned');
    if (/\bnoxious\b|\btoxic\b/.test(raw)) conditions.push('noxious');
    if (/\bsleeping\b|\basleep\b/.test(raw)) conditions.push('asleep');
    if (conditions.length > 0) return { kind: 'passedThrough', conditions };
  }
  if (/spins the same attack both times/i.test(t)) {
    return { kind: 'sameAttackBothTimes', target: { kind: 'battleOpponent' } };
  }
  if (/there are pok[eé]mon at three entry points/i.test(t)) {
    return {
      kind: 'targetCount',
      selector: { kind: 'all', where: [{ kind: 'atEntryPoint' }] },
      op: 'gte',
      value: 3,
    };
  }
  if (/there are 2 or more water-type pok[eé]mon and 2 or more ground-type/i.test(t)) {
    return {
      kind: 'allOf',
      of: [
        {
          kind: 'targetCount',
          selector: { kind: 'all', where: [{ kind: 'inZone', zones: ['field'] }, { kind: 'hasType', types: ['Water'] }] },
          op: 'gte',
          value: 2,
        },
        {
          kind: 'targetCount',
          selector: { kind: 'all', where: [{ kind: 'inZone', zones: ['field'] }, { kind: 'hasType', types: ['Ground'] }] },
          op: 'gte',
          value: 2,
        },
      ],
    };
  }
  return { kind: 'unimplemented', text: t };
}

/** Filters for a bare noun phrase, used where a full selector would be overkill. */
function parseFiltersOf(raw: string): Filter[] {
  return parseFilters(raw.toLowerCase());
}

const ACTION_BEARING_IF = /lands on miss|is a miss that turn|will shift to|would inflict a marker|attaches a marker or causes a special condition|attack knocks a pok|knocked out opposing|has a special condition, that condition is applied|they spin a gold|spin a gold attack|one of your own pok|spins a purple|would deal damage|collides with|in-use|sphere plates have been used|leaves the field|they leave the field/i;

/** Pull an `if ...` guard off the clause, whether it leads or trails. */
function extractGuard(text: string): { when: Condition[]; rest: string } {
  if (/if this pok[eé]mon is on the field and is not affected by a special condition/i.test(text)) {
    const stripped = text.replace(/if this pok[eé]mon is on the field and is not affected by a special condition,?\s*/i, '');
    if (stripped !== text) {
      const inner = extractGuard(stripped);
      return {
        when: [
          { kind: 'inZone', target: { kind: 'self' }, zones: ['field'] },
          { kind: 'not', of: { kind: 'hasCondition', target: { kind: 'self' }, conditions: [...SPECIAL_CONDITIONS] } },
          ...inner.when,
        ],
        rest: inner.rest,
      };
    }
  }
  if (/until it engages in its first battle after moving to the field/i.test(text)) {
    const inner = extractGuard(text.replace(/until it engages in its first battle after moving to the field,?\s*/i, ''));
    return {
      when: [{ kind: 'firstBattleAfterMoving', target: { kind: 'self' }, phase: 'untilEngage' }, ...inner.when],
      rest: inner.rest,
    };
  }
  if (/until the end of (?:this pok[eé]mon'?s )?first battle after moving to the field/i.test(text)) {
    const inner = extractGuard(text.replace(/until the end of (?:this pok[eé]mon'?s )?first battle after moving to the field,?\s*/i, ''));
    return {
      when: [{ kind: 'firstBattleAfterMoving', target: { kind: 'self' }, phase: 'untilEnd' }, ...inner.when],
      rest: inner.rest,
    };
  }
  if (/it can attack pok[eé]mon that are two steps away/i.test(text)) {
    const stripped = text.replace(/in (?:this pok[eé]mon'?s |its )?first battle after moving to the field,?\s*/i, '');
    if (stripped !== text) {
      const inner = extractGuard(stripped);
      return {
        when: [{ kind: 'firstBattleAfterMoving', target: { kind: 'self' }, phase: 'untilEnd' }, ...inner.when],
        rest: inner.rest,
      };
    }
  }
  if (/in (?:this pok[eé]mon'?s |its )?first battle after moving to the field/i.test(text)) {
    const inner = extractGuard(text.replace(/in (?:this pok[eé]mon'?s |its )?first battle after moving to the field,?\s*/i, ''));
    return {
      when: [{ kind: 'firstBattleAfterMoving', target: { kind: 'self' }, phase: 'during' }, ...inner.when],
      rest: inner.rest,
    };
  }
  if (/after its first battle since moving to the field/i.test(text)) {
    const inner = extractGuard(text.replace(/after its first battle since moving to the field,?\s*/i, ''));
    return {
      when: [{ kind: 'firstBattleAfterMoving', target: { kind: 'self' }, phase: 'after' }, ...inner.when],
      rest: inner.rest,
    };
  }
  if (/if there is an opponent's pok[eé]mon on your entry point, and this pok[eé]mon is on the bench/i.test(text)) {
    const inner = extractGuard(
      text.replace(/if there is an opponent's pok[eé]mon on your entry point, and this pok[eé]mon is on the bench,?\s*(?:at the beginning of your turn,?\s*)?/i, ''),
    );
    return {
      when: [
        { kind: 'inZone', target: { kind: 'self' }, zones: ['bench'] },
        {
          kind: 'targetExists',
          selector: {
            kind: 'all',
            where: [
              { kind: 'allegiance', of: 'opposing' },
              { kind: 'inZone', zones: ['field'] },
              { kind: 'atEntryPoint', whose: 'controller' },
            ],
          },
        },
        ...inner.when,
      ],
      rest: inner.rest,
    };
  }
  if (/while this pok[eé]mon is not affected by a special condition and is on an entry point/i.test(text)) {
    const inner = extractGuard(
      text.replace(/while this pok[eé]mon is not affected by a special condition and is on an entry point,?\s*/i, ''),
    );
    return {
      when: [
        { kind: 'not', of: { kind: 'hasCondition', target: { kind: 'self' }, conditions: [...SPECIAL_CONDITIONS] } },
        { kind: 'atEntryPoint', target: { kind: 'self' } },
        ...inner.when,
      ],
      rest: inner.rest,
    };
  }
  const evolvedMiss = text.match(
    /^if this pok[eé]mon has evolved, and its attack lands on miss,\s*(.+)$/i,
  );
  if (evolvedMiss?.[1]) {
    return {
      when: [
        { kind: 'isEvolved', target: { kind: 'self' }, value: true },
        { kind: 'spun', target: { kind: 'self' }, match: { kind: 'color', colors: ['miss'] } },
      ],
      rest: evolvedMiss[1],
    };
  }
  if (/when in a p\.c\./i.test(text)) {
    const inner = extractGuard(text.replace(/when in a p\.c\.,?\s*/i, ''));
    return {
      when: [{ kind: 'inZone', target: { kind: 'self' }, zones: ['pc'] }, ...inner.when],
      rest: inner.rest,
    };
  }
  const forceRespin = text.match(/^if\s+(.+?),\s*((?:you (?:may|can) )?force them to respin.+)$/i);
  if (forceRespin?.[1] && forceRespin[2]) {
    return { when: [parseCondition(forceRespin[1])], rest: forceRespin[2] };
  }
  if (/and this pok[eé]mon is in the p\.c\.,?\s*/i.test(text)) {
    const inner = extractGuard(text.replace(/,?\s*and this pok[eé]mon is in the p\.c\.,?\s*/i, ' '));
    return {
      when: [{ kind: 'inZone', target: { kind: 'self' }, zones: ['pc'] }, ...inner.when],
      rest: inner.rest,
    };
  }
  if (/^if possible,?\s+/i.test(text)) {
    return extractGuard(text.replace(/^if possible,?\s+/i, ''));
  }
  if (/,\s*if possible\.?$/i.test(text)) {
    return extractGuard(text.replace(/,\s*if possible\.?$/i, ''));
  }
  if (/,\s*if able\.?$/i.test(text)) {
    return extractGuard(text.replace(/,\s*if able\.?$/i, ''));
  }
  if (/^when you do,?\s+/i.test(text)) {
    const inner = extractGuard(text.replace(/^when you do,?\s+/i, ''));
    return { when: [{ kind: 'precedingActionTaken' }, ...inner.when], rest: inner.rest };
  }
  const passed = text.match(/^if\s+(it passes through .+),\s*(they will .+)$/i);
  if (passed?.[1] && passed[2]) {
    return { when: [parseCondition(passed[1])], rest: passed[2] };
  }
  const excluding = text.match(/\(excluding ([A-Za-z]+) pok[eé]mon\)/i);
  if (excluding?.[1]) {
    const types = parseTypes(excluding[1]);
    const inner = extractGuard(text.replace(/\s*\(excluding [A-Za-z]+ pok[eé]mon\)/i, ''));
    return {
      when: [
        ...inner.when,
        ...(types.length
          ? [{ kind: 'not' as const, of: { kind: 'hasType' as const, target: { kind: 'battleOpponent' as const }, types } }]
          : []),
      ],
      rest: inner.rest,
    };
  }
  if (/in battles (?:in|on) your turn$/i.test(text)) {
    const inner = extractGuard(text.replace(/\s*in battles (?:in|on) your turn$/i, ''));
    return { when: [...inner.when, { kind: 'isTurnPlayer', who: 'controller' }], rest: inner.rest };
  }
  const leadingBattles = text.match(/^in battles (?:in|on) your turn,?\s*(.+)$/i);
  if (leadingBattles?.[1]) {
    const inner = extractGuard(leadingBattles[1]);
    return { when: [...inner.when, { kind: 'isTurnPlayer', who: 'controller' }], rest: inner.rest };
  }
  const leading = text.match(/^if\s+(.+?),\s*(?:then\s+)?(.+)$/i);
  if (leading?.[1] && leading[2] && !/^possible\b/i.test(leading[1]) && !ACTION_BEARING_IF.test(leading[1])) {
    return { when: [parseCondition(leading[1])], rest: leading[2] };
  }
  // "Deals +50 damage if the battle opponent is a Dragon Pokemon" - the guard trails the
  // action here, and discarding it would have applied the bonus unconditionally.
  const trailing = text.match(/^(.+?)\s+if\s+([^,]+)$/i);
  if (
    trailing?.[1]
    && trailing[2]
    && !trailing[1].includes('(')
    && !/^possible\b/i.test(trailing[2])
    && !ACTION_BEARING_IF.test(trailing[2])
  ) {
    return { when: [parseCondition(trailing[2])], rest: trailing[1] };
  }
  return { when: [], rest: text };
}

// --- top level --------------------------------------------------------------

let counter = 0;
const nextId = (): ClauseId => `c${++counter}` as ClauseId;

/** Reset clause id numbering, so tests and reports are reproducible. */
export const resetClauseIds = (): void => { counter = 0; };

/** Compile one atomic clause. Always returns a clause; failures become `unimplemented`. */
export function compileClause(raw: string): Clause {
  // Trailing punctuation and Serebii's leading "*" footnote marker are stripped here as
  // well as in `splitClauses`, so the function is correct when called on its own. Guard
  // patterns anchor on `$`, and a stray period silently defeated all of them.
  const source = normalize(raw).replace(/^[*\s]+/, '').replace(/^then,?\s+/i, '').replace(/\s*[.;]+$/, '');
  const { trigger, rest: afterTrigger } = extractTrigger(source);
  const extracted = extractGuard(afterTrigger);
  let when = extracted.when;
  const rest = extracted.rest;

  const permissionMay = (
    /(?:may|can)\s+(?:also\s+)?(?:mp\s+)?move\s+(?:over|through|under|past)\b|(?:may|can) use an mp move to fly/i.test(rest)
    && !/to a point\b/i.test(rest)
  );
  const optional = !permissionMay && !/\boptionally\b/i.test(rest)
    && (/\byou (?:may|can)\b|\bmay\b/i.test(rest) || /can route move/i.test(rest) || /can move to your goal/i.test(rest));
  const body = rest
    .replace(/^(?:you\s+)?(?:may|can)\s+/i, '')
    .replace(/^it may\s+/i, '')
    .replace(/^(?:for|during) this turn,?\s+/i, '');
  const subject: Selector = { kind: 'self' };

  let actions: Action[] = [];
  for (const rule of RULES) {
    const m = body.match(rule.re);
    if (!m) continue;
    const action = rule.build(m, subject);
    if (action !== null) {
      actions = 'do' in action ? [action] : [...action];
      break;
    }
  }
  if (!actions.length && /^so is the battle opponent/i.test(body)) {
    actions = [{ do: 'knockOut', target: { kind: 'battleOpponent' } }];
  }
  if (!actions.length) actions = [{ do: 'unimplemented', text: source }];
  if (
    optional
    && actions[0]?.do !== 'unimplemented'
    && actions[0]?.do !== 'tag'
    && actions[0]?.do !== 'readyImmediately'
    && actions[0]?.do !== 'surviveByForm'
    && !(actions[0]?.do === 'respin' && /you can choose to respin once/i.test(source))
  ) {
    const then = /\bjust once\b/i.test(source) ? [...actions, { do: 'spendOnce' as const }] : actions;
    actions = [{ do: 'optional', chooser: 'controller', then }];
  }
  if (
    (/\(no battles? are triggered\)/i.test(source) || /\(a battle does not occur\.?\)/i.test(source))
    && actions[0]?.do !== 'unimplemented'
  ) {
    actions = [...actions, { do: 'tag', tag: 'noBattle' }];
  }
  actions = applyTextDuration(actions, source);
  if (when[0]?.kind === 'spun' && when[0].target.kind === 'antecedent') {
    actions = retargetSelfToAntecedent(actions);
  }
  if (/mp moves through opposing pok[eé]mon that are frozen/i.test(source)) {
    actions = [{
      do: 'move',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'hasCondition', conditions: ['frozen'] },
          { kind: 'passedThroughBy', of: { kind: 'self' } },
        ],
      },
      to: { kind: 'zone', zone: 'pc' },
    }];
  }
  if (/pok[eé]mon it moved over is an opposing pok/i.test(source)) {
    actions = [{
      do: 'applyCondition',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'passedThroughBy', of: { kind: 'self' } },
        ],
      },
      condition: 'burned',
    }];
  }
  if (trigger === 'onConditionApplied' && /burns the battle opponent/i.test(source)) {
    when = [...when, { kind: 'appliedCondition', conditions: ['burned'] }];
  }
  if (trigger === 'onConditionApplied' && /poisoned or noxious/i.test(source)) {
    when = [...when, { kind: 'appliedCondition', conditions: ['poisoned', 'noxious'] }];
  }
  if (trigger === 'afterBattle' && /moves its battle opponent by the effect of an attack/i.test(source)) {
    when = [...when, { kind: 'attackMovedOpponent' }];
  }
  if (/those pok[eé]mon are the opponent'?s pok[eé]mon/i.test(source)) {
    when = [...when, { kind: 'passedOverSelf' }];
    actions = [{
      do: 'applyCondition',
      target: {
        kind: 'all',
        where: [
          { kind: 'allegiance', of: 'opposing' },
          { kind: 'movedThisTurn', value: true },
        ],
      },
      condition: 'paralyzed',
    }];
  }

  const resolvedTrigger =
    trigger === 'onAttackResolve' && actions.length === 1 && actions[0]?.do === 'usageGate'
      ? 'usageRestriction'
      : trigger;

  return {
    id: nextId(),
    trigger: resolvedTrigger,
    when,
    actions,
    layer: resolvedTrigger === 'passive' ? 0 : 10,
    noStackKey: /does not stack/i.test(source) ? source.slice(0, 40) : null,
    source,
  };
}

/**
 * Compile a whole effect text, joining the spin idiom.
 *
 * "All opposing Pokemon on the field spin." followed by "Those that spin White Attacks
 * move to the bench." is one mechanic written as two sentences, so the follow-up is
 * folded into the spin check's `then` rather than left as a sibling that would have
 * nothing to read.
 */
function durationFromText(text: string): Duration | null {
  const namedEnd = text.match(/until the end of the next turn in which it spins ([A-Z][A-Za-z' -]+)/i);
  if (namedEnd?.[1]) {
    return { kind: 'untilNamedLand', name: namedEnd[1].trim(), endOfThatTurn: true };
  }
  const namedLand = text.match(/until the next time it lands on ([A-Z][A-Za-z' -]+)/i);
  if (namedLand?.[1]) {
    return { kind: 'untilNamedLand', name: namedLand[1].trim() };
  }
  const turns = text.match(/\bfor (\d+) turns?\b/i);
  if (turns) return { kind: 'turns', count: num(turns[1], 9) };
  if (/\bfor this turn\b|\bduring this turn\b/i.test(text)) return { kind: 'untilEndOfTurn' };
  if (/\buntil the end of your next turn\b/i.test(text)) return { kind: 'untilEndOfNextTurn' };
  if (/\buntil the end of (?:the )?battle\b/i.test(text)) return { kind: 'untilEndOfTurn' };
  if (/\buntil the end of the duel\b|\bduring this duel\b/i.test(text)) return { kind: 'untilEndOfDuel' };
  if (/until the end of (?:this pok[eé]mon'?s )?first battle after moving/i.test(text)) {
    return { kind: 'untilFirstBattle' };
  }
  return null;
}

function retargetSelfToAntecedent(actions: Action[]): Action[] {
  return actions.map((action) => {
    if (action.do === 'optional') return { ...action, then: retargetSelfToAntecedent([...action.then]) };
    if (!('target' in action) || typeof action.target === 'string') return action;
    if (action.target.kind !== 'self') return action;
    return { ...action, target: { kind: 'antecedent' } };
  });
}

function applyTextDuration(actions: Action[], source: string): Action[] {
  const duration = durationFromText(source);
  if (duration === null) return actions;
  return actions.map((action) => {
    if (action.do === 'grantMovement' || action.do === 'denyPassThrough' || 'duration' in action) {
      return { ...action, duration };
    }
    return action;
  });
}

function compilePhotonNotes(text: string): Clause[] | null {
  const n = normalize(text);
  if (!/photon marker/i.test(n) || !/changed its form from necrozma/i.test(n)) return null;
  const within = n.match(/within\s*x\+(\d+)\s*steps/i) ?? n.match(/withinx=(\d+)\s*steps/i);
  const steps = num(within?.[1], 1);
  const photon = marker('photon');
  return [
    {
      id: nextId(),
      trigger: 'onAttackResolve',
      when: [{ kind: 'not', of: { kind: 'changedFormFrom', target: { kind: 'self' }, names: ['Necrozma'] } }],
      actions: [{
        do: 'attachMarker',
        target: { kind: 'battleOpponent' },
        marker: photon,
        value: null,
        duration: INSTANT,
      }],
      layer: 10,
      noStackKey: null,
      source: n,
    },
    {
      id: nextId(),
      trigger: 'onAttackResolve',
      when: [{ kind: 'changedFormFrom', target: { kind: 'self' }, names: ['Necrozma'] }],
      actions: [{
        do: 'attachMarker',
        target: {
          kind: 'choose',
          count: 1,
          upTo: false,
          chooser: 'controller',
          where: [
            { kind: 'inZone', zones: ['field'] },
            { kind: 'within', steps, of: { kind: 'self' }, plusZone: 'ultraSpace' },
          ],
        },
        marker: photon,
        value: null,
        duration: INSTANT,
      }],
      layer: 10,
      noStackKey: null,
      source: n,
    },
    {
      id: nextId(),
      trigger: 'onAttackResolve',
      when: [],
      actions: [{
        do: 'nullify',
        target: { kind: 'all', where: [{ kind: 'hasMarker', marker: photon }] },
        duration: { kind: 'untilEndOfDuel' },
      }],
      layer: 10,
      noStackKey: null,
      source: n,
    },
  ];
}

function compileFusion(text: string): Clause[] | null {
  const n = normalize(text);
  if (/choose one of your kyurem on the field, and one of your zekrom or reshiram/i.test(n)
    && /black kyurem/i.test(n) && /white kyurem/i.test(n)) {
    return [{
      id: nextId(),
      trigger: 'onAttackResolve',
      when: [],
      actions: [{
        do: 'fuse',
        host: parseSelector('one of your Kyurem on the field'),
        material: parseSelector('one of your Zekrom or Reshiram on the field or bench in the P.C.'),
        materialTo: 'excluded',
        intoByMaterial: [['Zekrom', 'Black Kyurem'], ['Reshiram', 'White Kyurem']],
      }],
      layer: 10,
      noStackKey: null,
      source: n,
    }];
  }
  if (/choose one of your necrozma on the field and one of your solgaleo or lunala/i.test(n)
    && /dusk mane necrozma/i.test(n) && /dawn wings necrozma/i.test(n)) {
    return [{
      id: nextId(),
      trigger: 'onAttackResolve',
      when: [],
      actions: [{
        do: 'fuse',
        host: parseSelector('one of your Necrozma on the field'),
        material: parseSelector('one of your Solgaleo or Lunala on the field, bench or in the P.C.'),
        materialTo: 'ultraSpace',
        intoByMaterial: [['Solgaleo', 'Dusk Mane Necrozma'], ['Lunala', 'Dawn Wings Necrozma']],
      }],
      layer: 10,
      noStackKey: null,
      source: n,
    }];
  }
  return null;
}

function mentionsAntecedent(clause: Clause): boolean {
  return JSON.stringify(clause).includes('"kind":"antecedent"');
}

function mentionsSelfTarget(clause: Clause): boolean {
  return clause.actions.some((action) => {
    if (!('target' in action) || typeof action.target !== 'object') return false;
    return action.target.kind === 'self';
  });
}

function mentionsChosenFigure(clause: Clause): boolean {
  return (
    mentionsAntecedent(clause)
    || mentionsSelfTarget(clause)
    || /\b(?:it|them|that pok[eé]mon)\b/i.test(clause.source)
  );
}

function compileSwarm(text: string): Clause[] | null {
  const n = normalize(text);
  if (!/instead of an mp move/i.test(n) || !/ledyba or ledian|ledian or ledyba/i.test(n)) return null;
  if (!/on the bench next to this pok/i.test(n)) return null;
  const names = /ledian or ledyba/i.test(n) ? ['Ledian', 'Ledyba'] : ['Ledyba', 'Ledian'];
  const moveToSelf = {
    do: 'move' as const,
    target: {
      kind: 'choose' as const,
      count: 1,
      upTo: false,
      chooser: 'controller' as const,
      where: [
        { kind: 'allegiance' as const, of: 'ally' as const },
        { kind: 'named' as const, names },
        { kind: 'inZone' as const, zones: ['field' as const] },
      ],
    },
    to: { kind: 'openSpotAdjacentTo' as const, of: { kind: 'self' as const }, chooser: 'controller' as const },
  };
  const moveFromBench = {
    do: 'move' as const,
    target: {
      kind: 'choose' as const,
      count: 1,
      upTo: false,
      chooser: 'controller' as const,
      where: [
        { kind: 'allegiance' as const, of: 'ally' as const },
        { kind: 'named' as const, names },
        { kind: 'inZone' as const, zones: ['bench' as const] },
      ],
    },
    to: { kind: 'openSpotAdjacentTo' as const, of: { kind: 'self' as const }, chooser: 'controller' as const },
  };
  return [
    {
      id: nextId(),
      trigger: 'startOfTurn',
      when: [],
      actions: [moveToSelf, { do: 'endTurn' }],
      layer: 10,
      noStackKey: null,
      source: n,
    },
    {
      id: nextId(),
      trigger: 'startOfTurn',
      when: [{ kind: 'not', of: { kind: 'entryPointsFilled', whose: 'controller', by: 'opposing' } }],
      actions: [moveFromBench, { do: 'endTurn' }],
      layer: 10,
      noStackKey: null,
      source: n,
    },
  ];
}

function compileHomewardLights(text: string): Clause[] | null {
  const n = normalize(text);
  if (!/appears as a mega evolution, and again when its mega evolution ends/i.test(n)) return null;
  const move = compileClause(
    'you may move one of your Pokémon in the Ultra Space or P.C. next to this Pokémon',
  );
  const rest = n
    .replace(/when this pok[eé]mon appears as a mega evolution, and again when its mega evolution ends,?\s*/i, '')
    .replace(/you may move one of your pok[eé]mon in the ultra space or p\.c\. next to this pok[eé]mon\.?\s*/i, '');
  const extras = rest.length > 8 ? splitClauses(rest).map(compileClause) : [];
  return [
    { ...move, trigger: 'onMegaStart', source: n },
    { ...move, id: nextId(), trigger: 'onMegaEnd', source: n },
    ...extras,
  ];
}

function compileForestMischief(text: string): Clause[] | null {
  const n = normalize(text);
  if (!/forest mischief marker/i.test(n) || !/not subject to energy effects/i.test(n)) return null;
  const clauses: Clause[] = [];
  if (/(?:can|may) pass through other pok/i.test(n)) {
    clauses.push({
      id: nextId(),
      trigger: 'passive',
      when: [],
      actions: [{ do: 'grantMovement', target: { kind: 'self' }, grant: 'throughOthers' }],
      layer: 0,
      noStackKey: null,
      source: n,
    });
  }
  clauses.push(
    {
      id: nextId(),
      trigger: 'afterBattle',
      when: [{ kind: 'hasType', target: { kind: 'battleOpponent' }, types: ['Psychic'] }],
      actions: [{
        do: 'attachMarker',
        target: { kind: 'battleOpponent' },
        marker: marker('forestMischief'),
        value: null,
        duration: INSTANT,
      }],
      layer: 10,
      noStackKey: null,
      source: n,
    },
    {
      id: nextId(),
      trigger: 'passive',
      when: [],
      actions: [{
        do: 'nullify',
        target: { kind: 'all', where: [{ kind: 'hasMarker', marker: marker('forestMischief') }] },
        duration: { kind: 'untilEndOfDuel' },
        plateNameIncludes: 'Energy',
      }],
      layer: 0,
      noStackKey: null,
      source: n,
    },
  );
  return clauses;
}

function compileFullMarker(text: string): Clause[] | null {
  const n = normalize(text);
  if (!/attaches a full marker/i.test(n) || !/damage from white attacks/i.test(n)) return null;
  return [
    {
      id: nextId(),
      trigger: 'onAttackResolve',
      when: [],
      actions: [{
        do: 'attachMarker',
        target: { kind: 'self' },
        marker: marker('full'),
        value: null,
        duration: INSTANT,
      }],
      layer: 10,
      noStackKey: null,
      source: n,
    },
    {
      id: nextId(),
      trigger: 'passive',
      when: [{ kind: 'hasMarker', target: { kind: 'self' }, marker: marker('full') }],
      actions: [{ do: 'surviveByClearing', target: { kind: 'self' }, vs: 'whiteDamage' }],
      layer: 0,
      noStackKey: null,
      source: n,
    },
  ];
}

export function compileEffect(text: string): Clause[] {
  const fused = compileFusion(text);
  if (fused !== null) return fused;
  const photon = compilePhotonNotes(text);
  if (photon !== null) return photon;
  const swarm = compileSwarm(text);
  if (swarm !== null) return swarm;
  const full = compileFullMarker(text);
  if (full !== null) return full;
  const mischief = compileForestMischief(text);
  if (mischief !== null) return mischief;
  const homeward = compileHomewardLights(text);
  if (homeward !== null) return homeward;

  const clauses = splitClauses(text).map(compileClause);
  const out: Clause[] = [];

  for (const clause of clauses) {
    if (clause.trigger === 'usageRestriction') {
      out.push(clause);
      continue;
    }
    let prevIndex = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]?.trigger !== 'usageRestriction') {
        prevIndex = i;
        break;
      }
    }
    const prev = prevIndex >= 0 ? out[prevIndex] : undefined;
    const prevAction = prev?.actions[0];
    const readsSpin = clause.actions.some((a) => referencesSpunResult(a))
      || clause.when.some((c) => c.kind === 'spun' && c.target.kind === 'antecedent');

    if (prev && prevAction?.do === 'spinCheck' && readsSpin) {
      const remappedWhen = clause.when.map((cond) =>
        cond.kind === 'spun' && cond.target.kind === 'self'
          ? { ...cond, target: { kind: 'antecedent' as const } }
          : cond,
      );
      const remapped = {
        ...clause,
        when: remappedWhen,
        actions: remappedWhen.some((cond) => cond.kind === 'spun' && cond.target.kind === 'antecedent')
          ? retargetSelfToAntecedent([...clause.actions])
          : clause.actions,
      };
      out[prevIndex] = {
        ...prev,
        actions: [{ ...prevAction, then: [...prevAction.then, remapped] }],
      };
      continue;
    }
    if (
      prev
      && prev.actions.some((action) => action.do === 'select')
      && mentionsChosenFigure(clause)
    ) {
      const keepEnter = prev.trigger === 'onEnterField' || prev.trigger === 'onPcToBench' || prev.trigger === 'startOfTurn';
      out[prevIndex] = {
        ...prev,
        trigger: keepEnter ? prev.trigger : (clause.trigger !== 'onAttackResolve' ? clause.trigger : prev.trigger),
        when: [...prev.when, ...clause.when],
        actions: [...prev.actions, ...retargetSelfToAntecedent([...clause.actions])],
      };
      continue;
    }
    if (
      prev
      && prev.actions.some((action) => action.do === 'move')
      && mentionsAntecedent(clause)
    ) {
      const keepEnter = prev.trigger === 'onEnterField' || prev.trigger === 'onPcToBench' || prev.trigger === 'startOfTurn';
      out[prevIndex] = {
        ...prev,
        trigger: keepEnter ? prev.trigger : (clause.trigger !== 'onAttackResolve' ? clause.trigger : prev.trigger),
        when: [...prev.when, ...clause.when],
        actions: [...prev.actions, ...clause.actions],
      };
      continue;
    }
    const repeat = clause.actions[0];
    if (prev && repeat?.do === 'repeatFor') {
      out[prevIndex] = {
        ...prev,
        actions: [{ ...repeat, then: [...prev.actions, ...repeat.then] }],
      };
      continue;
    }
    if (prev && repeat?.do === 'repeatTimes') {
      out[prevIndex] = {
        ...prev,
        actions: [...prev.actions, { ...repeat, then: repeat.then.length > 0 ? repeat.then : [...prev.actions] }],
      };
      continue;
    }
    const returnAfter = clause.source.match(/returns to the bench after (\d+) turns/i);
    if (prev && returnAfter && prev.actions.some((action) => action.do === 'exclude')) {
      const turns = num(returnAfter[1], 7);
      out[prevIndex] = {
        ...prev,
        actions: prev.actions.map((action) =>
          action.do === 'exclude' ? { ...action, returnTo: 'bench', returnAfterTurns: turns } : action,
        ),
      };
      continue;
    }
    if (
      prev
      && /either of these things/i.test(clause.source)
      && clause.actions.some((action) => action.do === 'endTurn')
    ) {
      for (let i = 0; i < out.length; i++) {
        const earlier = out[i];
        if (earlier === undefined) continue;
        if (!earlier.actions.some((action) => action.do === 'optional')) continue;
        out[i] = {
          ...earlier,
          actions: earlier.actions.map((action) =>
            action.do === 'optional' && !action.then.some((inner) => inner.do === 'endTurn')
              ? { ...action, then: [...action.then, { do: 'endTurn' as const }] }
              : action,
          ),
        };
      }
      continue;
    }
    const prevOptional = prev?.actions.find((action) => action.do === 'optional');
    if (prev && prevOptional?.do === 'optional' && clause.when.some((cond) => cond.kind === 'precedingActionTaken')) {
      out[prevIndex] = {
        ...prev,
        actions: prev.actions.map((action) =>
          action.do === 'optional'
            ? { ...action, then: [...action.then, ...clause.actions] }
            : action,
        ),
      };
      continue;
    }
    const prevArm = prev?.actions.find((action) => action.do === 'armTrigger');
    if (prev && prevArm?.do === 'armTrigger' && clause.when.some((cond) => cond.kind === 'precedingActionTaken')) {
      out[prevIndex] = {
        ...prev,
        actions: prev.actions.map((action) =>
          action.do === 'armTrigger'
            ? { ...action, then: [...action.then, ...clause.actions] }
            : action,
        ),
      };
      continue;
    }
    out.push(clause);
  }
  return foldReadyImmediately(out);
}

function clauseMovesToBench(clause: Clause): boolean {
  const walk = (actions: readonly Action[]): boolean =>
    actions.some((action) =>
      (action.do === 'move' && action.to.kind === 'zone' && action.to.zone === 'bench')
      || (action.do === 'optional' && walk(action.then)),
    );
  return walk(clause.actions);
}

function readyImmediatelyAction(clause: Clause): Extract<Action, { do: 'readyImmediately' }> | null {
  for (const action of clause.actions) {
    if (action.do === 'readyImmediately') return action;
    if (action.do === 'optional') {
      const inner = action.then.find((child) => child.do === 'readyImmediately');
      if (inner?.do === 'readyImmediately') return inner;
    }
  }
  return null;
}

function foldReadyImmediately(clauses: readonly Clause[]): Clause[] {
  const readyAt = clauses.findIndex((clause) => readyImmediatelyAction(clause) !== null);
  const benchAt = clauses.findIndex((clause) => clause.trigger === 'startOfTurn' && clauseMovesToBench(clause));
  if (readyAt < 0 || benchAt < 0 || readyAt === benchAt) return [...clauses];
  const readyClause = clauses[readyAt];
  const bench = clauses[benchAt];
  if (readyClause === undefined || bench === undefined) return [...clauses];
  const ready = readyImmediatelyAction(readyClause);
  if (ready === null) return [...clauses];
  const merged: Clause = {
    ...bench,
    actions: bench.actions.map((action) =>
      action.do === 'optional' ? { ...action, then: [...action.then, ready] } : action,
    ),
  };
  const hasOptional = merged.actions.some((action) => action.do === 'optional');
  const attached = hasOptional ? merged : { ...bench, actions: [...bench.actions, ready] };
  return clauses.flatMap((clause, index) => {
    if (index === readyAt) return [];
    if (index === benchAt) return [attached];
    return [clause];
  });
}

function referencesSpunResult(action: Action): boolean {
  const target = 'target' in action ? action.target : null;
  if (target && typeof target === 'object' && 'kind' in target) {
    if (target.kind === 'spunResult') return true;
    if (target.kind === 'antecedent') return true;
  }
  if (action.do === 'optional') return action.then.some(referencesSpunResult);
  if (action.do === 'replaceSegment' && action.moveName === '*spun*') return true;
  return false;
}
