/**
 * Authoritative two-seat room + same-origin WebSocket.
 *
 *   npm run sync              sidecar on :8787  (Vite proxies /sync here)
 *   npm run start             HTTP + WS on one port, serves dist/
 *
 * Client always connects to ws(s)://<page-host>/sync — never ?relay= or :8787 in the URL.
 *
 * Rooms persist under PODU_ROOMS_DIR (default .rooms/). Sockets and heartbeats
 * are in-memory only; a restart marks seats disconnected and keeps tokens/log.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const STALE_MS = 16_000;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const staticFlag = process.argv.indexOf('--static');
const STATIC_DIR =
  staticFlag >= 0
    ? (process.argv[staticFlag + 1] ?? 'dist')
    : (process.env.PODU_STATIC ?? null);
const PORT = Number(process.env.PODU_SYNC_PORT ?? process.env.PODU_PORT ?? (STATIC_DIR ? 4173 : 8787));
const HOST = '0.0.0.0';
const ROOMS_DIR = process.env.PODU_ROOMS_DIR ?? '.rooms';

if (process.env.PODU_ROOMS_RESET === '1') {
  fs.rmSync(ROOMS_DIR, { recursive: true, force: true });
}

function lanIPv4() {
  const out = [];
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows ?? []) {
      const family = String(row.family);
      if ((family === 'IPv4' || family === '4') && !row.internal) out.push(row.address);
    }
  }
  return out;
}

function allowLan(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,HEAD,OPTIONS');
  res.setHeader('access-control-allow-headers', '*');
}

function newToken() {
  return crypto.randomUUID();
}

/** @typedef {{ token: string, connected: boolean, ready: boolean, ai: boolean, deck: object | null, lastSeen: number }} Seat */
/** @typedef {{ seed: number, phase: string, mode: string, difficulty: string, seats: [Seat | null, Seat | null], config: object | null, commands: object[], seq: number }} Room */

/** @type {Map<number, Room>} */
const rooms = new Map();
/** @type {Map<import('node:net').Socket, { seed: number, token: string | null }>} */
const peers = new Map();

function emptyRoom(seed) {
  return {
    seed,
    phase: 'lobby',
    mode: 'hotseat',
    difficulty: 'easy',
    seats: [null, null],
    config: null,
    commands: [],
    seq: 0,
  };
}

function roomFile(seed) {
  return path.join(ROOMS_DIR, `${seed}.json`);
}

