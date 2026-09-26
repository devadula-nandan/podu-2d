import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DuelSessionProvider } from './ui/DuelSession.js';
import { ThemeProvider } from './ui/theme.js';

const PlayPage = lazy(() => import('./player/PlayPage.js').then((m) => ({ default: m.PlayPage })));
const DevPage = lazy(() => import('./pages/DevPage.js').then((m) => ({ default: m.DevPage })));

function HomeRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/3d${search}`} replace />;
}

function RouteFallback() {
  return (
    <main className="shell play-shell" data-testid="route-loading">
      <div className="column play-column">
        <div className="play-boot">
          <h1>Pokémon Duel</h1>
          <p>Loading…</p>
        </div>
      </div>
    </main>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <DuelSessionProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/3d" element={<PlayPage />} />
            <Route path="/dev" element={<DevPage />} />
            <Route path="/2d" element={<HomeRedirect />} />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </Suspense>
      </DuelSessionProvider>
    </ThemeProvider>
  );
}
