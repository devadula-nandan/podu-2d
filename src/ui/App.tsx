import { DeckBuilder } from './DeckBuilder.js';
import { DuelScreen } from './DuelScreen.js';
import { useDuelSession } from './DuelSession.js';
import { formatSeed } from './model.js';

export function App() {
  const session = useDuelSession();

  if (session.booting) {
    return (
      <div className="app">
        <div className="boot" data-testid="boot-loading">
          <h2>Loading…</h2>
          <p className="note">Preparing figures, plates, and abilities.</p>
        </div>
      </div>
    );
  }

  if (session.bootError !== null || session.engine === null) {
    return (
      <div className="app">
        <div className="boot">
          <h2>Content failed to load</h2>
          <p className="note">{session.bootError ?? 'Engine missing.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-testid="app-ready">
      {session.duel === null ? (
        <DeckBuilder engine={session.engine} onStart={session.start} />
      ) : (
        <DuelScreen onRematch={session.rematch} onNewSeed={session.newSeed} onLeave={session.leave} />
      )}
      {session.config !== null ? (
        <p className="help session-seed">
          Playing seed {formatSeed(session.config.seed)}
          {session.config.mode === 'vsAi'
            ? ` · vs AI (${session.config.difficulty}, ${session.config.humanSeat === 0 ? 'You' : 'Rival'} at the bottom)`
            : ''}
          .
        </p>
      ) : null}
    </div>
  );
}
