import assert from 'node:assert/strict';
import {
  ALL_THEMES,
  getThemeByName,
  buildSystemTerminalTheme,
  systemTerminalDarkTheme,
  systemTerminalLightTheme,
  CUSTOM_THEME_PRESETS,
  isLightTheme,
} from './theme';

console.log('Testing System Terminal Theme & Auto Selector...');

// 1. Check that System Terminal is registered in ALL_THEMES
const sysTheme = ALL_THEMES.find((t) => t.name === 'System Terminal');
assert.ok(sysTheme, 'System Terminal theme must be registered in ALL_THEMES');
assert.equal(sysTheme.label, 'System Terminal (Auto)');
assert.equal(sysTheme.category, 'professional');
assert.equal(sysTheme.colors.bg.primary, systemTerminalDarkTheme.colors.bg.primary);

// 2. Check buildSystemTerminalTheme dark mode defaults
const darkSys = buildSystemTerminalTheme('dark');
assert.equal(darkSys.mode, 'dark');
assert.equal(darkSys.colors.bg.primary, systemTerminalDarkTheme.colors.bg.primary, 'Dark terminal background must be pure black (#000000)');
assert.equal(isLightTheme(darkSys), false);

// 3. Check buildSystemTerminalTheme light mode defaults
const lightSys = buildSystemTerminalTheme('light');
assert.equal(lightSys.mode, 'light');
assert.equal(lightSys.colors.bg.primary, systemTerminalLightTheme.colors.bg.primary, 'Light terminal background must be pure white (#ffffff)');
assert.equal(isLightTheme(lightSys), true);

// 4. Test getThemeByName resolution with explicit system mode
const resolvedDark = getThemeByName('System Terminal', undefined, 'dark');
assert.equal(resolvedDark.colors.bg.primary, '#000000');
assert.equal(resolvedDark.mode, 'dark');

const resolvedLight = getThemeByName('System Terminal', undefined, 'light');
assert.equal(resolvedLight.colors.bg.primary, '#ffffff');
assert.equal(resolvedLight.mode, 'light');

// 5. Test alias resolution ('system', 'system-terminal', etc.)
const resolvedAlias = getThemeByName('system', undefined, 'dark');
assert.equal(resolvedAlias.name, 'System Terminal');
assert.equal(resolvedAlias.colors.bg.primary, '#000000');

// 6. Test preset in CUSTOM_THEME_PRESETS
const preset = CUSTOM_THEME_PRESETS.find((p) => p.id === 'system-terminal');
assert.ok(preset, 'CUSTOM_THEME_PRESETS should include system-terminal');
assert.equal(preset.config.bgPrimary, '#000000');

console.log('✓ All System Terminal Theme & Auto Selector checks passed!');
