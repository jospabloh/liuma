import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Light/dark theme (module 10 of the portfolio standard) — separate from
// tenantTheme.js, which controls the per-school BRAND accent color, not
// light vs dark. tailwind.config.js already had darkMode:["class"] and
// index.css already had a complete .dark token palette (shadcn boilerplate)
// — neither was ever engaged before this.
//
// Resolution order: stored preference -> prefers-color-scheme -> light.
// index.html carries a matching inline pre-mount <script> with the SAME
// resolution logic, so the .dark class is applied before React hydrates
// (no flash of the wrong theme) -- keep both in sync by hand, each side
// comments the other.
const STORAGE_KEY = 'liuma-theme';

function resolveInitialTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) -- fall through.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const ThemeContext = createContext({ theme: 'light', toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(resolveInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Best-effort persistence only.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
