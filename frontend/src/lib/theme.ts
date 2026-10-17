'use client';

import { type CSSProperties } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// tto Design System — ZERO CSS. Every style is a plain object.
// Theme switching swaps the entire object at the <AppProvider> level.
// ═══════════════════════════════════════════════════════════════════════════

export interface ThemeColors {
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    elevated: string;
    hover: string;
    active: string;
    overlay: string;
    input: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    inverse: string;
    accent: string;
    link: string;
  };
  accent: { primary: string; hover: string; light: string; dark: string };
  success: { primary: string; light: string; dark: string };
  warning: { primary: string; light: string; dark: string };
  danger: { primary: string; light: string; dark: string };
  info: { primary: string; light: string };
  border: { primary: string; secondary: string; focus: string; subtle: string };
}

export interface Theme {
  name: string;
  label?: string;
  mode?: 'dark' | 'light';
  category?: 'professional' | 'creative' | 'light' | 'custom';
  colors: ThemeColors;
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string; xxl: string; xxxl: string };
  fontSize: { xxxs: string; xxs: string; xs: string; sm: string; md: string; lg: string; xl: string; xxl: string; xxxl: string };
  fontWeight: { normal: string; medium: string; semibold: string; bold: string };
  borderRadius: { none: string; sm: string; md: string; lg: string; xl: string; xxl: string; full: string };
  fontFamily: { mono: string; sans: string };
  shadow: { sm: string; md: string; lg: string; xl: string; glow: string };
  transition: { fast: string; normal: string; slow: string };
  zIndex: { base: string; sidebar: string; dropdown: string; modal: string; toast: string; overlay: string; inspector: string };
  layout: {
    sidebarWidth: string;
    topbarHeight: string;
    statusbarHeight: string;
    splitMinLeft: string;
    splitMinRight: string;
  };
}

export function isLightTheme(t: Theme): boolean {
  if (t.mode) return t.mode === 'light';
  return t.name === 'Paper' || t.name === 'Solarized Light';
}

// ── Dark theme (default) ──────────────────────────────────────────────
export const darkTheme: Theme = {
  name: 'dark',
  label: 'Dark (Default)',
  mode: 'dark',
  category: 'professional',
  colors: {
    bg: {
      primary: '#0a0a0a',
      secondary: '#111111',
      tertiary: '#1a1a1a',
      elevated: '#1e1e1e',
      hover: '#252525',
      active: '#2a2a2a',
      overlay: 'rgba(0,0,0,0.7)',
      input: '#161616',
    },
    text: {
      primary: '#e8e8e8',
      secondary: '#999999',
      muted: '#555555',
      inverse: '#0a0a0a',
      accent: '#4a9eff',
      link: '#60a5fa',
    },
    accent: { primary: '#4a9eff', hover: '#3b8de6', light: 'rgba(74,158,255,0.12)', dark: '#2563eb' },
    success: { primary: '#22c55e', light: 'rgba(34,197,94,0.12)', dark: '#16a34a' },
    warning: { primary: '#f59e0b', light: 'rgba(245,158,11,0.12)', dark: '#d97706' },
    danger: { primary: '#ef4444', light: 'rgba(239,68,68,0.12)', dark: '#dc2626' },
    info: { primary: '#3b82f6', light: 'rgba(59,130,246,0.12)' },
    border: { primary: '#2a2a2a', secondary: '#1e1e1e', focus: '#4a9eff', subtle: '#181818' },
  },
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', xxl: '32px', xxxl: '48px' },
  fontSize: { xxxs: '9px', xxs: '10px', xs: '11px', sm: '12px', md: '13px', lg: '14px', xl: '16px', xxl: '20px', xxxl: '24px' },
  fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
  borderRadius: { none: '0', sm: '4px', md: '6px', lg: '8px', xl: '12px', xxl: '16px', full: '9999px' },
  fontFamily: {
    mono: '"SF Mono", "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, "Liberation Mono", monospace',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.3)',
    md: '0 4px 12px rgba(0,0,0,0.4)',
    lg: '0 8px 24px rgba(0,0,0,0.5)',
    xl: '0 16px 48px rgba(0,0,0,0.6)',
    glow: '0 0 20px rgba(74,158,255,0.15)',
  },
  transition: { fast: '0.1s ease', normal: '0.2s ease', slow: '0.3s ease' },
  zIndex: { base: '1', sidebar: '100', dropdown: '200', modal: '500', toast: '600', overlay: '400', inspector: '700' },
  layout: { sidebarWidth: '300px', topbarHeight: '44px', statusbarHeight: '28px', splitMinLeft: '320px', splitMinRight: '280px' },
};

