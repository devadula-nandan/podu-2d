import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../ai/index.js';
import type {
  Command,
  Engine,
  FigureUid,
  GameEvent,
  GameSetup,
  GameState,
  PlayerId,
} from '../engine/index.js';
import {
  IllegalCommandError,
  contentFigureId,
  contentPlateId,
  findSurrounded,
  replayTo,
} from '../engine/index.js';
import { createChooser, delayAfterAiCommand, sleep } from './ai-client.js';
import { aiShouldAct, drainAi } from './ai-loop.js';
import { clockAdvanceCommand, shouldRunChessClock } from './clock-host.js';
import type { DeckDraft } from './model.js';
import {
  actorOf,
  commandLabel,
  decisionCommands,
  describeSurroundEvents,
  figureName,
  foldBattleSnap,
  foldSurround,
  formatSeed,
  randomSeed,
  type BattleSnap,
} from './model.js';
import {
  actorForCommand,
  applyLoggedCommand,
  canUndoLog,
  foldLoggedCommands,
  undoCommandPrefix,
  type CommandStep,
  type LoggedCommand,
} from './replay.js';
import { copySeedUrl } from './seed-url.js';

export type PlayMode = 'hotseat' | 'vsAi';

/**
 * `allowUnimplemented` is a `createGame` flag, not a `createEngine` flag.
 * The app boots one engine. Flipping the /dev debug toggle and starting is a
 * new session (new `createGame`) on that same engine. /3d always starts with
 * the flag on so any printed figure or plate can sit; gaps stay on state.
 */
export interface DuelConfig {
  readonly seed: number;
  readonly startingPlayer: PlayerId;
  readonly decks: Readonly<Record<PlayerId, DeckDraft>>;
  readonly allowUnimplemented: boolean;
  readonly mode: PlayMode;
  readonly humanSeat: PlayerId;
  readonly difficulty: Difficulty;
}

export interface CommandLogEntry {
  readonly id: number;
  readonly who: 'human' | 'ai';
  readonly player: PlayerId;
  readonly label: string;
  readonly turn: number;
  readonly kind: Command['kind'];
}

export interface DuelPersistSnapshot {
  readonly commands: readonly LoggedCommand[];
  readonly viewing: PlayerId;
}

export interface DuelRestore {
  readonly commands: readonly LoggedCommand[];
  readonly viewing: PlayerId;
}

export interface DuelHostOptions {
  readonly restore?: DuelRestore;
  readonly onPersist?: (snapshot: DuelPersistSnapshot) => void;
  readonly onDispatched?: (row: LoggedCommand) => void;
  readonly clockAuthority?: boolean;
  readonly aiAuthority?: boolean;
  readonly hotseatHandover?: boolean;
}

export interface DuelApi {
  readonly fatal: string | null;
  readonly host: GameState | null;
  readonly displayHost: GameState | null;
  readonly viewing: PlayerId;
  readonly handover: boolean;
  readonly thinking: boolean;
  readonly scrubbing: boolean;
  readonly canUndo: boolean;
  readonly legal: readonly Command[];
  readonly events: readonly GameEvent[];
  readonly eventCursor: number;
  readonly log: readonly CommandLogEntry[];
  readonly lastAiLabel: string | null;
  readonly battleSnap: BattleSnap | null;
  readonly surroundUids: ReadonlySet<number>;
  readonly pendingSurround: ReadonlySet<number>;
  readonly lastSurround: string | null;
  readonly notice: string | null;
  readonly seed: number;
  readonly seedLabel: string;
  readonly config: DuelConfig;
  readonly confirmHandover: () => void;
  readonly dismissBattle: () => void;
  readonly clearNotice: () => void;
  readonly explain: (message: string) => void;
  readonly issue: (command: Command) => boolean;
  readonly concede: (player: PlayerId) => void;
  readonly undo: () => boolean;
  readonly scrubTo: (index: number) => void;
  readonly jumpToLive: () => void;
  readonly copySeed: () => Promise<string>;
  readonly applyRemote: (command: Command, who: 'human' | 'ai') => boolean;
  readonly syncLog: (commands: readonly LoggedCommand[]) => boolean;
}

