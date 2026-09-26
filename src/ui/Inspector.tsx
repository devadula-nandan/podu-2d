import type { Clause, Trigger } from '../content/dsl/effects.js';
import type { Engine, FigureState, FigureSupport, GameState, PlayerId } from '../engine/index.js';
import { buildWheel, liveClauses, nullifiedFigures } from '../engine/index.js';
import { CoverageBadge } from './CoverageBadge.js';
import { WheelOdds } from './WheelOdds.js';
import { OPEN_RULINGS } from '../rules/constants.js';
import { figureOfContent } from './boot.js';
import { FigureSprite } from './FigureSprite.js';
import { figureName, figureSpriteUrl } from './model.js';

const INSPECTOR_TRIGGERS: readonly Trigger[] = [
  'onAttackResolve',
  'onSelfKnockedOut',
  'onOpponentKnockedOut',
  'onAttacked',
  'afterBattle',
  'beforeBattle',
  'duringBattle',
  'startOfTurn',
  'endOfTurn',
  'afterMove',
  'onEnterField',
  'passive',
  'usageRestriction',
];

interface Props {
  readonly engine: Engine;
  readonly host: GameState;
  readonly selected: FigureState | null;
  readonly you: PlayerId;
}

export function Inspector({ engine, host, selected, you }: Props) {
  const figure = selected ?? host.figures.find((row) => row.zone === 'field') ?? host.figures[0] ?? null;
  if (figure === null) {
    return (
      <aside className="panel">
        <p className="kicker">Rules inspector</p>
        <p className="note">No figure to inspect.</p>
      </aside>
    );
  }

  const content = figureOfContent(engine, figure.figureId);
  const support = engine.registry.figures.get(figure.figureId);
  const compiled = engine.content.figures.get(figure.figureId);
  const nullified = nullifiedFigures(host, engine.deps);
  const liveIds = new Set(
    INSPECTOR_TRIGGERS.flatMap((trigger) => liveClauses(host, engine.deps, trigger))
      .filter((row) => row.source === figure.uid)
      .map((row) => row.clause.id),
  );

  return (
    <aside className="panel" data-testid="inspector" data-side={figure.owner === you ? 'you' : 'rival'}>
      <p className="kicker">Rules inspector</p>
      <h2 className="inspector-name">
        <FigureSprite url={figureSpriteUrl(engine, figure.figureId)} name={figureName(engine, figure)} />
        {figureName(engine, figure)}
      </h2>
      <p className="inspector-ids">
        {figure.owner === you ? 'You' : 'Rival'} · uid {figure.uid} · id {figure.figureId} · node {figure.node ?? '—'}
      </p>
      <p className="note">
        {content !== null ? (
          <>
            {content.types.join(' / ')} · MP {content.mp} ·{' '}
            <span className="rarity chip chip-rarity" data-rarity={content.rarity}>
              {content.rarity}
            </span>
          </>
        ) : (
          'Unknown content'
        )}
        {content !== null && content.form !== null ? ` · form ${content.form}` : ''}
      </p>
      <p>
        <CoverageBadge
          implemented={support?.implemented === true}
          kind="figure"
          {...(support?.unsupported[0] !== undefined
            ? { title: support.unsupported[0].gaps.join(', ') }
            : {})}
        />{' '}
        {nullified.has(figure.uid) ? <span className="badge warn">nullified</span> : null}{' '}
        {figure.zone !== 'field' ? <span className="badge">off field</span> : <span className="badge ok">on field</span>}
      </p>
      <WheelOdds segments={buildWheel(host, engine.deps, figure.uid)} caption="Wheel odds" />
      {/* NEED: view() does not list live/nullified clauses. Inspector uses the host state + bus queries. */}
      <ClauseList
        title="Ability clauses"
        clauses={compiled?.abilityClauses ?? []}
        supportGaps={gapsByOrigin(support, 'ability')}
        liveIds={liveIds}
        nullified={nullified.has(figure.uid)}
        onField={figure.zone === 'field'}
      />
      <ClauseList
        title="Wheel clauses"
        clauses={compiled?.segmentClauses.flat() ?? []}
        supportGaps={gapsByOrigin(support, 'move')}
        liveIds={new Set()}
        nullified={false}
        onField={false}
      />
      <details>
        <summary className="kicker">Open rulings</summary>
        {Object.entries(OPEN_RULINGS).map(([id, ruling]) => (
          <div className="clause" key={id}>
            <strong>
              {id} · {ruling.confidence}
            </strong>
            <p>{ruling.ruling}</p>
          </div>
        ))}
      </details>
    </aside>
  );
}

function gapsByOrigin(support: FigureSupport | undefined, kind: 'ability' | 'move'): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (support === undefined) return map;
  for (const clause of support.unsupported) {
    if (kind === 'ability' && !clause.origin.startsWith('ability')) continue;
    if (kind === 'move' && !clause.origin.startsWith('move')) continue;
    map.set(clause.clause.id, [...clause.gaps]);
  }
  return map;
}

function unimplementedTexts(clause: Clause): string[] {
  const texts: string[] = [];
  for (const action of clause.actions) {
    if (action.do === 'unimplemented') texts.push(action.text);
  }
  return texts;
}

function ClauseList({
  title,
  clauses,
  supportGaps,
  liveIds,
  nullified,
  onField,
}: {
  readonly title: string;
  readonly clauses: readonly Clause[];
  readonly supportGaps: ReadonlyMap<string, string[]>;
  readonly liveIds: ReadonlySet<string>;
  readonly nullified: boolean;
  readonly onField: boolean;
}) {
  return (
    <div>
      <p className="kicker">{title}</p>
      {clauses.length === 0 ? <p className="note">None.</p> : null}
      {clauses.map((clause) => {
        const gaps = supportGaps.get(clause.id) ?? unimplementedTexts(clause);
        const unimplemented = gaps.length > 0;
        const live = onField && liveIds.has(clause.id);
        return (
          <div className="clause" key={clause.id}>
            <div>
              <span className="badge">{clause.trigger}</span>{' '}
              {unimplemented ? <span className="badge bad">unimplemented</span> : <span className="badge ok">compiled</span>}{' '}
              {nullified ? (
                <span className="badge warn">nullified</span>
              ) : live ? (
                <span className="badge ok">live</span>
              ) : (
                <span className="badge">not live</span>
              )}
            </div>
            <p>{clause.source}</p>
            {unimplemented ? <p className="muted">{gaps.join(' · ')}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
