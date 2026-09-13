import { SeedLink, useDuelSession } from '../ui/DuelSession.js';
import { formatSeed } from '../ui/model.js';

export function ComingSoon3d() {
  const session = useDuelSession();
  const seed = session.config?.seed ?? session.urlSeed;
  const live = session.duel !== null && session.config !== null;

  return (
    <main className="soon" data-testid="soon-3d">
      <p className="soon-kicker">Axis three</p>
      <h1>Coming soon</h1>
      <p className="soon-lede">
        The 28-point table stays the same. The camera will lift. There is no fake 3D canvas
        here — when the volumetric client ships, it will sit on the same engine as the 2D
        table.
      </p>
      {seed !== null ? (
        <p className="soon-meta" data-testid="soon-seed">
          Seed {formatSeed(seed)} ({seed >>> 0}).
        </p>
      ) : (
        <p className="soon-meta" data-testid="soon-seed">
          No seed in the URL yet.
        </p>
      )}
      {live ? (
        <p className="soon-meta" data-testid="soon-live">
          A live duel is in progress on this seed. Continue it on the 2D table or the
          developer client — this page only holds the session.
        </p>
      ) : (
        <p className="soon-meta" data-testid="soon-idle">
          No live duel. This page keeps the seed so a share URL still lines up.
        </p>
      )}
      <div className="soon-links">
        <SeedLink className="soon-primary" to="/2d">
          {live ? 'Back to the live 2D table' : 'Play on the 2D table'}
        </SeedLink>
        <SeedLink className="soon-ghost" to="/dev">
          Developer client
        </SeedLink>
      </div>
    </main>
  );
}
