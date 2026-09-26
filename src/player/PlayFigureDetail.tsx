import { useEffect, useState } from 'react';
import type { Engine, FigureState } from '../engine/index.js';
import { figureOfContent } from '../ui/boot.js';
import { FigureSprite } from '../ui/FigureSprite.js';
import { FigureWheelBody } from '../ui/FigureWheelPopout.js';
import { conditionLabel, figureMp, figureName, figureSpriteUrlOf } from '../ui/model.js';

interface Props {
  readonly engine: Engine;
  readonly figure: FigureState;
  readonly you: 0 | 1;
  readonly onClose: () => void;
}

function zoneLabel(zone: FigureState['zone']): string {
  switch (zone) {
    case 'field':
      return 'On the field';
    case 'bench':
      return 'Bench';
    case 'pc':
      return 'P.C.';
    case 'excluded':
      return 'Excluded';
    case 'ultraSpace':
      return 'Ultra Space';
  }
}

export function PlayFigureDetail({ engine, figure, you, onClose }: Props) {
  const [swapped, setSwapped] = useState(false);
  const printed = figureOfContent(engine, figure.figureId);
  const name = figureName(engine, figure);
  const mp = figureMp(engine, figure);
  const sprite = figureSpriteUrlOf(engine, figure);
  const mine = figure.owner === you;
  const statuses = conditionLabel(figure).filter((label) => !label.startsWith('Wait '));
  const zMoves = printed?.zMoves ?? [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="play-figure-detail"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} details`}
      data-testid="play-figure-detail"
      data-owner={mine ? 'you' : 'rival'}
      onClick={onClose}
    >
      <div
        className="pfd-sheet"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="pfd-top">
          <div className="pfd-identity">
            <span className="pfd-owner" data-owner={mine ? 'you' : 'rival'}>
              {mine ? 'You' : 'Rival'}
            </span>
            <h2 className="pfd-name">{name}</h2>
            <p className="pfd-meta">
              <span>MP {mp}</span>
              {printed !== null ? <span>{printed.types.join(' · ')}</span> : null}
              {printed !== null ? <span data-rarity={printed.rarity}>{printed.rarity}</span> : null}
              <span>{zoneLabel(figure.zone)}</span>
            </p>
          </div>
          <div className="pfd-actions">
            <button
              type="button"
              className="pfd-swap"
              data-testid="play-figure-detail-swap"
              aria-pressed={swapped}
              aria-label={swapped ? 'Show figure on the left' : 'Swap figure and wheel'}
              onClick={() => {
                setSwapped((prev) => !prev);
              }}
            >
              Swap
            </button>
            <button type="button" className="pfd-close" data-testid="play-figure-detail-close" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className={`pfd-body${swapped ? ' is-swapped' : ''}`}>
          <aside className="pfd-aside">
            <div className="pfd-token" data-owner={mine ? 'you' : 'rival'} data-rarity={printed?.rarity}>
              <span className="pfd-token-ring" aria-hidden="true" />
              <span className="pfd-token-art">
                <FigureSprite url={sprite} name={name} />
              </span>
              <span className="pfd-token-mp">MP {mp}</span>
            </div>

            {(statuses.length > 0 || figure.wait > 0) && (
              <ul className="pfd-status">
                {figure.wait > 0 ? <li data-kind="wait">Wait {figure.wait}</li> : null}
                {statuses.map((label) => (
                  <li key={label} data-kind="condition">
                    {label}
                  </li>
                ))}
              </ul>
            )}

            <section className="pfd-ability">
              <h3>Ability</h3>
              {printed?.ability !== null && printed?.ability !== undefined ? (
                <>
                  <p className="pfd-ability-name">{printed.ability.name}</p>
                  <p className="pfd-ability-text">{printed.ability.text}</p>
                </>
              ) : (
                <p className="pfd-ability-text pfd-muted">No ability.</p>
              )}
            </section>

            {zMoves.length > 0 ? (
              <section className="pfd-z">
                <h3>Z-Move{zMoves.length > 1 ? 's' : ''}</h3>
                <ul>
                  {zMoves.map((z, index) => (
                    <li key={`${z.moveName}-${index}`}>
                      <strong>{z.moveName}</strong>
                      <span>
                        {z.color}
                        {z.damage === null
                          ? ''
                          : z.damage.kind === 'stars'
                            ? ` · ${z.damage.stars}★`
                            : z.damage.kind === 'multiplier'
                              ? ` · ${z.damage.base}×`
                              : z.damage.kind === 'variable'
                                ? ` · ${z.damage.base}+`
                                : ` · ${z.damage.base}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>

          <section className="pfd-wheel" aria-label="Battle wheel">
            <h3>Battle wheel</h3>
            {printed !== null ? (
              <FigureWheelBody figure={printed} />
            ) : (
              <p className="pfd-muted">Figure data unavailable.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