// ── Professional themes ───────────────────────────────────────────────

export const githubDarkTheme: Theme = {
  ...darkTheme,
  name: 'GitHub Dark',
  label: 'GitHub Dark',
  mode: 'dark',
  category: 'professional',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#0d1117',
      secondary: '#161b22',
      tertiary: '#21262d',
      elevated: '#30363d',
      hover: '#292e36',
      active: '#30363d',
      overlay: 'rgba(1,4,9,0.8)',
      input: '#0d1117',
    },
    text: {
      primary: '#c9d1d9',
      secondary: '#8b949e',
      muted: '#6e7681',
      inverse: '#0d1117',
      accent: '#58a6ff',
      link: '#58a6ff',
    },
    accent: { primary: '#58a6ff', hover: '#4094f7', light: 'rgba(88,166,255,0.15)', dark: '#1f6feb' },
    success: { primary: '#3fb950', light: 'rgba(63,185,80,0.15)', dark: '#238636' },
    warning: { primary: '#d29922', light: 'rgba(210,153,34,0.15)', dark: '#9e6a03' },
    danger: { primary: '#f85149', light: 'rgba(248,81,73,0.15)', dark: '#da3633' },
    info: { primary: '#58a6ff', light: 'rgba(88,166,255,0.15)' },
    border: { primary: '#30363d', secondary: '#21262d', focus: '#58a6ff', subtle: '#21262d' },
  },
};

export const draculaTheme: Theme = {
  ...darkTheme,
  name: 'Dracula',
  label: 'Dracula',
  mode: 'dark',
  category: 'professional',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#21222c',
      secondary: '#282a36',
      tertiary: '#343746',
      elevated: '#44475a',
      hover: '#3b3e4f',
      active: '#44475a',
      overlay: 'rgba(0,0,0,0.75)',
      input: '#1d1e26',
    },
    text: {
      primary: '#f8f8f2',
      secondary: '#a0a6cc',
      muted: '#6272a4',
      inverse: '#282a36',
      accent: '#bd93f9',
      link: '#8be9fd',
    },
    accent: { primary: '#bd93f9', hover: '#ab79f7', light: 'rgba(189,147,249,0.15)', dark: '#9d65f5' },
    success: { primary: '#50fa7b', light: 'rgba(80,250,123,0.15)', dark: '#2ecc71' },
    warning: { primary: '#f1fa8c', light: 'rgba(241,250,140,0.15)', dark: '#ffb86c' },
    danger: { primary: '#ff5555', light: 'rgba(255,85,85,0.15)', dark: '#e04040' },
    info: { primary: '#8be9fd', light: 'rgba(139,233,253,0.15)' },
    border: { primary: '#44475a', secondary: '#343746', focus: '#bd93f9', subtle: '#2d303e' },
  },
};

