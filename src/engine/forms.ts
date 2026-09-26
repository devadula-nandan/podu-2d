/**
 * Form change, evolution, and Mega Evolution — three systems that share a transform
 * but are not the same rule.
 *
 * There is no `evolvesTo` field in the content. Names are not unique. Everything here
 * is keyed by figure id and derived from:
 *
 *   - the `form` field (same printed name, different named form)
 *   - Mega names (`Mega ${base}`, `Mega ${base} X|Y`)
 *   - species names that actually appear in ability / plate / `changeForm.into` text
 *
 * No National Dex lines are invented. "It can evolve" with no named target does not
 * pick a Metapod-to-Butterfree successor out of thin air.
 */
import { MEGA_DURATION_TURNS, MEGA_EVOLUTIONS_PER_DUEL } from '../rules/constants.js';
import type { EngineContent, Figure } from './content.js';
import { figureContent } from './content.js';
import type { GameEvent } from './events.js';
import type { ContentFigureId, FigureUid, PlayerId } from './ids.js';
import { contentFigureId } from './ids.js';
import type { GameState, TransformReason } from './state.js';
import { figureOf } from './state.js';

const FORM_ONLY_RE = /can only be set as a form/i;

const figuresListCache = new WeakMap<EngineContent, readonly Figure[]>();
const megaTargetCache = new Map<string, ContentFigureId[]>();

export function isFormOnlyText(text: string | null | undefined): boolean {
  return FORM_ONLY_RE.test(text ?? '');
}

function allFigures(content: EngineContent): readonly Figure[] {
  let list = figuresListCache.get(content);
  if (list === undefined) {
    list = [...content.figures.values()].map((entry) => entry.figure);
    figuresListCache.set(content, list);
  }
  return list;
}

function byId(content: EngineContent, id: ContentFigureId) {
  return figureContent(content, id).figure;
}

const stripShiny = (name: string): string => {
  if (name.length < 6) return name.trim();
  const c0 = name.charCodeAt(0);
  if (c0 !== 83 && c0 !== 115) return name.trim(); // S/s
  return name.replace(/^shiny\s+/i, '').trim();
};
/** Other figures that share this printed name and carry a different `form`. */
export function formSiblings(content: EngineContent, figureId: ContentFigureId): ContentFigureId[] {
  const source = byId(content, figureId);
  return allFigures(content)
    .filter((figure) => figure.id !== source.id && figure.name === source.name && figure.form !== source.form)
    .map((figure) => contentFigureId(figure.id))
    .sort((a, b) => a - b);
}

/**
 * Resolve `changeForm.into` strings against the bundle.
 *
 * A token matches a figure's `form` field or its printed name (case-insensitive).
 * Same-name form siblings are preferred over unrelated namesakes.
 */
export function resolveFormTargets(
  content: EngineContent,
  fromId: ContentFigureId,
  into: readonly string[],
): ContentFigureId[] {
  if (into.length === 0) return formSiblings(content, fromId);
  const source = byId(content, fromId);
  const tokens = into.map((token) => token.trim().toLowerCase()).filter((token) => token.length > 0);
  const siblings = formSiblings(content, fromId);
  const fromSiblings = siblings.filter((id) => {
    const figure = byId(content, id);
    const form = (figure.form ?? '').toLowerCase();
    const name = figure.name.toLowerCase();
    return tokens.some((token) => form.includes(token) || name.includes(token) || token.includes(form) || token === name);
  });
  if (fromSiblings.length > 0) return fromSiblings;

  const named = allFigures(content)
    .filter((figure) => {
      if (figure.id === source.id) return false;
      const form = (figure.form ?? '').toLowerCase();
      const name = figure.name.toLowerCase();
      return tokens.some((token) => form === token || name === token || form.includes(token) || name.endsWith(token));
    })
    .map((figure) => contentFigureId(figure.id))
    .sort((a, b) => a - b);
  return named;
}

/**
 * Mega forms of a figure, keyed by the printed name.
 *
 * Charizard → Mega Charizard / Mega Charizard X / Mega Charizard Y.
 * A Shiny source prefers a Shiny Mega of the same base when one exists.
 * `hint` is typically a plate name (`Charizardite X`) used to break X/Y ties.
 */
export function resolveMegaTargets(
  content: EngineContent,
  fromId: ContentFigureId,
  hint = '',
): ContentFigureId[] {
  const cacheKey = `${fromId}|${hint}`;
  const cached = megaTargetCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const source = byId(content, fromId);
  const shiny = /^shiny\s+/i.test(source.name);
  const base = stripShiny(source.name);
  if (/^mega\s+/i.test(base)) {
    megaTargetCache.set(cacheKey, []);
    return [];
  }

  const candidates = allFigures(content).filter((figure) => {
    const name = figure.name;
    const stripped = stripShiny(name);
    if (!/^mega\s+/i.test(stripped)) return false;
    const rest = stripped.replace(/^mega\s+/i, '');
    return rest === base || rest.startsWith(`${base} `);
  });

  const hinted = hint.match(/\b([XY])\b/i)?.[1]?.toUpperCase();
  let pool = candidates;
  if (hinted !== undefined) {
    const narrowed = candidates.filter((figure) => stripShiny(figure.name).endsWith(` ${hinted}`));
    if (narrowed.length > 0) pool = narrowed;
  }

  const preferred = pool.filter((figure) => /^shiny\s+/i.test(figure.name) === shiny);
  const chosen = preferred.length > 0 ? preferred : pool;
  const result = chosen.map((figure) => contentFigureId(figure.id)).sort((a, b) => a - b);
  megaTargetCache.set(cacheKey, result);
  return result;
}

