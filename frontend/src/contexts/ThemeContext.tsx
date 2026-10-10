'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { darkTheme, getThemeByName, ALL_THEMES, type Theme } from '@/lib/theme';

interface ThemeContextValue {
  theme: Theme;
  themeName: string;
  setTheme: (name: string) => void;
  availableThemes: { name: string; label: string }[];
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  themeName: 'dark',
  setTheme: () => {},
  availableThemes: [],
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<string>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      return localStorage.getItem('tto-theme') || 'dark';
    } catch {
      return 'dark';
    }
  });

  const setTheme = useCallback((name: string) => {
    setThemeName(name);
    try { localStorage.setItem('tto-theme', name); } catch {}
  }, []);

  const theme = getThemeByName(themeName);

  // Synchronize CSS variables and root document attributes live
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', theme.name);
    root.style.setProperty('--bg', theme.colors.bg.primary);
    root.style.setProperty('--panel', theme.colors.bg.secondary);
    root.style.setProperty('--border', theme.colors.border.primary);
    root.style.setProperty('--text', theme.colors.text.primary);
    root.style.setProperty('--muted', theme.colors.text.muted);
    root.style.setProperty('--accent', theme.colors.accent.primary);
    root.style.colorScheme = theme.name === 'Paper' ? 'light' : 'dark';
    document.body.style.background = theme.colors.bg.primary;
    document.body.style.color = theme.colors.text.primary;
  }, [theme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeName,
        setTheme,
        availableThemes: ALL_THEMES.map((t) => ({ name: t.name, label: t.name })),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
