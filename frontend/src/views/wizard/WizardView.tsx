'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { TemplateKey } from '@/lib/workspace';
import { tauri, isTauri } from '@/lib/tauri';
import { CliLogo } from '@/lib/cliLogos';
import { Folder, X } from 'lucide-react';

interface Props {
  onCreate: (config: {
    name?: string;
    projectPath?: string;
    template: TemplateKey;
    command?: string;
    color?: string;
  }) => void;
  onClose: () => void;
}

interface CliPreset {
  id: string;
  label: string;
  cmd: string;
  cli: string;
}

const CLI_PRESETS: CliPreset[] = [
  { id: 'opencode', label: 'opencode', cmd: 'opencode', cli: 'opencode' },
  { id: 'claude', label: 'claude', cmd: 'claude', cli: 'claude' },
  { id: 'codex', label: 'codex', cmd: 'codex', cli: 'codex' },
  { id: 'gemini', label: 'gemini', cmd: 'gemini', cli: 'gemini' },
  { id: 'aider', label: 'aider', cmd: 'aider', cli: 'aider' },
  { id: 'cursor', label: 'cursor', cmd: 'cursor', cli: 'cursor' },
  { id: 'kilo', label: 'kilo', cmd: 'kilo', cli: 'kilo' },
  { id: 'antigravity', label: 'antigravity', cmd: 'agy', cli: 'antigravity' },
];

const LAYOUT_DIMENSIONS: Record<number, string> = {
  1: '1 terminal · 1 × 1',
  2: '2 terminals · 1 × 2',
  3: '3 terminals · 1 × 3',
  4: '4 terminals · 2 × 2',
  5: '5 terminals · 2 × 3',
  6: '6 terminals · 2 × 3',
  7: '7 terminals · 2 × 4',
  8: '8 terminals · 2 × 4',
};

const DEFAULT_RECENTS = [
  '/Users/kennethaman',
  '/Users/kennethaman/dd',
  '/Users/kennethaman/clone',
  '/Users/kennethaman/tto-golden',
];

