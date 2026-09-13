import { useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../ai/index.js';
import type { Engine } from '../engine/index.js';
import { isFormOnlyFigure } from '../engine/index.js';
import { roomShareUrl } from '../net/sync-url.js';
import { warmAiWorker } from '../ui/ai-client.js';
import { figureOfContent, plateOfContent } from '../ui/boot.js';
import { FigureSprite } from '../ui/FigureSprite.js';
import {
  FIGURES_PER_DECK,
  PLATE_COST_CAP,
  deckHasErrors,
  figureSpriteUrl,
  plateCost,
  randomSeed,
  validateDeck,
  type DeckDraft,
} from '../ui/model.js';
import { SpriteAttribution } from '../ui/SpriteAttribution.js';
import { useDuelSession } from '../ui/DuelSession.js';
import type { DuelConfig, PlayMode } from '../ui/use-duel.js';
import {
  leagueSix,
  plateCaption,
  presetCaption,
  resolvedPresets,
  rivalLeagueSix,
  type PresetId,
} from './presets.js';

interface Props {
  readonly engine: Engine;
  readonly onStart: (config: DuelConfig) => void;
}

export function PlaySetup({ engine, onStart }: Props) {
  const {
    urlSeed,
    writeSeed,
    tableRole,
    tableSeat,
    youReady,
    rivalReady,
    rivalConnected,
    tableLink,
    configureSeat,
  } = useDuelSession();
  const packs = useMemo(() => resolvedPresets(engine), [engine]);
  const [draft, setDraft] = useState<DeckDraft>(() => leagueSix(engine));
  const [picked, setPicked] = useState<PresetId | 'custom' | 'league' | null>('league');
  const [mode, setMode] = useState<PlayMode>('hotseat');
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [seed, setSeed] = useState(() => urlSeed ?? randomSeed());
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);
  const seated = useRef(false);

  useEffect(() => {
    writeSeed(seed);
  }, [seed, writeSeed]);

  useEffect(() => {
    if (tableSeat === null || seated.current) return;
    seated.current = true;
    setDraft(tableSeat === 1 ? rivalLeagueSix(engine) : leagueSix(engine));
    setPicked('league');
  }, [engine, tableSeat]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  const issues = validateDeck(engine, draft, true);
  const blocked = deckHasErrors(issues);
  const share = roomShareUrl(seed, window.location.href);

  const readyUp = (): void => {
    if (blocked || tableSeat === null) return;
    configureSeat({ deck: draft, ready: true, mode: 'hotseat', difficulty });
  };

  const startVsAi = (): void => {
    if (blocked) return;
    warmAiWorker();
    onStart({
      seed: seed >>> 0,
      startingPlayer: (seed >>> 0) % 2 === 0 ? 0 : 1,
      decks: { 0: draft, 1: rivalLeagueSix(engine) },
      allowUnimplemented: true,
      mode: 'vsAi',
      humanSeat: 0,
      difficulty,
    });
  };

  if (tableRole === 'spectator') {
    return (
      <div className="play-setup" data-testid="play-setup">
        <div className="play-setup-card">
          <p className="play-kicker">Table</p>
          <h1>Table is full</h1>
          <p className="play-lede" data-testid="table-full">
            Two players are already seated. You will watch once they start.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="play-setup" data-testid="play-setup">
      <div className="play-setup-card">
      {!tableLink ? (
        <p className="play-note" data-testid="room-offline">
          Can&apos;t reach room server
        </p>
      ) : null}

      <header className="play-setup-head">
        <p className="play-kicker">Ver. 7.0.14</p>
        <h1>Pick a team</h1>
        <p className="play-lede">Six figures. Plates optional. You sit at the bottom.</p>
      </header>

      {building ? (
        <BuildModal
          engine={engine}
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            setPicked('custom');
          }}
          onClose={() => {
            setBuilding(false);
          }}
        />
      ) : (
        <>
      <fieldset className="play-modes">
        <legend>How to play</legend>
        <label>
          <input
            type="radio"
            name="play-mode"
            data-testid="mode-hotseat"
            checked={mode === 'hotseat'}
            onChange={() => {
              setMode('hotseat');
            }}
          />
          Two players
        </label>
        <label>
          <input
            type="radio"
            name="play-mode"
            data-testid="mode-vs-ai"
            checked={mode === 'vsAi'}
            onChange={() => {
              setMode('vsAi');
              warmAiWorker();
            }}
          />
          vs AI
        </label>
        {mode === 'vsAi' ? (
          <label className="play-ai-row">
            Difficulty{' '}
            <select
              data-testid="difficulty"
              value={difficulty}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'easy' || value === 'normal' || value === 'hard') setDifficulty(value);
              }}
            >
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        ) : null}
      </fieldset>

      <div className="play-presets" data-testid="preset-chooser">
        {packs.map(({ preset, draft: next }) => (
          <button
            key={preset.id}
            type="button"
            className="play-preset"
            data-testid={`preset-${preset.id}`}
            data-on={picked === preset.id ? '1' : '0'}
            onClick={() => {
              setDraft(next);
              setPicked(preset.id);
            }}
          >
            <strong>{preset.name}</strong>
            <span>{preset.blurb}</span>
            <span className="play-preset-line">{presetCaption(engine, next)}</span>
          </button>
        ))}
      </div>

      {mode === 'hotseat' ? (
        <RoomLink
          url={share}
          copied={copied}
          rivalConnected={rivalConnected}
          rivalReady={rivalReady}
          youReady={youReady}
          tableLink={tableLink}
          onCopy={() => {
            void navigator.clipboard.writeText(share).catch(() => {
              /* URL is on screen */
            });
            setCopied(true);
          }}
        />
      ) : null}

      <div className="play-setup-actions">
        <button
          type="button"
          className="play-ghost"
          data-testid="use-starters"
          onClick={() => {
            setDraft(tableSeat === 1 ? rivalLeagueSix(engine) : leagueSix(engine));
            setPicked('league');
          }}
        >
          Starter deck
        </button>
        <button
          type="button"
          className="play-ghost"
          data-testid="open-builder"
          onClick={() => {
            setBuilding(true);
          }}
        >
          Build
        </button>
        {mode === 'vsAi' ? (
          <button
            type="button"
            className="play-primary"
            data-testid="start-vs-ai"
            disabled={blocked || tableSeat !== 0}
            onClick={startVsAi}
          >
            Start vs AI
          </button>
        ) : (
          <button
            type="button"
            className="play-primary"
            data-testid="start-duel"
            disabled={blocked || tableSeat === null || youReady}
            onClick={readyUp}
          >
            Ready
          </button>
        )}
      </div>

      <p className="play-note" data-testid="ready-status">
        {!tableLink
          ? "Can't reach room server"
          : tableSeat === null
            ? 'Connecting to the room…'
            : mode === 'vsAi'
              ? 'You at the bottom. The AI fills the other seat.'
              : youReady && rivalReady
                ? 'Both ready — starting.'
                : youReady
                  ? rivalConnected
                    ? 'You are ready. Waiting for Rival.'
                    : 'You are ready. Waiting for Rival to open this same URL.'
                  : rivalReady
                    ? 'Rival is ready. Ready up when you are.'
                    : rivalConnected
                      ? 'Rival is picking a team.'
                      : 'Share the URL. First join is You on that device.'}
      </p>

      <details className="play-advanced">
        <summary>Seed</summary>
        <label>
          Seed{' '}
          <input
            data-testid="seed-input"
            value={String(seed >>> 0)}
            onChange={(event) => {
              const n = Number(event.target.value);
              if (Number.isFinite(n)) setSeed(n >>> 0);
            }}
          />
        </label>
      </details>

      {blocked ? (
        <ul className="play-issues">
          {issues
            .filter((issue) => issue.level === 'error')
            .map((issue) => (
              <li key={issue.message}>{issue.message}</li>
            ))}
        </ul>
      ) : null}
        </>
      )}
      <SpriteAttribution className="sprite-attrib" />
      </div>
    </div>
  );
}

