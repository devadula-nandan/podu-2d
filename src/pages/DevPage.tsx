import { coverageSummary } from '../engine/index.js';
import { App as DevApp } from '../ui/App.js';
import { SeedLink, useDuelSession } from '../ui/DuelSession.js';
import { SpriteAttribution } from '../ui/SpriteAttribution.js';
import { MoreMenu, ThemeToggle } from '../ui/theme.js';
import '../ui/dev-shell.css';

export function DevPage() {
  const session = useDuelSession();
  const coverage = session.engine === null ? null : coverageSummary(session.engine.registry);
  const mode = session.config === null ? 'decks' : session.config.mode === 'vsAi' ? 'vs AI' : 'hotseat';

  return (
    <div className="shell dev-shell">
      <div className="column dev-column">
        <header className="topbar dev-banner" data-testid="dev-banner">
          <div className="dev-banner-brand">
            <span className="dev-banner-mark" aria-hidden="true">
              DEV
            </span>
            <div className="dev-banner-titles">
              <h1 className="dev-title">Pokémon Duel</h1>
              <p className="dev-banner-kicker">debugger · {mode}</p>
            </div>
          </div>
          {coverage !== null ? (
            <div className="coverage" data-testid="coverage-line" title={coverage}>
              <div className="coverage-track">
                <p>{coverage}</p>
                <p aria-hidden="true">{coverage}</p>
              </div>
            </div>
          ) : null}
          <span className="dev-banner-actions">
            <SeedLink to="/3d" data-testid="dev-to-3d">
              Player table
            </SeedLink>
            {import.meta.env.BASE_URL !== '/' ? (
              <a href={`${import.meta.env.BASE_URL}storybook/`}>Storybook</a>
            ) : null}
            <MoreMenu>
              <ThemeToggle className="dev-theme-toggle" />
              <SpriteAttribution className="sprite-attrib" />
            </MoreMenu>
          </span>
        </header>
        <DevApp />
      </div>
    </div>
  );
}
