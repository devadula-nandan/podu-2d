import type { Command, Engine, FigureState, FigureUid, PlayerId, PlayerView } from '../engine/index.js';
import { PC_CAPACITY } from '../rules/constants.js';
import { figureOfContent, plateOfContent } from '../ui/boot.js';
import { FigureSprite } from '../ui/FigureSprite.js';
import {
  commandsForUid,
  conditionLabel,
  figureMp,
  figureName,
  figureSpriteUrl,
  plateCost,
  zoneFigures,
} from '../ui/model.js';
import { CONDITION_FX, markerShort } from './status-fx.js';

interface Props {
  readonly side: 'you' | 'rival';
  readonly engine: Engine;
  readonly view: PlayerView;
  readonly legal: readonly Command[];
  readonly selected: FigureUid | null;
  readonly locked: boolean;
  readonly onSelect: (uid: FigureUid) => void;
  readonly onPlayPlate: (slot: number) => void;
  readonly onAbility: (command: Command) => void;
}

export function PlaySeat({
  side,
  engine,
  view,
  legal,
  selected,
  locked,
  onSelect,
  onPlayPlate,
  onAbility,
}: Props) {
  const player: PlayerId = side === 'you' ? view.you : view.you === 0 ? 1 : 0;
  const bench = zoneFigures(view, player, 'bench');
  const pc = zoneFigures(view, player, 'pc');
  const abilityActions = legal.filter((command) => command.kind === 'abilityAction' && command.player === view.you);

  return (
    <section className="play-seat" data-side={side} data-testid={`play-seat-${side}`}>
      <div className="play-bench" aria-label={side === 'you' ? 'Your bench' : 'Rival bench'}>
        {bench.map((figure) => {
          const can = commandsForUid(legal, figure.uid).length > 0;
          const kind = can
            ? legal.some((command) => command.kind === 'deploy' && command.uid === figure.uid)
              ? 'deploy'
              : 'act'
            : 'none';
          const otherBlocked = view.turn.movedUid !== null && figure.uid !== view.turn.movedUid;
          return (
            <FigureDisc
              key={figure.uid}
              engine={engine}
              figure={figure}
              side={side}
              selected={selected === figure.uid}
              can={kind}
              disabled={locked || otherBlocked || (side === 'rival' && !can)}
              onSelect={() => {
                if (!locked) onSelect(figure.uid);
              }}
            />
          );
        })}
      </div>
      <div className="play-pc" aria-label="Pokémon Center">
        <span className="play-pc-label">P.C. {pc.length}/{PC_CAPACITY}</span>
        {Array.from({ length: PC_CAPACITY }, (_, index) => {
          const figure = pc[index];
          if (figure === undefined) {
            return <div key={`pc-empty-${index}`} className="play-disc is-empty is-pc" data-testid={`pc-empty-${side}-${index}`} />;
          }
          return (
            <FigureDisc
              key={figure.uid}
              engine={engine}
              figure={figure}
              side={side}
              selected={false}
              can="none"
              disabled
              onSelect={() => undefined}
            />
          );
        })}
      </div>
      {side === 'you' && view.yourPlates.length > 0 ? (
        <div className="play-plates" data-testid="play-plates">
          {view.yourPlates.map((plate, slot) => {
            const content = plateOfContent(engine, plate.plateId);
            const playable = legal.some(
              (command) => command.kind === 'playPlate' && command.player === view.you && command.slot === slot,
            );
            return (
              <button
                key={slot}
                type="button"
                className="play-plate"
                data-testid={`play-plate-${slot}`}
                data-used={plate.used ? '1' : '0'}
                disabled={locked || plate.used || !playable}
                onClick={() => {
                  onPlayPlate(slot);
                }}
              >
                <span className="play-plate-name">{content?.name ?? `Plate ${slot + 1}`}</span>
                <span className="play-plate-cost">{content === null ? '' : plateCost(content)}</span>
              </button>
            );
          })}
        </div>
      ) : side === 'you' ? (
        <div className="play-plates" data-testid="play-plates" hidden />
      ) : view.opponentPlates.unused > 0 || view.opponentPlates.used.length > 0 ? (
        <p className="play-hidden-plates" data-testid="opponent-plates">
          Rival plates · {view.opponentPlates.unused} facedown
        </p>
      ) : null}
      {side === 'you' && abilityActions.length > 0 ? (
        <div className="play-abilities">
          {abilityActions.map((command, index) => (
            <button
              key={`${command.kind}-${index}`}
              type="button"
              className="play-ghost"
              disabled={locked}
              onClick={() => {
                onAbility(command);
              }}
            >
              Ability
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function FigureDisc({
  engine,
  figure,
  side,
  selected,
  can,
  disabled,
  onSelect,
}: {
  readonly engine: Engine;
  readonly figure: FigureState;
  readonly side: 'you' | 'rival';
  readonly selected: boolean;
  readonly can: 'deploy' | 'act' | 'none';
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  const name = figureName(engine, figure);
  const mp = figureMp(engine, figure);
  const printed = figureOfContent(engine, figure.figureId);
  const printedMp = printed?.mp ?? mp;
  const mpLabel = mp === printedMp ? `MP ${mp}` : `MP ${mp} of ${printedMp}`;
  const badges = conditionLabel(figure);
  const fx = figure.condition === null ? null : CONDITION_FX[figure.condition];
  return (
    <button
      type="button"
      className="play-disc"
      data-testid={`figure-${figure.uid}`}
      data-can={can}
      data-owner={figure.owner}
      data-selected={selected ? '1' : '0'}
      data-wait={figure.wait > 0 ? String(figure.wait) : undefined}
      data-condition={figure.condition ?? undefined}
      disabled={disabled}
      title={mp === printedMp ? undefined : `Printed MP ${printedMp}`}
      aria-label={`${name}, ${mpLabel}${printed === null ? '' : `, ${printed.types.join('/')}`}`}
      onClick={onSelect}
    >
      <span className="play-disc-base" data-who={side} aria-hidden="true" />
      <FigureSprite url={figureSpriteUrl(engine, figure.figureId)} name={name} />
      <strong>{name}</strong>
      <span className="play-mp">{mp === printedMp ? mp : `${mp}/${printedMp}`}</span>
      {fx !== null ? (
        <span className="play-fx" data-fx={figure.condition} title={badges.join(' · ')}>
          {fx.glyph}
        </span>
      ) : null}
      {figure.wait > 0 ? (
        <span className="play-wait" data-testid={`wait-${figure.uid}`}>
          {figure.wait}
        </span>
      ) : null}
      {figure.marker !== null ? (
        <span className="play-marker">{markerShort(figure.marker.id, figure.marker.value)}</span>
      ) : null}
    </button>
  );
}
