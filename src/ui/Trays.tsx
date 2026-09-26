import { contentPlateId, type Command, type Engine, type FigureState, type FigureUid, type GameState, type PlayerId, type PlayerView } from '../engine/index.js';
import { PC_CAPACITY } from '../rules/constants.js';
import { figureOfContent, plateOfContent } from './boot.js';
import { FigureSprite } from './FigureSprite.js';
import {
  commandsForUid,
  conditionLabel,
  figureMp,
  figureName,
  figureSpriteUrl,
  plateCost,
  zoneFigures,
} from './model.js';

interface Props {
  readonly side: 'you' | 'rival';
  readonly engine: Engine;
  readonly host: GameState;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly selected: FigureUid | null;
  readonly onSelect: (uid: FigureUid) => void;
  readonly onPlayPlate: (slot: number) => void;
  readonly onAbility: (command: Command) => void;
}

export function Trays({ side, engine, host, view, legal, selected, onSelect, onPlayPlate, onAbility }: Props) {
  const player: PlayerId = side === 'you' ? view.you : view.you === 0 ? 1 : 0;
  return (
    <SeatTrays
      side={side}
      engine={engine}
      host={host}
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
  host,
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
  readonly host: GameState;
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
  const plates = host.players[player].plates;
  const abilityActions = legal.filter((command) => command.kind === 'abilityAction' && command.player === you);

  return (
    <section className="trays" data-side={side} data-testid={`trays-${side}`}>
      <div className="tray-strip">
        <p className="tray-head">
          <span className="tray-seat">{side === 'you' ? 'You' : 'Rival'}</span>
          <span>Bench {bench.length}/6</span>
          <span data-testid={`pc-${player}`}>
            P.C. {pc.length}/{PC_CAPACITY}
          </span>
        </p>
        <div className="tray-rail">
          <SlotRow
            title="Bench"
            figures={bench}
            slots={6}
            engine={engine}
            legal={legal}
            selected={selected}
            onSelect={onSelect}
          />
          <SlotRow
            title="P.C."
            figures={pc}
            slots={PC_CAPACITY}
            engine={engine}
            legal={legal}
            selected={selected}
            onSelect={onSelect}
          />
          {excluded.length > 0 ? (
            <SlotRow
              title="Excluded"
              figures={excluded}
              slots={excluded.length}
              labeled
              engine={engine}
              legal={legal}
              selected={selected}
              onSelect={onSelect}
            />
          ) : null}
          {ultra.length > 0 ? (
            <SlotRow
              title="Ultra Space"
              figures={ultra}
              slots={ultra.length}
              labeled
              engine={engine}
              legal={legal}
              selected={selected}
              onSelect={onSelect}
            />
          ) : null}
          <div className="tray-end" {...(mine ? {} : { 'data-testid': 'opponent-plates' })}>
            <PlateRow
              engine={engine}
              plates={plates}
              playable={mine}
              view={view}
              legal={legal}
              onPlayPlate={onPlayPlate}
            />
            {mine && abilityActions.length > 0 ? (
              <div className="actions tray-abilities">
                {abilityActions.map((command) =>
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
                )}
              </div>
            ) : null}
            {mine ? null : <span className="visually-hidden">hidden unused</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function SlotRow({
  title,
  figures,
  slots,
  labeled = false,
  engine,
  legal,
  selected,
  onSelect,
}: {
  readonly title: string;
  readonly figures: readonly FigureState[];
  readonly slots: number;
  readonly labeled?: boolean;
  readonly engine: Engine;
  readonly legal: readonly Command[];
  readonly selected: FigureUid | null;
  readonly onSelect: (uid: FigureUid) => void;
}) {
  const group =
    title === 'Bench' ? 'tray-figures' : title === 'P.C.' ? 'tray-pc' : title === 'Excluded' ? 'tray-excluded' : 'tray-ultra';
  return (
    <div className={`tray-group ${group}`}>
      {labeled ? <p className="tray-label">{title}</p> : <p className="visually-hidden">{title}</p>}
      <div className="tray-list">
        {Array.from({ length: slots }, (_, index) => {
          const figure = figures[index];
          if (figure === undefined) {
            return (
              <div key={`${title}-empty-${String(index)}`} className="tray-slot is-empty" aria-hidden="true">
                <span className="tray-slot-art" />
              </div>
            );
          }
          const usable = commandsForUid(legal, figure.uid).length > 0;
          const content = figureOfContent(engine, figure.figureId);
          const name = figureName(engine, figure);
          const mp = figureMp(engine, figure);
          const meta = [
            name,
            `MP ${mp}`,
            content !== null ? `${content.rarity} · ${content.types.join('/')}` : null,
            ...conditionLabel(figure),
            usable ? null : 'locked',
          ]
            .filter((part) => part !== null)
            .join(' · ');
          return (
            <button
              key={figure.uid}
              type="button"
              className="tray-slot"
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
              <span className="tray-slot-art">
                <FigureSprite url={figureSpriteUrl(engine, figure.figureId)} name={name} />
              </span>
              <strong className="tray-slot-name">{name}</strong>
              <span className="tray-slot-meta">
                <span className="chip chip-mp">MP {mp}</span>
                {content !== null ? (
                  <span className="chip chip-rarity" data-rarity={content.rarity}>
                    {content.rarity}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlateRow({
  engine,
  plates,
  playable,
  view,
  legal,
  onPlayPlate,
}: {
  readonly engine: Engine;
  readonly plates: readonly { readonly plateId: number; readonly used: boolean }[];
  readonly playable: boolean;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly onPlayPlate: (slot: number) => void;
}) {
  if (plates.length === 0) return null;
  return (
    <div className="tray-group tray-plates">
      <p className="visually-hidden">Plates</p>
      <div className="tray-list plate-chip-row">
        {plates.map((slot, index) => {
          const plate = plateOfContent(engine, slot.plateId);
          const support = engine.registry.plates.get(contentPlateId(slot.plateId));
          const thisPlay = legal.find(
            (command) => command.kind === 'playPlate' && command.player === view.you && command.slot === index,
          );
          const anyPlate = legal.some((command) => command.kind === 'playPlate' && command.player === view.you);
          const unimplemented = support !== undefined && !support.implemented;
          const reason = slot.used
            ? 'used'
            : unimplemented
              ? support.unsupported[0] !== undefined
                ? support.unsupported[0].gaps.join(', ')
                : 'unimplemented'
              : !playable
                ? 'rival'
                : thisPlay === undefined
                  ? anyPlate
                    ? 'not legal'
                    : 'locked'
                  : 'playable';
          const tip = [plate?.name ?? `Plate ${slot.plateId}`, plate?.effect, reason].filter(Boolean).join(' — ');
          const name = plate?.name ?? `Plate ${slot.plateId}`;
          return (
            <button
              key={`${slot.plateId}-${index}`}
              type="button"
              className="tray-card plate-chip"
              data-used={slot.used ? '1' : '0'}
              disabled={!playable || thisPlay === undefined}
              title={tip}
              onClick={() => {
                if (playable) onPlayPlate(index);
              }}
            >
              <strong>{name}</strong>
              <span className="muted">{plate !== null ? plateCost(plate) : '?'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
