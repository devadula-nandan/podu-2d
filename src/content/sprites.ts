/**
 * View-only figure art. Maps Duel `figureId` (not National Dex) onto a PokeAPI
 * official-artwork URL via the existing slug → PokeAPI id table.
 *
 * These are Nintendo / The Pokémon Company images, hosted by PokeAPI for
 * fan clients. They are not OSI-open. See ATTRIBUTION.md.
 */
import { POKEAPI_IDS } from './pokeapi-ids.js';

export const POKEAPI_SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
export const POKEAPI_OFFICIAL_ART = `${POKEAPI_SPRITE_BASE}/other/official-artwork`;

/** Inset from a token radius so the full PNG stays inside the disc. */
export const TOKEN_ART_INSET = 2;

/** Fit an image entirely inside a centered square. Never overflows the box. */
export function containedDrawRect(
  imgW: number,
  imgH: number,
  cx: number,
  cy: number,
  box: number,
): { x: number; y: number; w: number; h: number } {
  const safeW = imgW > 0 ? imgW : box;
  const safeH = imgH > 0 ? imgH : box;
  const scale = Math.min(box / safeW, box / safeH);
  const w = safeW * scale;
  const h = safeH * scale;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export interface SpriteFigure {
  readonly id: number;
  readonly name: string;
  readonly form: string | null;
}

export interface SpriteRef {
  readonly figureId: number;
  readonly slug: string;
  readonly pokeApiId: number;
  readonly shiny: boolean;
  readonly url: string;
}

const FORM_SLUG = {
  '50% Forme': 'zygarde-50',
  '10% Forme': 'zygarde-10',
  'Complete Forme': 'zygarde-complete',
  'Ordinary Form': 'keldeo-ordinary',
  'Resolute Form': 'keldeo-resolute',
  'Altered Forme': 'giratina-altered',
  'Origin Forme': 'giratina-origin',
  'Speed Forme': 'deoxys-speed',
  'Normal Forme': 'deoxys-normal',
  'Attack Forme': 'deoxys-attack',
  'Defense Forme': 'deoxys-defense',
  'Blade Forme': 'aegislash-blade',
  'Shield Forme': 'aegislash-shield',
  'Pom-Pom Style': 'oricorio-pom-pom',
  "Pa'u Style": 'oricorio-pau',
  'Sensu Style': 'oricorio-sensu',
  'Baile Style': 'oricorio-baile',
  'Sky Forme': 'shaymin-sky',
  'Land Forme': 'shaymin-land',
  'Midday Form': 'lycanroc-midday',
  'Midnight Form': 'lycanroc-midnight',
} as const;

const DEFAULT_FORM: Readonly<Record<string, string>> = {
  mimikyu: 'mimikyu-disguised',
  pumpkaboo: 'pumpkaboo-average',
  gourgeist: 'gourgeist-average',
};

function slugifySpecies(name: string): string {
  return name
    .toLowerCase()
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m')
    .replace(/['’.]/g, '')
    .replace(/:/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function formSlug(form: string): string | undefined {
  return Object.hasOwn(FORM_SLUG, form) ? FORM_SLUG[form as keyof typeof FORM_SLUG] : undefined;
}

/** PokeAPI slug + shiny flag. Variants live in the printed name or `form`. */
export function pokeApiSlug(figure: SpriteFigure): { slug: string; shiny: boolean } {
  let rest = figure.name;
  let shiny = false;
  if (rest.startsWith('Shiny ')) {
    shiny = true;
    rest = rest.slice(6);
  }

  const mapped = figure.form === null ? undefined : formSlug(figure.form);
  if (mapped !== undefined) return { slug: mapped, shiny };
  if (figure.form === 'Therian Forme') return { slug: `${slugifySpecies(rest)}-therian`, shiny };
  if (figure.form === 'Incarnate Forme') return { slug: `${slugifySpecies(rest)}-incarnate`, shiny };

  if (rest.startsWith('Mega ')) {
    const body = rest.slice(5);
    if (body.endsWith(' X')) return { slug: `${slugifySpecies(body.slice(0, -2))}-mega-x`, shiny };
    if (body.endsWith(' Y')) return { slug: `${slugifySpecies(body.slice(0, -2))}-mega-y`, shiny };
    return { slug: `${slugifySpecies(body)}-mega`, shiny };
  }
  if (rest.startsWith('Alolan ')) return { slug: `${slugifySpecies(rest.slice(7))}-alola`, shiny };
  if (rest.startsWith('Primal ')) return { slug: `${slugifySpecies(rest.slice(7))}-primal`, shiny };
  if (rest === 'Ultra Necrozma') return { slug: 'necrozma-ultra', shiny };
  if (rest === 'Black Kyurem') return { slug: 'kyurem-black', shiny };
  if (rest === 'White Kyurem') return { slug: 'kyurem-white', shiny };
  if (rest === 'Dawn Wings Necrozma') return { slug: 'necrozma-dawn', shiny };
  if (rest === 'Dusk Mane Necrozma') return { slug: 'necrozma-dusk', shiny };
  const rotom = /^(Heat|Wash|Frost|Fan|Mow) Rotom$/.exec(rest);
  if (rotom !== null) return { slug: `rotom-${rotom[1]?.toLowerCase() ?? ''}`, shiny };

  const base = slugifySpecies(rest);
  return { slug: DEFAULT_FORM[base] ?? base, shiny };
}

export function pokeApiSpriteUrl(pokeApiId: number, shiny: boolean): string {
  return shiny ? `${POKEAPI_OFFICIAL_ART}/shiny/${pokeApiId}.png` : `${POKEAPI_OFFICIAL_ART}/${pokeApiId}.png`;
}

export function resolveFigureSprite(figure: SpriteFigure): SpriteRef | null {
  const { slug, shiny } = pokeApiSlug(figure);
  const pokeApiId = POKEAPI_IDS[slug];
  if (pokeApiId === undefined) return null;
  return { figureId: figure.id, slug, pokeApiId, shiny, url: pokeApiSpriteUrl(pokeApiId, shiny) };
}

export function spriteUrlForFigure(figure: SpriteFigure): string | null {
  return resolveFigureSprite(figure)?.url ?? null;
}

export function figureInitials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
  const first = parts[0] ?? '?';
  if (first.length <= 3) return first.slice(0, 3).toUpperCase();
  return first.slice(0, 2).toUpperCase();
}

export function spriteCoverage(figures: readonly SpriteFigure[]): {
  readonly resolved: number;
  readonly fallback: number;
  readonly missingIds: readonly number[];
} {
  const missingIds: number[] = [];
  for (const figure of figures) {
    if (resolveFigureSprite(figure) === null) missingIds.push(figure.id);
  }
  return { resolved: figures.length - missingIds.length, fallback: missingIds.length, missingIds };
}
