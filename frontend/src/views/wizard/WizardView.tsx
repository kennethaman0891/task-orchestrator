'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { TemplateKey } from '@/lib/workspace';
import { TEMPLATES } from '@/lib/workspace';
import { tauri, isTauri } from '@/lib/tauri';
import { CliLogo } from '@/lib/cliLogos';
import {
  FolderOpen,
  Folder,
  X,
  Check,
  Layers,
  FolderPlus,
  Tag,
  Palette,
} from 'lucide-react';

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

const PALETTE = [
  { hex: '#3b82f6', label: 'Blue' },
  { hex: '#10b981', label: 'Emerald' },
  { hex: '#8b5cf6', label: 'Purple' },
  { hex: '#f59e0b', label: 'Amber' },
  { hex: '#ec4899', label: 'Rose' },
  { hex: '#06b6d4', label: 'Cyan' },
];

const CLI_PRESETS = [
  { id: 'antigravity', label: 'Antigravity', cmd: 'agy', cli: 'antigravity', desc: 'Google Antigravity CLI' },
  { id: 'claude', label: 'Claude Code', cmd: 'claude', cli: 'claude', desc: 'Claude Code CLI' },
  { id: 'opencode', label: 'OpenCode', cmd: 'opencode', cli: 'opencode', desc: 'OpenCode Coding Agent' },
  { id: 'codex', label: 'Codex', cmd: 'codex', cli: 'codex', desc: 'OpenAI Codex CLI' },
  { id: 'gemini', label: 'Gemini', cmd: 'gemini', cli: 'gemini', desc: 'Google Gemini CLI' },
  { id: 'cursor', label: 'Cursor', cmd: 'cursor', cli: 'cursor', desc: 'Cursor Agent CLI' },
  { id: 'prime-agent', label: 'Prime Agent', cmd: 'prime-agent', cli: 'prime', desc: 'Prime Intellect Agent' },
  { id: 'shell', label: 'Shell', cmd: '', cli: 'zsh', desc: 'Plain login shell' },
];

/** The 9 fixed grid configurations up to 16 terminals, forming a symmetrical 3x3 layout */
const WIZARD_TEMPLATES: { key: TemplateKey; label: string; count: number }[] = [
  { key: 1, label: 'Single', count: 1 },
  { key: 2, label: 'Split', count: 2 },
  { key: 4, label: 'Quad', count: 4 },
  { key: 6, label: 'Six', count: 6 },
  { key: 8, label: 'Eight', count: 8 },
  { key: 10, label: 'Ten', count: 10 },
  { key: 12, label: 'Twelve', count: 12 },
  { key: 14, label: 'Fourteen', count: 14 },
  { key: 16, label: 'Sixteen', count: 16 },
];