export const nordTheme: Theme = {
  ...darkTheme,
  name: 'Nord',
  label: 'Nord',
  mode: 'dark',
  category: 'professional',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#242933',
      secondary: '#2e3440',
      tertiary: '#3b4252',
      elevated: '#434c5e',
      hover: '#3d4556',
      active: '#434c5e',
      overlay: 'rgba(0,0,0,0.7)',
      input: '#1e222a',
    },
    text: {
      primary: '#eceff4',
      secondary: '#d8dee9',
      muted: '#7b88a1',
      inverse: '#2e3440',
      accent: '#88c0d0',
      link: '#81a1c1',
    },
    accent: { primary: '#88c0d0', hover: '#7eb6c6', light: 'rgba(136,192,208,0.15)', dark: '#5e81ac' },
    success: { primary: '#a3be8c', light: 'rgba(163,190,140,0.15)', dark: '#8fbcbb' },
    warning: { primary: '#ebcb8b', light: 'rgba(235,203,139,0.15)', dark: '#d08770' },
    danger: { primary: '#bf616a', light: 'rgba(191,97,106,0.15)', dark: '#ab4e57' },
    info: { primary: '#81a1c1', light: 'rgba(129,161,193,0.15)' },
    border: { primary: '#3b4252', secondary: '#2e3440', focus: '#88c0d0', subtle: '#2a303c' },
  },
};

export const oneDarkTheme: Theme = {
  ...darkTheme,
  name: 'One Dark Pro',
  label: 'One Dark Pro',
  mode: 'dark',
  category: 'professional',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#21252b',
      secondary: '#282c34',
      tertiary: '#2f343f',
      elevated: '#3e4451',
      hover: '#353b45',
      active: '#3e4451',
      overlay: 'rgba(0,0,0,0.7)',
      input: '#1d2026',
    },
    text: {
      primary: '#abb2bf',
      secondary: '#828997',
      muted: '#5c6370',
      inverse: '#21252b',
      accent: '#61afef',
      link: '#56b6c2',
    },
    accent: { primary: '#61afef', hover: '#4fa1e0', light: 'rgba(97,175,239,0.15)', dark: '#4078f2' },
    success: { primary: '#98c379', light: 'rgba(152,195,121,0.15)', dark: '#7cb35b' },
    warning: { primary: '#e5c07b', light: 'rgba(229,192,123,0.15)', dark: '#d19a66' },
    danger: { primary: '#e06c75', light: 'rgba(224,108,117,0.15)', dark: '#be5046' },
    info: { primary: '#56b6c2', light: 'rgba(86,182,194,0.15)' },
    border: { primary: '#3e4451', secondary: '#2f343f', focus: '#61afef', subtle: '#282c34' },
  },
};

export const monokaiProTheme: Theme = {
  ...darkTheme,
  name: 'Monokai Pro',
  label: 'Monokai Pro',
  mode: 'dark',
  category: 'professional',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#19181a',
      secondary: '#221f22',
      tertiary: '#2d2a2e',
      elevated: '#3a383b',
      hover: '#343135',
      active: '#3a383b',
      overlay: 'rgba(0,0,0,0.7)',
      input: '#161517',
    },
    text: {
      primary: '#fcfcfa',
      secondary: '#939293',
      muted: '#727072',
      inverse: '#19181a',
      accent: '#ffd866',
      link: '#78dce8',
    },
    accent: { primary: '#ffd866', hover: '#f5cb51', light: 'rgba(255,216,102,0.15)', dark: '#e0b536' },
    success: { primary: '#a9dc76', light: 'rgba(169,220,118,0.15)', dark: '#8cbd58' },
    warning: { primary: '#fc9867', light: 'rgba(252,152,103,0.15)', dark: '#e07d4c' },
    danger: { primary: '#ff6188', light: 'rgba(255,97,136,0.15)', dark: '#de436a' },
    info: { primary: '#78dce8', light: 'rgba(120,220,232,0.15)' },
    border: { primary: '#403e41', secondary: '#2d2a2e', focus: '#ffd866', subtle: '#252326' },
  },
};

