import * as THREE from 'three';
import { resolveFigureSprite } from '../content/sprites.js';

/** National Dex IDs for duel figures (official-artwork CDN). */
const DEX: Record<string, number> = {
  Absol: 359,
  Aggron: 306,
  Aipom: 190,
  Arbok: 24,
  Armaldo: 348,
  Aron: 304,
  Articuno: 144,
  Audino: 531,
  Bagon: 371,
  Banette: 354,
  Bayleef: 153,
  Beedrill: 15,
  Bellsprout: 69,
  Bidoof: 399,
  Blastoise: 9,
  Braixen: 654,
  Bronzong: 437,
  Bulbasaur: 1,
  Butterfree: 12,
  Cacnea: 331,
  Caterpie: 10,
  Charizard: 6,
  Charmander: 4,
  Charmeleon: 5,
  Chesnaught: 652,
  Chespin: 650,
  Chimchar: 390,
  Crobat: 169,
  Cyndaquil: 155,
  Darkrai: 491,
  Dedenne: 702,
  Deino: 633,
  Delphox: 655,
  'Deoxys-A': 386,
  'Deoxys-D': 386,
  'Deoxys-N': 386,
  'Deoxys-S': 386,
  Dialga: 483,
  Diglett: 50,
  Doduo: 84,
  Dragonair: 148,
  Drapion: 452,
  Dratini: 147,
  Drowzee: 96,
  Eevee: 133,
  Ekans: 23,
  Electabuzz: 125,
  Emolga: 587,
  Empoleon: 395,
  Espurr: 677,
  Exeggcute: 102,
  Exeggutor: 103,
  Fennekin: 653,
  Flareon: 136,
  Fletchling: 661,
  Floatzel: 419,
  Froakie: 656,
  Gabite: 444,
  Garchomp: 445,
  Gardevoir: 282,
  Genesect: 649,
  Geodude: 74,
  Girafarig: 203,
  Giratina: 487,
  Glaceon: 471,
  Golem: 76,
  Goodra: 706,
  Goomy: 704,
  Greninja: 658,
  Grovyle: 253,
  Gyarados: 130,
  Hariyama: 297,
  Haunter: 93,
  Hawlucha: 701,
  Heatran: 485,
  Heracross: 214,
  'Ho-Oh': 250,
  Infernape: 392,
  Jigglypuff: 39,
  Jolteon: 135,
  Joltik: 595,
  Kabuto: 140,
  Kakuna: 14,
  Keldeo: 647,
  Kirlia: 281,
  Kyogre: 382,
  Lapras: 131,
  Latias: 380,
  Latios: 381,
  Leafeon: 470,
  Ledyba: 165,
  Lilligant: 549,
  Lucario: 448,
  Lugia: 249,
  Luxray: 405,
  Machamp: 68,
  Machop: 66,
  Magikarp: 129,
  Magmar: 126,
  Magmortar: 467,
  Magnemite: 81,
  Manaphy: 490,
  Mankey: 56,
  Mareep: 179,
  Marill: 183,
  Mawile: 303,
  Meowth: 52,
  Metagross: 376,
  Mew: 151,
  Mewtwo: 150,
  Mightyena: 262,
  Minun: 312,
  Moltres: 146,
  Monferno: 391,
  Mudkip: 258,
  Murkrow: 198,
  Natu: 177,
  'Nidoran♂': 32,
  Pachirisu: 417,
  Palkia: 484,
  Petilil: 548,
  Phantump: 708,
  Pichu: 172,
  Pikachu: 25,
  'Pikachu R': 25,
  Pinsir: 127,
  Piplup: 393,
  Plusle: 311,
  Poliwag: 60,
  Poliwhirl: 61,
  Psyduck: 54,
  Quilava: 156,
  Quilladin: 651,
  Raikou: 243,
  Ralts: 280,
  Raticate: 20,
  Rattata: 19,
  Rayquaza: 384,
  Reshiram: 643,
  Reuniclus: 579,
  Rhyhorn: 111,
  Rhyperior: 464,
  Salamence: 373,
  Sandshrew: 27,
  Sceptile: 254,
  Scyther: 123,
  Seedot: 273,
  Sentret: 161,
  Seviper: 336,
  Shiftry: 275,
  Shinx: 403,
  Shroomish: 285,
  Shuppet: 353,
  Skarmory: 227,
  Sliggoo: 705,
  Smoochum: 238,
  Sneasel: 215,
  Snorlax: 143,
  Snubbull: 209,
  Spearow: 21,
  Spinarak: 167,
  Spinda: 327,
  Squirtle: 7,
  Staraptor: 398,
  Steelix: 208,
  Sylveon: 700,
  Taillow: 276,
  Tauros: 128,
  Teddiursa: 216,
  Tentacool: 72,
  Tentacruel: 73,
  Torchic: 255,
  Torterra: 389,
  Treecko: 252,
  Trevenant: 709,
  Tropius: 357,
  Turtwig: 387,
  Typhlosion: 157,
  Tyranitar: 248,
  Tyrogue: 236,
  Umbreon: 197,
  Vaporeon: 134,
  Venusaur: 3,
  Vigoroth: 288,
  Virizion: 640,
  Voltorb: 100,
  Weavile: 461,
  Weedle: 13,
  Weezing: 110,
  Whimsicott: 547,
  Wobbuffet: 202,
  Xatu: 178,
  Xerneas: 716,
  Yveltal: 717,
  Zangoose: 335,
  Zapdos: 145,
  Zekrom: 644,
  Zubat: 41,
  Zygarde: 718,
};