export function WizardView({ onCreate, onClose }: Props) {
  const { theme: t } = useTheme();

  const [projectPath, setProjectPath] = useState('/Users/kennethaman');
  const [command, setCommand] = useState('opencode');
  const [terminalCount, setTerminalCount] = useState<number>(4);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 860 : false,
  );

  const pathInputRef = useRef<HTMLInputElement>(null);

  // Recent paths from localStorage
  const [recentPaths, setRecentPaths] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_RECENTS;
    try {
      const saved = localStorage.getItem('tto-recent-paths');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_RECENTS;
  });

  // Base folder name for display
  const folderBasename = useMemo(() => {
    const clean = projectPath.trim().replace(/[/\\]+$/, '');
    if (!clean) return '';
    return clean.split(/[/\\]/).filter(Boolean).pop() || clean;
  }, [projectPath]);

  // Handle folder pick from Tauri
  const handleBrowseFolder = async () => {
    if (!isTauri()) return;
    try {
      const picked = await tauri.pickFolder();
      if (picked) {
        const clean = picked.trim().replace(/^["']|["']$/g, '');
        setProjectPath(clean);
      }
    } catch (err) {
      console.error('[WizardView] pickFolder error:', err);
    }
  };

  const handleClearPath = () => {
    setProjectPath('');
    pathInputRef.current?.focus();
  };

  const handleSelectRecent = (path: string) => {
    setProjectPath(path);
  };

  const handleSelectCli = (preset: CliPreset) => {
    if (command === preset.cmd) {
      setCommand('');
    } else {
      setCommand(preset.cmd);
    }
  };

  const submit = () => {
    const cleanPath = projectPath.trim().replace(/^["']|["']$/g, '');
    const cleanCmd = command.trim();
    const baseName = folderBasename || 'Workspace';

    // Persist path to recents
    if (cleanPath) {
      try {
        const next = [cleanPath, ...recentPaths.filter((p) => p !== cleanPath)].slice(0, 6);
        setRecentPaths(next);
        localStorage.setItem('tto-recent-paths', JSON.stringify(next));
      } catch {}
    }

    // Map 1..8 to TemplateKey
    const templateKey: TemplateKey =
      terminalCount >= 7 ? 8 : terminalCount >= 5 ? 6 : (terminalCount as TemplateKey);

    onCreate({
      name: baseName,
      projectPath: cleanPath || undefined,
      template: templateKey,
      command: cleanCmd || undefined,
    });
  };

  // Keyboard shortcut listener: Escape closes, Enter submits
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey || document.activeElement?.tagName !== 'BUTTON')
      ) {
        submit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectPath, command, terminalCount, folderBasename]);

  // Focus path input on open
  useEffect(() => {
    pathInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 860);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const accent = t.colors.accent.primary;
  const borderSubtle = t.colors.border.subtle || t.colors.border.primary;
  const borderSecondary = t.colors.border.secondary || t.colors.border.primary;
  const bgInput = t.colors.bg.input || t.colors.bg.secondary;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Workspace"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, calc(100vw - 40px))',
          maxWidth: '100%',
          maxHeight: '92vh',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: t.colors.bg.elevated || t.colors.bg.secondary,
          border: `1px solid ${borderSubtle}`,
          borderRadius: '14px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.04)',
          overflow: 'hidden',
          animation: 'wizardModalFadeIn 0.15s ease-out',
        }}
      >
        {/* ── Modal Content ── */}
        <div
          style={{
            padding: '22px 24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            overflowY: 'auto',
            minHeight: 0,
            flex: 1,
          }}
        >
          {/* Header */}
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: 600,
                  color: t.colors.text.primary,
                  letterSpacing: '-0.01em',
                }}
              >
                New Workspace
              </h2>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: '12.5px',
                  color: t.colors.text.muted,
                  lineHeight: 1.4,
                }}
              >
                Spin up an AI terminal grid for a project
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'transparent',
                border: 'none',
                color: t.colors.text.muted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = t.colors.bg.hover;
                e.currentTarget.style.color = t.colors.text.primary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = t.colors.text.muted;
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: narrow
                ? 'minmax(0, 1fr)'
                : 'minmax(0, 1.08fr) minmax(0, 0.92fr)',
              alignItems: 'stretch',
              gap: narrow ? '20px' : 0,
              minWidth: 0,
            }}
          >
            <div style={{ paddingRight: narrow ? 0 : 22, minWidth: 0 }}>
              {/* ── Section 1: PROJECT PATH ── */}
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: t.colors.text.muted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: '8px',
                  }}
                >
                  PROJECT PATH
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    ref={pathInputRef}
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    placeholder="/path/to/project"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: '38px',
                      borderRadius: '8px',
                      background: bgInput,
                      border: `1px solid ${isInputFocused ? accent : borderSecondary}`,
                      boxShadow: isInputFocused ? `0 0 0 1px ${accent}40` : 'none',
                      padding: '0 12px',
                      color: t.colors.text.primary,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: '12.5px',
                      outline: 'none',
                      transition: 'border-color 0.12s ease, box-shadow 0.12s ease',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    style={{
                      height: '38px',
                      padding: '0 14px',
                      borderRadius: '8px',
                      background: t.colors.bg.secondary,
                      border: `1px solid ${borderSecondary}`,
                      color: t.colors.text.secondary,
                      fontSize: '12.5px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = t.colors.bg.hover;
                      e.currentTarget.style.color = t.colors.text.primary;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = t.colors.bg.secondary;
                      e.currentTarget.style.color = t.colors.text.secondary;
                    }}
                  >
                    <Folder size={14} />
                    Browse
                  </button>
                </div>

                {/* Selected Path Pill */}
                {projectPath && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: bgInput,
                      border: `1px solid ${borderSubtle}`,
                      color: accent,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: '12px',
                      fontWeight: 500,
                      marginTop: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        minWidth: 0,
                        flex: 1,
                        overflow: 'hidden',
                      }}
                    >
                      <Folder size={13} style={{ color: accent, flexShrink: 0 }} />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                      >
                        {projectPath}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearPath}
                      title="Clear path"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: t.colors.text.muted,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '2px',
                        marginLeft: '8px',
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = accent)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = t.colors.text.muted)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}

                {/* Recent Paths */}
                {recentPaths.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 600,
                        color: t.colors.text.muted,
                        letterSpacing: '0.05em',
                      }}
                    >
                      RECENT
                    </span>
                    {recentPaths.map((p) => {
                      const base = p.split(/[/\\]/).filter(Boolean).pop() || p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleSelectRecent(p)}
                          title={p}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            background: t.colors.bg.secondary,
                            border: `1px solid ${borderSecondary}`,
                            color: t.colors.text.secondary,
                            fontFamily:
                              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            fontSize: '11.5px',
                            cursor: 'pointer',
                            maxWidth: '148px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.12s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = t.colors.bg.hover;
                            e.currentTarget.style.color = t.colors.text.primary;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = t.colors.bg.secondary;
                            e.currentTarget.style.color = t.colors.text.secondary;
                          }}
                        >
                          {base}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Section 2: LAUNCH COMMAND ── */}
              <div style={{ marginTop: '16px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: t.colors.text.muted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: '2px',
                  }}
                >
                  LAUNCH COMMAND
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: t.colors.text.muted,
                    marginBottom: '8px',
                    lineHeight: 1.4,
                  }}
                >
                  Runs in every terminal the moment it opens — pick an AI CLI below, or leave blank
                  for plain shells.
                </div>

                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g. opencode"
                  style={{
                    width: '100%',
                    height: '38px',
                    borderRadius: '8px',
                    background: bgInput,
                    border: `1px solid ${borderSecondary}`,
                    padding: '0 12px',
                    color: t.colors.text.primary,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '12.5px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.12s ease',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = accent)}
                  onBlur={(e) => (e.target.style.borderColor = borderSecondary)}
                />

                {/* Quick CLI Pills with Respective Brand Logos */}
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                    marginTop: '8px',
                  }}
                >
                  {CLI_PRESETS.map((preset) => {
                    const isActive = command === preset.cmd;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectCli(preset)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: isActive ? `${accent}22` : t.colors.bg.secondary,
                          border: `1px solid ${isActive ? accent : borderSecondary}`,
                          color: isActive ? accent : t.colors.text.secondary,
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: '11.5px',
                          cursor: 'pointer',
                          transition: 'all 0.12s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = t.colors.bg.hover;
                            e.currentTarget.style.color = t.colors.text.primary;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = t.colors.bg.secondary;
                            e.currentTarget.style.color = t.colors.text.secondary;
                          }
                        }}
                      >
                        <CliLogo cli={preset.cli} size={13} />
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div
              style={{
                paddingLeft: narrow ? 0 : 22,
                borderLeft: narrow ? 'none' : `1px solid ${borderSubtle}`,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                height: narrow ? 'auto' : '100%',
                minWidth: 0,
              }}
            >
              {/* ── Section 3: TERMINAL LAYOUT ── */}
              <div
                style={{
                  flex: narrow ? '0 0 auto' : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '10px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: t.colors.text.muted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    TERMINAL LAYOUT
                  </span>
                  <span
                    style={{
                      color: accent,
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    }}
                  >
                    {LAYOUT_DIMENSIONS[terminalCount] || `${terminalCount} terminals`}
                  </span>
                </div>

                {/* 2x4 Numeral Grid (1 to 8) */}
                <div
                  style={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gridTemplateRows: '1fr 1fr',
                    gap: '10px',
                    minHeight: '146px',
                  }}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => {
                    const isActive = num <= terminalCount;
                    return (
                      <div
                        key={num}
                        onClick={() => setTerminalCount(num)}
                        style={{
                          height: '100%',
                          minHeight: '64px',
                          borderRadius: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          fontSize: '20px',
                          fontWeight: isActive ? 600 : 500,
                          userSelect: 'none',
                          transition: 'all 0.12s ease',
                          background: isActive ? `${accent}18` : t.colors.bg.secondary,
                          border: isActive ? `1.5px solid ${accent}` : `1px solid ${borderSubtle}`,
                          color: isActive ? t.colors.text.primary : t.colors.text.muted,
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.borderColor = t.colors.border.focus || accent;
                            e.currentTarget.style.color = t.colors.text.secondary;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.borderColor = borderSubtle;
                            e.currentTarget.style.color = t.colors.text.muted;
                          }
                        }}
                      >
                        {num}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Footer ── */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginTop: '16px',
                }}
              >
                <div
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '12px',
                    color: t.colors.text.muted,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {folderBasename || 'workspace'} · {terminalCount} terminals
                </div>

                <button
                  type="button"
                  onClick={submit}
                  style={{
                    height: '38px',
                    padding: '0 20px',
                    borderRadius: '8px',
                    background: accent,
                    border: 'none',
                    color: t.colors.text.inverse || '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.12s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.92')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  Create Workspace
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