export const solarizedDarkTheme: Theme = {
  ...darkTheme,
  name: 'Solarized Dark',
  label: 'Solarized Dark',
  mode: 'dark',
  category: 'professional',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#00212b',
      secondary: '#002b36',
      tertiary: '#073642',
      elevated: '#0d4352',
      hover: '#09404f',
      active: '#0d4352',
      overlay: 'rgba(0,18,24,0.75)',
      input: '#001b24',
    },
    text: {
      primary: '#93a1a1',
      secondary: '#839496',
      muted: '#586e75',
      inverse: '#002b36',
      accent: '#268bd2',
      link: '#2aa198',
    },
    accent: { primary: '#268bd2', hover: '#1e75b3', light: 'rgba(38,139,210,0.15)', dark: '#185b8c' },
    success: { primary: '#859900', light: 'rgba(133,153,0,0.15)', dark: '#687800' },
    warning: { primary: '#b58900', light: 'rgba(181,137,0,0.15)', dark: '#8f6c00' },
    danger: { primary: '#dc322f', light: 'rgba(220,50,47,0.15)', dark: '#ad2422' },
    info: { primary: '#2aa198', light: 'rgba(42,161,152,0.15)' },
    border: { primary: '#073642', secondary: '#052b35', focus: '#268bd2', subtle: '#04222a' },
  },
};

export const solarizedLightTheme: Theme = {
  ...darkTheme,
  name: 'Solarized Light',
  label: 'Solarized Light',
  mode: 'light',
  category: 'light',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#fdf6e3',
      secondary: '#eee8d5',
      tertiary: '#e4dcba',
      elevated: '#fcf7e8',
      hover: '#e3dac0',
      active: '#d8ceb0',
      overlay: 'rgba(0,0,0,0.35)',
      input: '#ffffff',
    },
    text: {
      primary: '#657b83',
      secondary: '#586e75',
      muted: '#93a1a1',
      inverse: '#fdf6e3',
      accent: '#268bd2',
      link: '#2aa198',
    },
    accent: { primary: '#268bd2', hover: '#1e75b3', light: 'rgba(38,139,210,0.12)', dark: '#185b8c' },
    success: { primary: '#859900', light: 'rgba(133,153,0,0.12)', dark: '#687800' },
    warning: { primary: '#b58900', light: 'rgba(181,137,0,0.12)', dark: '#8f6c00' },
    danger: { primary: '#dc322f', light: 'rgba(220,50,47,0.12)', dark: '#ad2422' },
    info: { primary: '#2aa198', light: 'rgba(42,161,152,0.12)' },
    border: { primary: '#d3cbb7', secondary: '#dfd7c2', focus: '#268bd2', subtle: '#e8e1cb' },
  },
};

export const slateTheme: Theme = {
  ...darkTheme,
  name: 'Slate',
  label: 'Slate Executive',
  mode: 'dark',
  category: 'professional',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#0b0f19',
      secondary: '#111827',
      tertiary: '#1f2937',
      elevated: '#374151',
      hover: '#263345',
      active: '#374151',
      overlay: 'rgba(2,6,23,0.8)',
      input: '#0e1524',
    },
    text: {
      primary: '#f3f4f6',
      secondary: '#cbd5e1',
      muted: '#94a3b8',
      inverse: '#0b0f19',
      accent: '#38bdf8',
      link: '#60a5fa',
    },
    accent: { primary: '#38bdf8', hover: '#0ea5e9', light: 'rgba(56,189,248,0.15)', dark: '#0284c7' },
    success: { primary: '#10b981', light: 'rgba(16,185,129,0.15)', dark: '#059669' },
    warning: { primary: '#f59e0b', light: 'rgba(245,158,11,0.15)', dark: '#d97706' },
    danger: { primary: '#ef4444', light: 'rgba(239,68,68,0.15)', dark: '#dc2626' },
    info: { primary: '#38bdf8', light: 'rgba(56,189,248,0.15)' },
    border: { primary: '#1f2937', secondary: '#182232', focus: '#38bdf8', subtle: '#141d2b' },
  },
};

