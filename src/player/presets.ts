import type { Engine, PlayerId } from '../engine/index.js';
import { contentFigureId, isFormOnlyFigure } from '../engine/index.js';
import { figureOfContent, plateOfContent, starterFigureIds } from '../ui/boot.js';
import {
  deckHasErrors,
  isCompleteDeck,
  validateDeck,
  type DeckDraft,
} from '../ui/model.js';

/** Six editable team slots — mirrors the WebGL reference deck wells. */
export type PresetId =
  | 'starter-squad'
  | 'stone-guard'
  | 'swift-pack'
  | 'poison-fang'
  | 'dragon-rise'
  | 'arena-rush';

export interface DeckPreset {
  readonly id: PresetId;
  readonly name: string;
  readonly blurb: string;
  readonly figures: readonly string[];
  readonly plates: readonly string[];
}

const RARITY_RANK: Readonly<Record<string, number>> = {
  UX: 5,
  EX: 4,
  R: 3,
  UC: 2,
  C: 1,
};

/** Six strategic decks used as the default filled slots. */
export const DECK_PRESETS: readonly DeckPreset[] = [
  {
    id: 'starter-squad',
    name: 'Starter Squad',
    blurb: 'Balanced Kanto aces — learn the board',
    figures: ['Pikachu', 'Charizard', 'Venusaur', 'Blastoise', 'Machamp', 'Gyarados'],
    plates: ['Venusaurite', 'Charizardite X', 'Blastoisinite', 'Double Chance', 'X Attack', 'X Speed'],
  },
  {
    id: 'stone-guard',
    name: 'Stone Guard',
    blurb: 'Steel fortress — walls and a sweeper',
    figures: ['Metagross', 'Magnezone', 'Empoleon', 'Aggron', 'Lucario', 'Skarmory'],
    plates: ['Metal Coat', 'Double Chance', 'X Attack', 'X Defend', 'Full Heal', 'Scoop Up'],
  },
  {
    id: 'swift-pack',
    name: 'Swift Pack',
    blurb: 'Surround swarm — 3 MP flyers and cats',
    figures: ['Ninjask', 'Crobat', 'Talonflame', 'Swellow', 'Liepard', 'Emolga'],
    plates: ['X Speed', 'Long Throw', 'Double Chance', 'X Attack', 'Full Heal', 'Scoop Up'],
  },
  {
    id: 'poison-fang',
    name: 'Poison Fang',
    blurb: 'Poison spread — noxious and surround',
    figures: ['Weezing', 'Toxicroak', 'Arbok', 'Salazzle', 'Drapion', 'Naganadel'],
    plates: ['Poison Barb', 'Double Chance', 'X Attack', 'Full Heal', 'Scoop Up', 'Pokémon Switch'],
  },
  {
    id: 'dragon-rise',
    name: 'Dragon Rise',
    blurb: 'Dragon corridor — smash the center file',
    figures: ['Dragonite', 'Salamence', 'Garchomp', 'Haxorus', 'Noivern', 'Latios'],
    plates: ['Dragon Fang', 'Double Chance', 'X Attack', 'X Speed', 'Full Heal', 'Scoop Up'],
  },
  {
    id: 'arena-rush',
    name: 'Arena Rush',
    blurb: 'Goal rush — 3 MP runners down the corridor',
    figures: ['Greninja', 'Weavile', 'Talonflame', 'Noivern', 'Jolteon', 'Crobat'],
    plates: ['X Speed', 'Hurdle Jump', 'Double Chance', 'X Attack', 'Full Heal', 'Scoop Up'],
  },
];