/* Sleek miniature terminal wireframe preview */
function LayoutTilePreview({
  cols,
  rows,
  active,
  color,
}: {
  cols: number;
  rows: number;
  active: boolean;
  color: string;
}) {
  return (
    <div
      style={{
        width: '34px',
        height: '26px',
        borderRadius: '4px',
        background: active ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.3)',
        border: `1.5px solid ${active ? color : 'rgba(255, 255, 255, 0.12)'}`,
        boxShadow: active ? `0 0 10px ${color}35` : 'none',
        display: 'flex',
        flexDirection: 'column',
        padding: '2px',
        flexShrink: 0,
        boxSizing: 'border-box',
        transition: 'all 0.15s ease',
      }}
      aria-hidden
    >
      {/* Mini Titlebar */}
      <div
        style={{
          height: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '1.5px',
          padding: '0 1px 1.5px',
          opacity: active ? 0.9 : 0.4,
        }}
      >
        <span style={{ width: '2px', height: '2px', borderRadius: '50%', background: '#ef4444' }} />
        <span style={{ width: '2px', height: '2px', borderRadius: '50%', background: '#eab308' }} />
        <span style={{ width: '2px', height: '2px', borderRadius: '50%', background: '#22c55e' }} />
      </div>

      {/* Mini Grid Panes */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: '1.5px',
        }}
      >
        {Array.from({ length: cols * rows }).map((_, i) => (
          <div
            key={i}
            style={{
              borderRadius: '1.5px',
              background: active ? color : 'rgba(255, 255, 255, 0.2)',
              opacity: active ? 0.95 : 0.45,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function WizardView({ onCreate, onClose }: Props) {
  const { theme: t } = useTheme();
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [template, setTemplate] = useState<TemplateKey>(4);
  const [command, setCommand] = useState('opencode');
  const [selectedColor, setSelectedColor] = useState('#3b82f6');
  const [focused, setFocused] = useState<'name' | 'path' | 'cmd' | null>(null);
  const pathRef = useRef<HTMLInputElement>(null);

  // Derived folder name for display
  const folderBasename = useMemo(() => {
    if (!projectPath) return '';
    return projectPath.split(/[/\\]/).filter(Boolean).pop() || projectPath;
  }, [projectPath]);

  // When a folder is picked, auto-fill workspace name if empty or matches old folder
  const handleFolderPicked = (path: string) => {
    const clean = path.trim().replace(/^["']|["']$/g, '');
    setProjectPath(clean);
    const base = clean.split(/[/\\]/).filter(Boolean).pop() || '';
    if (!name || name === folderBasename) {
      setName(base);
    }
  };

  const handleBrowseFolder = async () => {
    if (!isTauri()) return;
    try {
      const picked = await tauri.pickFolder();
      if (picked) handleFolderPicked(picked);
    } catch (err) {
      console.error('[WizardView] pickFolder error:', err);
    }
  };

  const submit = () => {
    const cleanPath = projectPath.trim().replace(/^["']|["']$/g, '');
    const cleanCmd = command.trim();
    onCreate({
      name: name.trim() || undefined,
      projectPath: cleanPath || undefined,
      template,
      command: cleanCmd || undefined,
      color: selectedColor,
    });
  };

  /* Auto-focus the Location field when the modal opens */
  useEffect(() => {
    pathRef.current?.focus();
  }, []);

  /* Escape closes, Cmd/Ctrl+Enter submits */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    marginBottom: '8px',
  };

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
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '580px',
          maxWidth: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#141519',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '14px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 22px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              background: `${selectedColor}18`,
              border: `1px solid ${selectedColor}40`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: selectedColor,
              flexShrink: 0,
              boxShadow: `0 0 12px ${selectedColor}25`,
              transition: 'all 0.2s ease',
            }}
          >
            <FolderPlus size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#f8fafc', letterSpacing: '-0.1px' }}>
              Create Workspace
            </div>
            <div style={{ fontSize: '11.5px', color: 'rgba(255, 255, 255, 0.45)', marginTop: '1px' }}>
              Configure project directory, terminal layout, and startup command
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              borderRadius: '6px',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)';
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Form Body ── */}
        <div
          style={{
            padding: '18px 22px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            flex: 1,
          }}
        >
          {/* Section 1: Project Directory & Identity */}
          <div>
            <div style={sectionHeaderStyle}>
              <span>Project Directory</span>
              <span style={{ fontSize: '10px', textTransform: 'none', color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>
                Optional · Defaults to Home
              </span>
            </div>

            {projectPath ? (
              /* Selected Folder Card */
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '6px',
                    background: `${selectedColor}16`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: selectedColor,
                    flexShrink: 0,
                  }}
                >
                  <FolderOpen size={15} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12.5px', fontWeight: '600', color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {folderBasename}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'rgba(255, 255, 255, 0.45)', fontFamily: t.fontFamily.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {projectPath}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '5px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#f1f5f9',
                      fontSize: '11px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.12s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectPath('')}
                    title="Clear selected folder"
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '5px',
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255, 255, 255, 0.45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.12s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)'; }}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ) : (
              /* Unselected Folder Input */
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                  <Folder
                    size={13}
                    style={{
                      position: 'absolute',
                      left: '11px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: focused === 'path' ? selectedColor : 'rgba(255, 255, 255, 0.35)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    ref={pathRef}
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="/path/to/project (or browse local folder)"
                    onFocus={() => setFocused('path')}
                    onBlur={() => setFocused(null)}
                    style={{
                      width: '100%',
                      height: '35px',
                      paddingLeft: '32px',
                      paddingRight: '10px',
                      borderRadius: '7px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: `1px solid ${focused === 'path' ? selectedColor : 'rgba(255, 255, 255, 0.1)'}`,
                      color: '#f8fafc',
                      fontSize: '12px',
                      fontFamily: t.fontFamily.mono,
                      outline: 'none',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.12s ease',
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleBrowseFolder}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    height: '35px',
                    padding: '0 12px',
                    borderRadius: '7px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#f1f5f9',
                    fontSize: '11.5px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.12s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                  }}
                  title="Browse local folders"
                >
                  <FolderOpen size={13} style={{ color: selectedColor }} />
                  Browse
                </button>
              </div>
            )}

            {/* Workspace Identity: Name Input & Color Theme */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', marginTop: '10px', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <Tag
                  size={12}
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: focused === 'name' ? selectedColor : 'rgba(255, 255, 255, 0.35)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={folderBasename ? `Name: ${folderBasename}` : 'Workspace Name (optional)'}
                  onFocus={() => setFocused('name')}
                  onBlur={() => setFocused(null)}
                  style={{
                    width: '100%',
                    height: '33px',
                    paddingLeft: '28px',
                    paddingRight: '10px',
                    borderRadius: '7px',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: `1px solid ${focused === 'name' ? selectedColor : 'rgba(255, 255, 255, 0.08)'}`,
                    color: '#f8fafc',
                    fontSize: '11.5px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.12s ease',
                  }}
                />
              </div>

              {/* Color Swatches */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 8px',
                  borderRadius: '7px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <Palette size={12} style={{ color: 'rgba(255, 255, 255, 0.4)', marginRight: '2px' }} />
                {PALETTE.map((c) => {
                  const sel = selectedColor === c.hex;
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setSelectedColor(c.hex)}
                      title={c.label}
                      style={{
                        width: '19px',
                        height: '19px',
                        borderRadius: '50%',
                        background: c.hex,
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: sel ? `0 0 0 2px #141519, 0 0 0 3.5px ${c.hex}, 0 0 8px ${c.hex}80` : 'none',
                        transform: sel ? 'scale(1.08)' : 'scale(1)',
                        transition: 'all 0.12s ease',
                      }}
                    >
                      {sel && <Check size={11} color="#ffffff" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Section 2: Terminal Grid Layout (Symmetrical 3x3 Grid) */}
          <div>
            <div style={sectionHeaderStyle}>
              <span>Terminal Grid Layout</span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: selectedColor,
                  textTransform: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Layers size={11} />
                {TEMPLATES[template]?.label || 'Grid'} · {template} {template === 1 ? 'Terminal' : 'Terminals'}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '7px',
              }}
            >
              {WIZARD_TEMPLATES.map((tItem) => {
                const k = tItem.key;
                const sel = template === k;
                const info = TEMPLATES[k] || { label: tItem.label, cols: 2, rows: 2 };

                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTemplate(k)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '9px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: sel ? `${selectedColor}18` : 'rgba(255, 255, 255, 0.025)',
                      border: `1.5px solid ${sel ? selectedColor : 'rgba(255, 255, 255, 0.07)'}`,
                      boxShadow: sel ? `0 0 14px ${selectedColor}22` : 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!sel) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.14)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!sel) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.07)';
                      }
                    }}
                  >
                    <LayoutTilePreview
                      cols={info.cols}
                      rows={info.rows}
                      active={sel}
                      color={selectedColor}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: sel ? 600 : 500,
                          color: sel ? '#ffffff' : 'rgba(255, 255, 255, 0.85)',
                          letterSpacing: '-0.1px',
                        }}
                      >
                        {tItem.label}
                      </div>
                      <div
                        style={{
                          fontSize: '10px',
                          color: sel ? selectedColor : 'rgba(255, 255, 255, 0.4)',
                          marginTop: '1px',
                        }}
                      >
                        {tItem.count} {tItem.count === 1 ? 'terminal' : 'terminals'}
                      </div>
                    </div>
                    {sel && (
                      <Check size={12} color={selectedColor} strokeWidth={2.5} style={{ flexShrink: 0 }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Auto-Launch Command (Balanced 4x2 Grid with CliLogo) */}
          <div>
            <div style={sectionHeaderStyle}>
              <span>Auto-Launch CLI Command</span>
              <span style={{ fontSize: '10px', textTransform: 'none', color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>
                Injected in each terminal on boot
              </span>
            </div>

            {/* Presets Grid: Symmetrical 4x2 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '6px',
                marginBottom: '8px',
              }}
            >
              {CLI_PRESETS.map((p) => {
                const active = command.trim() === p.cmd;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setCommand(p.cmd)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: active
                        ? `${selectedColor}22`
                        : 'rgba(255, 255, 255, 0.035)',
                      border: `1px solid ${active ? selectedColor : 'rgba(255, 255, 255, 0.08)'}`,
                      boxShadow: active ? `0 0 10px ${selectedColor}20` : 'none',
                      color: active ? '#ffffff' : 'rgba(255, 255, 255, 0.75)',
                      fontSize: '11px',
                      fontWeight: active ? 600 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.12s ease',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.14)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.035)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                      }
                    }}
                    title={p.desc}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                      <CliLogo cli={p.cli} size={14} />
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Command Input Box */}
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '11px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontFamily: t.fontFamily.mono,
                  fontSize: '11.5px',
                  fontWeight: 600,
                  color: focused === 'cmd' ? selectedColor : 'rgba(255, 255, 255, 0.4)',
                  pointerEvents: 'none',
                }}
              >
                &gt;_
              </div>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onFocus={() => setFocused('cmd')}
                onBlur={() => setFocused(null)}
                placeholder="e.g. opencode, claude, agy, or leave blank for shell"
                style={{
                  width: '100%',
                  height: '35px',
                  paddingLeft: '32px',
                  paddingRight: command ? '32px' : '10px',
                  borderRadius: '7px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: `1px solid ${focused === 'cmd' ? selectedColor : 'rgba(255, 255, 255, 0.1)'}`,
                  color: '#f8fafc',
                  fontSize: '11.5px',
                  fontFamily: t.fontFamily.mono,
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.12s ease',
                }}
              />
              {command && (
                <button
                  type="button"
                  onClick={() => setCommand('')}
                  title="Clear command"
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '18px',
                    height: '18px',
                    borderRadius: '4px',
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ffffff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'; }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 22px',
            borderTop: '1px solid rgba(255, 255, 255, 0.07)',
            background: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          {/* Keyboard hints */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: 'rgba(255, 255, 255, 0.4)',
            }}
          >
            <kbd
              style={{
                padding: '2px 5px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.07)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: t.fontFamily.mono,
                fontSize: '10px',
              }}
            >
              ⌘↵
            </kbd>
            <span>Create</span>
            <span style={{ opacity: 0.3, margin: '0 2px' }}>·</span>
            <kbd
              style={{
                padding: '2px 5px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.07)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: t.fontFamily.mono,
                fontSize: '10px',
              }}
            >
              Esc
            </kbd>
            <span>Cancel</span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 14px',
                borderRadius: '7px',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.75)';
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 18px',
                borderRadius: '7px',
                background: selectedColor,
                border: 'none',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: `0 0 16px ${selectedColor}40`,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.92';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.transform = 'none';
              }}
            >
              <Check size={14} strokeWidth={2.5} />
              Create Workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
