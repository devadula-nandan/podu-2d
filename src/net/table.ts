import type { Command } from '../engine/index.js';
import type { LoggedCommand } from '../ui/replay.js';
import type { DuelConfig } from '../ui/use-duel.js';
import {
  browserLocalStorage,
  clearSeatClaim,
  readSeatHello,
  writeSeatClaim,
} from './ids.js';
import { browserSessionStorage, type SessionStorageLike } from '../ui/session-persist.js';
import type { NetMessage } from './protocol.js';
import {
  HEARTBEAT_MS,
  roleOfSeat,
  type ConfigureInput,
  type RoomPhase,
  type RoomPublic,
  type TableRole,
} from './room.js';
import type { Wire } from './wire.js';

export interface TableSnapshot {
  readonly config: DuelConfig;
  readonly commands: readonly LoggedCommand[];
}

export interface TablePublic {
  readonly role: TableRole | null;
  readonly seat: 0 | 1 | null;
  readonly phase: RoomPhase | null;
  readonly snapshot: TableSnapshot | null;
  readonly youReady: boolean;
  readonly rivalReady: boolean;
  readonly rivalConnected: boolean;
  readonly link: boolean;
}

export const IDLE_TABLE: TablePublic = {
  role: null,
  seat: null,
  phase: null,
  snapshot: null,
  youReady: false,
  rivalReady: false,
  rivalConnected: false,
  link: false,
};

export interface SeatStorage {
  readonly session: SessionStorageLike | null;
  readonly local: SessionStorageLike | null;
}

export class TableHub {
  private seed: number | null = null;
  private token: string | null = null;
  private seat: 0 | 1 | null = null;
  private role: TableRole | null = null;
  private room: RoomPublic | null = null;
  private expelled = false;
  private greeted = false;
  private link = false;
  private unsub: (() => void) | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private cached: TablePublic = IDLE_TABLE;
  private readonly listeners = new Set<(state: TablePublic) => void>();
  private readonly commitListeners = new Set<(row: LoggedCommand) => void>();

  constructor(
    private readonly wire: Wire,
    private readonly storage: SeatStorage = {
      session: browserSessionStorage(),
      local: browserLocalStorage(),
    },
  ) {
    this.wire.subscribeStatus((up) => {
      this.link = up;
      this.emit();
    });
  }

  get publicState(): TablePublic {
    return this.cached;
  }

