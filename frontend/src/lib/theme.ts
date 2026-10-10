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

// ── Dark theme (default) ──────────────────────────────────────────────
export const darkTheme: Theme = {
  name: 'dark',
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

// ── Additional themes ─────────────────────────────────────────────────

export const neonTokyoTheme: Theme = {
  ...darkTheme,
  name: 'Neon Tokyo',
  colors: {
    ...darkTheme.colors,
    accent: { primary: '#ff2d95', hover: '#e62788', light: 'rgba(255,45,149,0.12)', dark: '#cc1a75' },
    border: { ...darkTheme.colors.border, primary: '#2d1f3d', subtle: '#1a1225' },
    bg: { ...darkTheme.colors.bg, primary: '#0d0221', secondary: '#12052e', tertiary: '#1a0a3e', hover: '#250f4a' },
  },
};

export const synthwaveTheme: Theme = {
  ...darkTheme,
  name: 'Synthwave',
  colors: {
    ...darkTheme.colors,
    accent: { primary: '#f72585', hover: '#d91e75', light: 'rgba(247,37,133,0.12)', dark: '#b51565' },
    text: { ...darkTheme.colors.text, accent: '#f72585', link: '#ff6ec7' },
    bg: { ...darkTheme.colors.bg, primary: '#1a0a2e', secondary: '#240f42', tertiary: '#2e1455' },
  },
};

export const paperTheme: Theme = {
  ...darkTheme,
  name: 'Paper',
  colors: {
    ...darkTheme.colors,
    bg: { primary: '#ffffff', secondary: '#f8f9fa', tertiary: '#f0f1f3', elevated: '#ffffff', hover: '#f0f1f3', active: '#e8e9eb', overlay: 'rgba(0,0,0,0.4)', input: '#ffffff' },
    text: { primary: '#1a1a1a', secondary: '#555555', muted: '#999999', inverse: '#ffffff', accent: '#2563eb', link: '#2563eb' },
    border: { primary: '#dee2e6', secondary: '#e9ecef', focus: '#2563eb', subtle: '#f0f1f3' },
  },
};

// ── All themes registry ───────────────────────────────────────────────

export const ALL_THEMES: Theme[] = [darkTheme, neonTokyoTheme, synthwaveTheme, paperTheme];

export function getThemeByName(name: string): Theme {
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
