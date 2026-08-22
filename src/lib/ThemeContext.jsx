import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Theme provider — module 10 of the portfolio standard.
 *
 * Three modes, not two: 'light' | 'dark' | 'system'. What gets stored is the
 * operator's *preference*; 'system' keeps resolving against the OS for as long
 * as it is selected, so a phone that turns dark at sunset turns the app dark
 * with it — no reload, no second setting to remember.
 *
 * `resolvedTheme` is the colour actually on screen. Read `mode` when you need
 * to know what the operator chose (that is what the corner switcher shows) and
 * `resolvedTheme` when you need to know what they are looking at.
 *
 * index.html carries a pre-mount copy of this same resolution so the very first
 * paint is already the right colour. The two are kept in sync by hand — both
 * sides carry a comment pointing at the other.
 */

const STORAGE_KEY = 'liuma-theme';
const MODES = ['light', 'dark', 'system'];

const ThemeContext = createContext({ mode: 'system', resolvedTheme: 'light', setMode: () => {} });

function readStoredMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Releases before the three-mode switcher stored a bare 'light'/'dark';
    // both are still valid preferences, so those users keep their choice.
    if (MODES.includes(stored)) return stored;
  } catch { /* private mode — fall through to following the device */ }
  return 'system';
}

function prefersDark() {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch { return false; }
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => (typeof window === 'undefined' ? 'system' : readStoredMode()));
  const [systemDark, setSystemDark] = useState(() => (typeof window === 'undefined' ? false : prefersDark()));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    // Keeps native controls (scrollbars, date pickers, form widgets) in step
    // with the page instead of staying stubbornly light.
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* private mode — preference is session-only */ }
  }, [mode]);

  const setMode = useCallback((next) => setModeState(MODES.includes(next) ? next : 'system'), []);

  const value = useMemo(() => ({ mode, resolvedTheme, setMode }), [mode, resolvedTheme, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