const ART_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';
const SPRITE_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

const textureCache = new Map<string, Promise<THREE.CanvasTexture>>();

function hexToRgb(hex: number) {
  return {
    r: (hex >> 16) & 255,
    g: (hex >> 8) & 255,
    b: hex & 255,
  };
}

/** Soft tint color for glass shell. */
export function orbGlassColor(hex: number): number {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => Math.min(255, Math.round(c * 0.45 + 180 * 0.55));
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

function paintArt(size: number, img: CanvasImageSource | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;
  ctx.clearRect(0, 0, size, size);
  if (img) {
    const art = size * 0.92;
    ctx.drawImage(img, (size - art) / 2, (size - art) / 2, art, art);
  }
  return canvas;
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Empty transparent placeholder while art loads. */
export function createPlaceholderOrbTexture(_baseColor?: number, size = 256): THREE.CanvasTexture {
  return canvasTexture(paintArt(size, null));
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function fetchPokemonImage(name: string, url?: string | null): Promise<HTMLImageElement | null> {
  if (url) {
    const direct = await loadImage(url);
    if (direct) return direct;
  }
  const resolved = resolveFigureSprite({ id: 0, name, form: null })?.url;
  if (resolved && resolved !== url) {
    const fromSlug = await loadImage(resolved);
    if (fromSlug) return fromSlug;
  }
  const id = dexIdFor(name);
  if (!id) return null;
  return (
    (await loadImage(`${ART_BASE}/${id}.png`)) ||
    (await loadImage(`${SPRITE_BASE}/${id}.png`))
  );
}

/** National Dex id for a figure name, if known. */
export function dexIdFor(name: string): number | undefined {
  return DEX[name];
}

/** Official-artwork CDN URL for UI `<img>` tags (null if unknown). */
export function pokemonArtUrl(name: string): string | null {
  const id = dexIdFor(name);
  if (!id) return null;
  return `${ART_BASE}/${id}.png`;
}

/** Transparent Pokémon art for inside a glass orb. Cached per name. */
export function getPokemonOrbTexture(
  name: string,
  _baseColor?: number,
  url?: string | null,
): Promise<THREE.CanvasTexture> {
  const key = `${name}|${url ?? ''}`;
  const hit = textureCache.get(key);
  if (hit) return hit;

  const pending = (async () => {
    const img = await fetchPokemonImage(name, url);
    return canvasTexture(paintArt(256, img));
  })();

  textureCache.set(key, pending);
  return pending;
}
