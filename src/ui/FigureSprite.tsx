import { useState } from 'react';
import { figureInitials } from '../content/sprites.js';

interface Props {
  readonly url: string | null;
  readonly name: string;
  readonly className?: string;
}

export function FigureSprite({ url, name, className }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;
  const classes = ['figure-sprite', className].filter((part) => part !== undefined && part !== '').join(' ');

  if (!showImage) {
    return (
      <span className={`${classes} is-fallback`} aria-hidden="true">
        {figureInitials(name)}
      </span>
    );
  }

  return (
    <img
      className={classes}
      data-testid="figure-sprite"
      src={url}
      alt=""
      onError={() => {
        setFailedUrl(url);
      }}
    />
  );
}
