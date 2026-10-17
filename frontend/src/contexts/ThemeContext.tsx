import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  darkTheme,
  getThemeByName,
  ALL_THEMES,
  isLightTheme,
  DEFAULT_CUSTOM_THEME_CONFIG,
  buildCustomTheme,
  type Theme,
  type ThemeColors,
  type CustomThemeConfig,
} from '@/lib/theme';

export interface ThemeMeta {
  name: string;
  label: string;
  mode?: 'dark' | 'light';
  category?: 'professional' | 'creative' | 'light' | 'custom';
  colors: ThemeColors;
}

interface ThemeContextValue {
  theme: Theme;
  themeName: string;
  setTheme: (name: string) => void;
  availableThemes: ThemeMeta[];
  customConfig: CustomThemeConfig;
  setCustomConfig: (update: Partial<CustomThemeConfig> | ((prev: CustomThemeConfig) => CustomThemeConfig)) => void;
  resetCustomConfig: () => void;
  isLight: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  themeName: 'dark',
  setTheme: () => {},
  availableThemes: [],
  customConfig: DEFAULT_CUSTOM_THEME_CONFIG,
  setCustomConfig: () => {},
  resetCustomConfig: () => {},
  isLight: false,
});

const CUSTOM_CONFIG_KEY = 'tto-custom-theme-config';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<string>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      return localStorage.getItem('tto-theme') || 'dark';
    } catch {
      return 'dark';
    }
  });

  const [customConfig, setCustomConfigState] = useState<CustomThemeConfig>(() => {
    if (typeof window === 'undefined') return DEFAULT_CUSTOM_THEME_CONFIG;
    try {
      const stored = localStorage.getItem(CUSTOM_CONFIG_KEY);
      if (stored) {
        return { ...DEFAULT_CUSTOM_THEME_CONFIG, ...JSON.parse(stored) };
      }
    } catch {}
    return DEFAULT_CUSTOM_THEME_CONFIG;
  });

  const setTheme = useCallback((name: string) => {
    setThemeName(name);
    try { localStorage.setItem('tto-theme', name); } catch {}
  }, []);

  const setCustomConfig = useCallback((update: Partial<CustomThemeConfig> | ((prev: CustomThemeConfig) => CustomThemeConfig)) => {
    setCustomConfigState((prev) => {
      const next = typeof update === 'function' ? update(prev) : { ...prev, ...update };
      try {
        localStorage.setItem(CUSTOM_CONFIG_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const resetCustomConfig = useCallback(() => {
    setCustomConfigState(DEFAULT_CUSTOM_THEME_CONFIG);
    try {
      localStorage.setItem(CUSTOM_CONFIG_KEY, JSON.stringify(DEFAULT_CUSTOM_THEME_CONFIG));
    } catch {}
  }, []);

  const theme = getThemeByName(themeName, customConfig);
  const isLight = isLightTheme(theme);

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
    root.style.colorScheme = isLight ? 'light' : 'dark';
    document.body.style.background = theme.colors.bg.primary;
    document.body.style.color = theme.colors.text.primary;
  }, [theme, isLight]);

  const customBuiltTheme = buildCustomTheme(customConfig);

  const availableThemes: ThemeMeta[] = [
    ...ALL_THEMES.map((t) => ({
      name: t.name,
      label: t.label || t.name,
      mode: t.mode || (isLightTheme(t) ? 'light' : 'dark'),
      category: t.category || 'professional',
      colors: t.colors,
    })),
    {
      name: 'Custom',
      label: 'Custom Theme',
      mode: customConfig.baseMode,
      category: 'custom',
      colors: customBuiltTheme.colors,
    },
  ];

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeName,
        setTheme,
        availableThemes,
        customConfig,
        setCustomConfig,
        resetCustomConfig,
        isLight,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