export const emeraldTheme: Theme = {
  ...darkTheme,
  name: 'Emerald Studio',
  label: 'Emerald Studio',
  mode: 'dark',
  category: 'professional',
  colors: {
    ...darkTheme.colors,
    bg: {
      primary: '#071510',
      secondary: '#0d211a',
      tertiary: '#143329',
      elevated: '#1c4437',
      hover: '#1a3e32',
      active: '#1c4437',
      overlay: 'rgba(1,10,7,0.8)',
      input: '#091c15',
    },
    text: {
      primary: '#ecfdf5',
      secondary: '#a7f3d0',
      muted: '#6ee7b7',
      inverse: '#071510',
      accent: '#10b981',
      link: '#34d399',
    },
    accent: { primary: '#10b981', hover: '#059669', light: 'rgba(16,185,129,0.15)', dark: '#047857' },
    success: { primary: '#10b981', light: 'rgba(16,185,129,0.15)', dark: '#059669' },
    warning: { primary: '#f59e0b', light: 'rgba(245,158,11,0.15)', dark: '#d97706' },
    danger: { primary: '#ef4444', light: 'rgba(239,68,68,0.15)', dark: '#dc2626' },
    info: { primary: '#2dd4bf', light: 'rgba(45,212,191,0.15)' },
    border: { primary: '#1e4a3b', secondary: '#143329', focus: '#10b981', subtle: '#102920' },
  },
};

// ── Creative & Light themes ───────────────────────────────────────────

export const neonTokyoTheme: Theme = {
  ...darkTheme,
  name: 'Neon Tokyo',
  label: 'Neon Tokyo',
  mode: 'dark',
  category: 'creative',
  colors: {
    ...darkTheme.colors,
    accent: { primary: '#ff2d95', hover: '#e62788', light: 'rgba(255,45,149,0.15)', dark: '#cc1a75' },
    border: { ...darkTheme.colors.border, primary: '#2d1f3d', subtle: '#1a1225', focus: '#ff2d95' },
    bg: { ...darkTheme.colors.bg, primary: '#0d0221', secondary: '#12052e', tertiary: '#1a0a3e', elevated: '#240f50', hover: '#250f4a', active: '#2c1458', input: '#100326' },
  },
};

export const synthwaveTheme: Theme = {
  ...darkTheme,
  name: 'Synthwave',
  label: 'Synthwave',
  mode: 'dark',
  category: 'creative',
  colors: {
    ...darkTheme.colors,
    accent: { primary: '#f72585', hover: '#d91e75', light: 'rgba(247,37,133,0.15)', dark: '#b51565' },
    text: { ...darkTheme.colors.text, accent: '#f72585', link: '#ff6ec7' },
    bg: { ...darkTheme.colors.bg, primary: '#1a0a2e', secondary: '#240f42', tertiary: '#2e1455', elevated: '#3d1a70', hover: '#371866', active: '#3d1a70', input: '#1e0c35' },
    border: { ...darkTheme.colors.border, primary: '#3d1d6a', subtle: '#260e44', focus: '#f72585' },
  },
};

export const paperTheme: Theme = {
  ...darkTheme,
  name: 'Paper',
  label: 'Paper (Light)',
  mode: 'light',
  category: 'light',
  colors: {
    ...darkTheme.colors,
    bg: { primary: '#ffffff', secondary: '#f8f9fa', tertiary: '#f0f1f3', elevated: '#ffffff', hover: '#f0f1f3', active: '#e8e9eb', overlay: 'rgba(0,0,0,0.4)', input: '#ffffff' },
    text: { primary: '#1a1a1a', secondary: '#555555', muted: '#999999', inverse: '#ffffff', accent: '#2563eb', link: '#2563eb' },
    border: { primary: '#dee2e6', secondary: '#e9ecef', focus: '#2563eb', subtle: '#f0f1f3' },
  },
};

