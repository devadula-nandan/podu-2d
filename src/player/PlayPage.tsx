import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { SeedLink, useDuelSession } from '../ui/DuelSession.js';
import { formatSeed } from '../ui/model.js';
import { SpriteAttribution } from '../ui/SpriteAttribution.js';
import { MoreMenu, ThemeToggle } from '../ui/theme.js';
import type { Table3dApi } from '../stage3d/Table3d.js';
import { PlaySettings, type MatchSettingsProps } from './PlaySettings.js';
import { PlaySetup } from './PlaySetup.js';
import { readSfxMuted, unlockSfx, writeSfxMuted } from './sfx.js';

const PlayDuel = lazy(() => import('./PlayDuel.js').then((m) => ({ default: m.PlayDuel })));

export function PlayPage() {
  const session = useDuelSession();
  const [muted, setMuted] = useState(readSfxMuted);
  const [match, setMatch] = useState<MatchSettingsProps | null>(null);
  const tableApiRef = useRef<Table3dApi | null>(null);
  const onMatchSettings = useCallback((next: MatchSettingsProps | null) => {
    setMatch(next);
  }, []);

  if (session.booting || session.bootError !== null || session.engine === null) {
    return (
      <main className="shell play-shell" data-testid="play-ready" data-booting={session.booting ? '1' : '0'}>
        <div className="column play-column">
          <div className="play-boot" data-testid="play-boot">
            <h1>Pokémon Duel</h1>
            <p>{session.booting ? 'Loading duel field…' : (session.bootError ?? 'Engine missing.')}</p>
          </div>
        </div>
      </main>
    );
  }

  const seed = session.config?.seed ?? session.urlSeed;
  const live = session.duel !== null;

  return (
    <main className="shell play-shell" data-testid="play-ready" data-live={live ? '1' : '0'} onPointerDown={unlockSfx}>
      <div className="column play-column">
        <nav className="topbar play-nav">
          <span className="play-brand">Duel Field</span>
          {seed !== null ? <span data-testid="play-seed">{formatSeed(seed)}</span> : null}
          <span className="play-nav-spacer" />
          <SeedLink to="/dev">Dev</SeedLink>
          {import.meta.env.BASE_URL !== '/' ? (
            <a href={`${import.meta.env.BASE_URL}storybook/`}>Storybook</a>
          ) : null}
          {!live ? (
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
              <SpriteAttribution className="sprite-attrib" />
            </MoreMenu>
          ) : null}
        </nav>
        {live ? (
          <Suspense
            fallback={
              <div className="play-boot" data-testid="play-duel-loading">
                <h1>Pokémon Duel</h1>
                <p>Opening table…</p>
              </div>
            }
          >
            <PlayDuel muted={muted} tableApiRef={tableApiRef} onMatchSettings={onMatchSettings} />
          </Suspense>
        ) : (
          <PlaySetup engine={session.engine} onStart={session.start} />
        )}
      </div>
      <PlaySettings
        muted={muted}
        onMutedChange={(next) => {
          setMuted(next);
          writeSfxMuted(next);
        }}
        tableApiRef={tableApiRef}
        match={live ? match : null}
      />
    </main>
  );
}
