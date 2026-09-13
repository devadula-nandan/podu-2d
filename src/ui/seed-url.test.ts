import { describe, expect, it } from 'vitest';
import { parseModeParam, parseSeedParam, pathWithSearch, searchWithSeed, seedShareUrl } from './seed-url.js';

describe('shareable seeds', () => {
  it('reads decimal and 0x hex, and starting seat is seed % 2', () => {
    expect(parseSeedParam('42')).toBe(42);
    expect(parseSeedParam('0x2a')).toBe(42);
    expect(parseSeedParam('')).toBeNull();
    expect(parseSeedParam('nope')).toBeNull();
    expect((42 >>> 0) % 2).toBe(0);
    expect((43 >>> 0) % 2).toBe(1);
  });

  it('writes ?seed= onto the current URL', () => {
    expect(seedShareUrl(42, 'http://localhost:5173/')).toBe('http://localhost:5173/?seed=42');
    expect(seedShareUrl(0x2a, 'http://localhost:5173/?seed=1&x=1')).toBe(
      'http://localhost:5173/?seed=42&x=1',
    );
  });

  it('reads ?mode=hotseat and treats other values as unset or vs AI', () => {
    expect(parseModeParam('hotseat')).toBe('hotseat');
    expect(parseModeParam('vsAi')).toBe('vsAi');
    expect(parseModeParam('vs-ai')).toBe('vsAi');
    expect(parseModeParam(null)).toBeNull();
    expect(parseModeParam('coop')).toBeNull();
  });

  it('keeps the current query when switching client paths', () => {
    expect(pathWithSearch('/dev', '?seed=2')).toBe('/dev?seed=2');
    expect(pathWithSearch('/3d', '?seed=2&x=1')).toBe('/3d?seed=2&x=1');
    expect(searchWithSeed('?x=1', 42)).toBe('?x=1&seed=42');
    expect(searchWithSeed('', 2)).toBe('?seed=2');
  });
});