// ── Customizable Theme Engine ─────────────────────────────────────────

export interface CustomThemeConfig {
  baseMode: 'dark' | 'light';
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgElevated: string;
  accent: string;
  textPrimary: string;
  textMuted: string;
  border: string;
}

export const DEFAULT_CUSTOM_THEME_CONFIG: CustomThemeConfig = {
  baseMode: 'dark',
  bgPrimary: '#0f111a',
  bgSecondary: '#161926',
  bgTertiary: '#1f2436',
  bgElevated: '#2a3149',
  accent: '#7c3aed',
  textPrimary: '#f1f5f9',
  textMuted: '#94a3b8',
  border: '#282f45',
};

export interface CustomPreset {
  id: string;
  label: string;
  config: CustomThemeConfig;
}

export const CUSTOM_THEME_PRESETS: CustomPreset[] = [
  {
    id: 'cyber-amber',
    label: 'Cyber Amber',
    config: {
      baseMode: 'dark',
      bgPrimary: '#0a0908',
      bgSecondary: '#14120e',
      bgTertiary: '#1f1b15',
      bgElevated: '#2d271e',
      accent: '#f59e0b',
      textPrimary: '#fef3c7',
      textMuted: '#b45309',
      border: '#332a1e',
    },
  },
  {
    id: 'deep-ocean',
    label: 'Deep Ocean',
    config: {
      baseMode: 'dark',
      bgPrimary: '#030c1b',
      bgSecondary: '#071730',
      bgTertiary: '#0d254c',
      bgElevated: '#14356b',
      accent: '#06b6d4',
      textPrimary: '#e0f2fe',
      textMuted: '#38bdf8',
      border: '#113366',
    },
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    config: {
      baseMode: 'dark',
      bgPrimary: '#191724',
      bgSecondary: '#1f1d2e',
      bgTertiary: '#26233a',
      bgElevated: '#312f44',
      accent: '#eb6f92',
      textPrimary: '#e0def4',
      textMuted: '#908caa',
      border: '#393552',
    },
  },
  {
    id: 'royal-amethyst',
    label: 'Royal Amethyst',
    config: {
      baseMode: 'dark',
      bgPrimary: '#120b22',
      bgSecondary: '#1a1130',
      bgTertiary: '#251944',
      bgElevated: '#34235e',
      accent: '#a855f7',
      textPrimary: '#f3e8ff',
      textMuted: '#c084fc',
      border: '#372361',
    },
  },
  {
    id: 'warm-coffee',
    label: 'Warm Espresso',
    config: {
      baseMode: 'dark',
      bgPrimary: '#140f0c',
      bgSecondary: '#1e1713',
      bgTertiary: '#2b211b',
      bgElevated: '#3d2f27',
      accent: '#d97706',
      textPrimary: '#fef3c7',
      textMuted: '#a87955',
      border: '#3b2c23',
    },
  },
  {
    id: 'matrix-hacker',
    label: 'Matrix Hacker',
    config: {
      baseMode: 'dark',
      bgPrimary: '#040d07',
      bgSecondary: '#08170d',
      bgTertiary: '#0f2415',
      bgElevated: '#173620',
      accent: '#22c55e',
      textPrimary: '#bbf7d0',
      textMuted: '#4ade80',
      border: '#144021',
    },
  },
  {
    id: 'clean-slate-light',
    label: 'Clean Slate Light',
    config: {
      baseMode: 'light',
      bgPrimary: '#f8fafc',
      bgSecondary: '#f1f5f9',
      bgTertiary: '#e2e8f0',
      bgElevated: '#ffffff',
      accent: '#2563eb',
      textPrimary: '#0f172a',
      textMuted: '#64748b',
      border: '#cbd5e1',
    },
  },
];

