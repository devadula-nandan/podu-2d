/**
 * Parses the whole real content layer, then checks the schemas actually reject.
 *
 * The first half is the load-bearing part: if all 596 figures, 152 plates and 382
 * abilities go through `.strict()` schemas with every invariant refinement active,
 * the engine can stop defending against malformed content. The second half is the
 * part that stops the first half from being meaningless - a schema that accepts
 * everything also accepts the real data.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ContentError,
  figureSchema,
  figuresSchema,
  platesSchema,
  abilitiesSchema,
  WHEEL_TOTAL_UNITS,
} from './schema.js';
import { parseContent } from './load.js';

const readRaw = (name: string): unknown => JSON.parse(readFileSync(`data/content/${name}.json`, 'utf8'));

const rawFigures = readRaw('figures');
const rawPlates = readRaw('plates');
const rawAbilities = readRaw('abilities');

describe('the real content layer', () => {
  const bundle = parseContent({ figures: rawFigures, plates: rawPlates, abilities: rawAbilities });

  it('parses all 596 figures, 152 plates and 382 abilities', () => {
    expect(bundle.figures).toHaveLength(596);
    expect(bundle.plates).toHaveLength(152);
    expect(bundle.abilities).toHaveLength(382);
  });

  it('resolves every ability a figure claims', () => {
    const withAbility = bundle.figures.filter((f) => f.ability !== null);
    expect(withAbility).toHaveLength(472);
    for (const figure of withAbility) {
      expect(bundle.abilitiesByName.has(figure.ability?.name ?? '')).toBe(true);
    }
  });

  it('holds the 96-unit wheel invariant on every figure', () => {
    for (const figure of bundle.figures) {
      const sum = figure.wheel.reduce((total, seg) => total + seg.size, 0);
      expect(sum, `figure ${String(figure.id)} (${figure.name})`).toBe(WHEEL_TOTAL_UNITS);
    }
  });

  it('keeps the documented shape facts true, so the schema is not merely permissive', () => {
    // Each of these was read off the real JSON; if the pipeline changes one, the
    // schema comment above it is now a lie and should be revisited.
    // 4 inferred: 3 reconstructed wheels plus Pikachu's ruled Catastropika colour.
    expect(bundle.figures.filter((f) => f.inferred !== undefined)).toHaveLength(4);
    expect(bundle.figures.filter((f) => f.contested !== undefined)).toHaveLength(11);
    expect(bundle.figures.filter((f) => f.types.length === 2)).toHaveLength(338);
    expect(new Set(bundle.figures.map((f) => f.zMoves.length))).toEqual(new Set([1, 2, 3]));
    expect(bundle.plates.filter((p) => p.cost === null)).toHaveLength(31);
  });

  it('resolves a colour for every Z-Move segment, not just every wheel segment', () => {
    // The whole point of the tightened Z-Move schema: this used to be 65 nulls, which
    // parsed happily because the colour and star rules were applied to `wheel` only.
    const zMoves = bundle.figures.flatMap((f) => f.zMoves);
    expect(zMoves).toHaveLength(956);
    const byColor: Record<string, number> = {};
    for (const z of zMoves) byColor[z.color] = (byColor[z.color] ?? 0) + 1;
    // Z-Moves come in exactly two colours, and Purple is always the starred one.
    expect(byColor).toEqual({ white: 774, purple: 182 });
    expect(zMoves.filter((z) => z.damage?.kind === 'stars').every((z) => z.color === 'purple')).toBe(true);
  });

  it('keeps the raw Serebii label as provenance where the colour came from one', () => {
    // `colorRaw` is no longer an excuse for a missing colour, so it must agree with the
    // resolved value rather than replace it.
    const withRaw = bundle.figures.flatMap((f) => f.zMoves).filter((z) => z.colorRaw !== undefined);
    expect(withRaw).toHaveLength(65);
    for (const z of withRaw) {
      // Pikachu's Catastropika is the one row Serebii labels bare "Z-Move"; its colour
      // is adjudicated in tools/build-content.mjs rather than read off the label.
      if (z.colorRaw === 'Z-Move') continue;
      expect(z.colorRaw?.toLowerCase(), z.moveName).toContain(z.color);
    }
  });
});

/** A known-good figure to mutate, so each rejection test differs in exactly one field. */
function validFigure() {
  const [first] = figuresSchema.parse(rawFigures);
  if (!first) throw new Error('figures.json is empty');
  return structuredClone(first) as Record<string, unknown>;
}