export function pickFigureId(engine: Engine, name: string): number | null {
  const rows = [];
  for (const entry of engine.content.figures.values()) {
    if (entry.figure.name !== name) continue;
    if (isFormOnlyFigure(entry.figure)) continue;
    rows.push(entry.figure);
  }
  rows.sort((a, b) => {
    const implA = engine.registry.figures.get(contentFigureId(a.id))?.implemented === true ? 0 : 1;
    const implB = engine.registry.figures.get(contentFigureId(b.id))?.implemented === true ? 0 : 1;
    if (implA !== implB) return implA - implB;
    const formBias = Number(a.form !== null) - Number(b.form !== null);
    if (formBias !== 0) return formBias;
    const rarity = (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0);
    if (rarity !== 0) return rarity;
    return a.id - b.id;
  });
  return rows[0]?.id ?? null;
}

export function pickPlateId(engine: Engine, name: string): number | null {
  for (const entry of engine.content.plates.values()) {
    if (entry.plate.name === name) return entry.plate.id;
  }
  return null;
}

export function resolvePreset(engine: Engine, preset: DeckPreset): DeckDraft | null {
  const figures: number[] = [];
  for (const name of preset.figures) {
    const id = pickFigureId(engine, name);
    if (id === null) return null;
    figures.push(id);
  }
  const plates: number[] = [];
  for (const name of preset.plates) {
    const id = pickPlateId(engine, name);
    if (id === null) return null;
    plates.push(id);
  }
  const draft = { figures, plates };
  if (!isCompleteDeck(engine, draft) || deckHasErrors(validateDeck(engine, draft, true))) return null;
  return draft;
}

export function resolvedPresets(engine: Engine): readonly { preset: DeckPreset; draft: DeckDraft }[] {
  const rows: { preset: DeckPreset; draft: DeckDraft }[] = [];
  for (const preset of DECK_PRESETS) {
    const draft = resolvePreset(engine, preset);
    if (draft !== null) rows.push({ preset, draft });
  }
  return rows;
}

export function defaultSeatDrafts(engine: Engine): Record<PlayerId, DeckDraft> {
  const rows = resolvedPresets(engine);
  const pack = starterFigureIds(engine);
  const plates = leaguePlates(engine);
  return {
    0: rows[0]?.draft ?? { figures: [...pack[0]], plates },
    1: rows[1]?.draft ?? { figures: [...pack[1]], plates },
  };
}

const LEAGUE_PLATES = [
  'Double Chance',
  'X Attack',
  'Goal Block',
  'X Speed',
  'Full Heal',
  'Scoop Up',
] as const;

function leaguePlates(engine: Engine): number[] {
  const plates: number[] = [];
  for (const name of LEAGUE_PLATES) {
    const id = pickPlateId(engine, name);
    if (id !== null) plates.push(id);
  }
  return plates;
}

export function leagueSix(engine: Engine): DeckDraft {
  const pack = starterFigureIds(engine);
  return { figures: [...pack[0]], plates: leaguePlates(engine) };
}

export function rivalLeagueSix(engine: Engine): DeckDraft {
  const pack = starterFigureIds(engine);
  return { figures: [...pack[1]], plates: leaguePlates(engine) };
}

/** vs-AI opponent: a strategy deck, never the same preset the human just picked. */
export function rivalStrategyDraft(engine: Engine, seed: number, avoid?: PresetId): DeckDraft {
  const rows = resolvedPresets(engine);
  const pool = avoid === undefined ? rows : rows.filter((row) => row.preset.id !== avoid);
  const pick = pool.length > 0 ? pool : rows;
  if (pick.length === 0) return rivalLeagueSix(engine);
  return pick[(seed >>> 0) % pick.length]?.draft ?? rivalLeagueSix(engine);
}

export function presetCaption(engine: Engine, draft: DeckDraft): string {
  return draft.figures
    .map((id) => figureOfContent(engine, id)?.name ?? `#${id}`)
    .join(' · ');
}

export function plateCaption(engine: Engine, draft: DeckDraft): string {
  if (draft.plates.length === 0) return 'No plates';
  return draft.plates.map((id) => plateOfContent(engine, id)?.name ?? `#${id}`).join(' · ');
}
