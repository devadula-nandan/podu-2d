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
        {Array.from({ length: 6 }, (_, index) => {
          const figure = bench[index];
          if (figure === undefined) {
            return <div key={`empty-${index}`} className="play-disc is-empty" data-testid={`bench-empty-${side}-${index}`} />;
          }
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
              selected={false}
              can="none"
              disabled
              onSelect={() => undefined}
            />
          );
        })}
      </div>
      {side === 'you' ? (
        <div className="play-plates" data-testid="play-plates">
          {Array.from({ length: 6 }, (_, slot) => {
            const plate = view.yourPlates[slot];
            if (plate === undefined) {
              return <div key={`plate-empty-${slot}`} className="play-plate is-empty" />;
            }
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
      ) : (
        <p className="play-hidden-plates" data-testid="opponent-plates">
          Rival plates · {view.opponentPlates.unused} facedown
        </p>
      )}
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
  selected,
  can,
  disabled,
  onSelect,
}: {
  readonly engine: Engine;
  readonly figure: FigureState;
  readonly selected: boolean;
  readonly can: 'deploy' | 'act' | 'none';
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  const name = figureName(engine, figure);
  const mp = figureMp(engine, figure);
  const printed = figureOfContent(engine, figure.figureId);
  const badges = conditionLabel(figure);
  return (
    <button
      type="button"
      className="play-disc"
      data-testid={`figure-${figure.uid}`}
      data-can={can}
      data-owner={figure.owner}
      data-selected={selected ? '1' : '0'}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className={`play-seat-mark play-seat-${figure.owner === 0 ? 'circle' : 'square'}`} aria-hidden="true">
        {figure.owner === 0 ? 'A' : 'B'}
      </span>
      <FigureSprite url={figureSpriteUrl(engine, figure.figureId)} name={name} />
      <strong>{name}</strong>
      <span className="play-mp">MP {mp}</span>
      {printed !== null ? <span className="play-type">{printed.types.join('/')}</span> : null}
      {badges.length > 0 ? <span className="play-badges">{badges.join(' · ')}</span> : null}
    </button>
  );
}
