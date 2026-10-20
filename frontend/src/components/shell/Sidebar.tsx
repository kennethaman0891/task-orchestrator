'use client';

import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { buttonBase, buttonSize, buttonVariant, inputBase, scrollbarStyle } from '@/lib/theme';
import type { Workspace } from '@/lib/workspace';
import { templateLabel, type TemplateKey, type View } from '@/lib/workspace';
import { baseName } from '@/lib/format';
import {
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Monitor,
  LayoutGrid,
  Activity,
  Plus,
  Terminal,
  Pencil,
  X,
  Settings,
  ChevronDown,
  ChevronRight,
  Folder,
  FileCode,
  Code2,
  AppWindow,
  Building2,
  ImagePlus,
  Trash2,
  Users,
  MoreHorizontal,
  ExternalLink,
  Search,
} from 'lucide-react';
import { listFiles, renameFile, searchProjectFiles, type FileEntry, type FileSearchResult } from '@/lib/api';
import { isTauri as checkTauri, tauri } from '@/lib/tauri';
import { FolderIcon, FileIcon } from '@/lib/treeIcons';
import { usePointerFileDrag } from '@/hooks/usePointerFileDrag';
import { extractDropPaths } from '@/terminal/dropPaths';
import type { UnifiedTerminal } from '@/types';
import { isClosed } from '@/lib/format';
import { CliLogo } from '@/lib/cliLogos';
import { deriveTaskStatus, statusLabel, minTerminal, getTerminalWorkDuration, type TermStatus } from '@/lib/status';
import { TerminalManager } from '@/terminal/TerminalManager';
import { detectCLI } from '@/jarvis/adapters';

interface Props {
  workspaces: Workspace[];
  activeId: string;
  activeWorkspace?: Workspace;
  onSelectWorkspace: (id: string) => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onSetProjectPath: (id: string, path: string) => void;
  onOpenProjectFolder?: () => void;
  /** Upload (data URL) or clear a workspace icon; mirrored onto its city building. */
  onSetWorkspaceLogo?: (id: string, logo: string | null) => void;
  onCloseWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onAddTerminal: () => void;
  onOpenFile: (path: string, name: string) => void;
  view: View;
  onView: (v: View) => void;
  connected: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onDropToTerminal?: (sessionId: string, paths: string[]) => void;
  onToast?: (msg: string, error?: boolean) => void;
  focusedTerminal?: string | null;
  terminals?: Record<string, UnifiedTerminal>;
  openFiles?: { path: string; name: string; dirty?: boolean }[];
  activeFile?: string | null;
  onSelectTerminal?: (id: string | null) => void;
  onCloseFile?: (path: string) => void;
  onSaveFile?: (path: string, content: string) => Promise<void>;
  onMarkDirty?: (path: string, dirty: boolean) => void;
  viewMode?: 'focus' | 'split' | 'grid';
  onSetViewMode?: (mode: 'focus' | 'split' | 'grid') => void;
  onRenameTerminal?: (tty: string, currentLabel: string) => void;
  onCloseTerminal?: (tty: string) => void;
  editingTerminalId?: string | null;
  terminalNameDraft?: string;
  setTerminalNameDraft?: (s: string) => void;
  commitRenameTerminal?: (tty: string) => void;
  onCancelRenameTerminal?: () => void;
  /** Per-workspace collab activity: workspaceId -> array of online usernames */
  collabActivity?: Record<string, string[]>;
}

// Active views with implementations available in top navigation.
const VIEW_TABS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: 'workspace', label: 'Workspace', icon: <Monitor size={13} /> },
  { key: 'grid', label: 'Grid', icon: <LayoutGrid size={13} /> },
  { key: 'ide', label: 'IDE', icon: <Code2 size={13} /> },
  { key: 'city', label: 'City', icon: <Building2 size={13} /> },
  { key: 'colab', label: 'Colab', icon: <Users size={13} /> },
  { key: 'dashboard', label: 'Dashboard', icon: <Activity size={13} /> },
];

/* Curated jewel-tone avatar palettes for distinct, professional workspace identities */
const WORKSPACE_PALETTES = [
  { bg: 'rgba(99, 102, 241, 0.14)', text: '#818cf8', border: 'rgba(99, 102, 241, 0.3)' }, // Indigo
  { bg: 'rgba(16, 185, 129, 0.14)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)' }, // Emerald
  { bg: 'rgba(56, 189, 248, 0.14)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.3)' }, // Sky
  { bg: 'rgba(245, 158, 11, 0.14)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' }, // Amber
  { bg: 'rgba(168, 85, 247, 0.14)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' }, // Purple
  { bg: 'rgba(244, 63, 94, 0.14)', text: '#fb7185', border: 'rgba(244, 63, 94, 0.3)' },   // Rose
  { bg: 'rgba(20, 184, 166, 0.14)', text: '#2dd4bf', border: 'rgba(20, 184, 166, 0.3)' }, // Teal
  { bg: 'rgba(249, 115, 22, 0.14)', text: '#fb923c', border: 'rgba(249, 115, 22, 0.3)' }, // Orange
];

