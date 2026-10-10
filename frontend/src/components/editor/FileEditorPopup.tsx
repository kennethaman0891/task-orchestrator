'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { getFile } from '@/lib/api';
import { baseName, isImageFile } from '@/lib/format';
import { buttonBase, buttonSize, buttonVariant, scrollbarStyle } from '@/lib/theme';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { ImageViewer } from '@/components/editor/ImageViewer';
import { X, Maximize2, Minimize2, AppWindow } from 'lucide-react';

interface Props {
  open: boolean;
  openFiles: { path: string; name: string; dirty?: boolean }[];
  activeFile: string | null;
  onSelectFile: (path: string, name: string) => void;
  onCloseFile: (path: string) => void;
  onSaveFile: (path: string, content: string) => Promise<void>;
  onMarkDirty: (path: string, dirty: boolean) => void;
  onClose: () => void;
  onToast?: (msg: string, error?: boolean) => void;
}

/** Default popup window rectangle: slightly left-of-center, sized to viewport. */
function defaultRect() {
  if (typeof window === 'undefined') return { x: 48, y: 64, w: 680, h: 520 };
  const w = Math.min(720, Math.max(420, window.innerWidth - 96));
  const h = Math.min(560, Math.max(320, window.innerHeight - 160));
  return {
    x: Math.max(24, Math.round(window.innerWidth * 0.14)),
    y: Math.max(24, Math.round((window.innerHeight - h) * 0.16)),
    w,
    h,
  };
}

/**
 * Floating popup editor window.
 *
 * Opens on top of the app (backdrop + draggable window) instead of
 * embedding the editor inside the left sidebar. Shows the open-file
 * tab strip and the CodeEditor / ImageViewer for the active file.
 */
