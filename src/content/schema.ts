/**
 * zod schemas for `data/content/` — the single source of truth for the invariants
 * the engine is allowed to assume.
 *
 * `tools/validate.mjs` used to hand-roll these checks. It now imports this module
 * (Node >= 22.18 strips types natively), so there is exactly one definition of
 * "valid content" and the tool and the loader cannot drift apart. That is why the
 * relative import below uses an explicit `.ts` extension while the rest of the
 * codebase uses `.js`: Node's type stripping does not rewrite extensions, so this
 * one file has to be resolvable by both Node and the bundler unaided.
 *
 * The invariants encoded here are the ones the validator asserted, promoted to
 * parse-time so violations cannot reach the engine at all:
 *
 *   - every wheel's segment sizes sum to exactly 96
 *   - the stored `wheelSum` agrees with the recomputed sum
 *   - every complete wheel contains at least one Miss segment
 *   - stars appear only on Purple segments, and only in 1-4 - on Z-Moves as well as
 *     on the wheel, which is the half that used to be missing
 *   - MP is 0-3 (0 is real: five figures are deliberately immobile)
 *   - one or two types, no duplicates, every type known
 *   - every segment colour, wheel or Z-Move, is one of the five known colours
 *   - plate cost is 1-3 (or null for the 31 Mega Stones, which have no cost)
 *   - figure ids, plate ids and ability names are unique
 *
 * Two checks the validator reported as warnings are errors here, because the real
 * data satisfies them and a future violation would be a genuine content bug: a Miss
 * segment carrying damage, and a plate with no effect text.
 *
 * Object schemas are `.strict()` deliberately. Every field below was enumerated from
 * the actual JSON, so an unexpected key means `tools/build-content.mjs` grew an
 * output the engine has not been told about — which should be loud, not silent.
 */
import { z } from 'zod';
import { POKEMON_TYPES, SEGMENT_COLORS } from './dsl/primitives.ts';

/** Every wheel is a 96-unit discrete distribution. This is the content layer's one hard number. */
export const WHEEL_TOTAL_UNITS = 96;

export const RARITIES = ['C', 'UC', 'R', 'EX', 'UX'] as const;
export const LEAGUES = ['Beginner', 'Great', 'Elite', 'Champion', 'Leader', 'Ultra'] as const;
export const PLATE_CATEGORIES = ['Blue', 'Gold', 'Green', 'Pink', 'Purple', 'Red'] as const;
export const CONTENT_SOURCES = ['bulbapedia', 'serebii'] as const;

export const pokemonTypeSchema = z.enum(POKEMON_TYPES);
export const segmentColorSchema = z.enum(SEGMENT_COLORS);
export const raritySchema = z.enum(RARITIES);
export const leagueSchema = z.enum(LEAGUES);

/**
 * Four measured damage shapes. `multiplier` is a repeat-until-miss control-flow loop
 * rather than a static modifier, and `variable` is the written "90+", so collapsing
 * these to a number would lose real mechanics.
 */
/**
 * Literal union rather than `number().min(1).max(4)`, so the colour/star resolution
 * table can switch exhaustively over the four rungs. Kept as a union (and not a
 * refined `number`) because a transform would make the schema's input and output
 * types diverge, which leaks into every consumer's signature.
 */
const starCountSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)], {
  errorMap: () => ({
    message: 'stars run 1-4; Bulbapedia\u2019s explicit stars= over 1317 Purple segments never exceeds 4',
  }),
});

export const damageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), base: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('stars'), stars: starCountSchema }).strict(),
  z.object({ kind: z.literal('multiplier'), base: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('variable'), base: z.number().int().nonnegative() }).strict(),
]);

const segmentCore = {
  /** Integer /96 units. */
  size: z.number().int().positive(),
  moveName: z.string().min(1),
  damage: damageSchema.nullable(),
};

/**
 * Stars are Purple's damage notation and nothing else's: all 1317 starred wheel
 * segments and all 182 starred Z-Moves are Purple. Shared so that tightening the rule
 * on the wheel cannot leave the Z-Move path behind again - the colour and star checks
 * having been wheel-only is precisely how 65 colourless Z-Moves reached the engine.
 */
function checkStarColor(
  seg: { color: z.infer<typeof segmentColorSchema>; damage: Damage | null },
  ctx: z.RefinementCtx,
  kind: string,
): void {
  if (seg.damage?.kind === 'stars' && seg.color !== 'purple') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['damage'],
      message: `stars on a ${seg.color} ${kind}; only Purple segments carry stars`,
    });
  }
}

/** A segment of the battle wheel proper. Ordered and cyclic; sizes sum to 96. */
export const wheelSegmentSchema = z
  .object({
    ...segmentCore,
    color: segmentColorSchema,
    notes: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((seg, ctx) => {
    checkStarColor(seg, ctx, 'segment');
    if (seg.color === 'miss' && seg.damage !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['damage'],
        message: 'a Miss segment cannot deal damage',
      });
    }
  });

