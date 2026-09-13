import { parseNetMessage, type NetMessage } from './protocol.js';
import {
  applyFullStart,
  applyPropose,
  claimSeat,
  configureSeat,
  disconnectToken,
  emptyRoom,
  publicRoom,
  touchSeat,
  type RoomState,
} from './room.js';

export interface Wire {
  send(msg: NetMessage): void;
  subscribe(fn: (msg: NetMessage) => void): () => void;
  subscribeStatus(fn: (up: boolean) => void): () => void;
  close(): void;
}

function withSeed(base: string, seed: number): string {
  const url = new URL(base);
  url.searchParams.set('seed', String(seed >>> 0));
  return url.toString();
}

export function createRelayWire(baseUrl: string | readonly string[], seed: number): Wire {
  const bases = (typeof baseUrl === 'string' ? [baseUrl] : [...baseUrl]).filter((row) => row !== '');
  const urls = (bases.length > 0 ? bases : ['ws://127.0.0.1:8787/sync']).map((base) => withSeed(base, seed));
  const listeners = new Set<(msg: NetMessage) => void>();
  const statusListeners = new Set<(up: boolean) => void>();
  const queue: NetMessage[] = [];
  let closed = false;
  let up = false;
  let generation = 0;
  let urlIndex = 0;
  let socket: WebSocket | null = null;

  const setUp = (next: boolean): void => {
    if (up === next) return;
    up = next;
    statusListeners.forEach((fn) => {
      fn(up);
    });
  };

  const flush = (): void => {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    for (const msg of queue) socket.send(JSON.stringify(msg));
    queue.length = 0;
  };

  const connect = (): void => {
    if (closed || socket !== null) return;
    const gen = generation;
    const ws = new WebSocket(urls[urlIndex % urls.length] ?? urls[0] ?? '');
    socket = ws;
    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      setUp(true);
      flush();
    });
    ws.addEventListener('message', (event) => {
      if (socket !== ws || typeof event.data !== 'string') return;
      try {
        const parsed = parseNetMessage(JSON.parse(event.data) as unknown);
        if (parsed !== null) {
          listeners.forEach((fn) => {
            fn(parsed);
          });
        }
      } catch {
        /* junk */
      }
    });
    ws.addEventListener('close', () => {
      if (socket === ws) socket = null;
      setUp(false);
      if (closed || generation !== gen) return;
      urlIndex += 1;
      globalThis.setTimeout(() => {
        if (!closed && socket === null && generation === gen) connect();
      }, 400);
    });
  };
  return {
    send(msg) {
      if (closed) {
        closed = false;
        generation += 1;
      }
      if (socket === null) connect();
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
        return;
      }
      queue.push(msg);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    subscribeStatus(fn) {
      statusListeners.add(fn);
      fn(up);
      return () => {
        statusListeners.delete(fn);
      };
    },
    close() {
      closed = true;
      generation += 1;
      setUp(false);
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}

/** In-process room host. Same rules as `server/sync.mjs`. */
export function createMemoryServer(): { connect: () => Wire } {
  const rooms = new Map<number, RoomState>();
  const clients: Client[] = [];

  const getRoom = (seed: number): RoomState => {
    let room = rooms.get(seed);
    if (room === undefined) {
      room = emptyRoom(seed);
      rooms.set(seed, room);
    }
    return room;
  };

  const broadcast = (seed: number, msg: NetMessage, except?: Client): void => {
    for (const client of clients) {
      if (client === except || client.seed !== seed) continue;
      client.emit(msg);
    }
  };

  const kickToken = (seed: number, token: string, except?: Client): void => {
    for (const client of clients) {
      if (client === except || client.seed !== seed || client.token !== token) continue;
      client.token = null;
      client.emit({ type: 'kicked', seed, reason: 'replaced' });
    }
  };

  return {
    connect: () => {
      const listeners = new Set<(msg: NetMessage) => void>();
      const client: Client = {
        seed: null,
        token: null,
        emit(msg) {
          listeners.forEach((fn) => {
            fn(msg);
          });
        },
      };
      clients.push(client);

      const handle = (msg: NetMessage): void => {
        const room = getRoom(msg.seed);
        client.seed = msg.seed;
        switch (msg.type) {
          case 'hello': {
            const claimed = claimSeat(room, Date.now(), msg.token ?? null, msg.reclaim ?? null);
            if (claimed.kickedToken !== null) kickToken(msg.seed, claimed.kickedToken, client);
            client.token = claimed.token;
            if (claimed.seat === null || claimed.token === null) {
              client.emit({
                type: 'welcome',
                seed: msg.seed,
                to: 'spectator',
                seat: null,
                room: publicRoom(room),
              });
              return;
            }
            client.emit({
              type: 'welcome',
              seed: msg.seed,
              to: claimed.token,
              seat: claimed.seat,
              room: publicRoom(room),
            });
            broadcast(msg.seed, { type: 'presence', seed: msg.seed, room: publicRoom(room) }, client);
            return;
          }
          case 'heartbeat':
            if (touchSeat(room, msg.token, Date.now())) {
              client.token = msg.token;
            }
            return;
          case 'configure': {
            if (!configureSeat(room, msg.token, msg)) return;
            broadcast(msg.seed, { type: 'presence', seed: msg.seed, room: publicRoom(room) });
            return;
          }
          case 'start': {
            if (!applyFullStart(room, msg.token, msg.config)) return;
            broadcast(msg.seed, { type: 'presence', seed: msg.seed, room: publicRoom(room) });
            return;
          }
          case 'propose': {
            const row = applyPropose(room, msg.token, msg.command, msg.who);
            if (row === null) return;
            broadcast(msg.seed, {
              type: 'commit',
              seed: msg.seed,
              seq: room.seq,
              command: row.command,
              who: row.who,
            });
            broadcast(msg.seed, { type: 'presence', seed: msg.seed, room: publicRoom(room) });
            return;
          }
          case 'leave':
            disconnectToken(room, msg.token);
            client.token = null;
            broadcast(msg.seed, { type: 'presence', seed: msg.seed, room: publicRoom(room) });
            return;
          case 'welcome':
          case 'presence':
          case 'rejected':
          case 'kicked':
          case 'commit':
            return;
        }
      };

      return {
        send(msg) {
          handle(msg);
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        subscribeStatus(fn) {
          fn(true);
          return () => {
            /* always up */
          };
        },
        close() {
          if (client.token !== null && client.seed !== null) {
            const room = getRoom(client.seed);
            disconnectToken(room, client.token);
            broadcast(client.seed, { type: 'presence', seed: client.seed, room: publicRoom(room) }, client);
          }
          const index = clients.indexOf(client);
          if (index >= 0) clients.splice(index, 1);
          listeners.clear();
        },
      };
    },
  };
}

interface Client {
  seed: number | null;
  token: string | null;
  emit(msg: NetMessage): void;
}

