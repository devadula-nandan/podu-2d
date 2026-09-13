import type { Command, Engine, FigureState, FigureUid, PlayerId, PlayerView } from '../engine/index.js';
import { contentPlateId } from '../engine/index.js';
import { PC_CAPACITY } from '../rules/constants.js';
import { figureOfContent } from './boot.js';
import { FigureSprite } from './FigureSprite.js';
import {
  commandsForUid,
  conditionLabel,
  figureMp,
  figureName,
  figureSpriteUrl,
  plateCost,
  seatLabel,
  zoneFigures,
} from './model.js';

interface Props {
  readonly side: 'you' | 'rival';
  readonly engine: Engine;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly selected: FigureUid | null;
  readonly onSelect: (uid: FigureUid) => void;
  readonly onPlayPlate: (slot: number) => void;
  readonly onAbility: (command: Command) => void;
}

export function Trays({ side, engine, view, legal, selected, onSelect, onPlayPlate, onAbility }: Props) {
  const player: PlayerId = side === 'you' ? view.you : view.you === 0 ? 1 : 0;
  return (
    <SeatTrays
      side={side}
      engine={engine}
      view={view}
      legal={legal}
      player={player}
      you={view.you}
      selected={selected}
      onSelect={onSelect}
      onPlayPlate={onPlayPlate}
      onAbility={onAbility}
    />
  );
}