export function defaultViewing(config: DuelConfig): PlayerId {
  return config.mode === 'vsAi' ? config.humanSeat : 0;
}

function toSetup(config: DuelConfig): GameSetup {
  return {
    seed: config.seed,
    startingPlayer: config.startingPlayer,
    decks: {
      0: {
        figures: config.decks[0].figures.map(contentFigureId),
        plates: config.decks[0].plates.map(contentPlateId),
      },
      1: {
        figures: config.decks[1].figures.map(contentFigureId),
        plates: config.decks[1].plates.map(contentPlateId),
      },
    },
    ...(config.allowUnimplemented ? { allowUnimplemented: true } : {}),
  };
}

function openGame(engine: Engine, config: DuelConfig): { state: GameState; events: readonly GameEvent[] } {
  try {
    sessionStorage.removeItem(`podu:match-intro:${config.seed >>> 0}`);
  } catch {
    /* private mode */
  }
  const opened = engine.createGame(toSetup(config));
  return { state: opened.nextState, events: opened.events };
}

export function rebuildFromCommands(
  engine: Engine,
  base: GameState,
  commands: readonly LoggedCommand[],
): { folded: ReturnType<typeof foldLoggedCommands>; log: CommandLogEntry[] } {
  let state = base;
  let steps: readonly CommandStep[] = [];
  let liveEvents: readonly GameEvent[] = [];
  const log: CommandLogEntry[] = [];
  let id = 0;
  for (const row of commands) {
    const who = row.who === 'ai' ? 'ai' : 'human';
    const before = state;
    const applied = applyLoggedCommand(engine, base, state, steps, liveEvents, row.command, who);
    if (row.command.kind !== 'advanceClock') {
      id += 1;
      const nextEvents = applied.steps[applied.steps.length - 1]?.events ?? [];
      const surroundText = describeSurroundEvents((uid) => {
        const figure = applied.state.figures[uid] ?? before.figures[uid];
        return figure === undefined ? `#${uid}` : figureName(engine, figure);
      }, nextEvents);
      const baseLabel = commandLabel(engine, before.figures, row.command, before.pending);
      log.push({
        id,
        who,
        player: row.command.player,
        label: surroundText === null ? baseLabel : `${baseLabel} — ${surroundText}`,
        turn: before.turn.number,
        kind: row.command.kind,
      });
    }
    state = applied.state;
    steps = applied.steps;
    liveEvents = applied.liveEvents;
  }
  return { folded: { state, steps, liveEvents }, log };
}

type Opened =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly base: GameState;
      readonly steps: readonly CommandStep[];
      readonly liveEvents: readonly GameEvent[];
      readonly log: readonly CommandLogEntry[];
      readonly viewing: PlayerId;
    }
  | { readonly ok: false; readonly message: string };

