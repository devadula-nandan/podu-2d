/**
 * One host session above `/2d`, `/dev`, and `/3d`.
 *
 * `/2d` hydrates from the same-origin room. `/dev` stays on the Deck Builder
 * until Start (or a same-tab session restore). Start overwrites that seed.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
  useState,
} from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { Engine, PlayerId } from '../engine/index.js';
import type { ConfigureInput, RoomPhase } from '../net/room.js';
import { viewingForRole, type TableRole } from '../net/seats.js';
import { bootEngine } from './boot.js';
import { clockAdvanceCommand } from './clock-host.js';
import { parseSeedParam, pathWithSearch } from './seed-url.js';
import { clearLiveSession, snapshotForUrl, writeLiveSession } from './session-persist.js';
import {
  nextSeed,
  useDuel,
  type DuelApi,
  type DuelConfig,
  type DuelHostOptions,
  type DuelPersistSnapshot,
  type DuelRestore,
} from './use-duel.js';
import { useTable, type TableApi } from './use-table.js';
import type { LoggedCommand } from './replay.js';

export interface DuelSessionValue {
  readonly engine: Engine | null;
  readonly bootError: string | null;
  readonly urlSeed: number | null;
  readonly search: string;
  readonly config: DuelConfig | null;
  readonly duel: DuelApi | null;
  readonly tableRole: TableRole | null;
  readonly tableSeat: 0 | 1 | null;
  readonly tablePhase: RoomPhase | null;
  readonly youReady: boolean;
  readonly rivalReady: boolean;
  readonly rivalConnected: boolean;
  readonly tableLink: boolean;
  readonly configureSeat: (input: ConfigureInput) => void;
  readonly start: (config: DuelConfig) => void;
  readonly rematch: () => void;
  readonly newSeed: () => void;
  readonly leave: () => void;
  readonly writeSeed: (seed: number) => void;
}

const DuelSessionContext = createContext<DuelSessionValue | null>(null);

interface Live {
  readonly config: DuelConfig;
  readonly epoch: number;
  readonly restore?: DuelRestore;
}

interface Actions {
  readonly start: (config: DuelConfig) => void;
  readonly rematch: () => void;
  readonly newSeed: () => void;
  readonly leave: () => void;
  readonly writeSeed: (seed: number) => void;
  readonly configureSeat: (input: ConfigureInput) => void;
}

export function DuelSessionProvider({ children }: { readonly children: ReactNode }) {
  const boot = useMemo(() => {
    try {
      return { ok: true as const, engine: bootEngine() };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }, []);
  const [params, setParams] = useSearchParams();
  const { search, pathname } = useLocation();
  const playTable = pathname === '/2d' || pathname === '/';
  const urlSeed = parseSeedParam(params.get('seed'));
  const [live, setLive] = useState<Live | null>(() => {
    if (playTable) return null;
    const stored = snapshotForUrl(urlSeed);
    if (stored === null) return null;
    return {
      config: stored.config,
      epoch: 0,
      restore: { commands: stored.commands, viewing: stored.viewing },
    };
  });
  const table = useTable(live?.config.seed ?? urlSeed);

  const writeSeed = useCallback(
    (seed: number): void => {
      const next = new URLSearchParams(params);
      next.delete('relay');
      next.set('seed', String(seed >>> 0));
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    if (live === null) return;
    if (urlSeed === live.config.seed) return;
    writeSeed(live.config.seed);
  }, [live, urlSeed, writeSeed]);

  const joined = useMemo<Live | null>(() => {
    if (live !== null) return live;
    if (playTable) {
      if (table.snapshot === null) return null;
      const viewing = viewingForRole(table.role, table.snapshot.config);
      return {
        config: table.snapshot.config,
        epoch: 0,
        restore: { commands: table.snapshot.commands, viewing },
      };
    }
    const stored = snapshotForUrl(urlSeed);
    if (stored === null) return null;
    return {
      config: stored.config,
      epoch: 0,
      restore: { commands: stored.commands, viewing: stored.viewing },
    };
  }, [live, playTable, table.role, table.snapshot, urlSeed]);

  useEffect(() => {
    if (!playTable || live !== null || table.snapshot === null) return;
    writeLiveSession({
      config: table.snapshot.config,
      commands: table.snapshot.commands,
      viewing: viewingForRole(table.role, table.snapshot.config),
    });
  }, [live, playTable, table.role, table.snapshot]);

  const start = useCallback(
    (config: DuelConfig): void => {
      const viewing = viewingForRole(table.role, config);
      writeLiveSession({ config, commands: [], viewing });
      table.publishStart(config);
      setLive({ config, epoch: 0, restore: { commands: [], viewing } });
      writeSeed(config.seed);
    },
    [table, writeSeed],
  );

  const rematch = useCallback((): void => {
    setLive((prev) => {
      if (prev === null) return prev;
      writeLiveSession({
        config: prev.config,
        commands: [],
        viewing: viewingForRole(table.role, prev.config),
      });
      table.publishStart(prev.config);
      return { config: prev.config, epoch: prev.epoch + 1 };
    });
  }, [table]);

  const changeSeed = useCallback((): void => {
    setLive((prev) => {
      if (prev === null) return prev;
      const seed = nextSeed(prev.config.seed);
      const config: DuelConfig = {
        ...prev.config,
        seed,
        startingPlayer: seed % 2 === 0 ? 0 : 1,
      };
      writeLiveSession({
        config,
        commands: [],
        viewing: viewingForRole(table.role, config),
      });
      writeSeed(seed);
      return { config, epoch: prev.epoch + 1 };
    });
  }, [table.role, writeSeed]);

  const leave = useCallback((): void => {
    table.publishLeave();
    clearLiveSession();
    setLive(null);
  }, [table]);

  const configureSeat = useCallback(
    (input: ConfigureInput): void => {
      table.configure(input);
    },
    [table],
  );

  const actions: Actions = useMemo(
    () => ({ start, rematch, newSeed: changeSeed, leave, writeSeed, configureSeat }),
    [changeSeed, configureSeat, leave, rematch, start, writeSeed],
  );

  const bootError = boot.ok ? null : boot.message;
  const engine = boot.ok ? boot.engine : null;

  if (joined !== null && engine !== null) {
    return (
      <LiveSession
        key={`${joined.config.seed}-${joined.epoch}-${joined.config.allowUnimplemented ? 1 : 0}`}
        engine={engine}
        bootError={bootError}
        config={joined.config}
        restore={joined.restore}
        urlSeed={urlSeed}
        search={search}
        playTable={playTable}
        hydrateFromServer={live === null}
        table={table}
        actions={actions}
      >
        {children}
      </LiveSession>
    );
  }

  return (
    <IdleSession
      engine={engine}
      bootError={bootError}
      urlSeed={urlSeed}
      search={search}
      table={table}
      actions={actions}
    >
      {children}
    </IdleSession>
  );
}

function LiveSession({
  engine,
  bootError,
  config,
  restore,
  urlSeed,
  search,
  playTable,
  hydrateFromServer,
  table,
  actions,
  children,
}: {
  readonly engine: Engine;
  readonly bootError: string | null;
  readonly config: DuelConfig;
  readonly restore: DuelRestore | undefined;
  readonly urlSeed: number | null;
  readonly search: string;
  readonly playTable: boolean;
  readonly hydrateFromServer: boolean;
  readonly table: TableApi;
  readonly actions: Actions;
  readonly children: ReactNode;
}) {
  const persist = useCallback(
    (snapshot: DuelPersistSnapshot): void => {
      writeLiveSession({
        config,
        commands: snapshot.commands,
        viewing: snapshot.viewing,
      });
    },
    [config],
  );
  const netHotseat = playTable && config.mode === 'hotseat';
  const onDispatched = useCallback(
    (row: LoggedCommand): void => {
      if (playTable && config.mode === 'vsAi') table.propose(row.command, row.who);
    },
    [config.mode, playTable, table],
  );
  const options: DuelHostOptions =
    restore === undefined
      ? {
          onPersist: persist,
          onDispatched,
          clockAuthority: !netHotseat,
          aiAuthority: !netHotseat,
          hotseatHandover: !playTable,
        }
      : {
          restore,
          onPersist: persist,
          onDispatched,
          clockAuthority: !netHotseat,
          aiAuthority: !netHotseat,
          hotseatHandover: !playTable,
        };
  const duel = useDuel(engine, config, options);

  useEffect(() => {
    if (!playTable || !hydrateFromServer || table.snapshot === null) return;
    duel.syncLog(table.snapshot.commands);
  }, [duel, hydrateFromServer, playTable, table.snapshot]);

  const hostRef = useRef(duel.host);
  useEffect(() => {
    hostRef.current = duel.host;
  }, [duel.host]);
  useEffect(() => {
    if (!netHotseat || table.role !== 'home') return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const host = hostRef.current;
      if (host === null || host.result !== null) return;
      const now = performance.now();
      const elapsed = now - last;
      if (elapsed < 50) return;
      last = now;
      table.propose(clockAdvanceCommand(host.turn.player, elapsed), 'clock');
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [netHotseat, table]);

  const viewing: PlayerId = playTable ? viewingForRole(table.role, config) : duel.viewing;
  const wrapped = useMemo<DuelApi>(
    () => ({
      ...duel,
      viewing,
      handover: playTable ? false : duel.handover,
      canUndo: playTable ? false : duel.canUndo,
      issue: (command) => {
        if (table.role === 'spectator') {
          duel.explain('Table is full. You are watching.');
          return false;
        }
        if (netHotseat) {
          table.propose(command, command.kind === 'advanceClock' ? 'clock' : 'human');
          return true;
        }
        return duel.issue(command);
      },
      concede: (player) => {
        if (netHotseat) {
          table.propose({ kind: 'concede', player }, 'human');
          return;
        }
        duel.concede(player);
      },
      undo: () => {
        if (playTable) {
          duel.explain('Undo lives on /dev.');
          return false;
        }
        return duel.undo();
      },
    }),
    [duel, netHotseat, playTable, table, viewing],
  );
  const value = useMemo<DuelSessionValue>(
    () => ({
      engine,
      bootError,
      urlSeed,
      search,
      config,
      duel: wrapped,
      tableRole: table.role,
      tableSeat: table.seat,
      tablePhase: table.phase,
      youReady: table.youReady,
      rivalReady: table.rivalReady,
      rivalConnected: table.rivalConnected,
      tableLink: table.link,
      ...actions,
    }),
    [actions, bootError, config, engine, search, table, urlSeed, wrapped],
  );
  return <DuelSessionContext.Provider value={value}>{children}</DuelSessionContext.Provider>;
}

function IdleSession({
  engine,
  bootError,
  urlSeed,
  search,
  table,
  actions,
  children,
}: {
  readonly engine: Engine | null;
  readonly bootError: string | null;
  readonly urlSeed: number | null;
  readonly search: string;
  readonly table: TableApi;
  readonly actions: Actions;
  readonly children: ReactNode;
}) {
  const value = useMemo<DuelSessionValue>(
    () => ({
      engine,
      bootError,
      urlSeed,
      search,
      config: null,
      duel: null,
      tableRole: table.role,
      tableSeat: table.seat,
      tablePhase: table.phase,
      youReady: table.youReady,
      rivalReady: table.rivalReady,
      rivalConnected: table.rivalConnected,
      tableLink: table.link,
      ...actions,
    }),
    [actions, bootError, engine, search, table, urlSeed],
  );
  return <DuelSessionContext.Provider value={value}>{children}</DuelSessionContext.Provider>;
}

export function useDuelSession(): DuelSessionValue {
  const value = useContext(DuelSessionContext);
  if (value === null) throw new Error('useDuelSession must be used under DuelSessionProvider');
  return value;
}

export function useLiveDuel(): { engine: Engine; config: DuelConfig; duel: DuelApi } {
  const session = useDuelSession();
  if (session.engine === null || session.config === null || session.duel === null) {
    throw new Error('no live duel');
  }
  return { engine: session.engine, config: session.config, duel: session.duel };
}

export function SeedLink({
  to,
  children,
  ...rest
}: Omit<ComponentProps<typeof Link>, 'to'> & { readonly to: string }) {
  const { search } = useLocation();
  return (
    <Link {...rest} to={pathWithSearch(to, search)}>
      {children}
    </Link>
  );
}
