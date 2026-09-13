import { describe, expect, it } from 'vitest';
import {
  clearLiveSession,
  parseLiveSnapshot,
  readLiveSession,
  snapshotForUrl,
  writeLiveSession,
  type SessionStorageLike,
} from './session-persist.js';
import type { DuelConfig } from './use-duel.js';

const config: DuelConfig = {
  seed: 2,
  startingPlayer: 0,
  decks: {
    0: { figures: [1, 2, 3, 4, 5, 6], plates: [] },
    1: { figures: [7, 8, 9, 10, 11, 12], plates: [] },
  },
  allowUnimplemented: false,
  mode: 'hotseat',
  humanSeat: 0,
  difficulty: 'easy',
};

function memoryStorage(initial: Record<string, string> = {}): SessionStorageLike {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('live session persist', () => {
  it('round-trips config + commands keyed as one live snapshot', () => {
    const storage = memoryStorage();
    writeLiveSession(
      {
        config,
        viewing: 0,
        commands: [{ command: { kind: 'advanceClock', player: 0, ms: 12 }, who: 'clock' }],
      },
      storage,
    );
    const read = readLiveSession(storage);
    expect(read?.config.seed).toBe(2);
    expect(read?.commands).toHaveLength(1);
    expect(read?.commands[0]?.command.kind).toBe('advanceClock');
  });

  it('drops a leftover session when the URL asks for another seed', () => {
    const storage = memoryStorage();
    writeLiveSession({ config, viewing: 0, commands: [] }, storage);
    expect(snapshotForUrl(99, storage)).toBeNull();
    expect(readLiveSession(storage)).toBeNull();
  });

  it('keeps the snapshot when the URL seed matches, and when the URL has no seed', () => {
    const storage = memoryStorage();
    writeLiveSession({ config, viewing: 1, commands: [] }, storage);
    expect(snapshotForUrl(2, storage)?.viewing).toBe(1);
    expect(snapshotForUrl(null, storage)?.config.seed).toBe(2);
  });

  it('rejects junk JSON and unknown command kinds', () => {
    expect(parseLiveSnapshot(null)).toBeNull();
    expect(parseLiveSnapshot({ config, viewing: 0, commands: [{ who: 'human', command: { kind: 'nope' } }] })).toBeNull();
    const storage = memoryStorage({ 'podu:live-duel:v1': '{not json' });
    expect(readLiveSession(storage)).toBeNull();
    clearLiveSession(storage);
    expect(readLiveSession(storage)).toBeNull();
  });
});
