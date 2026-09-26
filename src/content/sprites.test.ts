import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContent } from './load.js';
import {
  containedDrawRect,
  figureInitials,
  pokeApiSlug,
  resolveFigureSprite,
  spriteCoverage,
  spriteUrlForFigure,
} from './sprites.js';

const figures = parseContent({
  figures: JSON.parse(readFileSync('data/content/figures.json', 'utf8')) as unknown,
  plates: JSON.parse(readFileSync('data/content/plates.json', 'utf8')) as unknown,
  abilities: JSON.parse(readFileSync('data/content/abilities.json', 'utf8')) as unknown,
}).figures;

function byId(id: number) {
  const figure = figures.find((row) => row.id === id);
  if (figure === undefined) throw new Error(`missing figure ${id}`);
  return figure;
}

describe('figure sprites', () => {
  const coverage = spriteCoverage(figures);

  it('resolves a PokeAPI URL for every printed figure', () => {
    expect(figures).toHaveLength(605);
    expect(coverage.resolved).toBe(605);
    expect(coverage.fallback).toBe(0);
    expect(coverage.missingIds).toEqual([]);
  });

  it('keys Dawn Wings Necrozma by figure id, not the base species art', () => {
    const dawn = resolveFigureSprite(byId(504));
    const copies = [647, 648].map((id) => resolveFigureSprite(byId(id)));
    const base = resolveFigureSprite(byId(498));
    expect(dawn?.slug).toBe('necrozma-dawn');
    expect(dawn?.pokeApiId).toBe(10156);
    expect(base?.slug).toBe('necrozma');
    expect(base?.pokeApiId).toBe(800);
    expect(dawn?.url).not.toBe(base?.url);
    expect(copies.every((row) => row?.url === dawn?.url)).toBe(true);
  });

  it('does not silently reuse base art for Mega, Alolan, or form variants', () => {
    const charizard = resolveFigureSprite(byId(50));
    const megaX = resolveFigureSprite(byId(276));
    const megaY = resolveFigureSprite(byId(277));
    const alolan = resolveFigureSprite(byId(353));
    expect(charizard?.slug).toBe('charizard');
    expect(megaX?.slug).toBe('charizard-mega-x');
    expect(megaY?.slug).toBe('charizard-mega-y');
    expect(megaX?.url).not.toBe(megaY?.url);
    expect(megaX?.url).not.toBe(charizard?.url);
    expect(alolan?.slug).toBe('ninetales-alola');
    expect(alolan?.pokeApiId).toBe(10104);
  });

  it('points every resolved URL at official-artwork, not the 96×96 dex sprites', () => {
    const charizard = resolveFigureSprite(byId(50));
    expect(charizard?.url).toBe(
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png',
    );
    expect(charizard?.url).toContain('/other/official-artwork/');
    expect(charizard?.url).not.toMatch(/\/sprites\/pokemon\/\d+\.png$/);
  });

  it('uses shiny sprite URLs when the printed name is Shiny', () => {
    const gyarados = resolveFigureSprite(byId(400));
    expect(gyarados?.shiny).toBe(true);
    expect(gyarados?.url).toContain('/shiny/');
    expect(gyarados?.url).toMatch(/\/130\.png$/);
    const shinyMega = resolveFigureSprite(byId(639));
    expect(shinyMega?.slug).toBe('charizard-mega-x');
    expect(shinyMega?.shiny).toBe(true);
    expect(shinyMega?.url).toContain('/shiny/');
    expect(shinyMega?.url).not.toBe(resolveFigureSprite(byId(276))?.url);
  });

  it('does not treat Meganium as a Mega', () => {
    expect(pokeApiSlug(byId(445))).toEqual({ slug: 'meganium', shiny: false });
  });

  it('fits official-art rectangles inside a token box without overflow', () => {
    const dest = containedDrawRect(475, 475, 40, 40, 28);
    expect(dest.w).toBe(28);
    expect(dest.h).toBe(28);
    expect(dest.x).toBe(26);
    expect(dest.y).toBe(26);
    const wide = containedDrawRect(200, 100, 0, 0, 40);
    expect(wide.w).toBe(40);
    expect(wide.h).toBe(20);
    expect(wide.x + wide.w).toBeLessThanOrEqual(20);
    expect(wide.y + wide.h).toBeLessThanOrEqual(20);
  });

  it('falls back to two-letter discs only when the map misses', () => {
    expect(spriteUrlForFigure({ id: 0, name: 'Not A Pokemon', form: null })).toBeNull();
    expect(figureInitials('Tauros')).toBe('TA');
    expect(figureInitials('Muk')).toBe('MUK');
  });
});