export function buildCustomTheme(cfg: CustomThemeConfig): Theme {
  const isLight = cfg.baseMode === 'light';
  return {
    ...darkTheme,
    name: 'Custom',
    label: 'Custom Theme',
    mode: cfg.baseMode,
    category: 'custom',
    colors: {
      ...darkTheme.colors,
      bg: {
        primary: cfg.bgPrimary,
        secondary: cfg.bgSecondary,
        tertiary: cfg.bgTertiary,
        elevated: cfg.bgElevated,
        hover: cfg.bgTertiary,
        active: cfg.bgElevated,
        overlay: isLight ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.75)',
        input: isLight ? '#ffffff' : cfg.bgPrimary,
      },
      text: {
        primary: cfg.textPrimary,
        secondary: cfg.textMuted,
        muted: cfg.textMuted,
        inverse: isLight ? '#ffffff' : '#0a0a0a',
        accent: cfg.accent,
        link: cfg.accent,
      },
      accent: {
        primary: cfg.accent,
        hover: cfg.accent,
        light: `${cfg.accent}26`,
        dark: cfg.accent,
      },
      border: {
        primary: cfg.border,
        secondary: cfg.border,
        focus: cfg.accent,
        subtle: cfg.border,
      },
    },
  };
}

// ── All themes registry ───────────────────────────────────────────────

export const ALL_THEMES: Theme[] = [
  darkTheme,
  githubDarkTheme,
  draculaTheme,
  nordTheme,
  oneDarkTheme,
  monokaiProTheme,
  solarizedDarkTheme,
  slateTheme,
  emeraldTheme,
  neonTokyoTheme,
  synthwaveTheme,
  solarizedLightTheme,
  paperTheme,
];

export function getThemeByName(name: string, customConfig?: CustomThemeConfig): Theme {
  if (name === 'Custom' || name === 'custom') {
    return buildCustomTheme(customConfig || DEFAULT_CUSTOM_THEME_CONFIG);
  }
  return ALL_THEMES.find((t) => t.name === name) || darkTheme;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT STYLE FACTORIES
// Every function returns a CSSProperties object. Zero CSS files.
// ═══════════════════════════════════════════════════════════════════════════

// ── Buttons ───────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

export const buttonBase = (t: Theme): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: t.spacing.xs,
  border: 'none',
  borderRadius: t.borderRadius.md,
  fontFamily: t.fontFamily.sans,
  fontWeight: t.fontWeight.medium,
  cursor: 'pointer',
  transition: `all ${t.transition.fast}`,
  whiteSpace: 'nowrap' as const,
  userSelect: 'none' as const,
  outline: 'none',
});

export const buttonSize = (t: Theme, size: ButtonSize): CSSProperties => {
  const map: Record<ButtonSize, CSSProperties> = {
    sm: { padding: `4px ${t.spacing.md}`, fontSize: t.fontSize.xs, height: '28px' },
    md: { padding: `6px ${t.spacing.lg}`, fontSize: t.fontSize.sm, height: '32px' },
    lg: { padding: `8px ${t.spacing.xl}`, fontSize: t.fontSize.md, height: '38px' },
  };
  return map[size];
};

export const buttonVariant = (t: Theme, variant: ButtonVariant): CSSProperties => {
  const map: Record<ButtonVariant, CSSProperties> = {
    primary: { background: t.colors.accent.primary, color: t.colors.text.inverse },
    secondary: { background: t.colors.bg.tertiary, color: t.colors.text.primary, border: `1px solid ${t.colors.border.primary}` },
    ghost: { background: 'transparent', color: t.colors.text.secondary },
    danger: { background: t.colors.danger.primary, color: '#ffffff' },
    success: { background: t.colors.success.primary, color: '#ffffff' },
  };
  return map[variant];
};

// ── Inputs ────────────────────────────────────────────────────────────

