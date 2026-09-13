import { useState } from 'react';
import { SeedLink, useDuelSession } from '../ui/DuelSession.js';
import { formatSeed } from '../ui/model.js';
import { MoreMenu, ThemeToggle } from '../ui/theme.js';
import { PlayDuel } from './PlayDuel.js';
import { PlaySetup } from './PlaySetup.js';
import { readSfxMuted, unlockSfx, writeSfxMuted } from './sfx.js';

export function PlayPage() {
  const session = useDuelSession();
  const [muted, setMuted] = useState(readSfxMuted);

  if (session.bootError !== null || session.engine === null) {
    return (
      <main className="shell play-shell" data-testid="play-ready">
        <div className="column play-column">
          <div className="play-boot">
            <h1>Pokémon Duel</h1>
            <p>{session.bootError ?? 'Engine missing.'}</p>
          </div>
        </div>
      </main>
    );
  }

  const seed = session.config?.seed ?? session.urlSeed;
  const live = session.duel !== null;

  return (
    <main className="shell play-shell" data-testid="play-ready" onPointerDown={unlockSfx}>
      <div className="column play-column">
        <nav className="topbar play-nav">
          <span className="play-brand">Duel</span>
          {seed !== null ? <span data-testid="play-seed">{formatSeed(seed)}</span> : null}
          <span className="play-nav-spacer" />
          <SeedLink to="/3d">3D soon</SeedLink>
          <SeedLink to="/dev">Dev</SeedLink>
          <MoreMenu>
            <ThemeToggle />
            <button
              type="button"
              data-testid="mute-toggle"
              onClick={() => {
                const next = !muted;
                setMuted(next);
                writeSfxMuted(next);
              }}
            >
              {muted ? 'Sound off' : 'Sound on'}
            </button>
          </MoreMenu>
        </nav>
        {live ? <PlayDuel muted={muted} /> : <PlaySetup engine={session.engine} onStart={session.start} />}
      </div>
    </main>
  );
}
