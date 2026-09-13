import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Command } from '../engine/index.js';
import { syncUrlCandidates } from '../net/sync-url.js';
import { IDLE_TABLE, TableHub, type TablePublic, type TableSnapshot } from '../net/table.js';
import type { ConfigureInput, RoomPhase, TableRole } from '../net/room.js';
import { createRelayWire } from '../net/wire.js';
import type { LoggedCommand } from './replay.js';
import type { DuelConfig } from './use-duel.js';

export interface TableApi {
  readonly role: TableRole | null;
  readonly seat: 0 | 1 | null;
  readonly phase: RoomPhase | null;
  readonly snapshot: TableSnapshot | null;
  readonly youReady: boolean;
  readonly rivalReady: boolean;
  readonly rivalConnected: boolean;
  readonly link: boolean;
  configure: (input: ConfigureInput) => void;
  publishStart: (config: DuelConfig) => void;
  publishLeave: () => void;
  propose: (command: Command, who: LoggedCommand['who']) => void;
  onCommit: (fn: (row: LoggedCommand) => void) => () => void;
}

const hubs = new Map<string, TableHub>();

function hubKey(origin: string, seed: number): string {
  return `${origin}:${seed >>> 0}`;
}

function hubFor(origin: string, seed: number): TableHub {
  const key = hubKey(origin, seed);
  const held = hubs.get(key);
  if (held !== undefined) return held;
  const urls = syncUrlCandidates(`${origin}/`, {
    dev: import.meta.env.DEV,
    sidecarPort: Number(import.meta.env.VITE_SYNC_PORT ?? 8787),
  });
  const hub = new TableHub(createRelayWire(urls, seed));
  hubs.set(key, hub);
  return hub;
}

export function useTable(seed: number | null): TableApi {
  const origin = typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin;
  const hub = useMemo(() => {
    if (seed === null) return null;
    return hubFor(origin, seed);
  }, [origin, seed]);

  useEffect(() => {
    if (hub === null || seed === null) return;
    const keep = hubKey(origin, seed);
    for (const [key, extra] of [...hubs]) {
      if (key === keep) continue;
      hubs.delete(key);
      extra.dispose();
    }
    hub.attach(seed);
    return () => {
      hub.detach();
    };
  }, [hub, origin, seed]);

  const publicState = useSyncExternalStore(
    (onChange) => {
      if (hub === null) return () => { /* idle */ };
      return hub.subscribe(onChange);
    },
    () => hub?.publicState ?? IDLE_TABLE,
    () => IDLE_TABLE,
  );

  const commitRef = useRef(new Set<(row: LoggedCommand) => void>());

  useEffect(() => {
    if (hub === null) return;
    return hub.onCommit((row) => {
      commitRef.current.forEach((fn) => {
        fn(row);
      });
    });
  }, [hub]);

  const configure = useCallback((input: ConfigureInput) => {
    hub?.configure(input);
  }, [hub]);
  const publishStart = useCallback((config: DuelConfig) => {
    hub?.publishStart(config);
  }, [hub]);
  const publishLeave = useCallback(() => {
    hub?.publishLeave();
  }, [hub]);
  const propose = useCallback((command: Command, who: LoggedCommand['who']) => {
    hub?.propose(command, who);
  }, [hub]);
  const onCommit = useCallback((fn: (row: LoggedCommand) => void) => {
    commitRef.current.add(fn);
    return () => {
      commitRef.current.delete(fn);
    };
  }, []);

  return {
    role: publicState.role,
    seat: publicState.seat,
    phase: publicState.phase,
    snapshot: publicState.snapshot,
    youReady: publicState.youReady,
    rivalReady: publicState.rivalReady,
    rivalConnected: publicState.rivalConnected,
    link: publicState.link,
    configure,
    publishStart,
    publishLeave,
    propose,
    onCommit,
  };
}

export type { TablePublic };
