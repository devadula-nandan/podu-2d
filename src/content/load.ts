/**
 * The content loader: read `data/content/*.json`, parse it through the zod schemas,
 * and fail loudly with a message that names the offending figure.
 *
 * This is the only door between the JSON on disk and the engine. It touches the
 * filesystem, which is why `src/engine/**` is forbidden by lint from importing it -
 * the engine receives an already-parsed `ContentBundle` instead. Pure types come
 * from `./schema.ts`, which the engine may import freely.
 *
 * The `.ts` extension on the schema import is deliberate; see the note at the top of
 * `schema.ts`.
 */
import { readFile } from 'node:fs/promises';
import { ContentError, abilitiesSchema, figuresSchema, parseOrThrow, platesSchema } from './schema.ts';
import type { Ability, Figure, Plate } from './schema.ts';

export const DEFAULT_CONTENT_DIR = 'data/content';

export interface ContentBundle {
  readonly figures: readonly Figure[];
  readonly plates: readonly Plate[];
  readonly abilities: readonly Ability[];
  /** Ability lookup by name. `figures.json` inlines abilities but joins on the name. */
  readonly abilitiesByName: ReadonlyMap<string, Ability>;
  readonly figuresById: ReadonlyMap<number, Figure>;
}

export interface RawContent {
  readonly figures: unknown;
  readonly plates: unknown;
  readonly abilities: unknown;
}

/**
 * Checks that need more than one file, so they cannot live in a single schema.
 * Every ability a figure claims must exist in `abilities.json`, or the effect runtime
 * would silently register nothing for it.
 */
function crossReference(figures: readonly Figure[], abilitiesByName: ReadonlyMap<string, Ability>): string[] {
  const problems: string[] = [];
  for (const figure of figures) {
    if (figure.ability && !abilitiesByName.has(figure.ability.name)) {
      problems.push(
        `figure ${String(figure.id)} (${figure.name}): ability "${figure.ability.name}" is not in abilities.json`,
      );
    }
  }
  return problems;
}

/** Parse already-read JSON. Separated from I/O so tests can feed it malformed input. */
export function parseContent(raw: RawContent): ContentBundle {
  const figures = parseOrThrow('figure', figuresSchema, raw.figures);
  const plates = parseOrThrow('plate', platesSchema, raw.plates);
  const abilities = parseOrThrow('ability', abilitiesSchema, raw.abilities);

  const abilitiesByName = new Map(abilities.map((ability) => [ability.name, ability]));
  const problems = crossReference(figures, abilitiesByName);
  if (problems.length > 0) {
    throw new ContentError(
      `${String(problems.length)} unresolved content reference(s):\n  ${problems.join('\n  ')}`,
      problems,
    );
  }

  return {
    figures,
    plates,
    abilities,
    abilitiesByName,
    figuresById: new Map(figures.map((figure) => [figure.id, figure])),
  };
}

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw new ContentError(`cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ContentError(
      `${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/** Read and validate the content layer. Throws `ContentError` on any violation. */
export async function loadContent(dir: string = DEFAULT_CONTENT_DIR): Promise<ContentBundle> {
  const [figures, plates, abilities] = await Promise.all([
    readJson(`${dir}/figures.json`),
    readJson(`${dir}/plates.json`),
    readJson(`${dir}/abilities.json`),
  ]);
  return parseContent({ figures, plates, abilities });
}