function getWorkspacePalette(id: string, name: string) {
  let hash = 0;
  const str = (id || '') + (name || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % WORKSPACE_PALETTES.length;
  return WORKSPACE_PALETTES[idx];
}

/** Max size for storing an image RAW (no decode): keeps localStorage light. */
const RAW_LOGO_MAX_BYTES = 300 * 1024;

function readAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function logoFileName(file: File): string {
  return file.name || file.type.replace('image/', 'image-') || 'image';
}

/**
 * Turn an image file into a data URL for the workspace icon.
 * Format-agnostic:
 *   • Small files (≤ 300 KB) are stored RAW — no decode, so any format the
 *     system can display works (HEIC, WebP, AVIF, …). If it can't display,
 *     the avatar/sign fall back to initials.
 *   • Large files must be downscaled to `size`×`size` PNG (localStorage
 *     quota). We try `createImageBitmap` first (broadest decode coverage in
 *     WebKit), then fall back to `<img>` decoding. If both fail we throw
 *     with the file name + MIME so the user gets an actionable message.
 */
async function fileToLogoDataUrl(file: File, size = 256): Promise<string> {
  if (file.size <= RAW_LOGO_MAX_BYTES) {
    return readAsDataURL(file);
  }

  // Large: downscale. Path A — createImageBitmap (best format coverage).
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const scale = size / Math.max(bmp.width, bmp.height);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
    bmp.close?.();
    return canvas.toDataURL('image/png');
  } catch {
    /* fall through to <img> decode */
  }

  // Path B — classic <img> decode (with an actionable failure message).
  let img: HTMLImageElement;
  const url = URL.createObjectURL(file);
  try {
    img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('decode failed'));
      im.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    const fmt = file.type || logoFileName(file);
    throw new Error(
      `This large image (${logoFileName(file)}, ${fmt || 'unknown type'}) can't be read on this system. ` +
      `Convert it to JPG or PNG (macOS Preview → File → Export as JPEG) and try again.`,
    );
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const scale = size / Math.max(img.width, img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function getWorkspaceInitials(name: string): string {
  if (!name) return 'WS';
  // Strip out brackets, special punctuation, keep letters and digits
  const clean = name.replace(/[[\](){}<>@#$%^&*+=~`|\\:;"',.?/!]/g, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'W';
  if (parts.length === 1) {
    const word = parts[0];
    return word.slice(0, 2).toUpperCase();
  }
  // If first token is short code like "M3", prioritize it
  if (parts[0].length <= 2 && /\d/.test(parts[0])) {
    return parts[0].toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/* VS Code-style authentic per-file-type icon from treeIcons */
function FileRowIcon({ name }: { name: string }) {
  return (
    <span style={{ width: '16px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <FileIcon name={name} size={14} />
    </span>
  );
}

export function Sidebar({
  workspaces,
  activeId,
  activeWorkspace,
  onSelectWorkspace,
  onRenameWorkspace,
  onSetProjectPath,
  onOpenProjectFolder,
  onSetWorkspaceLogo,
  onCloseWorkspace,
  onNewWorkspace,
  onAddTerminal,
  onOpenFile,
  view,
  onView,
  connected,
  sidebarOpen,
  onToggleSidebar,
  onDropToTerminal,
  onToast,
  focusedTerminal,
  terminals,
  openFiles,
  activeFile,
  onSelectTerminal,
  onCloseFile,
  viewMode,
  onSetViewMode,
  onRenameTerminal,
  onCloseTerminal,
  editingTerminalId,
  terminalNameDraft,
  setTerminalNameDraft,
  commitRenameTerminal,
  onCancelRenameTerminal,
}: Props) {
  const { theme: t } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoveredWsId, setHoveredWsId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [filesOpen, setFilesOpen] = useState(true);
  const [terminalsOpen, setTerminalsOpen] = useState(true);
  const [tick, setTick] = useState(0);
  const [menuOpenWsId, setMenuOpenWsId] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpenWsId) return;
    const handleClickOutside = () => setMenuOpenWsId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [menuOpenWsId]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  // ── Workspace icon (favicon) upload ──
  const [iconUploadId, setIconUploadId] = useState<string | null>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);
  // Workspaces whose stored logo the webview can't render (visual fallback
  // to initials only — the data itself stays intact).
  const [brokenLogos, setBrokenLogos] = useState<Set<string>>(new Set());

  const pickWorkspaceIcon = (wsId: string) => {
    // Sync state first (iconUploadId is read on onChange), then open the
    // picker inside the same user-gesture tick — WebKit requires the
    // input.click() to happen while user activation is still valid.
    setIconUploadId(wsId);
    iconFileRef.current?.click();
  };

  const onIconFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || !iconUploadId || !onSetWorkspaceLogo) return;
    try {
      const dataUrl = await fileToLogoDataUrl(file, 256);
      onSetWorkspaceLogo(iconUploadId, dataUrl);
      setBrokenLogos((prev) => {
        const next = new Set(prev);
        next.delete(iconUploadId);
        return next;
      });
    } catch (err) {
      onToast?.(
        err instanceof Error && err.message.includes('can\'t be read')
          ? err.message
          : `Could not read ${file.name} — try a JPG, PNG, or WEBP file`,
        true,
      );
    } finally {
      setIconUploadId(null);
    }
  };

  const [hoveredTty, setHoveredTty] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [fileTreePath, setFileTreePath] = useState('');
  const [dragOverTree, setDragOverTree] = useState(false);
  const [editorOpen, setEditorOpen] = useState(true);

  // File search state
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [isSearchingFiles, setIsSearchingFiles] = useState(false);
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([]);

  // Hook for reliable drag-and-drop from the sidebar (WKWebView-safe + standard)
  const { beginDrag, consumeDrag } = usePointerFileDrag({
    onDropTerminal: (paths, sid) => {
      const targetSession =
        sid ||
        focusedTerminal ||
        activeWorkspace?.panes?.find((p) => p.tty)?.tty ||
        workspaces.flatMap((w) => w.panes).find((p) => p.tty)?.tty;

      if (targetSession && onDropToTerminal) {
        onDropToTerminal(targetSession, paths);
      } else if (onToast) {
        onToast('No active terminal to drop file into', true);
      }
    },
    onDropEditor: (path, name) => {
      onOpenFile(path, name);
      if (onToast) onToast(`Opened ${name}`);
    },
    onDropFolder: async (sourcePath, destFolder) => {
      const name = sourcePath.split('/').filter(Boolean).pop();
      if (!name) return;
      const targetPath = `${destFolder}/${name}`;
      try {
        await renameFile(sourcePath, targetPath);
        if (onToast) onToast(`Moved ${name} → ${destFolder.split('/').pop()}`);
        if (fileTreePath) navigateTo(fileTreePath);
      } catch (err: any) {
        if (onToast) onToast(`Move failed: ${err?.message || err}`, true);
      }
    },
  });

  // Load file tree when project path changes
  useEffect(() => {
    if (!activeWorkspace?.projectPath) {
      setFileTree([]);
      setFileTreePath('');
      return;
    }
    const root = activeWorkspace.projectPath;
    rootPathRef.current = root;
    listFiles(root)
      .then((r) => {
        setFileTree(r.files || []);
        setFileTreePath(root);
      })
      .catch(() => {});
  }, [activeWorkspace?.projectPath]);

  // Reset search when active workspace or its project path changes
  useEffect(() => {
    setFileSearchQuery('');
    setSearchResults([]);
    setIsSearchingFiles(false);
  }, [activeWorkspace?.id, activeWorkspace?.projectPath]);

  // Handle file search with instant local filter + debounced recursive search
  useEffect(() => {
    const q = fileSearchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearchingFiles(false);
      return;
    }

    const lower = q.toLowerCase();
    // Immediate local matches from current fileTree for 0ms visual response
    const localMatches: FileSearchResult[] = fileTree
      .filter((f) => f.name.toLowerCase().includes(lower))
      .map((f) => ({
        name: f.name,
        path: fileTreePath ? `${fileTreePath}/${f.name}` : f.name,
        rel_path: f.name,
        is_dir: f.is_dir,
      }));
    setSearchResults(localMatches);

    const root = activeWorkspace?.projectPath || fileTreePath;
    if (!root) return;

    let active = true;
    setIsSearchingFiles(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchProjectFiles(root, q, 100);
        if (active) {
          const map = new Map<string, FileSearchResult>();
          for (const item of localMatches) {
            map.set(item.path, item);
          }
          for (const item of res.results || []) {
            map.set(item.path, item);
          }
          setSearchResults(Array.from(map.values()));
        }
      } catch (err) {
        console.warn('Failed to search project files:', err);
      } finally {
        if (active) setIsSearchingFiles(false);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fileSearchQuery, activeWorkspace?.projectPath, fileTree, fileTreePath]);

  // ── Terminal helpers (scoped strictly to current active workspace) ──
  const terminalList = useMemo(() => {
    if (!terminals || Object.keys(terminals).length === 0) return [];
    const currentWs = activeWorkspace || workspaces[0];
    if (!currentWs || !currentWs.panes) return [];

    const seen = new Set<string>();
    const result: Array<{
      tty: string;
      label: string;
      cli: string;
      status: TermStatus;
      statusLabelInfo: { text: string; color: string };
      duration: ReturnType<typeof getTerminalWorkDuration>;
      paneLabel?: string;
      registeredAt?: number;
    }> = [];

    let paneCounter = 1;
    for (const p of currentWs.panes) {
      if (p.tty && !seen.has(p.tty)) {
        seen.add(p.tty);
        const entry = terminals[p.tty];
        const closed = isClosed(entry || minTerminal(p.tty));
        const meta = TerminalManager.getTerminalMetadata(
          p.tty,
          entry,
          closed,
          detectCLI,
          deriveTaskStatus,
          getTerminalWorkDuration,
          'shell'
        );

        const defaultName = meta.cliName && meta.cli !== 'shell'
          ? `${meta.cliName} · ${paneCounter}`
          : (entry?.session_name || entry?.pane_title || `Terminal ${paneCounter}`);

        const label = p.label || defaultName;

        result.push({
          tty: p.tty,
          label,
          cli: meta.cli,
          status: meta.status,
          statusLabelInfo: statusLabel(meta.status),
          duration: meta.duration,
          paneLabel: p.label,
          registeredAt: entry?.registered_at,
        });
        paneCounter++;
      }
    }
    return result;
  }, [terminals, activeWorkspace, workspaces, tick]);

  const startRename = (ws: Workspace) => {
    setEditingId(ws.id);
    setNameDraft(ws.name);
  };

  const commitRename = (id: string) => {
    const name = nameDraft.trim();
    if (name) onRenameWorkspace(id, name);
    setEditingId(null);
  };

  const rootPathRef = useRef<string>('');
  const navigateTo = useCallback((path: string) => {
    listFiles(path)
      .then((r) => {
        setFileTree(r.files || []);
        setFileTreePath(path);
      })
      .catch(() => {
        setFileTree([]);
        setFileTreePath(path);
      });
  }, []);

  const toggleDir = useCallback(
    (path: string) => {
      if (fileTreePath === path) {
        const parent = fileTreePath.split('/').slice(0, -1).join('/') || rootPathRef.current;
        navigateTo(parent);
        return;
      }
      navigateTo(path);
    },
    [fileTreePath, navigateTo]
  );

  const goUp = useCallback(() => {
    if (!fileTreePath) return;
    const parent = fileTreePath.split('/').slice(0, -1).join('/') || rootPathRef.current;
    navigateTo(parent);
  }, [fileTreePath, navigateTo]);

  const renderFileRow = (
    name: string,
    fullPath: string,
    isDir: boolean,
    relPath?: string,
    keyPrefix = ''
  ) => {
    const dirHint =
      relPath && relPath !== name && relPath.includes('/')
        ? relPath.slice(0, relPath.lastIndexOf('/'))
        : '';

    return (
      <div
        key={`${keyPrefix}-${fullPath}`}
        className={`fb-item ${isDir ? 'fb-dir' : 'fb-file'}`}
        data-folder-path={isDir ? fullPath : undefined}
        draggable={true}
        onMouseDown={(e) => {
          beginDrag(e, {
            label: name,
            path: fullPath,
            kind: isDir ? 'folder' : 'file',
          });
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', fullPath);
          e.dataTransfer.setData('application/x-tto-file', fullPath);
          e.dataTransfer.setData('text/uri-list', `file://${encodeURI(fullPath)}`);
          e.dataTransfer.effectAllowed = 'copyMove';

          try {
            const ghost = document.createElement('div');
            ghost.className = 'tto-drag-ghost';
            const emoji = isDir ? '📁' : '📄';
            ghost.textContent = `${emoji} ${name}`;
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 0, 0);
            setTimeout(() => ghost.remove(), 0);
          } catch {}
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px 4px 16px',
          fontSize: '11.5px',
          color: isDir ? t.colors.text.secondary : t.colors.text.muted,
          cursor: 'grab',
          borderRadius: '4px',
          transition: 'all 0.12s ease',
          userSelect: 'none',
        }}
        onClick={() => {
          if (consumeDrag()) return;
          if (isDir) {
            toggleDir(fullPath);
            if (fileSearchQuery) setFileSearchQuery('');
          } else {
            onOpenFile(fullPath, name);
          }
        }}
        title={relPath || fullPath}
      >
        {isDir ? <FolderIcon name={name} open={false} size={14} /> : <FileRowIcon name={name} />}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            maxWidth: dirHint ? '135px' : '100%',
          }}
        >
          {name}
        </span>
        {dirHint && (
          <span
            style={{
              fontSize: '9.5px',
              color: t.colors.text.muted,
              opacity: 0.6,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginLeft: 'auto',
              maxWidth: '85px',
              textAlign: 'right',
            }}
            title={relPath}
          >
            {dirHint}
          </span>
        )}
      </div>
    );
  };

  const handlePickFolder = async (wsId: string) => {
    if (!checkTauri()) return;
    try {
      const path = await tauri.pickFolder();
      if (path) onSetProjectPath(wsId, path);
    } catch {}
  };

  return (
    <aside
      style={{
        width: sidebarOpen ? t.layout.sidebarWidth : '48px',
        minWidth: sidebarOpen ? t.layout.sidebarWidth : '48px',
        maxWidth: sidebarOpen ? t.layout.sidebarWidth : '48px',
        background: t.colors.bg.secondary,
        borderRight: `1px solid ${t.colors.border.primary}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
        transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        userSelect: 'none',
      }}
    >
      {/* Hidden picker for workspace icon uploads (driven by the per-row buttons) */}
      <input
        ref={iconFileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onIconFileChosen}
      />
      {/* ── Top Header ── */}
      <div
        style={{
          height: '48px',
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderBottom: `1px solid ${t.colors.border.primary}`,
          flexShrink: 0,
        }}
      >
        <button
          style={{
            ...buttonBase(t),
            ...buttonSize(t, 'sm'),
            ...buttonVariant(t, 'ghost'),
            width: '28px',
            height: '28px',
            padding: 0,
            flexShrink: 0,
            borderRadius: '6px',
          }}
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>

        {sidebarOpen && (
          <>
            <img
              src="/desktop-icon.png"
              alt="Task Orchestrator Logo"
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                flexShrink: 0,
                objectFit: 'cover',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: '13px',
                fontWeight: '600',
                color: t.colors.text.primary,
                letterSpacing: '-0.2px',
              }}
            >
              Task Orchestrator
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                background: t.colors.bg.elevated,
                border: `1px solid ${t.colors.border.primary}`,
                borderRadius: '12px',
                color: t.colors.text.muted,
                fontWeight: '500',
                fontFamily: t.fontFamily.mono,
              }}
            >
              v1.0
            </span>
          </>
        )}
      </div>

      {/* ── Collapsed icon strip ── */}
      {!sidebarOpen && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 0',
            flex: 1,
          }}
        >
          <img
            src="/desktop-icon.png"
            alt="Task Orchestrator"
            style={{ width: '26px', height: '26px', borderRadius: '6px', objectFit: 'cover' }}
          />

          <div style={{ width: '24px', height: '1px', background: t.colors.border.primary, margin: '4px 0' }} />

          {VIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onView(tab.key)}
              title={tab.label}
              aria-label={tab.label}
              aria-current={view === tab.key}
              style={{
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: 'none',
                background: view === tab.key ? t.colors.bg.active : 'transparent',
                color: view === tab.key ? t.colors.accent.primary : t.colors.text.muted,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.icon}
            </button>
          ))}

          <button
            onClick={() => onView('settings')}
            title="Account & Settings"
            aria-label="Account & Settings"
            aria-current={view === 'settings'}
            style={{
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: 'none',
              background: view === 'settings' ? t.colors.accent.light : 'transparent',
              color: view === 'settings' ? t.colors.accent.primary : t.colors.text.muted,
              cursor: 'pointer',
              marginTop: 'auto',
              marginBottom: '4px',
            }}
          >
            <Settings size={14} />
          </button>

          <button
            onClick={onToggleSidebar}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            style={{
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: 'none',
              background: 'transparent',
              color: t.colors.text.muted,
              cursor: 'pointer',
            }}
          >
            <PanelLeftOpen size={15} />
          </button>
        </div>
      )}

      {/* ── Expanded sidebar body ── */}
      {sidebarOpen && (
        <>
          {/* Segmented view switcher (2x2 Grid) */}
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${t.colors.border.primary}` }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                background: t.colors.bg.primary,
                padding: '4px',
                borderRadius: '8px',
                border: `1px solid ${t.colors.border.subtle}`,
                gap: '4px',
              }}
            >
              {VIEW_TABS.map((tab) => {
                const isSelected = view === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => onView(tab.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '7px',
                      padding: '7px 8px',
                      borderRadius: '6px',
                      fontSize: '11.5px',
                      fontWeight: isSelected ? '600' : '500',
                      color: isSelected ? t.colors.text.primary : t.colors.text.secondary,
                      background: isSelected ? t.colors.bg.elevated : 'transparent',
                      border: isSelected
                        ? `1px solid ${t.colors.border.primary}`
                        : '1px solid transparent',
                      boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.35)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = t.colors.bg.hover;
                        e.currentTarget.style.color = t.colors.text.primary;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = t.colors.text.secondary;
                      }
                    }}
                  >
                    <span style={{ color: isSelected ? t.colors.accent.primary : t.colors.text.muted, display: 'flex', alignItems: 'center' }}>
                      {tab.icon}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Connection status strip */}
          <div
            style={{
              margin: '8px 10px 0',
              padding: '5px 8px',
              background: connected ? 'rgba(34, 197, 94, 0.06)' : 'rgba(239, 68, 68, 0.06)',
              border: `1px solid ${connected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)'}`,
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              fontSize: '11px',
              color: connected ? '#22c55e' : '#ef4444',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'currentColor',
                boxShadow: connected ? '0 0 6px rgba(34, 197, 94, 0.6)' : '0 0 6px rgba(239, 68, 68, 0.6)',
                flexShrink: 0,
              }}
            />
            <span style={{ fontWeight: '500', fontSize: '10.5px' }}>
              {connected ? 'Backend Connected' : 'Backend Disconnected'}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '9.5px', opacity: 0.7, fontFamily: t.fontFamily.mono }}>
              {connected ? 'READY' : 'OFFLINE'}
            </span>
          </div>

          {/* Scrollable list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 12px', ...scrollbarStyle(t) }}>
            {/* Workspaces Section */}
            <div style={{ marginBottom: '14px' }}>
              {/* Header row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 6px 4px',
                  marginBottom: '2px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: '700',
                      color: t.colors.text.muted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.8px',
                    }}
                  >
                    Workspaces
                  </span>
                  <span
                    style={{
                      fontSize: '9.5px',
                      padding: '1px 5px',
                      borderRadius: '8px',
                      background: t.colors.bg.elevated,
                      border: `1px solid ${t.colors.border.subtle}`,
                      color: t.colors.text.muted,
                      fontWeight: '600',
                    }}
                  >
                    {workspaces.length}
                  </span>
                </div>

                {/* Action buttons: Professional Open Project + New Template */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onOpenProjectFolder) {
                        onOpenProjectFolder();
                      } else {
                        handlePickFolder(activeId);
                      }
                    }}
                    title="Open any project folder from Finder"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 9px',
                      borderRadius: '6px',
                      background: 'linear-gradient(180deg, rgba(56, 189, 248, 0.18) 0%, rgba(56, 189, 248, 0.08) 100%)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      color: '#38bdf8',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
                      transition: 'all 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
                      lineHeight: '13px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(180deg, rgba(56, 189, 248, 0.28) 0%, rgba(56, 189, 248, 0.16) 100%)';
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.6)';
                      e.currentTarget.style.color = '#7dd3fc';
                      e.currentTarget.style.boxShadow = '0 2px 10px rgba(56, 189, 248, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(180deg, rgba(56, 189, 248, 0.18) 0%, rgba(56, 189, 248, 0.08) 100%)';
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                      e.currentTarget.style.color = '#38bdf8';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = 'scale(0.96)';
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    <FolderOpen size={12} style={{ flexShrink: 0 }} />
                    <span>Open Project</span>
                  </button>

                  <button
                    type="button"
                    onClick={onNewWorkspace}
                    title="Create new workspace template"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      borderRadius: '6px',
                      background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)',
                      border: `1px solid ${t.colors.border.subtle}`,
                      color: t.colors.text.secondary,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)',
                      transition: 'all 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 100%)';
                      e.currentTarget.style.color = t.colors.text.primary;
                      e.currentTarget.style.borderColor = t.colors.border.primary;
                      e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)';
                      e.currentTarget.style.color = t.colors.text.secondary;
                      e.currentTarget.style.borderColor = t.colors.border.subtle;
                      e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = 'scale(0.95)';
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>

              {/* Workspace cards list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {workspaces.map((ws) => {
                  const isActive = ws.id === activeId;
                  const isHovered = hoveredWsId === ws.id;
                  const editing = editingId === ws.id;
                  const isMenuOpen = menuOpenWsId === ws.id;
                  const liveCount = ws.panes?.filter((p) => p.tty).length || 0;
                  const palette = getWorkspacePalette(ws.id, ws.name);
                  const initials = getWorkspaceInitials(ws.name);

                  return (
                    <div
                      key={ws.id}
                      style={{ position: 'relative' }}
                      onMouseEnter={() => setHoveredWsId(ws.id)}
                      onMouseLeave={() => setHoveredWsId(null)}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px 10px',
                          background: isActive
                            ? t.colors.bg.active
                            : isHovered
                              ? t.colors.bg.hover
                              : 'transparent',
                          cursor: 'pointer',
                          borderRadius: '7px',
                          border: isActive
                            ? `1px solid ${t.colors.border.primary}`
                            : isHovered
                              ? `1px solid ${t.colors.border.subtle}`
                              : '1px solid transparent',
                          boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.25)' : 'none',
                          transition: 'all 0.12s ease',
                          position: 'relative',
                        }}
                        onClick={() => !editing && onSelectWorkspace(ws.id)}
                      >
                        {/* Active indicator bar */}
                        {isActive && (
                          <span
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: '6px',
                              bottom: '6px',
                              width: '3.5px',
                              borderRadius: '0 4px 4px 0',
                              background: t.colors.accent.primary,
                              boxShadow: '0 0 8px rgba(56, 189, 248, 0.4)',
                            }}
                          />
                        )}

                        {/* Workspace Colored Avatar */}
                        <span
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '7px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            fontWeight: '700',
                            background: ws.logo ? 'transparent' : (isActive
                              ? palette.bg.replace('0.14', '0.24')
                              : palette.bg),
                            color: palette.text,
                            border: `1px solid ${isActive ? palette.border.replace('0.3', '0.6') : palette.border}`,
                            boxShadow: isActive ? `0 0 10px ${palette.text}33` : 'none',
                            flexShrink: 0,
                            letterSpacing: '0.2px',
                            fontFamily: t.fontFamily.mono,
                            transition: 'all 0.15s ease',
                            overflow: 'hidden',
                          }}
                        >
                          {ws.logo && !brokenLogos.has(ws.id) ? (
                            <img
                              src={ws.logo}
                              alt=""
                              onError={() => setBrokenLogos((prev) => new Set(prev).add(ws.id))}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            />
                          ) : (
                            initials
                          )}
                        </span>

                        {editing ? (
                          <input
                            autoFocus
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onBlur={() => commitRename(ws.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(ws.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              ...inputBase(t),
                              flex: 1,
                              height: '24px',
                              fontSize: t.fontSize.xs,
                              padding: '2px 6px',
                            }}
                          />
                        ) : (
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: '12.5px',
                                color: isActive ? t.colors.text.primary : t.colors.text.secondary,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontWeight: isActive ? '600' : '500',
                                letterSpacing: '-0.1px',
                              }}
                            >
                              {ws.name}
                            </div>

                            {/* Clean metadata row (no messy clutter buttons) */}
                            <div
                              style={{
                                fontSize: '10px',
                                color: t.colors.text.muted,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginTop: '2px',
                                overflow: 'hidden',
                              }}
                            >
                              {/* Clean project directory label */}
                              {ws.projectPath ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3.5px',
                                    fontFamily: t.fontFamily.mono,
                                    fontSize: '9.5px',
                                    color: isActive ? t.colors.text.secondary : t.colors.text.muted,
                                    background: isActive ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                                    border: `1px solid ${isActive ? t.colors.border.subtle : 'transparent'}`,
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    maxWidth: '120px',
                                    transition: 'all 0.14s ease',
                                    cursor: 'pointer',
                                  }}
                                  title={`${ws.projectPath} (Click to change folder in Finder)`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePickFolder(ws.id);
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(56, 189, 248, 0.14)';
                                    e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                                    e.currentTarget.style.color = '#38bdf8';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = isActive ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)';
                                    e.currentTarget.style.borderColor = isActive ? t.colors.border.subtle : 'transparent';
                                    e.currentTarget.style.color = isActive ? t.colors.text.secondary : t.colors.text.muted;
                                  }}
                                >
                                  <FolderOpen size={10} style={{ flexShrink: 0, opacity: 0.85 }} />
                                  <span>{baseName(ws.projectPath)}</span>
                                </span>
                              ) : (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    fontSize: '9px',
                                    color: t.colors.text.muted,
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    border: `1px dashed ${t.colors.border.subtle}`,
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    transition: 'all 0.14s ease',
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePickFolder(ws.id);
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.color = t.colors.accent.primary;
                                    e.currentTarget.style.borderColor = t.colors.accent.primary;
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.color = t.colors.text.muted;
                                    e.currentTarget.style.borderColor = t.colors.border.subtle;
                                  }}
                                  title="Assign project folder from Finder"
                                >
                                  <FolderOpen size={9} />
                                  <span>+ Folder</span>
                                </span>
                              )}

                              <span style={{ opacity: 0.3 }}>·</span>

                              {/* Layout Template Badge */}
                              <span
                                style={{
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  background: t.colors.bg.elevated,
                                  border: `1px solid ${t.colors.border.subtle}`,
                                  borderRadius: '4px',
                                  color: t.colors.text.muted,
                                  fontWeight: '500',
                                  flexShrink: 0,
                                }}
                              >
                                {templateLabel(ws.template as TemplateKey)}
                              </span>

                              {/* Terminal live count indicator */}
                              {liveCount > 0 ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3.5px',
                                    color: '#22c55e',
                                    fontSize: '9.5px',
                                    fontWeight: '500',
                                    flexShrink: 0,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: '5px',
                                      height: '5px',
                                      borderRadius: '50%',
                                      background: '#22c55e',
                                      boxShadow: '0 0 5px rgba(34, 197, 94, 0.6)',
                                    }}
                                  />
                                  <span>{liveCount}</span>
                                </span>
                              ) : (
                                <span style={{ fontSize: '9px', color: t.colors.text.muted, opacity: 0.6, flexShrink: 0 }}>
                                  idle
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Single clean overflow options menu button */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            opacity: isHovered || isActive || isMenuOpen ? 1 : 0,
                            transition: 'opacity 0.15s ease',
                            flexShrink: 0,
                          }}
                        >
                          <button
                            type="button"
                            style={{
                              width: '22px',
                              height: '22px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: isMenuOpen ? t.colors.bg.elevated : 'transparent',
                              border: 'none',
                              color: isMenuOpen ? t.colors.text.primary : t.colors.text.muted,
                              cursor: 'pointer',
                              padding: 0,
                              transition: 'all 0.12s ease',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenWsId(isMenuOpen ? null : ws.id);
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = t.colors.bg.elevated;
                              e.currentTarget.style.color = t.colors.text.primary;
                            }}
                            onMouseLeave={(e) => {
                              if (!isMenuOpen) {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.color = t.colors.text.muted;
                              }
                            }}
                            title="Workspace options"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Floating Context Dropdown Menu */}
                      {isMenuOpen && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute',
                            right: '8px',
                            top: '38px',
                            zIndex: 100,
                            background: t.colors.bg.elevated,
                            border: `1px solid ${t.colors.border.primary}`,
                            borderRadius: '8px',
                            padding: '4px',
                            minWidth: '180px',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpenWsId(null);
                              handlePickFolder(ws.id);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 10px',
                              borderRadius: '5px',
                              background: 'transparent',
                              border: 'none',
                              color: t.colors.text.primary,
                              fontSize: '11px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.hover; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <FolderOpen size={13} style={{ color: t.colors.accent.primary }} />
                            <span>Change Project Folder...</span>
                          </button>

                          {ws.projectPath && (
                            <button
                              type="button"
                              onClick={() => {
                                setMenuOpenWsId(null);
                                tauri.revealInFinder(ws.projectPath!);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 10px',
                                borderRadius: '5px',
                                background: 'transparent',
                                border: 'none',
                                color: t.colors.text.primary,
                                fontSize: '11px',
                                cursor: 'pointer',
                                textAlign: 'left',
                                width: '100%',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.hover; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <ExternalLink size={13} style={{ color: '#2dd4bf' }} />
                              <span>Reveal in macOS Finder</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpenWsId(null);
                              pickWorkspaceIcon(ws.id);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 10px',
                              borderRadius: '5px',
                              background: 'transparent',
                              border: 'none',
                              color: t.colors.text.primary,
                              fontSize: '11px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.hover; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <ImagePlus size={13} style={{ color: '#fbbf24' }} />
                            <span>Change Workspace Icon...</span>
                          </button>

                          {ws.logo && onSetWorkspaceLogo && (
                            <button
                              type="button"
                              onClick={() => {
                                setMenuOpenWsId(null);
                                onSetWorkspaceLogo(ws.id, null);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 10px',
                                borderRadius: '5px',
                                background: 'transparent',
                                border: 'none',
                                color: t.colors.text.secondary,
                                fontSize: '11px',
                                cursor: 'pointer',
                                textAlign: 'left',
                                width: '100%',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.hover; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <Trash2 size={13} />
                              <span>Reset Icon to Initials</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpenWsId(null);
                              startRename(ws);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 10px',
                              borderRadius: '5px',
                              background: 'transparent',
                              border: 'none',
                              color: t.colors.text.primary,
                              fontSize: '11px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.hover; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <Pencil size={13} style={{ color: '#38bdf8' }} />
                            <span>Rename Workspace</span>
                          </button>

                          <div style={{ height: '1px', background: t.colors.border.subtle, margin: '2px 0' }} />

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpenWsId(null);
                              onCloseWorkspace(ws.id);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 10px',
                              borderRadius: '5px',
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              fontSize: '11px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <X size={13} />
                            <span>Close Workspace</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Terminals Section (Scoped to Current Active Workspace) ── */}
            <div style={{ height: '1px', background: t.colors.border.subtle, margin: '8px 0' }} />
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 6px',
                  fontSize: '10.5px',
                  fontWeight: '700',
                  color: t.colors.text.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  borderRadius: '6px',
                  userSelect: 'none',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    flex: 1,
                  }}
                  onClick={() => setTerminalsOpen((o) => !o)}
                  onMouseEnter={(e) => { e.currentTarget.style.color = t.colors.text.primary; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = t.colors.text.muted; }}
                >
                  {terminalsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Terminal size={12} style={{ color: t.colors.accent.primary }} />
                  <span>Terminals</span>
                  <span
                    style={{
                      fontSize: '9.5px',
                      padding: '1px 5px',
                      borderRadius: '8px',
                      background: t.colors.bg.elevated,
                      border: `1px solid ${t.colors.border.subtle}`,
                      color: t.colors.text.muted,
                      fontWeight: '600',
                    }}
                  >
                    {terminalList.length}
                  </span>
                </div>

                {/* Quick Add Terminal Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddTerminal();
                  }}
                  title="Add terminal pane to active workspace"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    borderRadius: '4px',
                    background: 'transparent',
                    border: 'none',
                    color: t.colors.text.muted,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
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
                  <Plus size={13} />
                </button>
              </div>

              {terminalsOpen && (
                <div style={{ maxHeight: '280px', overflowY: 'auto', padding: '2px 0', ...scrollbarStyle(t) }}>
                  {terminalList.length === 0 ? (
                    <div style={{ padding: '8px 12px', fontSize: '11px', color: t.colors.text.muted, fontStyle: 'italic' }}>
                      No active terminals in workspace
                    </div>
                  ) : (
                    terminalList.map(({ tty, label, cli, status, statusLabelInfo, duration }) => {
                      const isActive = tty === focusedTerminal;
                      const isEditing = editingTerminalId === tty;
                      const isHovered = hoveredTty === tty;

                      return (
                        <div
                          key={tty}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '7px',
                            height: '30px',
                            padding: '0 8px 0 10px',
                            background: isActive
                              ? t.colors.bg.active
                              : isHovered
                              ? t.colors.bg.hover
                              : 'transparent',
                            borderLeft: isActive
                              ? `2.5px solid ${t.colors.accent.primary}`
                              : '2.5px solid transparent',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            transition: 'all 0.12s ease',
                            position: 'relative',
                          }}
                          onMouseEnter={() => setHoveredTty(tty)}
                          onMouseLeave={() => setHoveredTty(null)}
                          onClick={() => onSelectTerminal?.(tty)}
                          title={`${label} · ${cli || 'shell'} (${tty})\nStatus: ${statusLabelInfo.text}${
                            status === 'running'
                              ? `\nStarted: ${duration.startTimeFormatted}\nDuration: ${duration.durationStr}`
                              : status === 'asking'
                              ? `\nWaiting: ${duration.durationStr}`
                              : (duration as any)?.lastTaskDurationStr
                              ? `\nLast Task: ${(duration as any).lastTaskDurationStr}${duration.endTimeFormatted ? ` (ended ${duration.endTimeFormatted})` : ''}`
                              : '\n(Idle)'
                          }`}
                        >
                          {/* Status dot */}
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: statusLabelInfo.color,
                              boxShadow: status === 'running' || status === 'asking'
                                ? `0 0 5px ${statusLabelInfo.color}80`
                                : 'none',
                              flexShrink: 0,
                            }}
                          />

                          {/* CLI Logo / Terminal Icon */}
                          {cli && ['zsh', 'bash', 'sh'].includes(cli) ? (
                            <Terminal size={12} style={{ opacity: 0.75, color: isActive ? t.colors.accent.primary : t.colors.text.muted, flexShrink: 0 }} />
                          ) : (
                            <CliLogo cli={cli} size={13} />
                          )}

                          {/* Terminal name / editor input */}
                          {isEditing ? (
                            <input
                              autoFocus
                              value={terminalNameDraft}
                              onChange={(e) => setTerminalNameDraft?.(e.target.value)}
                              onBlur={() => commitRenameTerminal?.(tty)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRenameTerminal?.(tty);
                                if (e.key === 'Escape') { onCancelRenameTerminal?.(); }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                ...inputBase(t),
                                flex: 1,
                                height: '22px',
                                fontSize: '11px',
                                padding: '2px 6px',
                              }}
                            />
                          ) : (
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '11.5px',
                                fontWeight: isActive ? 600 : 500,
                                color: isActive ? t.colors.text.primary : t.colors.text.secondary,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                letterSpacing: '-0.1px',
                              }}
                            >
                              {label}
                            </span>
                          )}

                          {/* Status & Duration Tag (compact, professional, monospace) */}
                          {!isEditing && (!isHovered || !onCloseTerminal) && duration && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                padding: '1.5px 5.5px',
                                borderRadius: '4px',
                                fontSize: '9px',
                                fontWeight: 600,
                                fontFamily: t.fontFamily.mono,
                                background: status === 'running'
                                  ? 'rgba(34, 197, 94, 0.12)'
                                  : status === 'asking'
                                  ? 'rgba(245, 158, 11, 0.12)'
                                  : 'rgba(100, 116, 139, 0.12)',
                                border: `1px solid ${
                                  status === 'running'
                                    ? 'rgba(34, 197, 94, 0.25)'
                                    : status === 'asking'
                                    ? 'rgba(245, 158, 11, 0.25)'
                                    : 'rgba(100, 116, 139, 0.25)'
                                }`,
                                color: statusLabelInfo.color,
                                flexShrink: 0,
                                lineHeight: '13px',
                              }}
                            >
                              {status === 'running'
                                ? duration.durationStr || 'RUNNING'
                                : status === 'asking'
                                ? duration.durationStr ? `ASK (${duration.durationStr})` : 'ASKING'
                                : status === 'over' && duration.durationStr
                                ? `OVER (${duration.durationStr})`
                                : statusLabelInfo.text}
                            </span>
                          )}

                          {/* Action buttons (Rename & Close) — revealed on hover */}
                          {!isEditing && isHovered && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                flexShrink: 0,
                              }}
                            >
                              <button
                                style={{
                                  width: '20px',
                                  height: '20px',
                                  borderRadius: '4px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: 'transparent',
                                  border: 'none',
                                  color: t.colors.text.muted,
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRenameTerminal?.(tty, label);
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = t.colors.bg.elevated;
                                  e.currentTarget.style.color = t.colors.text.primary;
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent';
                                  e.currentTarget.style.color = t.colors.text.muted;
                                }}
                                title="Rename terminal"
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                style={{
                                  width: '20px',
                                  height: '20px',
                                  borderRadius: '4px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: 'transparent',
                                  border: 'none',
                                  color: t.colors.text.muted,
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCloseTerminal?.(tty);
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                  e.currentTarget.style.color = '#f87171';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent';
                                  e.currentTarget.style.color = t.colors.text.muted;
                                }}
                                title="Close terminal"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>


            {/* Subtle Divider */}
            <div style={{ height: '1px', background: t.colors.border.primary, margin: '10px 0' }} />

            {/* Project Files Section */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 8px',
                  fontSize: '10.5px',
                  fontWeight: '700',
                  color: t.colors.text.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  transition: 'all 0.12s ease',
                }}
                onClick={() => setFilesOpen((o) => !o)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = t.colors.bg.hover;
                  e.currentTarget.style.color = t.colors.text.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = t.colors.text.muted;
                }}
              >
                {filesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Folder size={12} style={{ color: t.colors.accent.primary }} />
                <span>Project Files</span>
                {activeWorkspace?.projectPath && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: '9.5px',
                      color: t.colors.text.muted,
                      fontFamily: t.fontFamily.mono,
                      maxWidth: '90px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {baseName(activeWorkspace.projectPath)}
                  </span>
                )}
              </div>

              {filesOpen && (
                <>
                  {/* Search Input Bar */}
                  <div style={{ padding: '2px 8px 6px 8px' }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <Search
                        size={12}
                        style={{
                          position: 'absolute',
                          left: '8px',
                          color: t.colors.text.muted,
                          pointerEvents: 'none',
                          opacity: 0.6,
                        }}
                      />
                      <input
                        type="text"
                        value={fileSearchQuery}
                        onChange={(e) => setFileSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setFileSearchQuery('');
                          } else if (e.key === 'Enter' && searchResults.length > 0) {
                            const top = searchResults[0];
                            if (top.is_dir) {
                              navigateTo(top.path);
                              setFileSearchQuery('');
                            } else {
                              onOpenFile(top.path, top.name);
                            }
                          }
                        }}
                        placeholder="Search files..."
                        style={{
                          width: '100%',
                          height: '24px',
                          background: t.colors.bg.tertiary,
                          border: `1px solid ${t.colors.border.subtle || t.colors.border.primary}`,
                          borderRadius: '4px',
                          paddingLeft: '26px',
                          paddingRight: fileSearchQuery ? '24px' : '8px',
                          fontSize: '11px',
                          color: t.colors.text.primary,
                          outline: 'none',
                          boxSizing: 'border-box',
                          fontFamily: 'inherit',
                          transition: 'border-color 0.15s ease',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = t.colors.accent.primary;
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = t.colors.border.subtle || t.colors.border.primary;
                        }}
                      />
                      {fileSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setFileSearchQuery('')}
                          style={{
                            position: 'absolute',
                            right: '6px',
                            background: 'transparent',
                            border: 'none',
                            padding: '2px',
                            cursor: 'pointer',
                            color: t.colors.text.muted,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          title="Clear search (Esc)"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className={`fb-tree${dragOverTree ? ' drag-over' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                      setDragOverTree(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverTree(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverTree(false);
                      const paths = extractDropPaths(e.dataTransfer);
                      if (paths.length > 0) {
                        if (onToast) onToast(`Received ${paths.length} file(s) in project folder`);
                        if (fileTreePath) navigateTo(fileTreePath);
                      }
                    }}
                    style={{
                      maxHeight: '260px',
                      overflowY: 'auto',
                      position: 'relative',
                      padding: '2px 0',
                      borderRadius: '6px',
                    }}
                  >
                    {dragOverTree && (
                      <div className="fb-drop-overlay">
                        <span>📂 Drop files here</span>
                      </div>
                    )}

                    {fileSearchQuery.trim() ? (
                      /* ── Search Results Mode ── */
                      <>
                        <div
                          style={{
                            padding: '2px 10px 4px 10px',
                            fontSize: '10px',
                            color: t.colors.text.muted,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderBottom: `1px solid ${t.colors.border.subtle || t.colors.border.primary}`,
                            marginBottom: '2px',
                          }}
                        >
                          <span>
                            {isSearchingFiles
                              ? 'Searching...'
                              : `${searchResults.length} ${searchResults.length === 1 ? 'result' : 'results'}`}
                          </span>
                        </div>

                        {searchResults.length === 0 && !isSearchingFiles && (
                          <div
                            style={{
                              padding: '12px 10px',
                              fontSize: '11px',
                              color: t.colors.text.muted,
                              fontStyle: 'italic',
                              textAlign: 'center',
                            }}
                          >
                            No files found matching &quot;{fileSearchQuery}&quot;
                          </div>
                        )}

                        {searchResults.map((item) =>
                          renderFileRow(item.name, item.path, item.is_dir, item.rel_path, 'search')
                        )}
                      </>
                    ) : (
                      /* ── Standard Directory Tree Mode ── */
                      <>
                        {/* Up one level */}
                        {fileTreePath && fileTreePath !== rootPathRef.current && (
                          <button
                            onClick={goUp}
                            title={fileTreePath}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              width: '100%',
                              padding: '4px 8px 4px 12px',
                              background: 'transparent',
                              border: 'none',
                              fontSize: '11px',
                              color: t.colors.text.secondary,
                              cursor: 'pointer',
                              textAlign: 'left',
                              borderRadius: '4px',
                              transition: 'background 0.12s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = t.colors.bg.hover;
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            <span style={{ fontSize: '11px' }}>↑</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {baseName(fileTreePath)}
                            </span>
                          </button>
                        )}

                        {fileTree.length === 0 && (
                          <div
                            style={{
                              padding: '8px 12px',
                              fontSize: '11px',
                              color: t.colors.text.muted,
                              fontStyle: 'italic',
                            }}
                          >
                            {activeWorkspace?.projectPath ? 'Loading directory...' : 'No project folder selected'}
                          </div>
                        )}

                        {fileTree
                          .sort((a, b) => (b.is_dir ? 1 : 0) - (a.is_dir ? 1 : 0) || a.name.localeCompare(b.name))
                          .map((entry) => {
                            const fullPath = fileTreePath ? `${fileTreePath}/${entry.name}` : entry.name;
                            return renderFileRow(entry.name, fullPath, entry.is_dir, undefined, 'tree');
                          })}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Editor Section ── */}
          {openFiles && openFiles.length > 0 && (
            <>
              <div style={{ height: '1px', background: t.colors.border.primary, margin: '10px 0' }} />
              <div>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 8px', fontSize: '10.5px', fontWeight: '700',
                    color: t.colors.text.muted, textTransform: 'uppercase',
                    letterSpacing: '0.6px', cursor: 'pointer', borderRadius: '6px',
                    transition: 'all 0.12s ease',
                  }}
                  onClick={() => setEditorOpen((o) => !o)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.hover; e.currentTarget.style.color = t.colors.text.primary; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.colors.text.muted; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {editorOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <FileCode size={12} style={{ color: t.colors.accent.primary }} />
                    <span>Editor</span>
                    <span style={{
                      fontSize: '9.5px', padding: '1px 5px', borderRadius: '8px',
                      background: t.colors.bg.elevated, border: `1px solid ${t.colors.border.subtle}`,
                      color: t.colors.text.muted, fontWeight: '600',
                    }}>{openFiles.length}</span>
                  </div>
                  {onSetViewMode && viewMode !== 'focus' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onSetViewMode('focus'); }}
                      title="Close editor"
                      style={{
                        width: '18px', height: '18px', borderRadius: '4px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: 'none',
                        color: t.colors.text.muted, cursor: 'pointer', padding: 0,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#f87171'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.colors.text.muted; }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>

                {editorOpen && (
                  <div style={{ maxHeight: '320px', overflowY: 'auto', padding: '2px 0', ...scrollbarStyle(t) }}>
                    {/* File tabs */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      borderBottom: `1px solid ${t.colors.border.subtle}`,
                      background: t.colors.bg.secondary,
                      height: '30px', flexShrink: 0,
                      overflowX: 'auto',
                    }}>
                      {openFiles.map((f) => {
                        const isActive = f.path === activeFile;
                        return (
                          <div
                            key={f.path}
                            onClick={() => onOpenFile(f.path, f.name)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              padding: '0 8px 0 10px',
                              height: '100%',
                              fontSize: '10.5px',
                              cursor: 'pointer',
                              userSelect: 'none',
                              borderRight: `1px solid ${t.colors.border.subtle}`,
                              borderBottom: isActive ? `2px solid ${t.colors.accent.primary}` : '2px solid transparent',
                              background: isActive ? t.colors.bg.primary : 'transparent',
                              color: isActive ? t.colors.text.primary : t.colors.text.muted,
                              transition: 'all 0.12s ease',
                              maxWidth: '140px', minWidth: '60px',
                            }}
                            title={f.path}
                          >
                            {f.dirty ? (
                              <span style={{ color: t.colors.warning.primary, fontSize: '9px' }}>●</span>
                            ) : (
                              <FileIcon name={f.name} size={12} />
                            )}
                            <span style={{
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              fontWeight: isActive ? 500 : 400,
                            }}>{f.name}</span>
                            <span
                              role="button"
                              onClick={(e) => { e.stopPropagation(); onCloseFile?.(f.path); }}
                              title="Close tab"
                              style={{ marginLeft: 'auto', padding: '1px', borderRadius: '3px', display: 'flex', alignItems: 'center', color: t.colors.text.muted, cursor: 'pointer', flexShrink: 0 }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.elevated; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <X size={10} />
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Editor window trigger */}
                    <div style={{ padding: '4px 2px 6px' }}>
                      {activeFile ? (
                        <button
                          onClick={() =>
                            onOpenFile(
                              activeFile,
                              openFiles.find((f) => f.path === activeFile)?.name || baseName(activeFile),
                            )
                          }
                          title={`Open ${activeFile} in editor window`}
                          style={{
                            ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'secondary'),
                            width: '100%', justifyContent: 'flex-start',
                            fontSize: '10.5px',
                          }}
                        >
                          <AppWindow size={11} style={{ color: t.colors.accent.primary }} />
                          Open in editor window
                        </button>
                      ) : (
                        <div style={{
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          minHeight: '96px',
                          color: t.colors.text.muted, gap: t.spacing.sm,
                          padding: t.spacing.md, textAlign: 'center',
                        }}>
                          <Code2 size={20} style={{ color: t.colors.accent.primary }} />
                          <div style={{ fontSize: t.fontSize.xs }}>No file open</div>
                          <div style={{ fontSize: '10px', opacity: 0.7 }}>Click a file in Project Files</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Footer ── */}
          <div
            style={{
              padding: '8px 10px',
              borderTop: `1px solid ${t.colors.border.primary}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: t.colors.bg.secondary,
              flexShrink: 0,
            }}
          >
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 8px',
                borderRadius: '5px',
                background: view === 'settings' ? t.colors.accent.light : 'transparent',
                border: view === 'settings' ? `1px solid ${t.colors.accent.primary}50` : '1px solid transparent',
                color: view === 'settings' ? t.colors.accent.primary : t.colors.text.secondary,
                fontWeight: view === 'settings' ? 600 : 400,
                fontSize: '11px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onClick={() => onView('settings')}
              onMouseEnter={(e) => {
                if (view !== 'settings') {
                  e.currentTarget.style.background = t.colors.bg.hover;
                  e.currentTarget.style.color = t.colors.text.primary;
                }
              }}
              onMouseLeave={(e) => {
                if (view !== 'settings') {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = t.colors.text.secondary;
                }
              }}
              title="Account Details, Plans & Settings"
            >
              <Settings size={13} />
              <span>Settings</span>
            </button>

            <span style={{ fontSize: '10px', color: t.colors.text.muted, fontFamily: t.fontFamily.mono }}>
              {workspaces.length} ws • {workspaces.reduce((acc, w) => acc + (w.panes?.length || 0), 0)} panes
            </span>
          </div>
        </>
      )}
    </aside>
  );
}