export const inputBase = (t: Theme): CSSProperties => ({
  background: t.colors.bg.input,
  border: `1px solid ${t.colors.border.primary}`,
  borderRadius: t.borderRadius.md,
  color: t.colors.text.primary,
  fontFamily: t.fontFamily.sans,
  fontSize: t.fontSize.sm,
  padding: `${t.spacing.sm} ${t.spacing.md}`,
  outline: 'none',
  transition: `border-color ${t.transition.fast}`,
  width: '100%',
  boxSizing: 'border-box' as const,
  height: '32px',
});

export const inputFocus = (t: Theme): CSSProperties => ({
  borderColor: t.colors.border.focus,
  boxShadow: `0 0 0 2px ${t.colors.accent.light}`,
});

// ── Select ────────────────────────────────────────────────────────────

export const selectBase = (t: Theme): CSSProperties => ({
  ...inputBase(t),
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: `right ${t.spacing.md} center`,
  paddingRight: `${t.spacing.xxl}`,
  height: '32px',
  cursor: 'pointer',
});

// ── Card ──────────────────────────────────────────────────────────────

export const cardBase = (t: Theme): CSSProperties => ({
  background: t.colors.bg.secondary,
  border: `1px solid ${t.colors.border.primary}`,
  borderRadius: t.borderRadius.lg,
  padding: t.spacing.lg,
});

// Alias for backward compatibility
export const cardStyle = cardBase;

// ── Panel ─────────────────────────────────────────────────────────────

export const panelBase = (t: Theme): CSSProperties => ({
  background: t.colors.bg.secondary,
  border: `1px solid ${t.colors.border.subtle}`,
  borderRadius: t.borderRadius.lg,
});

// ── Badge ─────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export const badgeBase = (t: Theme, variant: BadgeVariant = 'default'): CSSProperties => {
  const bgMap: Record<BadgeVariant, string> = {
    default: t.colors.bg.tertiary,
    success: t.colors.success.light,
    warning: t.colors.warning.light,
    danger: t.colors.danger.light,
    info: t.colors.info.light,
  };
  const fgMap: Record<BadgeVariant, string> = {
    default: t.colors.text.secondary,
    success: t.colors.success.primary,
    warning: t.colors.warning.primary,
    danger: t.colors.danger.primary,
    info: t.colors.info.primary,
  };
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: t.spacing.xs,
    padding: `2px ${t.spacing.sm}`,
    borderRadius: t.borderRadius.full,
    fontSize: t.fontSize.xs,
    fontWeight: t.fontWeight.medium,
    background: bgMap[variant],
    color: fgMap[variant],
    lineHeight: '1.4',
  };
};

// ── Tooltip / popover ─────────────────────────────────────────────────

export const tooltipBase = (t: Theme): CSSProperties => ({
  background: t.colors.bg.elevated,
  border: `1px solid ${t.colors.border.primary}`,
  borderRadius: t.borderRadius.md,
  padding: `${t.spacing.xs} ${t.spacing.sm}`,
  fontSize: t.fontSize.xs,
  color: t.colors.text.secondary,
  boxShadow: t.shadow.md,
  zIndex: t.zIndex.dropdown,
  pointerEvents: 'none' as const,
  whiteSpace: 'nowrap' as const,
});

// ── Scrollbar ─────────────────────────────────────────────────────────

export const scrollbarStyle = (t: Theme, vertical = true): CSSProperties => ({
  ...(vertical
    ? { overflowY: 'auto', overflowX: 'hidden' }
    : { overflowX: 'auto', overflowY: 'hidden' }),
  scrollbarWidth: 'thin' as any,
  scrollbarColor: `${t.colors.border.primary} transparent` as any,
});

// ── Dividers ──────────────────────────────────────────────────────────

export const dividerHorizontal = (t: Theme): CSSProperties => ({
  height: '1px',
  background: t.colors.border.primary,
  border: 'none',
  margin: `${t.spacing.sm} 0`,
});

export const dividerVertical = (t: Theme): CSSProperties => ({
  width: '1px',
  background: t.colors.border.primary,
  alignSelf: 'stretch',
});