/**
 * Z-Move segments are a separate shape, not wheel segments with extra fields. They
 * always occupy the whole wheel (size 96) and always carry `notes`.
 *
 * `color` is required, like the wheel's. It used to be nullable because 65 segments
 * arrived without one, and this schema recorded that as provenance (`colorRaw` present)
 * rather than rejecting it. That was the wrong trade: a colourless segment cannot be
 * compared against a spin, so the engine has no defined behaviour for it. The cause was
 * a parser bug - Serebii qualifies the colour ("White Z-Move") and tools/parse-all.mjs
 * stripped the colour word along with the qualifier - which is fixed at the source, and
 * the one row Serebii leaves genuinely unlabelled is ruled on in tools/build-content.mjs.
 *
 * `colorRaw` survives on the 65 Serebii-sourced segments as the label the colour was
 * read from. It is provenance now, not an excuse for a missing value.
 */
export const zMoveSegmentSchema = z
  .object({
    ...segmentCore,
    jname: z.string().min(1).optional(),
    color: segmentColorSchema,
    colorRaw: z.string().min(1).optional(),
    patchFlag: z.null().optional(),
    notes: z.string().min(1),
    isZMove: z.literal(true),
  })
  .strict()
  .superRefine((seg, ctx) => {
    checkStarColor(seg, ctx, 'Z-Move');
  });

/**
 * The ability as embedded on the figure. Note this is a whole object, not an id -
 * `data/content/figures.json` inlines name, text and (usually) the Japanese name.
 * The text can differ slightly from `abilities.json` for 24 figures, so only the
 * name is treated as the join key.
 */
export const figureAbilitySchema = z
  .object({
    name: z.string().min(1),
    text: z.string().min(1),
    jname: z.string().min(1).optional(),
  })
  .strict();

export const figureSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    /** One of 23 named forms (Rotom, Necrozma, Aegislash stance, Zygarde...), else null. */
    form: z.string().min(1).nullable(),
    rarity: raritySchema,
    /** Unordered set of 1-2 types. Order is not load-bearing: both sources invert pairs. */
    types: z
      .array(pokemonTypeSchema)
      .min(1, 'a figure must have at least one type')
      .max(2, 'no figure has more than two types'),
    /** 0 is real - Metapod, Kakuna, Spiritomb, Aegislash Blade Forme and Regigigas are immobile. */
    mp: z
      .number()
      .int()
      .min(0, 'MP cannot be negative')
      .max(3, 'base MP tops out at 3; +1 effects are engine-side'),
    evoStage: z.number().int().min(1).max(4).nullable(),
    materialCost: z.number().int().positive(),
    gems: z.number().int().positive().nullable(),
    league: leagueSchema.nullable(),
    booster: z.string().min(1).nullable(),
    ability: figureAbilitySchema.nullable(),
    wheel: z.array(wheelSegmentSchema).min(1),
    /** Plural, and up to three: the Alolan guardians and Necrozma forms each carry three. */
    zMoves: z.array(zMoveSegmentSchema),
    wheelSum: z.number().int().nonnegative(),
    /** "bulbapedia", "serebii", or "mirrored:<id>" for the two mirrored Shiny wheels. */
    wheelSource: z.string().min(1),
    diskVersion: z.string().min(1).nullable(),
    sources: z.array(z.enum(CONTENT_SOURCES)).min(1),
    dataComplete: z.boolean(),
    /** Fields where two witnesses disagreed and neither could be outvoted (11 figures). */
    contested: z.array(z.string().min(1)).min(1).optional(),
    /** Provenance for the 3 reconstructed wheels and the 1 ruled Z-Move colour. */
    inferred: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((fig, ctx) => {
    const sum = fig.wheel.reduce((total, seg) => total + seg.size, 0);
    if (sum !== fig.wheelSum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['wheelSum'],
        message: `stored wheelSum ${fig.wheelSum} but the segments add to ${sum}`,
      });
    }
    if (fig.dataComplete && sum !== WHEEL_TOTAL_UNITS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['wheel'],
        message: `dataComplete but the wheel sums to ${sum}/${WHEEL_TOTAL_UNITS}`,
      });
    }
    if (fig.dataComplete && !fig.wheel.some((seg) => seg.color === 'miss')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['wheel'],
        message: 'no Miss segment; every complete wheel has at least one',
      });
    }
    if (new Set(fig.types).size !== fig.types.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['types'],
        message: 'duplicate type; types are an unordered set',
      });
    }
  });

