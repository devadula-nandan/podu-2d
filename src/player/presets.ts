import type { Engine } from '../engine/index.js';
import { isFormOnlyFigure } from '../engine/index.js';
import { figureOfContent, plateOfContent, starterFigureIds } from '../ui/boot.js';
import {
  deckHasErrors,
  validateDeck,
  type DeckDraft,
} from '../ui/model.js';

export type PresetId =
  | 'night-league'
  | 'slipstream'
  | 'violet-cage'
  | 'goal-line'
  | 'stone-circuit'
  | 'gym-circuit';

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

/** Six original-feeling archetypes. Names resolve against printed content. */
export const DECK_PRESETS: readonly DeckPreset[] = [
  {
    id: 'night-league',
    name: 'Night League',
    blurb: 'UX midrange — Eevee line plus dark control',
    figures: ['Umbreon', 'Espeon', 'Sylveon', 'Darkrai', 'Cresselia', 'Absol'],
    plates: ['Double Chance', 'Goal Block'],
  },
  {
    id: 'slipstream',
    name: 'Slipstream',
    blurb: 'Surround swarm — 3 MP flyers and cats',
    figures: ['Ninjask', 'Crobat', 'Talonflame', 'Swellow', 'Liepard', 'Emolga'],
    plates: ['X Speed', 'Long Throw'],
  },
  {
    id: 'violet-cage',
    name: 'Violet Cage',
    blurb: 'Purple control — status wheels and walls',
    figures: ['Gengar', 'Sableye', 'Wobbuffet', 'Malamar', 'Banette', 'Mismagius'],
    plates: ['Full Heal', 'Scoop Up'],
  },
  {
    id: 'goal-line',
    name: 'Goal Line',
    blurb: 'Goal rush — 3 MP runners down the corridor',
    figures: ['Greninja', 'Weavile', 'Talonflame', 'Noivern', 'Jolteon', 'Crobat'],
    plates: ['X Speed', 'Hurdle Jump'],
  },
  {
    id: 'stone-circuit',
    name: 'Stone Circuit',
    blurb: 'Mega stones and a Z-leaning core',
    figures: ['Charizard', 'Lucario', 'Blaziken', 'Gengar', 'Greninja', 'Solgaleo'],
    plates: ['Charizardite X', 'Lucarionite', 'Gengarite'],
  },
  {
    id: 'gym-circuit',
    name: 'Gym Circuit',
    blurb: 'Mixed gym — Kanto aces on one bench',
    figures: ['Pikachu', 'Charizard', 'Venusaur', 'Blastoise', 'Machamp', 'Gyarados'],
    plates: ['Double Chance', 'Max Revive', 'X Attack'],
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
  if (deckHasErrors(validateDeck(engine, draft, true))) return null;
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

export function leagueSix(engine: Engine): DeckDraft {
  const pack = starterFigureIds(engine);
  return { figures: [...pack[0]], plates: [] };
}

export function rivalLeagueSix(engine: Engine): DeckDraft {
  const pack = starterFigureIds(engine);
  return { figures: [...pack[1]], plates: [] };
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