  subscribe(fn: (state: TablePublic) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onCommit(fn: (row: LoggedCommand) => void): () => void {
    this.commitListeners.add(fn);
    return () => {
      this.commitListeners.delete(fn);
    };
  }

  attach(seed: number): void {
    if (this.seed === seed) {
      if (this.unsub === null) this.listen(seed);
      return;
    }
    this.dropSubscription();
    this.seed = seed;
    this.token = null;
    this.seat = null;
    this.role = null;
    this.room = null;
    this.expelled = false;
    this.greeted = false;
    this.emit();
    this.listen(seed);
  }

  detach(): void {
    this.dropSubscription();
  }

  dispose(): void {
    this.dropSubscription();
    this.wire.close();
    this.greeted = false;
    this.seed = null;
    this.token = null;
    this.seat = null;
    this.role = null;
    this.room = null;
    this.emit();
  }

  configure(input: ConfigureInput): void {
    if (this.seed === null || this.token === null || this.seat === null) return;
    this.wire.send({
      type: 'configure',
      seed: this.seed,
      token: this.token,
      deck: input.deck,
      ready: input.ready,
      mode: input.mode,
      difficulty: input.difficulty,
    });
  }

  publishStart(config: DuelConfig): void {
    if (this.seed === null || this.token === null) return;
    this.wire.send({ type: 'start', seed: this.seed, token: this.token, config });
  }

  publishLeave(): void {
    if (this.seed === null || this.token === null) return;
    this.wire.send({ type: 'leave', seed: this.seed, token: this.token });
  }

  propose(command: Command, who: LoggedCommand['who']): void {
    if (this.seed === null || this.token === null || this.seat === null) return;
    this.wire.send({ type: 'propose', seed: this.seed, token: this.token, command, who });
  }

  private listen(seed: number): void {
    this.dropSubscription();
    this.unsub = this.wire.subscribe((msg) => {
      this.onMessage(msg);
    });
    this.hello();
    this.beat = setInterval(() => {
      if (this.seed !== seed || this.token === null) return;
      this.wire.send({ type: 'heartbeat', seed, token: this.token });
    }, HEARTBEAT_MS);
  }

  private hello(): void {
    if (this.seed === null) return;
    if (this.greeted && !this.expelled) return;
    this.greeted = true;
    const claimed = this.expelled
      ? { token: null, reclaim: null }
      : readSeatHello(this.seed, this.storage.session, this.storage.local);
    this.wire.send({
      type: 'hello',
      seed: this.seed,
      ...(claimed.token !== null ? { token: claimed.token } : {}),
      ...(claimed.reclaim !== null ? { reclaim: claimed.reclaim } : {}),
    });
  }

  private dropSubscription(): void {
    if (this.beat !== null) {
      clearInterval(this.beat);
      this.beat = null;
    }
    this.unsub?.();
    this.unsub = null;
  }

  private onMessage(msg: NetMessage): void {
    if (this.seed === null || msg.seed !== this.seed) return;
    switch (msg.type) {
      case 'welcome':
        this.token = msg.seat === null ? null : msg.to;
        this.seat = msg.seat;
        this.role = roleOfSeat(msg.seat);
        if (this.token !== null) writeSeatClaim(this.seed, this.token, this.storage.session, this.storage.local);
        this.takeRoom(msg.room);
        return;
      case 'presence':
        this.takeRoom(msg.room);
        if (this.role === 'spectator') this.maybeReclaim();
        return;
      case 'commit':
        this.applyCommit(msg);
        return;
      case 'kicked':
        this.expelled = true;
        clearSeatClaim(this.seed, this.storage.session, this.storage.local);
        this.token = null;
        this.seat = null;
        this.role = 'spectator';
        this.emit();
        return;
      case 'hello':
      case 'rejected':
      case 'heartbeat':
      case 'configure':
      case 'start':
      case 'propose':
      case 'leave':
        return;
    }
  }

  private applyCommit(msg: Extract<NetMessage, { type: 'commit' }>): void {
    if (this.room === null) return;
    if (msg.seq <= this.room.seq) return;
    const row: LoggedCommand = { command: msg.command, who: msg.who };
    this.room = {
      ...this.room,
      commands: [...this.room.commands, row],
      seq: msg.seq,
    };
    this.emit();
    this.commitListeners.forEach((fn) => {
      fn(row);
    });
  }

  private takeRoom(room: RoomPublic): void {
    if (this.room !== null && room.seq < this.room.seq) return;
    this.room = room;
    if (this.seat !== null) this.role = roleOfSeat(this.seat);
    this.emit();
  }

  private maybeReclaim(): void {
    if (this.role !== 'spectator' || this.room === null || this.expelled) return;
    const a = this.room.seats[0];
    const b = this.room.seats[1];
    const vacant = a === null || b === null || !a.connected || !b.connected;
    if (!vacant) return;
    this.greeted = false;
    this.hello();
  }

  private emit(): void {
    this.cached = toPublic(this.role, this.seat, this.room, this.link);
    const state = this.cached;
    this.listeners.forEach((fn) => {
      fn(state);
    });
  }
}

function toPublic(
  role: TableRole | null,
  seat: 0 | 1 | null,
  room: RoomPublic | null,
  link: boolean,
): TablePublic {
  if (room === null) {
    return { ...IDLE_TABLE, role, seat, link };
  }
  const you = seat === null ? null : room.seats[seat];
  const rival = seat === null ? null : room.seats[seat === 0 ? 1 : 0];
  return {
    role,
    seat,
    phase: room.phase,
    snapshot: room.config === null ? null : { config: room.config, commands: room.commands },
    youReady: you?.ready === true,
    rivalReady: rival?.ready === true,
    rivalConnected: rival?.connected === true || rival?.ai === true,
    link,
  };
}