/**
 * Species names that appear in free text and exist as figures in the bundle.
 *
 * Longest name first, so "Dawn Wings Necrozma" wins over "Necrozma". The source
 * figure's own name is ignored. This is the only evolution targeting we do — no
 * stage-increment walk, no dex line.
 */
export function namedFiguresInText(content: EngineContent, text: string, selfId: ContentFigureId): ContentFigureId[] {
  const self = byId(content, selfId);
  const names = [...new Set(allFigures(content).map((figure) => figure.name))].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  const found = new Set<ContentFigureId>();
  for (const name of names) {
    if (name === self.name) continue;
    if (!lower.includes(name.toLowerCase())) continue;
    for (const figure of allFigures(content)) {
      if (figure.name === name) found.add(contentFigureId(figure.id));
    }
  }
  return [...found].sort((a, b) => a - b);
}

export function resolveEvolutionTargets(
  content: EngineContent,
  fromId: ContentFigureId,
  sourceText: string,
): ContentFigureId[] {
  return namedFiguresInText(content, sourceText, fromId);
}

const EVOLVE_ON_AFTER_BATTLE = new Set([
  'Metamorphosis',
  'Emergent Evolution',
  'Arm Thrust Evolution',
  'Poisonous Evolution',
  'Floating Candle',
]);
const EVOLVE_ON_KO = new Set(['Rapid Evolution', 'Evolution to Beauty', 'Trainee', 'Flame Evolution']);
const EVOLVE_ON_PC_BENCH = new Set(['Spontaneous Evolution', 'Upside-Down Evolution', 'Bright Arrow']);
const EVOLVE_ON_SURROUND = new Set(['Black Core']);

export type EvolutionHook = 'afterBattle' | 'knockedOut' | 'pcToBench' | 'surround';

/** Ability names whose printed text is an evolution trigger. Justified by `abilities.json`. */
export function evolutionHookForAbility(name: string | null | undefined): EvolutionHook | null {
  if (name === null || name === undefined) return null;
  if (EVOLVE_ON_AFTER_BATTLE.has(name)) return 'afterBattle';
  if (EVOLVE_ON_KO.has(name)) return 'knockedOut';
  if (EVOLVE_ON_PC_BENCH.has(name)) return 'pcToBench';
  if (EVOLVE_ON_SURROUND.has(name)) return 'surround';
  return null;
}

export function abilityNameOf(content: EngineContent, figureId: ContentFigureId): string | null {
  return byId(content, figureId).ability?.name ?? null;
}

export function megaBlockedByOncePerDuel(state: GameState, uid: FigureUid): boolean {
  const figure = figureOf(state, uid);
  if (figure.megaTurnsLeft !== null) return true;
  const used = state.players[figure.owner].megaUsed ? 1 : 0;
  return used >= MEGA_EVOLUTIONS_PER_DUEL;
}

export function transformEvents(
  uid: FigureUid,
  fromId: ContentFigureId,
  toId: ContentFigureId,
  reason: TransformReason,
): GameEvent[] {
  if (fromId === toId) return [];
  return [{ kind: 'figureTransformed', uid, fromId, toId, reason }];
}

export function megaStartEvents(
  state: GameState,
  uid: FigureUid,
  player: PlayerId,
  toId: ContentFigureId,
  turns: number = MEGA_DURATION_TURNS,
): GameEvent[] {
  const figure = figureOf(state, uid);
  return [
    ...transformEvents(uid, figure.figureId, toId, 'mega'),
    { kind: 'megaStarted', uid, player, turns: Math.max(1, turns) },
  ];
}

export function megaEndEvents(state: GameState, uid: FigureUid): GameEvent[] {
  const figure = figureOf(state, uid);
  if (figure.megaRevertsTo === null) return [];
  return transformEvents(uid, figure.figureId, figure.megaRevertsTo, 'megaEnd');
}

/** Default Mega length, imported so callers do not hardcode 7. */
export const defaultMegaTurns = MEGA_DURATION_TURNS;

/**
 * Transform a figure if its ability name is an evolution hook and a species name
 * actually appears in the printed text. No target in the text means no transform.
 */
export function evolveIfHooked(
  state: GameState,
  content: EngineContent,
  uid: FigureUid,
  hook: EvolutionHook,
): GameEvent[] {
  const figure = figureOf(state, uid);
  const ability = byId(content, figure.figureId).ability;
  if (evolutionHookForAbility(ability?.name) !== hook) return [];
  const targets = resolveEvolutionTargets(content, figure.figureId, ability?.text ?? '');
  const to = targets[0];
  if (to === undefined) return [];
  return transformEvents(uid, figure.figureId, to, 'evolve');
}
