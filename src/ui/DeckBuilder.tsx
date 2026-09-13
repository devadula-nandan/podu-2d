import { useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../ai/index.js';
import type { Engine, PlayerId } from '../engine/index.js';
import { contentFigureId, contentPlateId, isFormOnlyFigure } from '../engine/index.js';
import type { Figure, Plate } from '../content/schema.js';
import { warmAiWorker } from './ai-client.js';
import { figureOfContent, plateOfContent, starterFigureIds } from './boot.js';
import {
  asStoredDeck,
  readDeckSlots,
  readDevDrafts,
  slotIsEmpty,
  writeDeckSlots,
  writeDevDrafts,
  type DeckSlot,
} from './deck-slots.js';
import { FigureSprite } from './FigureSprite.js';
import type { DeckDraft } from './model.js';
import {
  FIGURES_PER_DECK,
  PLATES_PER_DECK,
  PLATE_COST_CAP,
  deckHasErrors,
  deckSeatName,
  figureSpriteUrl,
  plateCost,
  randomSeed,
  validateDeck,
} from './model.js';
import { RARITIES } from '../content/schema.js';
import { POKEMON_TYPES, type PokemonType } from '../content/dsl/primitives.js';
import { CoverageBadge } from './CoverageBadge.js';
import { useDuelSession } from './DuelSession.js';
import { copySeedUrl, readModeFromSearch } from './seed-url.js';
import type { DuelConfig, PlayMode } from './use-duel.js';

type FigureSort = 'name' | 'mp' | 'rarity' | 'id';
type PlateSort = 'name' | 'cost' | 'rarity' | 'id';
type ExFilter = 'all' | 'ex' | 'not';
type AbilityFilter = 'all' | 'has' | 'none';

const RARITY_RANK: Readonly<Record<(typeof RARITIES)[number], number>> = {
  C: 0,
  UC: 1,
  R: 2,
  EX: 3,
  UX: 4,
};

function initialPlayMode(): PlayMode {
  if (typeof window === 'undefined') return 'vsAi';
  return readModeFromSearch() ?? 'vsAi';
}

interface Props {
  readonly engine: Engine;
  readonly onStart: (config: DuelConfig) => void;
}

const MOBILE_BOX = 6;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = (): void => {
      setNarrow(mq.matches);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
    };
  }, []);
  return narrow;
}

function clampDraft(engine: Engine, draft: DeckDraft): DeckDraft {
  const figures = draft.figures.slice(0, FIGURES_PER_DECK);
  const plates: number[] = [];
  let spend = 0;
  for (const id of draft.plates) {
    if (plates.length >= PLATES_PER_DECK) break;
    const plate = plateOfContent(engine, id);
    const cost = plate === null ? 0 : plateCost(plate);
    if (spend + cost > PLATE_COST_CAP) continue;
    plates.push(id);
    spend += cost;
  }
  return { figures, plates };
}

function starterDrafts(engine: Engine): Record<PlayerId, DeckDraft> {
  const next = starterFigureIds(engine);
  return {
    0: { figures: [...next[0]], plates: [] },
    1: { figures: [...next[1]], plates: [] },
  };
}

