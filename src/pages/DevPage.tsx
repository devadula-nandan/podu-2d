import { coverageSummary } from '../engine/index.js';
import { App as DevApp } from '../ui/App.js';
import { SeedLink, useDuelSession } from '../ui/DuelSession.js';
import { MoreMenu, ThemeToggle } from '../ui/theme.js';

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
              <p className="dev-banner-kicker">Developer table · {mode}</p>
              <h1>Pokémon Duel</h1>
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
            <SeedLink to="/2d" data-testid="dev-to-2d">
              Player table
            </SeedLink>
            <MoreMenu>
              <ThemeToggle className="dev-theme-toggle" />
            </MoreMenu>
          </span>
        </header>
        <DevApp />
      </div>
    </div>
  );
}