export function FileEditorPopup({
  open,
  openFiles,
  activeFile,
  onSelectFile,
  onCloseFile,
  onSaveFile,
  onMarkDirty,
  onClose,
  onToast,
}: Props) {
  const { theme: t } = useTheme();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rect, setRect] = useState(defaultRect);
  const [maximized, setMaximized] = useState(false);
  const lastRectRef = useRef(rect);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // ── Load file content when active file changes (images load via ImageViewer) ──
  useEffect(() => {
    if (!activeFile) { setContent(null); setError(null); setLoading(false); return; }
    if (isImageFile(activeFile)) { setContent(null); setError(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFile(activeFile)
      .then((r) => { if (!cancelled) setContent(r.content ?? ''); })
      .catch((e: any) => { if (!cancelled) setError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeFile]);

  // ── Save handler ──
  const handleSave = useCallback(async (filePath: string, text: string) => {
    try {
      await onSaveFile(filePath, text);
      onToast?.('File saved');
    } catch (err: any) {
      onToast?.(`Save failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }, [onSaveFile, onToast]);

  // ── Close on Escape (CodeMirror's keymap stops handled keydowns from bubbling) ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── Draggable window (grab the header; interactive elements are excluded) ──
  const onHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, [role="button"]')) return;
    dragRef.current = { dx: e.clientX - rect.x, dy: e.clientY - rect.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = 'grabbing';
  }, [rect]);

  const onHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Math.min(Math.max(e.clientX - d.dx, -(rect.w - 200)), window.innerWidth - 200);
    const ny = Math.min(Math.max(e.clientY - d.dy, 8), window.innerHeight - 48);
    setRect((r) => ({ ...r, x: nx, y: ny }));
  }, [rect.w]);

  const onHeaderPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    e.currentTarget.style.cursor = '';
  }, []);

  const toggleMaximize = useCallback(() => {
    setMaximized((m) => {
      if (m) lastRectRef.current = rect;
      return !m;
    });
  }, [rect]);

  if (!open || !activeFile) return null;

  const activeEntry = openFiles.find((f) => f.path === activeFile);
  const activeName = activeEntry?.name || baseName(activeFile);

  const winStyle: React.CSSProperties = maximized
    ? {
        position: 'fixed', inset: '12px',
        zIndex: Number(t.zIndex.modal) || 500,
        background: t.colors.bg.secondary,
        border: `1px solid ${t.colors.border.primary}`,
        borderRadius: t.borderRadius.lg,
        boxShadow: t.shadow.xl,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }
    : {
        position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        zIndex: Number(t.zIndex.modal) || 500,
        background: t.colors.bg.secondary,
        border: `1px solid ${t.colors.border.primary}`,
        borderRadius: t.borderRadius.lg,
        boxShadow: t.shadow.xl,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'fep-pop 0.14s ease',
      };

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: Number(t.zIndex.overlay) || 400,
          background: 'rgba(8, 10, 16, 0.45)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }}
        onClick={onClose}
      />

      {/* Popup window */}
      <div style={winStyle} role="dialog" aria-label={`Editor window: ${activeName}`}>
        {/* Title bar (drag handle) */}
        <div
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 10px', flexShrink: 0,
            background: t.colors.bg.elevated,
            borderBottom: `1px solid ${t.colors.border.subtle}`,
            cursor: maximized ? 'default' : 'grab',
            touchAction: 'none', userSelect: 'none',
          }}
        >
          <AppWindow size={13} style={{ color: t.colors.accent.primary, flexShrink: 0 }} />
          <span
            style={{
              fontSize: t.fontSize.xs, fontWeight: t.fontWeight.semibold,
              color: t.colors.text.primary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
            }}
            title={activeFile}
          >
            {activeName}
            {activeEntry?.dirty && (
              <span style={{ color: t.colors.warning.primary, fontSize: '10px', marginLeft: '6px' }}>●</span>
            )}
          </span>
          <span
            style={{
              fontSize: '10px', color: t.colors.text.muted,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginLeft: 'auto', marginRight: '4px',
            }}
            title={activeFile}
          >
            {activeFile}
          </span>
          <button
            onClick={toggleMaximize}
            title={maximized ? 'Restore' : 'Maximize'}
            aria-label={maximized ? 'Restore' : 'Maximize'}
            style={{
              ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'),
              width: '24px', height: '24px', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={onClose}
            title="Close editor window"
            aria-label="Close editor window"
            style={{
              ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'),
              width: '24px', height: '24px', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <X size={13} />
          </button>
        </div>

        {/* File tabs */}
        {openFiles.length > 0 && (
          <div
            style={{
              display: 'flex', alignItems: 'center',
              borderBottom: `1px solid ${t.colors.border.subtle}`,
              background: t.colors.bg.secondary,
              height: '30px', flexShrink: 0, overflowX: 'auto',
              ...scrollbarStyle(t, false),
            }}
          >
            {openFiles.map((f) => {
              const isActive = f.path === activeFile;
              return (
                <div
                  key={f.path}
                  onClick={() => onSelectFile(f.path, f.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '0 8px 0 10px', height: '100%',
                    fontSize: '10.5px', cursor: 'pointer', userSelect: 'none',
                    borderRight: `1px solid ${t.colors.border.subtle}`,
                    borderBottom: isActive ? `2px solid ${t.colors.accent.primary}` : '2px solid transparent',
                    background: isActive ? t.colors.bg.primary : 'transparent',
                    color: isActive ? t.colors.text.primary : t.colors.text.muted,
                    transition: 'all 0.12s ease',
                    maxWidth: '160px', minWidth: '70px',
                  }}
                  title={f.path}
                >
                  {f.dirty && <span style={{ color: t.colors.warning.primary, fontSize: '9px' }}>●</span>}
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isActive ? 500 : 400,
                  }}>{f.name}</span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); onCloseFile(f.path); }}
                    title="Close tab"
                    style={{
                      marginLeft: 'auto', padding: '1px', borderRadius: '3px',
                      display: 'flex', alignItems: 'center',
                      color: t.colors.text.muted, cursor: 'pointer', flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.elevated; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <X size={10} />
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Editor body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {isImageFile(activeFile) ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <ImageViewer key={activeFile} path={activeFile} error={error} />
            </div>
          ) : (
            <CodeEditor
              key={activeFile}
              path={activeFile}
              initialContent={content ?? ''}
              onSave={(c) => handleSave(activeFile, c)}
              onDirtyChange={(dirty) => onMarkDirty(activeFile, dirty)}
              loading={loading}
              error={error}
            />
          )}
        </div>
      </div>
    </>
  );
}