export function DeckBuilder({ engine, onStart }: Props) {
  const { urlSeed, writeSeed } = useDuelSession();
  const starters = useMemo(() => starterDrafts(engine), [engine]);
  const [decks, setDecks] = useState<Record<PlayerId, DeckDraft>>(() => {
    const raw = readDevDrafts() ?? starters;
    return { 0: clampDraft(engine, raw[0]), 1: clampDraft(engine, raw[1]) };
  });
  const [slots, setSlots] = useState<DeckSlot[]>(() => readDeckSlots());
  const [pickedSlot, setPickedSlot] = useState(0);
  const [seat, setSeat] = useState<PlayerId>(0);
  const [query, setQuery] = useState('');
  const [onlyImplemented, setOnlyImplemented] = useState(true);
  const [allowUnimplemented, setAllowUnimplemented] = useState(false);
  const [tab, setTab] = useState<'figures' | 'plates'>('figures');
  const [seed, setSeed] = useState(() => urlSeed ?? randomSeed());
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PlayMode>(initialPlayMode);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [page, setPage] = useState(0);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [figureSort, setFigureSort] = useState<FigureSort>('name');
  const [plateSort, setPlateSort] = useState<PlateSort>('name');
  const [typeFilter, setTypeFilter] = useState<'' | PokemonType>('');
  const [rarityFilter, setRarityFilter] = useState('');
  const [exFilter, setExFilter] = useState<ExFilter>('all');
  const [abilityFilter, setAbilityFilter] = useState<AbilityFilter>('all');
  const narrow = useNarrow();

  useEffect(() => {
    writeSeed(seed);
  }, [seed, writeSeed]);

  useEffect(() => {
    writeDevDrafts(decks);
  }, [decks]);

  useEffect(() => {
    if (mode === 'vsAi') warmAiWorker();
  }, [mode]);

  const issues0 = validateDeck(engine, decks[0], allowUnimplemented);
  const issues1 = validateDeck(engine, decks[1], allowUnimplemented);
  const issues = seat === 0 ? issues0 : issues1;
  const blocked = deckHasErrors(issues0) || deckHasErrors(issues1);

  const figures = useMemo(() => [...engine.content.figures.values()].map((entry) => entry.figure), [engine]);
  const plates = useMemo(() => [...engine.content.plates.values()].map((entry) => entry.plate), [engine]);
  const q = query.trim().toLowerCase();

  const shownFigures = [...figures]
    .filter((figure) => {
      const support = engine.registry.figures.get(contentFigureId(figure.id));
      if (onlyImplemented && support?.implemented !== true) return false;
      if (q !== '' && !`${figure.name} ${figure.id}`.toLowerCase().includes(q)) return false;
      if (typeFilter !== '' && !figure.types.includes(typeFilter)) return false;
      if (rarityFilter !== '' && figure.rarity !== rarityFilter) return false;
      if (exFilter === 'ex' && figure.rarity !== 'EX') return false;
      if (exFilter === 'not' && figure.rarity === 'EX') return false;
      if (abilityFilter === 'has' && figure.ability === null) return false;
      if (abilityFilter === 'none' && figure.ability !== null) return false;
      return true;
    })
    .sort((a, b) => {
      if (figureSort === 'mp') return a.mp - b.mp || a.name.localeCompare(b.name);
      if (figureSort === 'rarity') return RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || a.name.localeCompare(b.name);
      if (figureSort === 'id') return a.id - b.id;
      return a.name.localeCompare(b.name) || a.id - b.id;
    });
  const shownPlates = [...plates]
    .filter((plate) => {
      const support = engine.registry.plates.get(contentPlateId(plate.id));
      if (onlyImplemented && support?.implemented !== true) return false;
      if (q !== '' && !`${plate.name} ${plate.id}`.toLowerCase().includes(q)) return false;
      if (rarityFilter !== '' && plate.rarity !== rarityFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (plateSort === 'cost') return plateCost(a) - plateCost(b) || a.name.localeCompare(b.name);
      if (plateSort === 'rarity') return RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || a.name.localeCompare(b.name);
      if (plateSort === 'id') return a.id - b.id;
      return a.name.localeCompare(b.name) || a.id - b.id;
    });

  const listed = tab === 'figures' ? shownFigures : shownPlates;
  const pageSize = narrow ? MOBILE_BOX : Math.max(listed.length, 1);
  const pageCount = Math.max(1, Math.ceil(listed.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pagedFigures =
    tab === 'figures' ? shownFigures.slice(safePage * pageSize, safePage * pageSize + pageSize) : [];
  const pagedPlates =
    tab === 'plates' ? shownPlates.slice(safePage * pageSize, safePage * pageSize + pageSize) : [];

  const toggleFigure = (id: number): void => {
    setDecks((prev) => {
      const current = prev[seat];
      if (current.figures.includes(id)) {
        return { ...prev, [seat]: { ...current, figures: current.figures.filter((item) => item !== id) } };
      }
      if (current.figures.length >= FIGURES_PER_DECK) return prev;
      return { ...prev, [seat]: { ...current, figures: [...current.figures, id] } };
    });
  };

  const togglePlate = (id: number): void => {
    setDecks((prev) => {
      const current = prev[seat];
      if (current.plates.includes(id)) {
        return { ...prev, [seat]: { ...current, plates: current.plates.filter((item) => item !== id) } };
      }
      if (current.plates.length >= PLATES_PER_DECK) return prev;
      const plate = plateOfContent(engine, id);
      const nextCost =
        current.plates.reduce((sum, item) => {
          const row = plateOfContent(engine, item);
          return sum + (row === null ? 0 : plateCost(row));
        }, 0) + (plate === null ? 0 : plateCost(plate));
      if (nextCost > PLATE_COST_CAP) return prev;
      return { ...prev, [seat]: { ...current, plates: [...current.plates, id] } };
    });
  };

  const saveSlot = (): void => {
    const next = slots.map((slot, index) => (index === pickedSlot ? asStoredDeck(decks[seat]) : slot));
    setSlots(next);
    writeDeckSlots(next);
  };

  const loadSlot = (): void => {
    const slot = slots[pickedSlot];
    if (slot == null) return;
    if (slot.figures.length === 0 && slot.plates.length === 0) return;
    setDecks((prev) => ({
      ...prev,
      [seat]: clampDraft(engine, { figures: [...slot.figures], plates: [...slot.plates] }),
    }));
  };

  const start = (): void => {
    if (blocked) {
      setError('Fix deck errors before starting.');
      return;
    }
    setError(null);
    if (mode === 'vsAi') warmAiWorker();
    onStart({
      seed: seed >>> 0,
      startingPlayer: (seed >>> 0) % 2 === 0 ? 0 : 1,
      decks,
      allowUnimplemented,
      mode,
      humanSeat: 0,
      difficulty,
    });
  };

  const catalogPane = (
    <CatalogPane
      engine={engine}
      seat={seat}
      tab={tab}
      query={query}
      onlyImplemented={onlyImplemented}
      allowUnimplemented={allowUnimplemented}
      page={safePage}
      pageCount={pageCount}
      total={listed.length}
      figures={pagedFigures}
      plates={pagedPlates}
      pickedFigures={decks[seat].figures}
      pickedPlates={decks[seat].plates}
      onTab={(next) => {
        setTab(next);
        setPage(0);
      }}
      onQuery={(value) => {
        setQuery(value);
        setPage(0);
      }}
      onOnlyImplemented={(value) => {
        setOnlyImplemented(value);
        setPage(0);
      }}
      onAllowUnimplemented={setAllowUnimplemented}
      figureSort={figureSort}
      plateSort={plateSort}
      typeFilter={typeFilter}
      rarityFilter={rarityFilter}
      exFilter={exFilter}
      abilityFilter={abilityFilter}
      onFigureSort={(value) => {
        setFigureSort(value);
        setPage(0);
      }}
      onPlateSort={(value) => {
        setPlateSort(value);
        setPage(0);
      }}
      onTypeFilter={(value) => {
        setTypeFilter(value);
        setPage(0);
      }}
      onRarityFilter={(value) => {
        setRarityFilter(value);
        setPage(0);
      }}
      onExFilter={(value) => {
        setExFilter(value);
        setPage(0);
      }}
      onAbilityFilter={(value) => {
        setAbilityFilter(value);
        setPage(0);
      }}
      onPage={setPage}
      onToggleFigure={toggleFigure}
      onTogglePlate={togglePlate}
    />
  );

  const plateCount = decks[seat].plates.length;
  const plateSpend = decks[seat].plates.reduce((sum, id) => {
    const plate = plateOfContent(engine, id);
    return sum + (plate === null ? 0 : plateCost(plate));
  }, 0);

  return (
    <div className="deck-builder" data-testid="deck-builder" data-narrow={narrow ? '1' : '0'}>
      <div className="deck-atmosphere" aria-hidden="true" />

      <aside className="deck-bench" data-testid="deck-bench" data-seat={seat}>
        <div className="deck-bench-nav">
          <div className="deck-seat-tabs" role="tablist" aria-label="Seat">
            <SeatTab
              player={0}
              active={seat === 0}
              issues={issues0}
              onPick={() => {
                setSeat(0);
                setPage(0);
              }}
            />
            <SeatTab
              player={1}
              active={seat === 1}
              issues={issues1}
              onPick={() => {
                setSeat(1);
                setPage(0);
              }}
            />
          </div>
          <button
            type="button"
            className="ghost deck-decks-open"
            data-testid="decks-open"
            onClick={() => {
              setSlotsOpen(true);
            }}
          >
            Decks
          </button>
        </div>
        <SeatBench
          engine={engine}
          player={seat}
          draft={decks[seat]}
          issues={issues}
          plateCount={plateCount}
          plateSpend={plateSpend}
          onToggleFigure={toggleFigure}
          onTogglePlate={togglePlate}
        />
      </aside>

      {narrow ? (
        <button
          type="button"
          className="primary deck-catalog-open"
          data-testid="catalog-open"
          onClick={() => {
            setCatalogOpen(true);
          }}
        >
          Open {tab === 'figures' ? 'figure' : 'plate'} box
        </button>
      ) : (
        <main className="deck-main deck-catalog-desktop">{catalogPane}</main>
      )}

      <footer className="deck-foot">
        <div className="deck-foot-row">
          <div className="deck-launch">
            <div className="deck-seed">
              <label htmlFor="dev-seed-input" className="visually-hidden">
                Seed
              </label>
              <span className="deck-seed-field">
                <input
                  id="dev-seed-input"
                  aria-label="Seed"
                  data-testid="seed-input"
                  value={String(seed >>> 0)}
                  onChange={(event) => {
                    const n = Number(event.target.value);
                    if (Number.isFinite(n)) setSeed(n >>> 0);
                  }}
                />
                <button
                  type="button"
                  className="deck-seed-copy"
                  data-testid="copy-seed"
                  aria-label="Copy seed URL"
                  title="Copy seed URL"
                  onClick={() => {
                    void copySeedUrl(seed).then((url) => {
                      setCopied(url);
                    });
                  }}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <rect x="5.5" y="1.5" width="5" height="2.25" rx="0.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
                    <rect x="3.25" y="2.75" width="9.5" height="11.75" rx="0.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
                  </svg>
                </button>
              </span>
            </div>
            <fieldset className="mode-set" aria-label="Mode">
              <label>
                <input
                  type="radio"
                  name="play-mode"
                  data-testid="mode-hotseat"
                  checked={mode === 'hotseat'}
                  onChange={() => {
                    setMode('hotseat');
                  }}
                />{' '}
                Hotseat
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
                />{' '}
                vs AI
              </label>
            </fieldset>
            <label className="deck-diff">
              <span className="deck-foot-label">Difficulty</span>
              <select
                data-testid="difficulty"
                value={difficulty}
                disabled={mode !== 'vsAi'}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'easy' || value === 'normal' || value === 'hard') setDifficulty(value);
                }}
              >
                <option value="easy">Easy (10)</option>
                <option value="normal">Normal (50)</option>
                <option value="hard">Hard (200)</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="primary deck-start"
            data-testid={mode === 'vsAi' ? 'start-vs-ai' : 'start-duel'}
            disabled={blocked}
            onClick={start}
          >
            {mode === 'vsAi' ? 'Start vs AI' : 'Start duel'}
          </button>
        </div>
        {error !== null ? <p className="issues">{error}</p> : null}
        {copied !== null ? (
          <p className="note deck-copied" data-testid="copied-seed">
            Copied {copied}
          </p>
        ) : null}
      </footer>

      {slotsOpen ? (
        <div className="deck-modal deck-slots-modal" role="dialog" aria-label="Deck slots" data-testid="deck-slots-modal">
          <div className="deck-modal-panel deck-slots-panel">
            <div className="deck-modal-head">
              <p>Deck slots</p>
              <button
                type="button"
                className="ghost"
                data-testid="decks-close"
                onClick={() => {
                  setSlotsOpen(false);
                }}
              >
                Close
              </button>
            </div>
            <div className="deck-slots" data-testid="deck-slots">
              {slots.map((slot, index) => (
                <button
                  key={index}
                  type="button"
                  className="deck-well"
                  data-testid={`deck-slot-${index}`}
                  data-empty={slotIsEmpty(slot) ? '1' : '0'}
                  data-on={pickedSlot === index ? '1' : '0'}
                  onClick={() => {
                    setPickedSlot(index);
                  }}
                >
                  <span className="deck-well-index">{index + 1}</span>
                  {slotIsEmpty(slot) ? (
                    <span className="deck-well-empty">Empty</span>
                  ) : (
                    <span className="deck-well-fill">
                      {slot?.figures[0] !== undefined ? (
                        <span className="sprite-frame sprite-frame-well">
                          <FigureSprite
                            url={figureSpriteUrl(engine, slot.figures[0])}
                            name={figureOfContent(engine, slot.figures[0])?.name ?? `#${slot.figures[0]}`}
                          />
                        </span>
                      ) : null}
                      <span>
                        {slot?.figures.length ?? 0}/{FIGURES_PER_DECK}
                      </span>
                    </span>
                  )}
                </button>
              ))}
              <div className="deck-slot-actions">
                <button type="button" className="ghost" data-testid="deck-slot-save" onClick={saveSlot}>
                  Save
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid="deck-slot-load"
                  disabled={slotIsEmpty(slots[pickedSlot] ?? null)}
                  onClick={loadSlot}
                >
                  Load
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid="deck-slot-edit"
                  onClick={() => {
                    loadSlot();
                    setSlotsOpen(false);
                    if (narrow) setCatalogOpen(true);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid="use-starters"
                  onClick={() => {
                    setDecks(starterDrafts(engine));
                    setAllowUnimplemented(false);
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {narrow && catalogOpen ? (
        <div className="deck-modal" role="dialog" aria-label="Catalog" data-testid="catalog-modal">
          <div className="deck-modal-panel">
            <div className="deck-modal-head">
              <p>
                {deckSeatName(seat)} · {tab === 'figures' ? 'Figures' : 'Plates'}
              </p>
              <button
                type="button"
                className="ghost"
                data-testid="catalog-close"
                onClick={() => {
                  setCatalogOpen(false);
                }}
              >
                Close
              </button>
            </div>
            {catalogPane}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SeatTab({
  player,
  active,
  issues,
  onPick,
}: {
  readonly player: PlayerId;
  readonly active: boolean;
  readonly issues: ReturnType<typeof validateDeck>;
  readonly onPick: () => void;
}) {
  const broken = deckHasErrors(issues);
  return (
    <button
      type="button"
      role="tab"
      className="deck-seat-tab"
      data-testid={player === 0 ? 'seat-tab-you' : 'seat-tab-rival'}
      data-seat={player}
      data-broken={broken ? '1' : '0'}
      aria-selected={active}
      onClick={onPick}
    >
      {deckSeatName(player)}
    </button>
  );
}

function KindTabs({
  tab,
  onTab,
}: {
  readonly tab: 'figures' | 'plates';
  readonly onTab: (tab: 'figures' | 'plates') => void;
}) {
  return (
    <div className="deck-kind-tabs" role="tablist" aria-label="Catalog" data-testid="catalog-tab">
      <button
        type="button"
        role="tab"
        className="deck-kind-tab"
        data-testid="catalog-tab-figures"
        aria-selected={tab === 'figures'}
        onClick={() => {
          onTab('figures');
        }}
      >
        Figures
      </button>
      <button
        type="button"
        role="tab"
        className="deck-kind-tab"
        data-testid="catalog-tab-plates"
        aria-selected={tab === 'plates'}
        onClick={() => {
          onTab('plates');
        }}
      >
        Plates
      </button>
    </div>
  );
}

function SeatBench({
  engine,
  player,
  draft,
  issues,
  plateCount,
  plateSpend,
  onToggleFigure,
  onTogglePlate,
}: {
  readonly engine: Engine;
  readonly player: PlayerId;
  readonly draft: DeckDraft;
  readonly issues: ReturnType<typeof validateDeck>;
  readonly plateCount: number;
  readonly plateSpend: number;
  readonly onToggleFigure: (id: number) => void;
  readonly onTogglePlate: (id: number) => void;
}) {
  const costOver = plateSpend > PLATE_COST_CAP;
  const platesFull = plateCount >= 6;
  return (
    <div className="deck-bench-inner">
      <div className="deck-bench-head">
        <p className="deck-bench-label">
          Bench{' '}
          <span>
            {draft.figures.length}/{FIGURES_PER_DECK}
          </span>
        </p>
        <p className="deck-bench-meta">{deckSeatName(player)}</p>
      </div>
      <ol className="bench-pads">
        {Array.from({ length: FIGURES_PER_DECK }, (_, slot) => {
          const id = draft.figures[slot];
          if (id === undefined) {
            return (
              <li key={`empty-${slot}`} className="bench-slot empty">
                <span className="fig-card-art">
                  <span className="fig-card-art-fallback">{slot + 1}</span>
                </span>
                <span className="name-marquee muted">Empty</span>
                <span className="fig-badges">
                  <span className="stat-badge">Slot {slot + 1}</span>
                </span>
              </li>
            );
          }
          const figure = figureOfContent(engine, id);
          const name = figure?.name ?? `#${id}`;
          return (
            <li key={id}>
              <button
                type="button"
                className="bench-slot filled fig-card selected"
                aria-label={`Remove ${name}`}
                onClick={() => {
                  onToggleFigure(id);
                }}
              >
                <span className="fig-card-art" data-rarity={figure?.rarity}>
                  <span className="sprite-frame sprite-frame-bench">
                    <FigureSprite url={figureSpriteUrl(engine, id)} name={name} />
                  </span>
                </span>
                <span className="fig-card-top">
                  <span className="name-marquee-text">{name}</span>
                  {figure !== null ? (
                    <span className="rarity chip chip-rarity" data-rarity={figure.rarity}>
                      {figure.rarity}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="deck-plate-meter">
        <div className="deck-plate-meter-top">
          <p className="deck-bench-label">
            Plates{' '}
            <span className={platesFull ? 'full' : undefined}>
              {plateCount}/6
            </span>
          </p>
          <p className="deck-bench-label">
            Cost{' '}
            <span className={costOver ? 'over' : undefined}>
              {plateSpend}/{PLATE_COST_CAP}
            </span>
          </p>
        </div>
        <div className="deck-plate-bar deck-plate-bar-dual" aria-hidden="true">
          <i
            className={`fill-plates${platesFull ? ' full' : ''}`}
            style={{ width: `${Math.min(100, (plateCount / 6) * 100)}%` }}
          />
          <i
            className={`fill-cost${costOver ? ' over' : ''}`}
            style={{ width: `${Math.min(100, (plateSpend / PLATE_COST_CAP) * 100)}%` }}
          />
        </div>
        {draft.plates.length > 0 ? (
          <ol className="plate-chip-row">
            {draft.plates.map((id) => {
              const plate = plateOfContent(engine, id);
              const name = plate?.name ?? `plate #${id}`;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="plate-chip"
                    onClick={() => {
                      onTogglePlate(id);
                    }}
                  >
                    <span className="name-marquee-text">{name}</span>
                    {plate !== null ? <em>{plateCost(plate)}</em> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="deck-empty">No plates yet</p>
        )}
      </div>
      <ul className="issues">
        {issues
          .filter((issue) => issue.level === 'error')
          .map((issue) => (
            <li key={issue.message}>{issue.message}</li>
          ))}
      </ul>
    </div>
  );
}

function CatalogPane({
  engine,
  seat,
  tab,
  query,
  onlyImplemented,
  allowUnimplemented,
  page,
  pageCount,
  total,
  figures,
  plates,
  pickedFigures,
  pickedPlates,
  onTab,
  onQuery,
  onOnlyImplemented,
  onAllowUnimplemented,
  figureSort,
  plateSort,
  typeFilter,
  rarityFilter,
  exFilter,
  abilityFilter,
  onFigureSort,
  onPlateSort,
  onTypeFilter,
  onRarityFilter,
  onExFilter,
  onAbilityFilter,
  onPage,
  onToggleFigure,
  onTogglePlate,
}: {
  readonly engine: Engine;
  readonly seat: PlayerId;
  readonly tab: 'figures' | 'plates';
  readonly query: string;
  readonly onlyImplemented: boolean;
  readonly allowUnimplemented: boolean;
  readonly figureSort: FigureSort;
  readonly plateSort: PlateSort;
  readonly typeFilter: '' | PokemonType;
  readonly rarityFilter: string;
  readonly exFilter: ExFilter;
  readonly abilityFilter: AbilityFilter;
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly figures: readonly Figure[];
  readonly plates: readonly Plate[];
  readonly pickedFigures: readonly number[];
  readonly pickedPlates: readonly number[];
  readonly onTab: (tab: 'figures' | 'plates') => void;
  readonly onQuery: (value: string) => void;
  readonly onOnlyImplemented: (value: boolean) => void;
  readonly onAllowUnimplemented: (value: boolean) => void;
  readonly onFigureSort: (value: FigureSort) => void;
  readonly onPlateSort: (value: PlateSort) => void;
  readonly onTypeFilter: (value: '' | PokemonType) => void;
  readonly onRarityFilter: (value: string) => void;
  readonly onExFilter: (value: ExFilter) => void;
  readonly onAbilityFilter: (value: AbilityFilter) => void;
  readonly onPage: (page: number) => void;
  readonly onToggleFigure: (id: number) => void;
  readonly onTogglePlate: (id: number) => void;
}) {
  return (
    <div className="deck-catalog">
      <KindTabs tab={tab} onTab={onTab} />
      <div className="deck-catalog-tools filters">
        <label>
          Search{' '}
          <input
            data-testid="catalog-search"
            placeholder={tab === 'figures' ? 'Search figures…' : 'Search plates…'}
            value={query}
            onChange={(event) => {
              onQuery(event.target.value);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={onlyImplemented}
            onChange={(event) => {
              onOnlyImplemented(event.target.checked);
            }}
          />{' '}
          Implemented only
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowUnimplemented}
            onChange={(event) => {
              onAllowUnimplemented(event.target.checked);
            }}
          />{' '}
          Debug: allow unimplemented
        </label>
        {tab === 'figures' ? (
          <label>
            Sort{' '}
            <select
              data-testid="catalog-sort"
              value={figureSort}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'name' || value === 'mp' || value === 'rarity' || value === 'id') {
                  onFigureSort(value);
                }
              }}
            >
              <option value="name">Name</option>
              <option value="mp">MP</option>
              <option value="rarity">Rarity</option>
              <option value="id">Id</option>
            </select>
          </label>
        ) : (
          <label>
            Sort{' '}
            <select
              data-testid="catalog-sort"
              value={plateSort}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'name' || value === 'cost' || value === 'rarity' || value === 'id') {
                  onPlateSort(value);
                }
              }}
            >
              <option value="name">Name</option>
              <option value="cost">Cost</option>
              <option value="rarity">Rarity</option>
              <option value="id">Id</option>
            </select>
          </label>
        )}
        <label>
          Rarity{' '}
          <select
            data-testid="catalog-filter-rarity"
            value={rarityFilter}
            onChange={(event) => {
              onRarityFilter(event.target.value);
            }}
          >
            <option value="">All</option>
            {RARITIES.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity}
              </option>
            ))}
          </select>
        </label>
        {tab === 'figures' ? (
          <>
            <label>
              Type{' '}
              <select
                data-testid="catalog-filter-type"
                value={typeFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '' || (POKEMON_TYPES as readonly string[]).includes(value)) {
                    onTypeFilter(value as '' | PokemonType);
                  }
                }}
              >
                <option value="">All</option>
                {POKEMON_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              EX{' '}
              <select
                data-testid="catalog-filter-ex"
                value={exFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'all' || value === 'ex' || value === 'not') onExFilter(value);
                }}
              >
                <option value="all">All</option>
                <option value="ex">EX</option>
                <option value="not">Not EX</option>
              </select>
            </label>
            <label>
              Ability{' '}
              <select
                data-testid="catalog-filter-ability"
                value={abilityFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'all' || value === 'has' || value === 'none') onAbilityFilter(value);
                }}
              >
                <option value="all">All</option>
                <option value="has">Has ability</option>
                <option value="none">No ability</option>
              </select>
            </label>
          </>
        ) : null}
        {pageCount > 1 ? (
          <div className="deck-box-pager">
            <button
              type="button"
              className="ghost"
              disabled={page <= 0}
              onClick={() => {
                onPage(page - 1);
              }}
            >
              Prev
            </button>
            <span data-testid="catalog-page">
              {tab === 'figures' ? 'Box' : 'Case'} {page + 1}/{pageCount}
            </span>
            <button
              type="button"
              className="ghost"
              disabled={page >= pageCount - 1}
              onClick={() => {
                onPage(page + 1);
              }}
            >
              Next
            </button>
            <span className="muted">{total} listed</span>
          </div>
        ) : null}
      </div>

      <div className="catalog">
        {tab === 'figures'
          ? figures.map((figure) => {
              const support = engine.registry.figures.get(contentFigureId(figure.id));
              const on = pickedFigures.includes(figure.id);
              return (
                <button
                  key={figure.id}
                  type="button"
                  className="card fig-card"
                  data-on={on ? 'true' : 'false'}
                  data-seat={seat}
                  disabled={!on && pickedFigures.length >= FIGURES_PER_DECK}
                  onClick={() => {
                    onToggleFigure(figure.id);
                  }}
                >
                  <span className="fig-card-art" data-rarity={figure.rarity}>
                    <span className="sprite-frame sprite-frame-card">
                      <FigureSprite url={figureSpriteUrl(engine, figure.id)} name={figure.name} />
                    </span>
                  </span>
                  <span className="fig-card-body">
                    <span className="fig-card-top">
                      <strong className="name-marquee-text">{figure.name}</strong>
                      <span className="rarity chip chip-rarity" data-rarity={figure.rarity}>
                        {figure.rarity}
                      </span>
                    </span>
                    <FigureChips figure={figure} />
                    <div className="muted">{figure.types.join('/')}</div>
                    {figure.ability !== null ? (
                      <CardAbility className="card-ability" text={figure.ability.text} />
                    ) : null}
                    {support?.implemented !== true ? (
                      <CoverageBadge
                        implemented={false}
                        kind="figure"
                        {...(support?.unsupported[0] !== undefined
                          ? { title: support.unsupported[0].gaps.join(', ') }
                          : {})}
                      />
                    ) : null}
                    {isFormOnlyFigure(figure) ? <span className="badge warn">form-only</span> : null}
                  </span>
                </button>
              );
            })
          : plates.map((plate) => {
              const support = engine.registry.plates.get(contentPlateId(plate.id));
              const on = pickedPlates.includes(plate.id);
              const spend = pickedPlates.reduce((sum, id) => {
                const row = plateOfContent(engine, id);
                return sum + (row === null ? 0 : plateCost(row));
              }, 0);
              const wouldOver =
                !on &&
                (pickedPlates.length >= PLATES_PER_DECK || spend + plateCost(plate) > PLATE_COST_CAP);
              return (
                <button
                  key={plate.id}
                  type="button"
                  className="card fig-card plate-card"
                  data-on={on ? 'true' : 'false'}
                  disabled={
                    wouldOver || (!allowUnimplemented && support?.implemented !== true)
                  }
                  title={
                    support?.implemented === true
                      ? plate.effect
                      : (support?.unsupported[0]?.gaps.join(', ') ?? 'unimplemented')
                  }
                  onClick={() => {
                    onTogglePlate(plate.id);
                  }}
                >
                  <span className="fig-card-body">
                    <span className="fig-card-top">
                      <strong className="name-marquee-text">{plate.name}</strong>
                      <span className="rarity chip chip-rarity" data-rarity={plate.rarity}>
                        {plate.rarity}
                      </span>
                    </span>
                    <div className="muted">
                      Cost {plateCost(plate)}
                      {plate.endsTurn ? ' · ends turn' : ''}
                    </div>
                    <CardAbility className="card-ability plate-desc" text={plate.effect} />
                    {support?.implemented !== true ? (
                      <CoverageBadge
                        implemented={false}
                        kind="plate"
                        {...(support?.unsupported[0] !== undefined
                          ? { title: support.unsupported[0].gaps.join(', ') }
                          : {})}
                      />
                    ) : null}
                  </span>
                </button>
              );
            })}
      </div>
    </div>
  );
}

function CardAbility({ text, className }: { readonly text: string; readonly className: string }) {
  const clipRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = clipRef.current;
    if (el === null) return;
    const measure = (): void => {
      const first = el.querySelector('p');
      if (first === null) return;
      setOverflow(first.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [text]);
  return (
    <div
      ref={clipRef}
      className="card-ability-clip"
      data-marquee={overflow ? '1' : '0'}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="card-ability-track">
        <p className={className}>{text}</p>
        {overflow ? (
          <p className={className} aria-hidden="true">
            {text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FigureChips({ figure }: { readonly figure: Figure }) {
  return (
    <div className="figure-chips">
      <span className="chip chip-mp" data-testid="chip-mp">
        MP {figure.mp}
      </span>
      {figure.rarity === 'EX' ? (
        <span className="chip chip-ex" data-testid="chip-ex">
          EX
        </span>
      ) : null}
      <span className="chip chip-rarity" data-testid="chip-rarity" data-rarity={figure.rarity}>
        {figure.rarity}
      </span>
    </div>
  );
}