function loadRoom(seed) {
  try {
    const raw = JSON.parse(fs.readFileSync(roomFile(seed), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return emptyRoom(seed);
    const seats = Array.isArray(raw.seats) ? raw.seats : [null, null];
    return {
      seed,
      phase: raw.phase === 'live' || raw.phase === 'over' ? raw.phase : 'lobby',
      mode: raw.mode === 'vsAi' ? 'vsAi' : 'hotseat',
      difficulty: raw.difficulty === 'normal' || raw.difficulty === 'hard' ? raw.difficulty : 'easy',
      seats: [
        hydrateSeat(seats[0]),
        hydrateSeat(seats[1]),
      ],
      config: raw.config ?? null,
      commands: Array.isArray(raw.commands) ? raw.commands : [],
      seq: Number(raw.seq) >>> 0,
    };
  } catch {
    return emptyRoom(seed);
  }
}

function hydrateSeat(raw) {
  if (typeof raw !== 'object' || raw === null || typeof raw.token !== 'string') return null;
  return {
    token: raw.token,
    connected: raw.ai === true,
    ready: raw.ready === true,
    ai: raw.ai === true,
    deck: raw.deck ?? null,
    lastSeen: Number(raw.lastSeen) || 0,
  };
}

function persist(room) {
  fs.mkdirSync(ROOMS_DIR, { recursive: true });
  const body = JSON.stringify({
    seed: room.seed,
    phase: room.phase,
    mode: room.mode,
    difficulty: room.difficulty,
    seats: room.seats.map((seat) =>
      seat === null
        ? null
        : {
            token: seat.token,
            connected: false,
            ready: seat.ready,
            ai: seat.ai,
            deck: seat.deck,
            lastSeen: seat.lastSeen,
          },
    ),
    config: room.config,
    commands: room.commands,
    seq: room.seq,
  });
  fs.writeFileSync(roomFile(room.seed), body);
}

function getRoom(seed) {
  let room = rooms.get(seed);
  if (room === undefined) {
    room = loadRoom(seed);
    rooms.set(seed, room);
  }
  return room;
}

function publicSeat(seat) {
  if (seat === null) return null;
  return { connected: seat.connected, ready: seat.ready, ai: seat.ai, deck: seat.deck };
}

function publicRoom(room) {
  return {
    phase: room.phase,
    mode: room.mode,
    difficulty: room.difficulty,
    seats: [publicSeat(room.seats[0]), publicSeat(room.seats[1])],
    config: room.config,
    commands: room.commands.slice(),
    seq: room.seq,
  };
}

function seatIndex(room, token) {
  if (room.seats[0]?.token === token) return 0;
  if (room.seats[1]?.token === token) return 1;
  return null;
}

function isStale(seat, now) {
  if (seat.ai) return false;
  if (!seat.connected) return true;
  return now - seat.lastSeen > STALE_MS;
}

function occupy(room, index, token, now) {
  const seat = room.seats[index];
  if (seat === null) return { seat: null, token: null, kickedToken: null };
  const kickedToken = seat.token !== token ? seat.token : null;
  seat.token = token;
  seat.connected = true;
  seat.lastSeen = now;
  return { seat: index, token, kickedToken };
}

function claimSeat(room, now, token, reclaim) {
  if (token) {
    const mine = seatIndex(room, token);
    if (mine !== null && room.seats[mine] && !room.seats[mine].ai) {
      return occupy(room, mine, token, now);
    }
  }
  const vacant = room.seats[0] === null ? 0 : room.seats[1] === null ? 1 : null;
  if (vacant !== null) {
    const nextToken = token || newToken();
    room.seats[vacant] = {
      token: nextToken,
      connected: true,
      ready: false,
      ai: false,
      deck: null,
      lastSeen: now,
    };
    return { seat: vacant, token: nextToken, kickedToken: null };
  }
  if (reclaim) {
    const held = seatIndex(room, reclaim);
    if (held !== null) {
      const seat = room.seats[held];
      if (seat && !seat.ai && isStale(seat, now)) return occupy(room, held, reclaim, now);
    }
  }
  for (const index of [0, 1]) {
    const seat = room.seats[index];
    if (!seat || seat.ai || !isStale(seat, now)) continue;
    return occupy(room, index, newToken(), now);
  }
  return { seat: null, token: null, kickedToken: null };
}

function tryStartHotseat(room) {
  if (room.phase !== 'lobby' || room.mode === 'vsAi') return false;
  const a = room.seats[0];
  const b = room.seats[1];
  if (!a?.ready || !b?.ready || !a.deck || !b.deck) return false;
  room.config = {
    seed: room.seed,
    startingPlayer: room.seed % 2 === 0 ? 0 : 1,
    decks: { 0: a.deck, 1: b.deck },
    allowUnimplemented: false,
    mode: 'hotseat',
    humanSeat: 0,
    difficulty: room.difficulty,
  };
  room.phase = 'live';
  room.commands = [];
  room.seq = 0;
  return true;
}

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeText(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

function encodePong(data) {
  const header = Buffer.alloc(2);
  header[0] = 0x8a;
  header[1] = data.length;
  return Buffer.concat([header, data]);
}

function readFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const b1 = buffer[offset + 1];
    const opcode = buffer[offset] & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let hdr = 2;
    if (len === 126) {
      if (buffer.length - offset < 4) break;
      len = buffer.readUInt16BE(offset + 2);
      hdr = 4;
    } else if (len === 127) {
      if (buffer.length - offset < 10) break;
      len = buffer.readUInt32BE(offset + 6);
      hdr = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buffer.length - offset < hdr + maskLen + len) break;
    let payload = buffer.subarray(offset + hdr + maskLen, offset + hdr + maskLen + len);
    if (masked) {
      const mask = buffer.subarray(offset + hdr, offset + hdr + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3] ?? 0;
    }
    offset += hdr + maskLen + len;
    if (opcode === 0x8) frames.push({ type: 'close' });
    else if (opcode === 0x1) frames.push({ type: 'text', data: payload.toString('utf8') });
    else if (opcode === 0x9) frames.push({ type: 'ping', data: payload });
  }
  return { frames, rest: buffer.subarray(offset) };
}

function send(socket, obj) {
  if (socket.destroyed) return;
  socket.write(encodeText(JSON.stringify(obj)));
}

function socketsIn(seed) {
  const out = [];
  for (const [socket, peer] of peers) {
    if (peer.seed === seed && !socket.destroyed) out.push(socket);
  }
  return out;
}

function broadcast(seed, obj, except) {
  const raw = encodeText(JSON.stringify(obj));
  for (const socket of socketsIn(seed)) {
    if (socket !== except) socket.write(raw);
  }
}

function kickToken(seed, token, except) {
  for (const [socket, peer] of peers) {
    if (peer.seed !== seed || peer.token !== token || socket === except) continue;
    peer.token = null;
    send(socket, { type: 'kicked', seed, reason: 'replaced' });
  }
}

function serveStatic(req, res) {
  if (STATIC_DIR === null) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('podu sync — connect over WebSocket at /sync?seed=');
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  const rel = (urlPath === '/' ? 'index.html' : urlPath).replace(/^\/+/, '');
  const root = path.resolve(STATIC_DIR);
  let file = path.resolve(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(root, 'index.html');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  allowLan(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const urlPath = (req.url ?? '/').split('?')[0];
  if (urlPath === '/health') {
    const ipv4 = lanIPv4();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT, ipv4, path: '/sync' }));
    return;
  }
  serveStatic(req, res);
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/sync' && url.pathname !== '/') {
    socket.destroy();
    return;
  }
  const seed = Number(url.searchParams.get('seed') ?? '0') >>> 0;
  const room = getRoom(seed);
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  const peer = { seed, token: null };
  peers.set(socket, peer);
  let buf = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = readFrames(buf);
    buf = rest;
    for (const frame of frames) {
      if (frame.type === 'close') {
        socket.end();
        return;
      }
      if (frame.type === 'ping') {
        socket.write(encodePong(frame.data ?? Buffer.alloc(0)));
        continue;
      }
      if (frame.type !== 'text') continue;
      let msg;
      try {
        msg = JSON.parse(frame.data);
      } catch {
        continue;
      }
      if (typeof msg !== 'object' || msg === null) continue;
      onMessage(room, socket, peer, msg);
    }
  });

  const drop = () => {
    const token = peer.token;
    peers.delete(socket);
    if (typeof token !== 'string') return;
    const index = seatIndex(room, token);
    if (index === null) return;
    const seat = room.seats[index];
    if (seat === null || seat.ai) return;
    if (room.phase === 'lobby') room.seats[index] = null;
    else seat.connected = false;
    persist(room);
    broadcast(seed, { type: 'presence', seed, room: publicRoom(room) }, socket);
  };
  socket.on('close', drop);
  socket.on('error', drop);
});