export const plateSchema = z
  .object({
    id: z.number().int().positive(),
    category: z.enum(PLATE_CATEGORIES),
    name: z.string().min(1),
    rarity: raritySchema,
    /** Null for the 31 Mega Stones, which carry no deck cost. Otherwise 1-3, budget <= 8. */
    cost: z.number().int().min(1, 'plate cost runs 1-3').max(3, 'plate cost runs 1-3').nullable(),
    effect: z.string().min(1, 'a plate with no effect text cannot be implemented'),
    /** Literally whether the text ends "Your turn ends." */
    endsTurn: z.boolean(),
  })
  .strict();

export const abilitySchema = z
  .object({
    name: z.string().min(1),
    text: z.string().min(1),
    /** Provenance only, not an engine concern, so left open rather than enumerated. */
    source: z.string().min(1),
  })
  .strict();

/** Collection-level invariants: identity must be unique or nothing downstream can key off it. */
function uniqueBy<T>(label: string, key: (item: T) => string | number) {
  return (items: readonly T[], ctx: z.RefinementCtx): void => {
    const seen = new Map<string | number, number>();
    items.forEach((item, index) => {
      const k = key(item);
      const first = seen.get(k);
      if (first === undefined) {
        seen.set(k, index);
        return;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `duplicate ${label} ${String(k)} (first seen at index ${String(first)})`,
      });
    });
  };
}

export const figuresSchema = z.array(figureSchema).superRefine(uniqueBy('figure id', (f) => f.id));

export const platesSchema = z.array(plateSchema).superRefine(uniqueBy('plate id', (p) => p.id));

export const abilitiesSchema = z.array(abilitySchema).superRefine(uniqueBy('ability name', (a) => a.name));

export type Damage = z.infer<typeof damageSchema>;
export type WheelSegment = z.infer<typeof wheelSegmentSchema>;
export type ZMoveSegment = z.infer<typeof zMoveSegmentSchema>;
export type FigureAbility = z.infer<typeof figureAbilitySchema>;
export type Figure = z.infer<typeof figureSchema>;
export type Plate = z.infer<typeof plateSchema>;
export type Ability = z.infer<typeof abilitySchema>;
export type Rarity = (typeof RARITIES)[number];
export type League = (typeof LEAGUES)[number];
export type PlateCategory = (typeof PLATE_CATEGORIES)[number];

/**
 * Thrown by the loader. Carries every issue, not just the first: content bugs arrive
 * in families (one bad parser rule breaks forty figures), so a single-issue error
 * message costs forty round trips.
 */
export class ContentError extends Error {
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'ContentError';
    this.details = details;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function scalar(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

/**
 * Turn a zod path into something a human can act on.
 *
 * A bare `[461, "wheel", 2, "size"]` is useless when the file is 1.3 MB on one line,
 * so the offending figure is named by id and name, and a segment is named by its move.
 */
function locate(kind: string, raw: unknown, path: readonly (string | number)[]): string {
  const index = path[0];
  if (!Array.isArray(raw) || typeof index !== 'number') return kind;

  const item = asRecord((raw as unknown[])[index]);
  const id = scalar(item?.['id']);
  const name = scalar(item?.['name']) ?? '?';
  const head = `${kind} ${id ?? `#${String(index)}`} (${name})`;

  const field = path[1];
  const segmentIndex = path[2];
  if ((field === 'wheel' || field === 'zMoves') && typeof segmentIndex === 'number') {
    const segments = item?.[field];
    const move = Array.isArray(segments) ? scalar(asRecord(segments[segmentIndex])?.['moveName']) : undefined;
    const rest = path.slice(3).join('.');
    return `${head} ${field}[${String(segmentIndex)}]${move ? ` "${move}"` : ''}${rest ? `.${rest}` : ''}`;
  }

  const rest = path.slice(1).join('.');
  return rest ? `${head} ${rest}` : head;
}

const MAX_REPORTED_ISSUES = 25;

/** One line per issue, each naming the figure/plate/ability that caused it. */
export function formatContentIssues(kind: string, raw: unknown, error: z.ZodError): string[] {
  return error.issues.map((issue) => `${locate(kind, raw, issue.path)}: ${issue.message}`);
}

/** Parse or throw, with every issue in the message rather than just the first. */
export function parseOrThrow<S extends z.ZodTypeAny>(kind: string, schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data as z.output<S>;

  const lines = formatContentIssues(kind, raw, result.error);
  const shown =
    lines.length <= MAX_REPORTED_ISSUES
      ? lines
      : [
          ...lines.slice(0, MAX_REPORTED_ISSUES),
          `... and ${String(lines.length - MAX_REPORTED_ISSUES)} more`,
        ];
  throw new ContentError(
    `${String(lines.length)} ${kind} validation error(s):\n  ${shown.join('\n  ')}`,
    lines,
  );
}