/** A Z-Move segment in the shape the pipeline emits, so each test differs in one field. */
function zMoveSegment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    size: 96,
    moveName: 'Gigavolt Havoc',
    color: 'white',
    colorRaw: 'White Z-Move',
    damage: { kind: 'fixed', base: 220 },
    notes: 'The battle opponent becomes paralyzed.',
    isZMove: true,
    patchFlag: null,
    ...overrides,
  };
}

function expectRejected(figure: unknown): string {
  const result = figureSchema.safeParse(figure);
  expect(result.success).toBe(false);
  return result.success ? '' : result.error.issues.map((i) => i.message).join(' | ');
}

describe('the schemas reject malformed content', () => {
  it('rejects a deliberately malformed figure', () => {
    // One figure, many things wrong at once: a wheel that does not sum to 96, three
    // types, MP out of range, an unknown colour and stars on a White segment.
    const broken = {
      ...validFigure(),
      id: 9999,
      name: 'Brokenmon',
      types: ['Fire', 'Water', 'Grass'],
      mp: 7,
      wheel: [
        {
          size: 50,
          moveName: 'Nonsense',
          color: 'chartreuse',
          damage: { kind: 'fixed', base: 30 },
          notes: null,
        },
        {
          size: 10,
          moveName: 'Starry White',
          color: 'white',
          damage: { kind: 'stars', stars: 9 },
          notes: null,
        },
      ],
      wheelSum: 96,
    };
    const messages = expectRejected(broken);
    expect(messages).toMatch(/no figure has more than two types/);
    expect(messages).toMatch(/base MP tops out at 3/);
    expect(messages).toMatch(/stars run 1-4/);
  });

  it('rejects a wheel that does not sum to 96', () => {
    const figure = validFigure();
    const wheel = figure['wheel'] as { size: number }[];
    expect(expectRejected({ ...figure, wheel: wheel.slice(0, 1), wheelSum: wheel[0]?.size })).toMatch(
      /the wheel sums to \d+\/96/,
    );
  });

  it('rejects a stored wheelSum that disagrees with the segments', () => {
    expect(expectRejected({ ...validFigure(), wheelSum: 95 })).toMatch(
      /stored wheelSum 95 but the segments add to 96/,
    );
  });

  it('rejects a complete wheel with no Miss segment', () => {
    const figure = validFigure();
    const wheel = (figure['wheel'] as Record<string, unknown>[]).map((seg) =>
      seg['color'] === 'miss' ? { ...seg, color: 'white', damage: { kind: 'fixed', base: 10 } } : seg,
    );
    expect(expectRejected({ ...figure, wheel })).toMatch(/no Miss segment/);
  });

  it('rejects stars on a non-Purple segment', () => {
    const figure = validFigure();
    const wheel = [...(figure['wheel'] as Record<string, unknown>[])];
    wheel[0] = {
      size: 96,
      moveName: 'Gold Star',
      color: 'gold',
      damage: { kind: 'stars', stars: 3 },
      notes: null,
    };
    expect(expectRejected({ ...figure, wheel: wheel.slice(0, 1), wheelSum: 96 })).toMatch(
      /stars on a gold segment/,
    );
  });

  it('rejects a Z-Move segment with no colour, however it is explained', () => {
    // The regression guard for the 65 colourless Z-Moves. `colorRaw` used to buy a null
    // colour a pass; it does not any more, because the engine cannot compare a
    // colourless segment against a spin no matter how well the gap is documented.
    expect(expectRejected({ ...validFigure(), zMoves: [zMoveSegment({ color: null })] })).toMatch(
      /received null/,
    );
    expect(
      expectRejected({
        ...validFigure(),
        zMoves: [zMoveSegment({ color: null, colorRaw: 'White Z-Move' })],
      }),
    ).toMatch(/received null/);
    // ... and the same segment with its colour resolved is accepted, so the rejection
    // above is about the colour and not about some other part of the fixture.
    expect(figureSchema.safeParse({ ...validFigure(), zMoves: [zMoveSegment()] }).success).toBe(true);
  });

  it('applies the star rules to Z-Moves too, not just to the wheel', () => {
    expect(
      expectRejected({
        ...validFigure(),
        zMoves: [zMoveSegment({ damage: { kind: 'stars', stars: 3 } })],
      }),
    ).toMatch(/stars on a white Z-Move/);
    expect(
      expectRejected({
        ...validFigure(),
        zMoves: [zMoveSegment({ color: 'purple', damage: { kind: 'stars', stars: 5 } })],
      }),
    ).toMatch(/stars run 1-4/);
  });

  it('rejects a Miss segment that deals damage', () => {
    const figure = validFigure();
    const wheel = (figure['wheel'] as Record<string, unknown>[]).map((seg) =>
      seg['color'] === 'miss' ? { ...seg, damage: { kind: 'fixed', base: 20 } } : seg,
    );
    expect(expectRejected({ ...figure, wheel })).toMatch(/a Miss segment cannot deal damage/);
  });

  it('rejects an unknown field rather than silently dropping it', () => {
    expect(expectRejected({ ...validFigure(), sparkles: true })).toMatch(/[Uu]nrecognized key/);
  });

  it('rejects duplicate figure ids and names the first occurrence', () => {
    const figure = validFigure();
    const result = figuresSchema.safeParse([figure, structuredClone(figure)]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join()).toMatch(
        /duplicate figure id 1 \(first seen at index 0\)/,
      );
    }
  });

  it('rejects a plate cost outside 1-3, but allows the Mega Stones null', () => {
    const [plate] = platesSchema.parse(rawPlates);
    expect(platesSchema.safeParse([{ ...plate, cost: 4 }]).success).toBe(false);
    expect(platesSchema.safeParse([{ ...plate, cost: null }]).success).toBe(true);
  });

  it('rejects an ability with no text', () => {
    const [ability] = abilitiesSchema.parse(rawAbilities);
    expect(abilitiesSchema.safeParse([{ ...ability, text: '' }]).success).toBe(false);
  });
});

describe('the loader fails loudly', () => {
  it('names the offending figure, its move and the reason', () => {
    const figures = [validFigure(), validFigure()];
    const second = figures[1] as Record<string, unknown>;
    second['id'] = 461;
    second['name'] = 'Scrafty';
    const wheel = [...(second['wheel'] as Record<string, unknown>[])];
    wheel[1] = { ...(wheel[1] as Record<string, unknown>), size: -3 };
    second['wheel'] = wheel;

    const attempt = (): unknown => parseContent({ figures, plates: rawPlates, abilities: rawAbilities });

    expect(attempt).toThrow(ContentError);
    try {
      attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('figure 461 (Scrafty)');
      expect(message).toContain('wheel[1] "Roar of Time*"');
      expect(message).toContain('.size');
    }
  });

  it('reports an unresolved ability reference', () => {
    const figure = validFigure();
    figure['ability'] = { name: 'Nonexistent Ability', text: 'does nothing' };
    const attempt = (): unknown =>
      parseContent({ figures: [figure], plates: rawPlates, abilities: rawAbilities });
    expect(attempt).toThrow(/ability "Nonexistent Ability" is not in abilities\.json/);
  });
});
