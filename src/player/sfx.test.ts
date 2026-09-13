import { describe, expect, it } from 'vitest';
import { readSfxMuted, writeSfxMuted } from './sfx.js';

describe('sfx mute flag', () => {
  it('defaults to sound on when storage is unavailable', () => {
    expect(readSfxMuted()).toBe(false);
  });

  it('writeSfxMuted does not throw without a window', () => {
    expect(() => {
      writeSfxMuted(true);
      writeSfxMuted(false);
    }).not.toThrow();
  });
});
