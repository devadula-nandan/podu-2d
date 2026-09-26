import { useEffect, useId, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Table3dApi } from '../stage3d/Table3d.js';
import { SeedLink } from '../ui/DuelSession.js';
import { useTheme, type ThemeName } from '../ui/theme.js';

export interface MatchSettingsProps {
  readonly lines?: readonly string[];
  readonly canConcede?: boolean;
  readonly onConcede?: () => void;
  readonly onLeave?: () => void;
}

interface Props {
  readonly muted: boolean;
  readonly onMutedChange: (muted: boolean) => void;
  readonly tableApiRef?: MutableRefObject<Table3dApi | null>;
  readonly match?: MatchSettingsProps | null;
}

const GEAR = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export function PlaySettings({ muted, onMutedChange, tableApiRef, match = null }: Props) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [camLocked, setCamLocked] = useState(false);
  const titleId = useId();
  const live = match !== null;

  useEffect(() => {
    tableApiRef?.current?.setWorldTheme(theme === 'light' ? 'light' : 'dark');
  }, [tableApiRef, theme]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pickTheme = (next: ThemeName): void => {
    setTheme(next);
    tableApiRef?.current?.setWorldTheme(next === 'light' ? 'light' : 'dark');
  };

  const toggleLock = (): void => {
    const next = !camLocked;
    setCamLocked(next);
    tableApiRef?.current?.setCameraLocked(next);
  };

  return (
    <>
      <button
        type="button"
        className="settings-btn"
        id="settings-btn"
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        data-testid="settings-btn"
        onClick={() => {
          setOpen(true);
        }}
      >
        {GEAR}
      </button>
      <div
        id="settings-dialog"
        className={`settings-dialog${open ? '' : ' hidden'}`}
        data-testid="settings-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="settings-top">
            <div className="settings-top-copy">
              <p className="settings-kicker">Duel Field</p>
              <h2 id={titleId}>Settings</h2>
            </div>
            <button
              type="button"
              className="settings-close"
              aria-label="Close"
              onClick={() => {
                setOpen(false);
              }}
            >
              ✕
            </button>
          </div>
          <div className="settings-body">
            <section className="settings-section">
              <h3>Appearance</h3>
              <div className="theme-switch" role="group" aria-label="Color theme">
                <ThemeOption
                  active={theme === 'dark'}
                  title="Arena night"
                  sub="Warm stone & copper — match board"
                  swatches={['#140e0a', '#e8a860', '#ff6b35']}
                  onClick={() => {
                    pickTheme('dark');
                  }}
                />
                <ThemeOption
                  active={theme === 'light'}
                  title="Daylight"
                  sub="Paper cream & clay accents"
                  swatches={['#f4ece3', '#c4783a', '#2a1c12']}
                  onClick={() => {
                    pickTheme('light');
                  }}
                />
              </div>
            </section>
            <section className="settings-section">
              <h3>Camera</h3>
              <div className="settings-camera-row" role="group" aria-label="Camera controls">
                <button
                  type="button"
                  className="settings-chip bgm-icon-btn"
                  title="Reset camera"
                  aria-label="Reset camera"
                  disabled={!live}
                  onClick={() => {
                    tableApiRef?.current?.resetCamera();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <path d="M3 4v5h5" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`settings-chip bgm-icon-btn${camLocked ? ' active is-locked' : ''}`}
                  title="Lock camera"
                  aria-label="Lock camera"
                  aria-pressed={camLocked}
                  disabled={!live}
                  onClick={toggleLock}
                >
                  <svg className="cam-lock-open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 7.5-1.8" />
                  </svg>
                  <svg className="cam-lock-closed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </button>
              </div>
              <p className="settings-hint">Reset returns to the default match view. Lock freezes orbit so drag won&apos;t move the camera.</p>
            </section>
            <section className="settings-section">
              <h3>Audio</h3>
              <div className="settings-camera-row" role="group" aria-label="Sound">
                <button
                  type="button"
                  className={`settings-chip${muted ? '' : ' active'}`}
                  data-testid="settings-mute"
                  onClick={() => {
                    onMutedChange(!muted);
                  }}
                >
                  {muted ? 'Sound off' : 'Sound on'}
                </button>
              </div>
              <p className="settings-hint">Battle and UI sound effects. Preference is saved on this device.</p>
            </section>
            <section className="settings-section">
              <h3>Development</h3>
              <div className="settings-camera-row" role="group" aria-label="Development">
                <SeedLink
                  to="/dev"
                  className="settings-chip"
                  data-testid="settings-dev"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Dev mode
                </SeedLink>
              </div>
              <p className="settings-hint">Opens the debugger with the same seed — undo, machine, and command tools.</p>
            </section>
            {live ? (
              <section className="settings-section">
                <h3>Match</h3>
                <div className="settings-camera-row" role="group" aria-label="Match controls">
                  <button
                    type="button"
                    className="settings-chip resign-btn"
                    title="Resign"
                    aria-label="Resign"
                    data-testid="settings-concede"
                    disabled={match?.canConcede === false}
                    onClick={() => {
                      match?.onConcede?.();
                      setOpen(false);
                    }}
                  >
                    Concede
                  </button>
                  <button
                    type="button"
                    className="settings-chip"
                    title="Leave table"
                    aria-label="Leave"
                    data-testid="leave"
                    onClick={() => {
                      match?.onLeave?.();
                      setOpen(false);
                    }}
                  >
                    Leave
                  </button>
                </div>
                <p className="settings-hint">Concede ends the match as a loss. Leave returns to setup without changing the recorded result.</p>
              </section>
            ) : null}
            {live ? (
              <section className="settings-section">
                <h3>Battle log</h3>
                <div className="settings-log" data-testid="settings-log">
                  {(match?.lines?.length ?? 0) === 0 ? (
                    <p className="settings-log-empty">No moves yet.</p>
                  ) : (
                    match?.lines?.map((line, index) => (
                      <p key={`${index}-${line}`} className="settings-log-line">
                        {line}
                      </p>
                    ))
                  )}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function ThemeOption({
  active,
  title,
  sub,
  swatches,
  onClick,
}: {
  readonly active: boolean;
  readonly title: string;
  readonly sub: string;
  readonly swatches: readonly string[];
  readonly onClick: () => void;
}): ReactNode {
  return (
    <button type="button" className={`theme-option${active ? ' active' : ''}`} onClick={onClick}>
      <span className="theme-option-title">{title}</span>
      <span className="theme-option-sub">{sub}</span>
      <span className="theme-swatches" aria-hidden="true">
        {swatches.map((color) => (
          <i key={color} style={{ background: color }} />
        ))}
      </span>
    </button>
  );
}