function RoomLink({
  url,
  copied,
  rivalConnected,
  rivalReady,
  youReady,
  tableLink,
  onCopy,
}: {
  readonly url: string;
  readonly copied: boolean;
  readonly rivalConnected: boolean;
  readonly rivalReady: boolean;
  readonly youReady: boolean;
  readonly tableLink: boolean;
  readonly onCopy: () => void;
}) {
  return (
    <div className="play-invite" data-testid="network-invite">
      <p className="play-kicker">Same URL</p>
      <code className="play-invite-url" data-testid="network-invite-url">
        {url}
      </code>
      <div className="play-invite-actions">
        <button type="button" className="play-ghost" data-testid="copy-network-invite" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy room link'}
        </button>
        <span data-testid="room-presence">
          {!tableLink ? (
            <span data-testid="room-offline">Can&apos;t reach room server</span>
          ) : (
            <>
              {youReady ? 'You ready' : 'You'}
              {' · '}
              {rivalReady ? 'Rival ready' : rivalConnected ? 'Rival here' : 'Rival not here'}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function BuildModal({
  engine,
  draft,
  onChange,
  onClose,
}: {
  readonly engine: Engine;
  readonly draft: DeckDraft;
  readonly onChange: (draft: DeckDraft) => void;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<'figures' | 'plates'>('figures');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(0);
  const q = query.trim().toLowerCase();

  const figures = useMemo(() => {
    const rows = [];
    for (const entry of engine.content.figures.values()) {
      const figure = entry.figure;
      if (q !== '' && !figure.name.toLowerCase().includes(q) && !String(figure.id).includes(q)) continue;
      rows.push(figure);
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [engine, q]);

  const plates = useMemo(() => {
    const rows = [];
    for (const entry of engine.content.plates.values()) {
      const plate = entry.plate;
      if (q !== '' && !plate.name.toLowerCase().includes(q) && !String(plate.id).includes(q)) continue;
      rows.push(plate);
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [engine, q]);

  const cost = draft.plates.reduce((sum, id) => {
    const plate = plateOfContent(engine, id);
    return sum + (plate === null ? 0 : plateCost(plate));
  }, 0);

  return (
    <div className="play-build" data-testid="figure-picker" role="dialog" aria-label="Build a team">
      <div className="play-picker">
        <div className="play-picker-head">
          <p>
            Build · {draft.figures.length}/{FIGURES_PER_DECK} · plates {cost}/{PLATE_COST_CAP}
          </p>
          <button type="button" className="play-ghost" onClick={onClose}>
            Done
          </button>
        </div>
        <ol className="play-build-slots">
          {Array.from({ length: FIGURES_PER_DECK }, (_, slot) => {
            const id = draft.figures[slot];
            const name = id === undefined ? 'Empty' : (figureOfContent(engine, id)?.name ?? `#${id}`);
            return (
              <li key={slot}>
                <button
                  type="button"
                  data-on={editing === slot ? '1' : '0'}
                  onClick={() => {
                    setTab('figures');
                    setEditing(slot);
                  }}
                >
                  {id !== undefined ? <FigureSprite url={figureSpriteUrl(engine, id)} name={name} /> : null}
                  {name}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="play-note">{plateCaption(engine, draft)}</p>
        <div className="play-build-tabs">
          <button
            type="button"
            className={tab === 'figures' ? 'play-primary' : 'play-ghost'}
            onClick={() => {
              setTab('figures');
            }}
          >
            Figures
          </button>
          <button
            type="button"
            className={tab === 'plates' ? 'play-primary' : 'play-ghost'}
            onClick={() => {
              setTab('plates');
            }}
          >
            Plates
          </button>
          <input
            placeholder={tab === 'figures' ? 'Search figures' : 'Search plates'}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <div className="play-picker-grid">
          {tab === 'figures'
            ? figures.map((figure) => {
                const formOnly = isFormOnlyFigure(figure);
                return (
                  <button
                    key={figure.id}
                    type="button"
                    className="play-pick"
                    disabled={formOnly}
                    onClick={() => {
                      if (formOnly) return;
                      onChange({
                        ...draft,
                        figures: replaceSlot(draft.figures, editing, figure.id),
                      });
                    }}
                  >
                    <FigureSprite url={figureSpriteUrl(engine, figure.id)} name={figure.name} />
                    <strong>{figure.name}</strong>
                    <span>
                      MP {figure.mp}
                      {formOnly ? ' · form' : ''}
                    </span>
                  </button>
                );
              })
            : plates.map((plate) => {
                const on = draft.plates.includes(plate.id);
                return (
                  <button
                    key={plate.id}
                    type="button"
                    className="play-pick"
                    data-on={on ? '1' : '0'}
                    onClick={() => {
                      onChange({
                        ...draft,
                        plates: on
                          ? draft.plates.filter((id) => id !== plate.id)
                          : [...draft.plates, plate.id].slice(0, 6),
                      });
                    }}
                  >
                    <strong>{plate.name}</strong>
                    <span>cost {plateCost(plate)}</span>
                  </button>
                );
              })}
        </div>
      </div>
    </div>
  );
}

function replaceSlot(figures: readonly number[], slot: number, id: number): number[] {
  const next = [...figures];
  if (next.length < FIGURES_PER_DECK) {
    while (next.length < slot) next.push(next[next.length - 1] ?? id);
    if (next.length === slot) next.push(id);
    else next[slot] = id;
    return next.slice(0, FIGURES_PER_DECK);
  }
  next[slot] = id;
  return next;
}