function SeatTrays({
  side,
  engine,
  view,
  legal,
  player,
  you,
  selected,
  onSelect,
  onPlayPlate,
  onAbility,
}: {
  readonly side: 'you' | 'rival';
  readonly engine: Engine;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly player: PlayerId;
  readonly you: PlayerId;
  readonly selected: FigureUid | null;
  readonly onSelect: (uid: FigureUid) => void;
  readonly onPlayPlate: (slot: number) => void;
  readonly onAbility: (command: Command) => void;
}) {
  const mine = player === you;
  const bench = zoneFigures(view, player, 'bench');
  const pc = zoneFigures(view, player, 'pc');
  const excluded = zoneFigures(view, player, 'excluded');
  const ultra = zoneFigures(view, player, 'ultraSpace');
  const abilityActions = legal.filter((command) => command.kind === 'abilityAction' && command.player === you);

  return (
    <section className="trays" data-side={side}>
      <div className="panel tray-seat">
        <p className="kicker" data-testid={`pc-${player}`}>
          {seatLabel(player)} {mine ? '(you)' : '(public)'} · P.C. {pc.length}/{PC_CAPACITY} FIFO
        </p>
        <div className="tray-rail">
          <DomeRow
            title="Bench"
            figures={bench}
            slots={6}
            engine={engine}
            legal={legal}
            selected={selected}
            onSelect={onSelect}
          />
          <DomeRow
            title="P.C."
            figures={pc}
            slots={PC_CAPACITY}
            engine={engine}
            legal={legal}
            selected={selected}
            onSelect={onSelect}
          />
          {excluded.length > 0 ? (
            <DomeRow
              title="Excluded"
              figures={excluded}
              slots={excluded.length}
              engine={engine}
              legal={legal}
              selected={selected}
              onSelect={onSelect}
            />
          ) : null}
          {ultra.length > 0 ? (
            <DomeRow
              title="Ultra Space"
              figures={ultra}
              slots={ultra.length}
              engine={engine}
              legal={legal}
              selected={selected}
              onSelect={onSelect}
            />
          ) : null}
          {mine ? (
            <div className="tray-end">
              <PlateRow engine={engine} view={view} legal={legal} onPlayPlate={onPlayPlate} />
              <div className="actions tray-abilities">
                {abilityActions.length === 0 ? (
                  <p className="note">No legal ability actions this window.</p>
                ) : (
                  abilityActions.map((command) =>
                    command.kind === 'abilityAction' ? (
                      <button
                        key={`${command.uid}-${command.clauseId}`}
                        type="button"
                        className="action"
                        onClick={() => {
                          onAbility(command);
                        }}
                      >
                        {command.clauseId}
                      </button>
                    ) : null,
                  )
                )}
              </div>
            </div>
          ) : (
            <p className="note tray-hidden" data-testid="opponent-plates">
              Opponent plates: {view.opponentPlates.unused} hidden unused
              {view.opponentPlates.used.length > 0
                ? `, used ${view.opponentPlates.used
                    .map((id) => figurePlateName(engine, id))
                    .join(', ')}`
                : ''}
              .
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function DomeRow({
  title,
  figures,
  slots,
  engine,
  legal,
  selected,
  onSelect,
}: {
  readonly title: string;
  readonly figures: readonly FigureState[];
  readonly slots: number;
  readonly engine: Engine;
  readonly legal: readonly Command[];
  readonly selected: FigureUid | null;
  readonly onSelect: (uid: FigureUid) => void;
}) {
  return (
    <div className="tray-group">
      <p className="kicker">{title}</p>
      <div className="tray-list dome-row">
        {Array.from({ length: slots }, (_, index) => {
          const figure = figures[index];
          if (figure === undefined) {
            return (
              <div key={`${title}-empty-${String(index)}`} className="dome is-empty">
                <span className="muted">{title === 'Bench' ? String(index + 1) : '·'}</span>
              </div>
            );
          }
          const usable = commandsForUid(legal, figure.uid).length > 0;
          const content = figureOfContent(engine, figure.figureId);
          const meta = [
            `MP ${figureMp(engine, figure)}`,
            content !== null ? content.types.join('/') : null,
            ...conditionLabel(figure),
            usable ? null : 'No legal command',
          ]
            .filter((part) => part !== null)
            .join(' · ');
          return (
            <button
              key={figure.uid}
              type="button"
              className="dome"
              data-on={selected === figure.uid ? 'true' : 'false'}
              title={meta}
              data-testid={
                title === 'Bench'
                  ? `bench-${figure.owner}-${index}`
                  : title === 'P.C.'
                    ? `pc-card-${figure.uid}`
                    : undefined
              }
              disabled={!usable && selected !== figure.uid}
              onClick={() => {
                onSelect(figure.uid);
              }}
            >
              <FigureSprite url={figureSpriteUrl(engine, figure.figureId)} name={figureName(engine, figure)} />
              <strong>
                {figure.owner === 0 ? '○' : '□'} {figureName(engine, figure)}
              </strong>
              <span className="dome-mp">MP {figureMp(engine, figure)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlateRow({
  engine,
  view,
  legal,
  onPlayPlate,
}: {
  readonly engine: Engine;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly onPlayPlate: (slot: number) => void;
}) {
  if (view.yourPlates.length === 0) {
    return <p className="note tray-hidden">No plates in this deck.</p>;
  }
  return (
    <div className="tray-group">
      <p className="kicker">Your plates</p>
      <div className="tray-list plate-chip-row">
        {view.yourPlates.map((slot, index) => {
          const plate = engine.content.plates.get(slot.plateId)?.plate;
          const support = engine.registry.plates.get(slot.plateId);
          const thisPlay = legal.find(
            (command) => command.kind === 'playPlate' && command.player === view.you && command.slot === index,
          );
          const anyPlate = legal.some((command) => command.kind === 'playPlate' && command.player === view.you);
          const unimplemented = support !== undefined && !support.implemented;
          const reason = slot.used
            ? 'already used'
            : unimplemented
              ? support.unsupported[0] !== undefined
                ? support.unsupported[0].gaps.join(', ')
                : 'unimplemented'
              : thisPlay === undefined
                ? anyPlate
                  ? 'not legal now'
                  : 'not the plate window'
                : null;
          return (
            <button
              key={`${slot.plateId}-${index}`}
              type="button"
              className="tray-card plate-chip"
              disabled={thisPlay === undefined}
              title={reason ?? 'Play this plate'}
              onClick={() => {
                onPlayPlate(index);
              }}
            >
              <strong>{plate?.name ?? `Plate ${slot.plateId}`}</strong>
              <span className="muted">
                {plate !== undefined ? plateCost(plate) : '?'}
                {plate?.endsTurn === true ? ' · end' : ''}
              </span>
              {reason !== null ? (
                <span className={`badge ${unimplemented ? 'bad' : 'warn'}`}>{reason}</span>
              ) : (
                <span className="badge ok">playable</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function figurePlateName(engine: Engine, id: number): string {
  return engine.content.plates.get(contentPlateId(id))?.plate.name ?? `#${id}`;
}
