'use client';

import { useState, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { isLightTheme } from '@/lib/theme';
import { tauri } from '@/lib/tauri';
import { baseName, getExtension, isSqliteDatabase, formatBytes } from '@/lib/format';
import { buttonBase, buttonSize, buttonVariant } from '@/lib/theme';
import {
  Database,
  Binary,
  FileArchive,
  FileCode2,
  FolderOpen,
  ExternalLink,
  FileText,
  AlertTriangle,
  Terminal as TerminalIcon,
  Check,
} from 'lucide-react';

interface Props {
  path: string;
  onOpenRaw?: () => void;
}

export function BinaryViewer({ path, onOpenRaw }: Props) {
  const { theme: t } = useTheme();
  const isLight = isLightTheme(t);
  const bg = isLight ? '#ffffff' : '#1e1e1e';
  const subBg = isLight ? '#f3f3f3' : '#181818';
  const cardBg = isLight ? '#f9f9f9' : '#252526';
  const border = isLight ? '#e5e5e5' : '#2d2d2d';
  const text = isLight ? '#000000' : '#d4d4d4';
  const muted = isLight ? '#6c6c6c' : '#858585';

  const [fileSize, setFileSize] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [openedApp, setOpenedApp] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fileName = baseName(path);
  const ext = getExtension(fileName).toLowerCase();
  const isSqlite = isSqliteDatabase(fileName);

  // Fetch file size from backend
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        if (res.ok) {
          const data = await res.json();
          if (active && data.files && data.files.length > 0) {
            setFileSize(data.files[0].size ?? null);
          }
        }
      } catch {
        // Non-critical, ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [path]);

  const handleRevealInFinder = async () => {
    setActionError(null);
    try {
      await tauri.revealInFinder(path);
      setRevealed(true);
      setTimeout(() => setRevealed(false), 2000);
    } catch (err: any) {
      setActionError(`Could not reveal in Finder: ${err?.message || err}`);
    }
  };

  const handleOpenInApp = async () => {
    setActionError(null);
    try {
      await tauri.openUrl(path);
      setOpenedApp(true);
      setTimeout(() => setOpenedApp(false), 2000);
    } catch (err: any) {
      setActionError(`Could not open file: ${err?.message || err}`);
    }
  };

  const renderIcon = () => {
    if (isSqlite) {
      return <Database size={42} style={{ color: t.colors.accent.primary }} />;
    }
    if (['zip', 'gz', 'tar', '7z', 'rar'].includes(ext)) {
      return <FileArchive size={42} style={{ color: '#eab308' }} />;
    }
    if (['pyc', 'pyo', 'pyd', 'dylib', 'so', 'dll', 'wasm', 'bin'].includes(ext)) {
      return <Binary size={42} style={{ color: '#38bdf8' }} />;
    }
    if (ext === 'pdf') {
      return <FileText size={42} style={{ color: '#f87171' }} />;
    }
    return <FileCode2 size={42} style={{ color: muted }} />;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        flex: 1,
        background: bg,
      }}
    >
      {/* Sub-header status bar matching CodeEditor */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: `1px solid ${border}`,
          background: subBg,
          flexShrink: 0,
          height: '34px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          {isSqlite ? (
            <Database size={13} style={{ color: t.colors.accent.primary, flexShrink: 0 }} />
          ) : (
            <Binary size={13} style={{ color: muted, flexShrink: 0 }} />
          )}
          <span
            style={{
              fontSize: t.fontSize.xs,
              fontWeight: t.fontWeight.medium,
              color: text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fileName}
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '3px',
              background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
              color: muted,
              fontFamily: t.fontFamily.mono,
            }}
          >
            {isSqlite ? 'SQLITE DB' : ext ? ext.toUpperCase() : 'BINARY'}
          </span>
        </div>

        {fileSize !== null && (
          <span
            style={{
              fontSize: '11px',
              color: muted,
              fontFamily: t.fontFamily.mono,
            }}
          >
            {formatBytes(fileSize)}
          </span>
        )}
      </div>

      {/* Main Container */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 20px',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            maxWidth: '520px',
            width: '100%',
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: '8px',
            padding: '28px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            boxShadow: isLight ? '0 4px 12px rgba(0,0,0,0.05)' : '0 4px 16px rgba(0,0,0,0.2)',
          }}
        >
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: isLight ? '#f0f0f0' : '#2d2d30',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
            }}
          >
            {renderIcon()}
          </div>

          <h3
            style={{
              margin: '0 0 6px 0',
              fontSize: t.fontSize.lg,
              fontWeight: 600,
              color: text,
            }}
          >
            {fileName}
          </h3>

          <div
            style={{
              fontSize: '11px',
              color: muted,
              fontFamily: t.fontFamily.mono,
              wordBreak: 'break-all',
              marginBottom: '16px',
              padding: '4px 8px',
              borderRadius: '4px',
              background: isLight ? '#eaeaea' : '#1e1e1e',
              maxWidth: '100%',
            }}
          >
            {path}
          </div>

          <p
            style={{
              margin: '0 0 20px 0',
              fontSize: t.fontSize.sm,
              lineHeight: 1.5,
              color: muted,
            }}
          >
            {isSqlite ? (
              <>
                This file is a <strong>SQLite database</strong>. Binary database files cannot be
                displayed directly in the text editor to prevent data corruption.
              </>
            ) : (
              <>
                The file cannot be displayed in the editor because it is either binary or uses an
                unsupported text encoding.
              </>
            )}
          </p>

          {isSqlite && (
            <div
              style={{
                width: '100%',
                marginBottom: '20px',
                padding: '12px 14px',
                borderRadius: '6px',
                background: isLight ? '#f0fdf4' : '#062013',
                border: `1px solid ${isLight ? '#bbf7d0' : '#14532d'}`,
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: t.fontSize.xs,
                  fontWeight: 600,
                  color: isLight ? '#166534' : '#4ade80',
                  marginBottom: '6px',
                }}
              >
                <TerminalIcon size={13} />
                <span>How to inspect this database:</span>
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: '18px',
                  fontSize: '11px',
                  lineHeight: 1.6,
                  color: isLight ? '#15803d' : '#86efac',
                }}
              >
                <li>
                  Open with an external SQLite GUI app such as <strong>DB Browser for SQLite</strong> or <strong>TablePlus</strong>.
                </li>
                <li>
                  In the dedicated terminal below, inspect tables with:{' '}
                  <code style={{ fontFamily: t.fontFamily.mono, fontWeight: 600 }}>python manage.py dbshell</code> or{' '}
                  <code style={{ fontFamily: t.fontFamily.mono, fontWeight: 600 }}>sqlite3 {fileName}</code>.
                </li>
              </ul>
            </div>
          )}

          {actionError && (
            <div
              style={{
                width: '100%',
                marginBottom: '16px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: isLight ? '#fef2f2' : '#450a0a',
                border: `1px solid ${isLight ? '#fecaca' : '#7f1d1d'}`,
                color: '#f87171',
                fontSize: t.fontSize.xs,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>{actionError}</span>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={handleRevealInFinder}
              style={{
                ...buttonBase(t),
                ...buttonSize(t, 'sm'),
                ...buttonVariant(t, 'primary'),
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                height: '32px',
                padding: '0 14px',
              }}
            >
              {revealed ? <Check size={14} /> : <FolderOpen size={14} />}
              <span>{revealed ? 'Revealed in Finder' : 'Reveal in Finder'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenInApp}
              style={{
                ...buttonBase(t),
                ...buttonSize(t, 'sm'),
                ...buttonVariant(t, 'secondary'),
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                height: '32px',
                padding: '0 14px',
              }}
            >
              {openedApp ? <Check size={14} /> : <ExternalLink size={14} />}
              <span>{openedApp ? 'Opened' : 'Open in Default App'}</span>
            </button>

            {onOpenRaw && (
              <button
                type="button"
                onClick={onOpenRaw}
                style={{
                  ...buttonBase(t),
                  ...buttonSize(t, 'sm'),
                  ...buttonVariant(t, 'secondary'),
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '32px',
                  padding: '0 14px',
                  opacity: 0.75,
                }}
                title="Force open in CodeMirror text editor (may show raw binary glyphs)"
              >
                <FileCode2 size={14} />
                <span>Open as Raw Text Anyway</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