function onMessage(room, socket, peer, msg) {
  const seed = room.seed;
  const now = Date.now();
  if (msg.type === 'hello') {
    const claimed = claimSeat(room, now, typeof msg.token === 'string' ? msg.token : null, typeof msg.reclaim === 'string' ? msg.reclaim : null);
    if (claimed.kickedToken) kickToken(seed, claimed.kickedToken, socket);
    peer.token = claimed.token;
    persist(room);
    send(socket, {
      type: 'welcome',
      seed,
      to: claimed.token ?? 'spectator',
      seat: claimed.seat,
      room: publicRoom(room),
    });
    broadcast(seed, { type: 'presence', seed, room: publicRoom(room) }, socket);
    return;
  }
  if (msg.type === 'heartbeat' && typeof msg.token === 'string') {
    const index = seatIndex(room, msg.token);
    if (index === null) return;
    const seat = room.seats[index];
    if (seat === null || seat.ai) return;
    seat.connected = true;
    seat.lastSeen = now;
    peer.token = msg.token;
    return;
  }
  if (msg.type === 'configure' && typeof msg.token === 'string') {
    const index = seatIndex(room, msg.token);
    if (index === null || room.phase !== 'lobby') return;
    const seat = room.seats[index];
    if (seat === null || seat.ai) return;
    if (typeof msg.deck !== 'object' || msg.deck === null) return;
    seat.deck = msg.deck;
    seat.ready = msg.ready === true;
    if (msg.mode === 'hotseat' || msg.mode === 'vsAi') room.mode = msg.mode;
    if (msg.difficulty === 'easy' || msg.difficulty === 'normal' || msg.difficulty === 'hard') {
      room.difficulty = msg.difficulty;
    }
    tryStartHotseat(room);
    persist(room);
    broadcast(seed, { type: 'presence', seed, room: publicRoom(room) }, null);
    return;
  }
  if (msg.type === 'start' && typeof msg.token === 'string' && msg.config && typeof msg.config === 'object') {
    const index = seatIndex(room, msg.token);
    if (index === null) return;
    if (msg.config.mode === 'vsAi' && index !== 0) return;
    const config = msg.config;
    room.mode = config.mode === 'vsAi' ? 'vsAi' : 'hotseat';
    room.difficulty = config.difficulty === 'normal' || config.difficulty === 'hard' ? config.difficulty : 'easy';
    room.config = config;
    room.phase = 'live';
    room.commands = [];
    room.seq = 0;
    if (room.seats[0]) {
      room.seats[0].deck = config.decks?.[0] ?? room.seats[0].deck;
      room.seats[0].ready = true;
    }
    if (room.mode === 'vsAi') {
      room.seats[1] = {
        token: 'ai',
        connected: true,
        ready: true,
        ai: true,
        deck: config.decks?.[1] ?? null,
        lastSeen: 0,
      };
    } else if (room.seats[1]?.ai) {
      room.seats[1] = null;
    } else if (room.seats[1]) {
      room.seats[1].deck = config.decks?.[1] ?? room.seats[1].deck;
      room.seats[1].ready = true;
    }
    persist(room);
    broadcast(seed, { type: 'presence', seed, room: publicRoom(room) }, null);
    return;
  }
  if (msg.type === 'propose' && typeof msg.token === 'string') {
    if (room.phase !== 'live' && room.phase !== 'over') return;
    const index = seatIndex(room, msg.token);
    if (index === null) return;
    const seat = room.seats[index];
    if (seat === null || seat.ai) return;
    if (typeof msg.command !== 'object' || msg.command === null) return;
    const who = msg.who === 'ai' || msg.who === 'clock' ? msg.who : 'human';
    room.commands.push({ command: msg.command, who });
    room.seq += 1;
    persist(room);
    broadcast(seed, { type: 'commit', seed, seq: room.seq, command: msg.command, who }, null);
    broadcast(seed, { type: 'presence', seed, room: publicRoom(room) }, null);
    return;
  }
  if (msg.type === 'leave' && typeof msg.token === 'string') {
    const index = seatIndex(room, msg.token);
    if (index === null) return;
    const seat = room.seats[index];
    if (seat === null || seat.ai) return;
    if (room.phase === 'lobby') room.seats[index] = null;
    else seat.connected = false;
    peer.token = null;
    persist(room);
    broadcast(seed, { type: 'presence', seed, room: publicRoom(room) }, null);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let changed = false;
    for (const seat of room.seats) {
      if (!seat || seat.ai || !seat.connected) continue;
      if (now - seat.lastSeen <= STALE_MS) continue;
      seat.connected = false;
      changed = true;
    }
    if (!changed) continue;
    persist(room);
    broadcast(room.seed, { type: 'presence', seed: room.seed, room: publicRoom(room) }, null);
  }
}, 2000);

server.listen(PORT, HOST, () => {
  const ipv4 = lanIPv4();
  console.log(`podu sync bound ${HOST}:${PORT}  /sync  (GET /health)`);
  if (STATIC_DIR) console.log(`  static: ${STATIC_DIR}`);
  console.log(`  rooms:  ${path.resolve(ROOMS_DIR)}`);
  console.log(`  Local:  ws://127.0.0.1:${PORT}/sync`);
  if (ipv4.length === 0) {
    console.log('  Network: (no LAN IPv4 — check Wi-Fi / Ethernet)');
    return;
  }
  for (const ip of ipv4) {
    console.log(`  Page:    http://${ip}:5173/2d?seed=  (Vite --host + this sidecar)`);
  }
});
