import { describe, expect, it } from 'vitest';
import { figureUid, nodeId, type Command } from '../engine/index.js';
import type { DuelConfig } from '../ui/use-duel.js';
import type { SessionStorageLike } from '../ui/session-persist.js';
import { TableHub } from './table.js';
import { createMemoryServer } from './wire.js';

function mem(): SessionStorageLike {
  const data = new Map<string, string>();
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

function isolatedHub(wire: ReturnType<ReturnType<typeof createMemoryServer>['connect']>): TableHub {
  return new TableHub(wire, { session: mem(), local: mem() });
}

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

const deploy: Command = {
  kind: 'deploy',
  player: 0,
  uid: figureUid(0),
  entry: nodeId('r4c0'),
  to: nodeId('r4c0'),
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('table hub', () => {
  it('assigns home / away / spectator and folds the same command list', async () => {
    const net = createMemoryServer();
    const home = isolatedHub(net.connect());
    const away = isolatedHub(net.connect());
    const spec = isolatedHub(net.connect());
    home.attach(2);
    away.attach(2);
    spec.attach(2);
    await wait(10);

    expect(home.publicState.role).toBe('home');
    expect(home.publicState.link).toBe(true);
    expect(away.publicState.role).toBe('away');
    expect(spec.publicState.role).toBe('spectator');

    home.configure({
      deck: config.decks[0],
      ready: true,
      mode: 'hotseat',
      difficulty: 'easy',
    });
    away.configure({
      deck: config.decks[1],
      ready: true,
      mode: 'hotseat',
      difficulty: 'easy',
    });
    await wait(10);
    expect(home.publicState.snapshot?.config.seed).toBe(2);
    expect(away.publicState.snapshot?.config.mode).toBe('hotseat');
    expect(spec.publicState.snapshot?.config.seed).toBe(2);

    const commits: string[] = [];
    away.onCommit((row) => {
      commits.push(row.command.kind);
    });
    home.propose(deploy, 'human');
    await wait(10);
    expect(home.publicState.snapshot?.commands).toHaveLength(1);
    expect(away.publicState.snapshot?.commands).toHaveLength(1);
    expect(away.publicState.snapshot?.commands[0]?.command).toEqual(deploy);
    expect(commits).toEqual(['deploy']);
  });

  it('starts vs-AI from a full config without a second human', async () => {
    const net = createMemoryServer();
    const home = isolatedHub(net.connect());
    const spec = isolatedHub(net.connect());
    home.attach(9);
    await wait(10);
    home.publishStart({ ...config, mode: 'vsAi', seed: 9 });
    spec.attach(9);
    await wait(10);
    expect(home.publicState.snapshot?.config.mode).toBe('vsAi');
    expect(spec.publicState.role).toBe('spectator');
  });

  it('hellos again after detach so Strict Mode remounts can sit', async () => {
    const net = createMemoryServer();
    const hub = isolatedHub(net.connect());
    hub.attach(3);
    await wait(10);
    expect(hub.publicState.seat).toBe(0);
    hub.detach();
    expect(hub.publicState.seat).toBe(0);
    hub.attach(3);
    await wait(10);
    expect(hub.publicState.seat).toBe(0);
    expect(hub.publicState.link).toBe(true);
    const extra = isolatedHub(net.connect());
    extra.attach(3);
    await wait(10);
    expect(extra.publicState.seat).toBe(1);
  });
});
