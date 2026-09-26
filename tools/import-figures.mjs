/**
 * Import data/figures (Godot / duel-source dump) into data/content/figures.json
 * and refresh abilities.json.
 *
 * Source of truth for wheels / types / MP / rarity / abilities is data/figures.
 * Provenance fields (gems, league, booster, evoStage, Z-Move bodies, Japanese
 * ability names) are carried forward from the previous content layer by id when
 * present. Figures whose wheel does not sum to 96 fall back to the prior wheel.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const FIGURES_DIR = 'data/figures';
const CONTENT_DIR = 'data/content';

function loadPreviousFigures() {
  if (process.env.PODU_PREV_FIGURES && existsSync(process.env.PODU_PREV_FIGURES)) {
    return JSON.parse(readFileSync(process.env.PODU_PREV_FIGURES, 'utf8'));
  }
  try {
    const fromGit = execSync('git show HEAD:data/content/figures.json', {
      maxBuffer: 80 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(fromGit);
  } catch {
    const path = join(CONTENT_DIR, 'figures.json');
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, 'utf8'));
  }
}

const COLOR = {
  WHITE: 'white',
  GOLD: 'gold',
  PURPLE: 'purple',
  BLUE: 'blue',
  RED: 'miss',
  MISS: 'miss',
};

const VARIANT_FORM = {
  complete: 'Complete Forme',
  '10': '10% Forme',
  '10percent': '10% Forme',
  '50': '50% Forme',
  '50percent': '50% Forme',
  origin: 'Origin Forme',
  altered: 'Altered Forme',
  therian: 'Therian Forme',
  incarnate: 'Incarnate Forme',
  blade: 'Blade Forme',
  shield: 'Shield Forme',
  ordinary: 'Ordinary Form',
  resolute: 'Resolute Form',
  sky: 'Sky Forme',
  land: 'Land Forme',
  midday: 'Midday Form',
  midnight: 'Midnight Form',
  speed: 'Speed Forme',
  attack: 'Attack Forme',
  defense: 'Defense Forme',
  normal: 'Normal Forme',
  'pom-pom': 'Pom-Pom Style',
  pau: "Pa'u Style",
  sensu: 'Sensu Style',
  baile: 'Baile Style',
};

function walkJson(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkJson(path, out);
    else if (name.endsWith('.json')) out.push(path);
  }
  return out;
}

function titleType(t) {
  const lower = String(t).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function parseDamage(seg) {
  const raw = String(seg.source_damage_or_stars ?? '').trim();
  const stars = Number(seg.stars) || 0;
  if (stars > 0 || /☆/.test(raw)) {
    const count = stars > 0 ? stars : (raw.match(/☆/g) ?? []).length;
    if (count >= 1 && count <= 4) return { kind: 'stars', stars: count };
  }
  if (/x$/i.test(raw)) {
    const base = Number.parseInt(raw.replace(/x$/i, ''), 10);
    if (Number.isFinite(base) && base > 0) return { kind: 'multiplier', base };
  }
  if (/\+$/.test(raw)) {
    const base = Number.parseInt(raw.replace(/\+$/, ''), 10);
    if (Number.isFinite(base) && base >= 0) return { kind: 'variable', base };
  }
  const n = Number(seg.damage);
  if (Number.isFinite(n) && n > 0) return { kind: 'fixed', base: Math.trunc(n) };
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0 && raw === String(parsed)) {
    return { kind: 'fixed', base: parsed };
  }
  return null;
}

function convertWheel(wheel) {
  return (wheel ?? []).map((seg) => {
    const type = String(seg.type ?? 'RED').toUpperCase();
    const color = COLOR[type] ?? (seg.name === 'Miss' ? 'miss' : 'white');
    const notesRaw = typeof seg.note === 'string' && seg.note.trim() !== '' ? cleanEffectText(seg.note) : '';
    const notes = notesRaw !== '' ? notesRaw : null;
    return {
      size: Number(seg.size) || 0,
      moveName: String(seg.name || 'Unknown').trim() || 'Unknown',
      color,
      damage: color === 'miss' ? null : parseDamage(seg),
      notes,
    };
  });
}

function stripRaritySuffix(display) {
  return String(display)
    .replace(/\s+(C|UC|R|EX|UX|NX)\s*$/i, '')
    .trim();
}

function deriveNameAndForm(raw, prev) {
  if (prev) return { name: prev.name, form: prev.form };
  const display = stripRaritySuffix(raw.display_name ?? raw.figure_id ?? 'Unknown');
  const variant = String(raw.source_data?.variant ?? '').toLowerCase().replace(/\s+/g, '');
  const formFromVariant = VARIANT_FORM[variant] ?? null;

  // "Zygarde Complete Forme" → name Zygarde + form Complete Forme
  for (const form of Object.values(VARIANT_FORM)) {
    if (display.endsWith(` ${form}`)) {
      return { name: display.slice(0, -(form.length + 1)).trim(), form };
    }
  }
  if (formFromVariant && !display.includes(formFromVariant)) {
    // e.g. figure_id carries forme, display is "Zygarde UX"
    const base = display.replace(/^Shiny\s+/i, (m) => m);
    return { name: base, form: formFromVariant };
  }
  return { name: display, form: formFromVariant };
}

function materialCost(raw, prev) {
  const m = raw.source_data?.material ?? raw.material;
  if (typeof m === 'number' && m > 0) return Math.trunc(m);
  if (prev?.materialCost) return prev.materialCost;
  const rarity = String(raw.source_data?.rarity ?? raw.rarity ?? 'C').toUpperCase();
  return { C: 250, UC: 450, R: 1800, EX: 4000, UX: 5000 }[rarity] ?? 250;
}

function cleanEffectText(text) {
  return String(text)
    .replace(/\[CTRL [^\]]+\]\[([^\]]*)\]/g, '$1')
    .replace(/\[CTRL [^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function convertAbility(raw, prev) {
  const abl = raw.ability;
  if (!abl || !abl.name || /^none$/i.test(abl.name)) return null;
  const incoming = cleanEffectText(abl.note ?? '');
  // Prefer prior ability text when present: data/figures notes are often abbreviated
  // or mistyped, while the previous content layer was already DSL-compiled.
  const resolvedText = prev?.ability?.text?.trim() || incoming;
  if (!resolvedText) return null;
  return {
    name: abl.name.trim(),
    text: resolvedText,
    ...(prev?.ability?.jname ? { jname: prev.ability.jname } : {}),
  };
}

function enrichWheelNotes(wheel, prev) {
  if (!prev?.wheel?.length) return wheel;
  const byName = new Map();
  for (const seg of prev.wheel) {
    const key = seg.moveName.replace(/\*+$/, '');
    if (!byName.has(key)) byName.set(key, seg);
  }
  return wheel.map((seg) => {
    const prior = byName.get(seg.moveName.replace(/\*+$/, ''));
    // Prefer prior effect text when the same attack existed: data/figures notes are
    // often thinner, and the previous layer was already DSL-compiled.
    if (prior?.notes) return { ...seg, notes: prior.notes };
    return seg;
  });
}

function buildZMoveCatalog(prevFigures) {
  const byName = new Map();
  for (const fig of prevFigures) {
    for (const zm of fig.zMoves ?? []) {
      if (!byName.has(zm.moveName)) byName.set(zm.moveName, zm);
    }
  }
  return byName;
}

function resolveZMoves(raw, prev, catalog) {
  if (prev?.zMoves?.length) return prev.zMoves;
  const keys = raw.source_data?.z_move_keys ?? [];
  const out = [];
  for (const key of keys) {
    const hit = catalog.get(key);
    if (hit) out.push(structuredClone(hit));
  }
  return out;
}

function convertOne(raw, path, prevById, zCatalog) {
  const id = Number(raw.source_data?.app_figure_id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const prev = prevById.get(id);
  let wheel = enrichWheelNotes(convertWheel(raw.wheel), prev);
  let wheelSum = wheel.reduce((n, s) => n + s.size, 0);
  let wheelSource = 'data/figures';
  let inferred;

  if (wheelSum !== 96) {
    if (prev?.wheel?.length && prev.wheelSum === 96) {
      const originalSum = wheelSum;
      wheel = structuredClone(prev.wheel);
      wheelSum = 96;
      wheelSource = prev.wheelSource ?? 'prior-content';
      inferred = `wheel from prior content; data/figures summed to ${originalSum}`;
    } else {
      return { skip: true, reason: `wheel sum ${wheelSum}`, path };
    }
  }

  const { name, form } = deriveNameAndForm(raw, prev);
  const rarity = String(raw.source_data?.rarity ?? raw.rarity ?? prev?.rarity ?? 'C').toUpperCase();
  if (!['C', 'UC', 'R', 'EX', 'UX'].includes(rarity)) {
    return { skip: true, reason: `rarity ${rarity}`, path };
  }

  const types = (raw.types ?? prev?.types ?? []).map(titleType);
  if (types.length < 1 || types.length > 2) {
    return { skip: true, reason: `types ${JSON.stringify(types)}`, path };
  }

  const mp = Number(raw.movement_points ?? raw.source_data?.max_movement ?? prev?.mp ?? 1);
  const ability = convertAbility(raw, prev);
  const figure = {
    id,
    name,
    form,
    rarity,
    types,
    mp,
    evoStage: prev?.evoStage ?? (raw.evolution_stage > 0 ? raw.evolution_stage : 1),
    materialCost: materialCost(raw, prev),
    gems: prev?.gems ?? null,
    league: prev?.league ?? null,
    booster: prev?.booster ?? null,
    ability,
    wheel,
    zMoves: resolveZMoves(raw, prev, zCatalog),
    wheelSum,
    wheelSource,
    diskVersion: prev?.diskVersion ?? raw.source_data?.last_update ?? null,
    sources: prev?.sources ?? ['bulbapedia'],
    dataComplete: true,
  };
  if (prev?.contested) figure.contested = prev.contested;
  if (inferred) figure.inferred = inferred;

  return { figure, path: relative(FIGURES_DIR, path) };
}

const prevFigures = loadPreviousFigures();
const prevById = new Map(prevFigures.map((f) => [f.id, f]));
const zCatalog = buildZMoveCatalog(prevFigures);

const files = walkJson(FIGURES_DIR);
const figures = [];
const skipped = [];
const seen = new Set();

for (const path of files) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    skipped.push({ path, reason: String(err) });
    continue;
  }
  if (!raw.source_data?.app_figure_id && !raw.figure_id) {
    skipped.push({ path, reason: 'stub / missing identity' });
    continue;
  }
  const result = convertOne(raw, path, prevById, zCatalog);
  if (!result) {
    skipped.push({ path, reason: 'no app_figure_id' });
    continue;
  }
  if (result.skip) {
    skipped.push(result);
    continue;
  }
  if (seen.has(result.figure.id)) {
    skipped.push({ path, reason: `duplicate id ${result.figure.id}` });
    continue;
  }
  seen.add(result.figure.id);
  figures.push(result.figure);
}

figures.sort((a, b) => a.id - b.id);

const abilities = [];
const abilitySeen = new Set();
for (const fig of figures) {
  if (fig.ability === null) continue;
  if (abilitySeen.has(fig.ability.name)) continue;
  abilitySeen.add(fig.ability.name);
  abilities.push({
    name: fig.ability.name,
    text: fig.ability.text,
    source: 'figure',
  });
}
abilities.sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(CONTENT_DIR, { recursive: true });
writeFileSync(join(CONTENT_DIR, 'figures.json'), `${JSON.stringify(figures, null, 2)}\n`);
writeFileSync(join(CONTENT_DIR, 'abilities.json'), `${JSON.stringify(abilities, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      imported: figures.length,
      skipped: skipped.length,
      abilities: abilities.length,
      newIds: figures.filter((f) => !prevById.has(f.id)).map((f) => f.id),
      skippedSample: skipped.slice(0, 12),
    },
    null,
    2,
  ),
);
