import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ComingSoon3d } from './pages/ComingSoon3d.js';
import { DevPage } from './pages/DevPage.js';
import { PlayPage } from './player/PlayPage.js';
import { DuelSessionProvider } from './ui/DuelSession.js';
import { ThemeProvider } from './ui/theme.js';

function HomeRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/2d${search}`} replace />;
}

export function App() {
  return (
    <ThemeProvider>
      <DuelSessionProvider>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/2d" element={<PlayPage />} />
          <Route path="/dev" element={<DevPage />} />
          <Route path="/3d" element={<ComingSoon3d />} />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </DuelSessionProvider>
    </ThemeProvider>
  );
}
