import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeName = 'dark' | 'light';

const STORAGE_KEY = 'podu-theme';

function readTheme(): ThemeName {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

interface ThemeApi {
  readonly theme: ThemeName;
  readonly toggle: () => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const initial = readTheme();
    if (typeof document !== 'undefined') applyTheme(initial);
    return initial;
  });

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo<ThemeApi>(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used under ThemeProvider');
  return value;
}

export function ThemeToggle({ className }: { readonly className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className={className} data-testid="theme-toggle" onClick={toggle}>
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

export function MoreMenu({ children }: { readonly children: ReactNode }) {
  return (
    <details className="more">
      <summary data-testid="more-menu" aria-label="More">
        ⋯
      </summary>
      <div className="more-panel">{children}</div>
    </details>
  );
}