export function useDuel(engine: Engine, config: DuelConfig, options: DuelHostOptions = {}): DuelApi {
  const persistRef = useRef(options.onPersist);
  persistRef.current = options.onPersist;
  const dispatchedRef = useRef(options.onDispatched);
  dispatchedRef.current = options.onDispatched;
  const clockAuthority = options.clockAuthority ?? true;
  const aiAuthority = options.aiAuthority ?? true;
  const hotseatHandover = options.hotseatHandover ?? true;

  const [opened] = useState<Opened>(() => {
    try {
      const game = openGame(engine, config);
      const restore = options.restore;
      if (restore !== undefined && restore.commands.length > 0) {
        try {
          const rebuilt = rebuildFromCommands(engine, game.state, restore.commands);
          return {
            ok: true as const,
            state: rebuilt.folded.state,
            base: game.state,
            steps: rebuilt.folded.steps,
            liveEvents: rebuilt.folded.liveEvents,
            log: rebuilt.log,
            viewing: restore.viewing,
          };
        } catch {
          /* stale snapshot — open a fresh game for this seed */
        }
      }
      return {
        ok: true as const,
        state: game.state,
        base: game.state,
        steps: [],
        liveEvents: [],
        log: [],
        viewing: restore?.viewing ?? defaultViewing(config),
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
  const [host, setHost] = useState<GameState | null>(opened.ok ? opened.state : null);
  const [viewing, setViewing] = useState<PlayerId>(opened.ok ? opened.viewing : defaultViewing(config));
  const [liveEvents, setLiveEvents] = useState<readonly GameEvent[]>(opened.ok ? opened.liveEvents : []);
  const [eventCursor, setEventCursor] = useState(opened.ok ? opened.liveEvents.length : 0);
  const [canUndo, setCanUndo] = useState(opened.ok ? canUndoLog(opened.steps, config.mode) : false);
  const [log, setLog] = useState<readonly CommandLogEntry[]>(opened.ok ? opened.log : []);
  const [battleSnap, setBattleSnap] = useState<BattleSnap | null>(
    opened.ok ? foldBattleSnap(opened.liveEvents, null) : null,
  );
  const [surround, setSurround] = useState<readonly FigureUid[]>(
    opened.ok ? foldSurround(opened.liveEvents, []) : [],
  );
  const [lastSurround, setLastSurround] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const hostRef = useRef(host);
  hostRef.current = host;
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;
  const busyRef = useRef(false);
  const thinkingRef = useRef(false);
  const genRef = useRef(0);
  const logIdRef = useRef(opened.ok ? opened.log.length : 0);
  const lastTickRef = useRef(0);
  const baseRef = useRef<GameState | null>(opened.ok ? opened.base : null);
  const stepsRef = useRef<readonly CommandStep[]>(opened.ok ? opened.steps : []);
  const liveEventsRef = useRef<readonly GameEvent[]>(opened.ok ? opened.liveEvents : []);
  const chooserRef = useRef(createChooser(engine));

  const persistNow = useCallback((): void => {
    persistRef.current?.({
      commands: stepsRef.current.map(({ command, who }) => ({ command, who })),
      viewing: viewingRef.current,
    });
  }, []);

  const legal = useMemo(() => (host === null ? [] : engine.legalCommands(host)), [engine, host]);
  const actor = host === null ? config.startingPlayer : actorOf(host, legal);
  const handover =
    hotseatHandover &&
    config.mode === 'hotseat' &&
    host !== null &&
    actor !== viewing &&
    decisionCommands(legal).length > 0 &&
    host.result === null;
  const scrubbing = eventCursor < liveEvents.length;

  const displayHost = useMemo(() => {
    const base = baseRef.current;
    if (host === null || base === null) return host;
    if (eventCursor >= liveEvents.length) return host;
    return replayTo(base, liveEvents, eventCursor);
  }, [eventCursor, host, liveEvents]);

  const displayBattleSnap = useMemo(() => {
    if (eventCursor >= liveEvents.length) return battleSnap;
    return foldBattleSnap(liveEvents.slice(0, eventCursor), null);
  }, [battleSnap, eventCursor, liveEvents]);

  const clockPaused = !shouldRunChessClock({
    hasHost: host !== null,
    gameOver: host?.result !== null,
    handover,
    scrubbing,
  });

  const rememberLog = useCallback((): void => {
    setCanUndo(canUndoLog(stepsRef.current, config.mode));
  }, [config.mode]);

  const applySync = useCallback(
    (command: Command, who: 'human' | 'ai', flags?: { emit?: boolean; quiet?: boolean }): boolean => {
      const emit = flags?.emit !== false;
      const quiet = flags?.quiet === true;
      const current = hostRef.current;
      const base = baseRef.current;
      if (current === null || base === null) return false;
      try {
        busyRef.current = true;
        const applied = applyLoggedCommand(
          engine,
          base,
          current,
          stepsRef.current,
          liveEventsRef.current,
          command,
          who,
        );
        stepsRef.current = applied.steps;
        liveEventsRef.current = applied.liveEvents;
        hostRef.current = applied.state;
        setHost(applied.state);
        setLiveEvents(applied.liveEvents);
        setEventCursor(applied.liveEvents.length);
        rememberLog();
        persistNow();
        if (emit) dispatchedRef.current?.({ command, who: actorForCommand(command, who) });

        if (command.kind === 'advanceClock') {
          if (applied.state.result !== null) {
            setBattleSnap(null);
            setNotice(null);
          }
          return true;
        }

        const nextEvents = applied.steps[applied.steps.length - 1]?.events ?? [];
        const traveled = nextEvents.some((event) => event.kind === 'timeTravelRequested');
        const snapEvents = traveled ? applied.liveEvents : nextEvents;
        setBattleSnap((prev) =>
          applied.state.result !== null ? null : foldBattleSnap(snapEvents, traveled ? null : prev),
        );
        setSurround((prev) => foldSurround(snapEvents, traveled ? [] : prev));
        const surroundText = describeSurroundEvents((uid) => {
          const figure = applied.state.figures[uid] ?? current.figures[uid];
          return figure === undefined ? `#${uid}` : figureName(engine, figure);
        }, snapEvents);
        if (surroundText !== null) setLastSurround(surroundText);

        logIdRef.current += 1;
        const baseLabel = commandLabel(engine, applied.state.figures, command, current.pending);
        const entry: CommandLogEntry = {
          id: logIdRef.current,
          who,
          player: command.player,
          label: surroundText === null ? baseLabel : `${baseLabel} — ${surroundText}`,
          turn: current.turn.number,
          kind: command.kind,
        };
        setLog((prev) => [...prev, entry]);
        setNotice(
          traveled ? 'Time Travel rewound the caller log. Clocks were left as they were.' : surroundText,
        );
        return true;
      } catch (err) {
        if (!quiet) {
          if (err instanceof IllegalCommandError) {
            setNotice(err.message);
            return false;
          }
          setNotice(err instanceof Error ? err.message : String(err));
        }
        return false;
      } finally {
        busyRef.current = false;
      }
    },
    [engine, persistNow, rememberLog],
  );

  const applyRemote = useCallback(
    (command: Command, who: 'human' | 'ai'): boolean => applySync(command, who, { emit: false, quiet: true }),
    [applySync],
  );

  const syncLog = useCallback(
    (commands: readonly LoggedCommand[]): boolean => {
      const base = baseRef.current;
      if (base === null) return false;
      const have = stepsRef.current.length;
      if (commands.length === have) return true;
      if (commands.length === have + 1) {
        const row = commands[have];
        if (row === undefined) return false;
        return applySync(row.command, row.who === 'ai' ? 'ai' : 'human', { emit: false, quiet: true });
      }
      try {
        const rebuilt = rebuildFromCommands(engine, base, commands);
        stepsRef.current = rebuilt.folded.steps;
        liveEventsRef.current = rebuilt.folded.liveEvents;
        hostRef.current = rebuilt.folded.state;
        setHost(rebuilt.folded.state);
        setLiveEvents(rebuilt.folded.liveEvents);
        setEventCursor(rebuilt.folded.liveEvents.length);
        setLog(rebuilt.log);
        logIdRef.current = rebuilt.log.length;
        rememberLog();
        persistNow();
        setBattleSnap(foldBattleSnap(rebuilt.folded.liveEvents, null));
        setSurround(foldSurround(rebuilt.folded.liveEvents, []));
        return true;
      } catch {
        return false;
      }
    },
    [applySync, engine, persistNow, rememberLog],
  );

  const pumpAi = useCallback(async (): Promise<void> => {
    if (!aiAuthority || config.mode !== 'vsAi') return;
    const state = hostRef.current;
    if (state === null || state.result !== null) return;
    if (!aiShouldAct(state, engine.legalCommands(state), config.humanSeat)) return;
    const gen = genRef.current;
    thinkingRef.current = true;
    setThinking(true);
    try {
      await drainAi({
        engine,
        getState: () => hostRef.current,
        apply: (command) => applySync(command, 'ai'),
        choose: chooserRef.current,
        humanSeat: config.humanSeat,
        difficulty: config.difficulty,
        duelSeed: config.seed,
        isCancelled: () => gen !== genRef.current,
        afterCommand: async (command) => {
          await sleep(delayAfterAiCommand(command.kind));
        },
      });
    } catch (err) {
      if (gen === genRef.current) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (gen === genRef.current) {
        thinkingRef.current = false;
        setThinking(false);
      }
    }
  }, [aiAuthority, applySync, config.difficulty, config.humanSeat, config.mode, config.seed, engine]);

  useEffect(() => {
    genRef.current += 1;
    void pumpAi();
    return () => {
      genRef.current += 1;
    };
  }, [pumpAi]);

  useEffect(() => {
    if (!clockAuthority || clockPaused) return;
    lastTickRef.current = performance.now();
    const id = window.setInterval(() => {
      const current = hostRef.current;
      if (busyRef.current || current === null || current.result !== null) return;
      const now = performance.now();
      const elapsed = now - lastTickRef.current;
      if (elapsed < 50) return;
      lastTickRef.current = now;
      applySync(clockAdvanceCommand(current.turn.player, elapsed), 'human');
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [applySync, clockAuthority, clockPaused]);

  const pendingSurround = useMemo(() => {
    const shown = displayHost;
    if (shown === null) return new Set<number>();
    const found = findSurrounded(shown, engine.deps);
    return new Set(found.map((row) => row.uid));
  }, [displayHost, engine]);

  const lastAiLabel = useMemo(() => {
    for (let i = log.length - 1; i >= 0; i -= 1) {
      const row = log[i];
      if (row?.who === 'ai') return row.label;
    }
    return null;
  }, [log]);

  const undo = useCallback((): boolean => {
    const base = baseRef.current;
    if (base === null) return false;
    const next = undoCommandPrefix(stepsRef.current, config.mode);
    if (next.length === stepsRef.current.length) {
      setNotice('Nothing to undo.');
      return false;
    }
    genRef.current += 1;
    thinkingRef.current = false;
    setThinking(false);
    const folded = foldLoggedCommands(engine, base, next);
    stepsRef.current = folded.steps;
    liveEventsRef.current = folded.liveEvents;
    hostRef.current = folded.state;
    setHost(folded.state);
    setLiveEvents(folded.liveEvents);
    setEventCursor(folded.liveEvents.length);
    rememberLog();
    persistNow();
    setBattleSnap(foldBattleSnap(folded.liveEvents, null));
    setSurround(foldSurround(folded.liveEvents, []));
    setLog((prev) => prev.slice(0, next.filter((row) => row.command.kind !== 'advanceClock').length));
    setNotice('Undid the last player decision (and the clocks that belonged to it).');
    void pumpAi();
    return true;
  }, [config.mode, engine, persistNow, pumpAi, rememberLog]);

  return {
    fatal: opened.ok ? null : opened.message,
    host,
    displayHost,
    viewing,
    handover,
    thinking,
    scrubbing,
    canUndo,
    legal,
    events: liveEvents,
    eventCursor,
    log,
    lastAiLabel,
    battleSnap: displayBattleSnap,
    surroundUids: new Set(surround),
    pendingSurround,
    lastSurround,
    notice,
    seed: config.seed,
    seedLabel: formatSeed(config.seed),
    config,
    confirmHandover: () => {
      viewingRef.current = actor;
      setViewing(actor);
      persistNow();
    },
    dismissBattle: () => {
      setBattleSnap(null);
    },
    clearNotice: () => {
      setNotice(null);
    },
    explain: (message) => {
      setNotice(message);
    },
    issue: (command) => {
      if (scrubbing) {
        setNotice('Jump to live before acting. The scrubber is a view of the caller log.');
        return false;
      }
      if (thinkingRef.current && command.kind !== 'concede') {
        setNotice('The AI is thinking.');
        return false;
      }
      if (command.kind === 'concede') {
        genRef.current += 1;
        thinkingRef.current = false;
        setThinking(false);
      }
      const ok = applySync(command, 'human');
      if (ok && command.kind !== 'concede') void pumpAi();
      return ok;
    },
    concede: (player) => {
      genRef.current += 1;
      thinkingRef.current = false;
      setThinking(false);
      applySync({ kind: 'concede', player }, 'human');
    },
    undo,
    scrubTo: (index) => {
      setEventCursor(Math.max(0, Math.min(index, liveEventsRef.current.length)));
    },
    jumpToLive: () => {
      setEventCursor(liveEventsRef.current.length);
    },
    copySeed: () => copySeedUrl(config.seed),
    applyRemote,
    syncLog,
  };
}

export function nextSeed(previous: number): number {
  const next = randomSeed();
  return next === previous ? next ^ 0x9e3779b9 : next;
}
