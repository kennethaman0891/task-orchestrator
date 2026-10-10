// tto — Antigravity IDE View
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { UnifiedTerminal } from '@/types';
import type { Workspace } from '@/lib/workspace';
import {
  listFiles,
  getFile,
  putFile,
  createFile,
  createDir,
  deleteFile,
  renameFile,
  getGitStatus,
  searchProjectFiles,
  type GitStatus,
  type FileSearchResult,
} from '@/lib/api';
import { baseName, isImageFile, isBinaryFile, getLanguage } from '@/lib/format';
import { buttonBase, buttonSize, buttonVariant, inputBase, scrollbarStyle } from '@/lib/theme';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { ImageViewer } from '@/components/editor/ImageViewer';
import { BinaryViewer } from '@/components/editor/BinaryViewer';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  Terminal as TerminalIcon,
  ChevronUp,
  Maximize2,
  Minimize2,
  X,
  GitBranch,
  Code2,
  Trash2,
  Edit2,
  FilePlus,
  FolderPlus,
  FolderOpen,
  FileUp,
} from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderIcon, FileIcon } from '@/lib/treeIcons';

interface Props {
  activeWorkspace?: Workspace;
  workspaces: Workspace[];
  terminals?: Record<string, UnifiedTerminal>;
  openFiles: { path: string; name: string; dirty?: boolean }[];
  activeFile: string | null;
  onOpenFile: (path: string, name: string) => void;
  onCloseFile: (path: string) => void;
  onToast: (msg: string, error?: boolean) => void;
  onSaveFile?: (path: string, content: string) => Promise<void>;
  onMarkDirty?: (path: string, dirty: boolean) => void;
  onAddIdeTerminal?: () => Promise<string | undefined>;
  onRemoveIdeTerminal?: (tty: string) => void;
  onSetProjectPath?: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  mtime: number;
  children?: TreeNode[];
  loaded?: boolean;
}

export function IDEView({
  activeWorkspace,
  openFiles,
  activeFile,
  onOpenFile,
  onCloseFile,
  onToast,
  onSaveFile,
  onMarkDirty,
  onAddIdeTerminal,
  onRemoveIdeTerminal,
  onSetProjectPath,
}: Props) {
  const { theme: t } = useTheme();

  // Root project path for the explorer
  const rootPath = activeWorkspace?.projectPath || '';

  // ── Explorer state ──
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [creatingItem, setCreatingItem] = useState<{ parentPath: string; isDir: boolean } | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [renamingItem, setRenamingItem] = useState<{ path: string; oldName: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [explorerWidth, setExplorerWidth] = useState(250);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // ── Editor file content ──
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [forceRawText, setForceRawText] = useState<string | null>(null);
  const [detectedBinaryFiles, setDetectedBinaryFiles] = useState<Set<string>>(new Set());

  // ── Bottom terminal dock state ──
  const [terminalDockOpen, setTerminalDockOpen] = useState(true);
  const [terminalDockHeight, setTerminalDockHeight] = useState(240);
  const [terminalMaximized, setTerminalMaximized] = useState(false);

  // ── Dedicated IDE Terminal State (isolated from workspace/grid panes) ──
  const idePanes = useMemo(() => {
    return activeWorkspace?.idePanes || [];
  }, [activeWorkspace?.idePanes]);

  const availableSessionIds = useMemo(() => {
    return idePanes
      .map((p) => p.tty)
      .filter((tty): tty is string => !!tty);
  }, [idePanes]);

  const [selectedIdeTerminalId, setSelectedIdeTerminalId] = useState<string | null>(null);

  const activeTerminalId = useMemo(() => {
    if (selectedIdeTerminalId && availableSessionIds.includes(selectedIdeTerminalId)) {
      return selectedIdeTerminalId;
    }
    return availableSessionIds[0] ?? null;
  }, [selectedIdeTerminalId, availableSessionIds]);

  // Auto-initialize dedicated IDE terminal if none exists for this workspace
  useEffect(() => {
    if (availableSessionIds.length === 0 && onAddIdeTerminal) {
      onAddIdeTerminal().then((sid) => {
        if (sid) setSelectedIdeTerminalId(sid);
      });
    }
  }, [availableSessionIds.length, onAddIdeTerminal]);

  // Native macOS Finder File Picker
  const handlePickFile = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: 'Open File in Antigravity IDE',
      });
      if (selected && typeof selected === 'string') {
        const name = baseName(selected);
        onOpenFile(selected, name);
      }
    } catch (err: any) {
      console.warn('[IDEView] Open file dialog error:', err);
    }
  }, [onOpenFile]);

  // Native macOS Finder Folder Picker
  const handlePickFolder = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Open Project Folder in Antigravity IDE',
      });
      if (selected && typeof selected === 'string') {
        onSetProjectPath?.(selected);
        onToast(`Opened project folder: ${baseName(selected)}`);
      }
    } catch (err: any) {
      console.warn('[IDEView] Open folder dialog error:', err);
    }
  }, [onSetProjectPath, onToast]);

  // Global shortcuts: Cmd+O (Open File from Finder)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handlePickFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePickFile]);

  // Debounced recursive project search
  useEffect(() => {
    const q = searchFilter.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    if (!rootPath) {
      const matches = openFiles
        .filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
        .map((f) => ({
          name: f.name,
          path: f.path,
          rel_path: f.name,
          is_dir: false,
        }));
      setSearchResults(matches);
      setIsSearching(false);
      return;
    }

    let active = true;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchProjectFiles(rootPath, q, 100);
        if (active) {
          setSearchResults(res.results || []);
        }
      } catch (err) {
        console.error('Project search error:', err);
        if (active) setSearchResults([]);
      } finally {
        if (active) setIsSearching(false);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchFilter, rootPath, openFiles]);

  // Load directory tree for a specific path
  const fetchDirectory = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    try {
      const res = await listFiles(dirPath);
      return (res.files || []).map((f) => ({
        name: f.name,
        path: dirPath ? `${dirPath}/${f.name}` : f.name,
        is_dir: f.is_dir,
        size: f.size,
        mtime: f.mtime,
        children: f.is_dir ? [] : undefined,
        loaded: false,
      })).sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch {
      return [];
    }
  }, []);

  // Refresh tree preserving all open/expanded folders
  const refreshTree = useCallback(async () => {
    if (!rootPath) {
      setTreeData([]);
      return;
    }
    setLoadingTree(true);
    try {
      const loadTreeRecursively = async (dirPath: string): Promise<TreeNode[]> => {
        const nodes = await fetchDirectory(dirPath);
        return Promise.all(
          nodes.map(async (n) => {
            if (n.is_dir && expandedFolders.has(n.path)) {
              const children = await loadTreeRecursively(n.path);
              return { ...n, children, loaded: true };
            }
            return n;
          })
        );
      };
      const rootFiles = await loadTreeRecursively(rootPath);
      setTreeData(rootFiles);
    } catch (err: any) {
      onToast(`Failed to load directory: ${err?.message || err}`, true);
    } finally {
      setLoadingTree(false);
    }
  }, [rootPath, expandedFolders, fetchDirectory, onToast]);

  // Refresh git status
  const refreshGit = useCallback(async () => {
    if (!rootPath) return;
    try {
      const status = await getGitStatus(rootPath);
      setGitStatus(status);
    } catch {
      setGitStatus(null);
    }
  }, [rootPath]);

  useEffect(() => {
    refreshTree();
    refreshGit();
  }, [refreshTree, refreshGit]);

  // Toggle folder expansion and dynamically load contents if not loaded yet
  const toggleFolder = useCallback(async (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });

    // Populate children in tree data if needed
    const updateNode = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      return Promise.all(nodes.map(async (n) => {
        if (n.path === folderPath && n.is_dir && !n.loaded) {
          const children = await fetchDirectory(folderPath);
          return { ...n, children, loaded: true };
        }
        if (n.children && n.children.length > 0) {
          return { ...n, children: await updateNode(n.children) };
        }
        return n;
      }));
    };

    setTreeData((curr) => {
      updateNode(curr).then((updated) => setTreeData(updated));
      return curr;
    });
  }, [fetchDirectory]);

  // Load content of active file
  useEffect(() => {
    if (!activeFile) {
      setFileContent(null);
      setFileError(null);
      setFileLoading(false);
      return;
    }
    if (isImageFile(activeFile)) {
      setFileContent(null);
      setFileError(null);
      setFileLoading(false);
      return;
    }
    if (isBinaryFile(activeFile) && forceRawText !== activeFile) {
      setFileContent(null);
      setFileError(null);
      setFileLoading(false);
      return;
    }

    let cancelled = false;
    setFileLoading(true);
    setFileError(null);

    getFile(activeFile)
      .then((res) => {
        if (!cancelled) {
          if (res.is_binary && forceRawText !== activeFile) {
            setDetectedBinaryFiles((prev) => new Set(prev).add(activeFile));
            setFileContent(null);
          } else {
            setFileContent(res.content ?? '');
          }
        }
      })
      .catch((err: any) => {
        if (!cancelled) setFileError(String(err?.message || err));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeFile, forceRawText]);

  const isBinary = Boolean(
    activeFile &&
    (isBinaryFile(activeFile) || detectedBinaryFiles.has(activeFile)) &&
    forceRawText !== activeFile
  );

  // Save active file
  const handleSaveCurrentFile = useCallback(async (text?: string) => {
    if (!activeFile) return;
    const contentToSave = text !== undefined ? text : fileContent;
    if (contentToSave === null) return;
    try {
      if (onSaveFile) {
        await onSaveFile(activeFile, contentToSave);
      } else {
        await putFile(activeFile, contentToSave);
      }
      onMarkDirty?.(activeFile, false);
      onToast('File saved');
    } catch (err: any) {
      onToast(`Failed to save: ${err?.message || err}`, true);
    }
  }, [activeFile, fileContent, onSaveFile, onMarkDirty, onToast]);

  // Create new file or folder
  const handleCreateConfirm = useCallback(async () => {
    if (!creatingItem || !newItemName.trim()) return;
    const fullPath = creatingItem.parentPath
      ? `${creatingItem.parentPath}/${newItemName.trim()}`
      : newItemName.trim();
    try {
      if (creatingItem.isDir) {
        await createDir(fullPath);
        onToast(`Created folder "${newItemName.trim()}"`);
      } else {
        await createFile(fullPath);
        onToast(`Created file "${newItemName.trim()}"`);
        onOpenFile(fullPath, newItemName.trim());
      }
      setCreatingItem(null);
      setNewItemName('');
      refreshTree();
    } catch (err: any) {
      onToast(`Create failed: ${err?.message || err}`, true);
    }
  }, [creatingItem, newItemName, onOpenFile, onToast, refreshTree]);

  // Rename item
  const handleRenameConfirm = useCallback(async () => {
    if (!renamingItem || !renameDraft.trim()) return;
    try {
      await renameFile(renamingItem.path, renameDraft.trim());
      onToast(`Renamed to "${renameDraft.trim()}"`);
      setRenamingItem(null);
      setRenameDraft('');
      refreshTree();
    } catch (err: any) {
      onToast(`Rename failed: ${err?.message || err}`, true);
    }
  }, [renamingItem, renameDraft, onToast, refreshTree]);

  // Delete item
  const handleDeleteItem = useCallback(async (path: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
      await deleteFile(path);
      onToast(`Deleted "${name}"`);
      if (activeFile === path) {
        onCloseFile(path);
      }
      refreshTree();
    } catch (err: any) {
      onToast(`Delete failed: ${err?.message || err}`, true);
    }
  }, [activeFile, onCloseFile, onToast, refreshTree]);

  // Recursive Tree Node Renderer
  const renderNode = (node: TreeNode, depth = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isCurrentFile = activeFile === node.path;
    const matchesFilter = searchFilter
      ? node.name.toLowerCase().includes(searchFilter.toLowerCase())
      : true;

    if (searchFilter && !matchesFilter && !node.is_dir) return null;

    return (
      <div key={node.path} style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          className="ide-tree-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: `4px 8px 4px ${8 + depth * 14}px`,
            fontSize: t.fontSize.sm,
            cursor: 'pointer',
            backgroundColor: isCurrentFile ? t.colors.accent.light : 'transparent',
            color: isCurrentFile ? t.colors.accent.primary : t.colors.text.primary,
            borderRadius: t.borderRadius.sm,
            gap: 6,
            userSelect: 'none',
            transition: `background-color ${t.transition.fast}`,
          }}
          onClick={() => {
            if (node.is_dir) {
              toggleFolder(node.path);
            } else {
              onOpenFile(node.path, node.name);
            }
          }}
        >
          {node.is_dir ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.85 }}>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ marginLeft: 3 }}>
                <FolderIcon name={node.name} open={isExpanded} size={15} />
              </span>
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 14 }}>
              <FileIcon name={node.name} size={15} />
            </span>
          )}

          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: node.is_dir ? 'inherit' : t.fontFamily.mono,
            }}
            title={node.path}
          >
            {node.name}
          </span>

          {/* Quick node action buttons (revealed on hover) */}
          <div
            className="ide-tree-actions"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {node.is_dir && (
              <>
                <button
                  type="button"
                  title="New File inside folder"
                  onClick={() => {
                    setCreatingItem({ parentPath: node.path, isDir: false });
                    setNewItemName('');
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'inherit', padding: 2, display: 'flex',
                  }}
                >
                  <FilePlus size={12} />
                </button>
                <button
                  type="button"
                  title="New Folder inside"
                  onClick={() => {
                    setCreatingItem({ parentPath: node.path, isDir: true });
                    setNewItemName('');
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'inherit', padding: 2, display: 'flex',
                  }}
                >
                  <FolderPlus size={12} />
                </button>
              </>
            )}
            <button
              type="button"
              title="Rename"
              onClick={() => {
                setRenamingItem({ path: node.path, oldName: node.name });
                setRenameDraft(node.name);
              }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'inherit', padding: 2, display: 'flex',
              }}
            >
              <Edit2 size={12} />
            </button>
            <button
              type="button"
              title="Delete"
              onClick={() => handleDeleteItem(node.path, node.name)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: t.colors.danger.primary, padding: 2, display: 'flex',
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Directory children */}
        {node.is_dir && isExpanded && node.children && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const activeLanguage = useMemo(() => {
    if (!activeFile) return 'Plain Text';
    return getLanguage(activeFile);
  }, [activeFile]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: t.colors.bg.primary,
        color: t.colors.text.primary,
      }}
    >
      {/* ── IDE Workspace Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          backgroundColor: t.colors.bg.secondary,
          fontSize: t.fontSize.xs,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Code2 size={15} style={{ color: t.colors.accent.primary }} />
          <span style={{ fontWeight: 600 }}>{activeWorkspace?.name || 'Antigravity IDE'}</span>
          {rootPath && (
            <span
              style={{
                color: t.colors.text.muted,
                fontFamily: t.fontFamily.mono,
                backgroundColor: t.colors.bg.tertiary,
                padding: '2px 8px',
                borderRadius: t.borderRadius.sm,
              }}
            >
              {rootPath}
            </span>
          )}
          {gitStatus?.branch && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: t.colors.accent.primary,
                backgroundColor: t.colors.accent.light,
                padding: '2px 8px',
                borderRadius: t.borderRadius.sm,
                fontWeight: 500,
              }}
            >
              <GitBranch size={12} />
              {gitStatus.branch}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            style={{
              ...buttonBase(t),
              ...buttonSize(t, 'sm'),
              ...buttonVariant(t, 'secondary'),
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              height: '26px',
            }}
            onClick={() => setTerminalDockOpen((v) => !v)}
            title="Toggle Bottom Terminal Dock"
          >
            <TerminalIcon size={12} />
            <span>Terminal</span>
            {terminalDockOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
      </div>

      {/* ── Main IDE Content Split (Left File Tree, Center Code Editor) ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: Project File Explorer */}
        <div
          style={{
            width: explorerWidth,
            borderRight: `1px solid ${t.colors.border.subtle}`,
            backgroundColor: t.colors.bg.secondary,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* File Explorer Header */}
          <div
            style={{
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: `1px solid ${t.colors.border.subtle}`,
            }}
          >
            <span style={{ fontSize: t.fontSize.xs, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: t.colors.text.muted }}>
              Explorer
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <button
                type="button"
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: 3, height: 'auto' }}
                title="Open File from Finder (⌘O)"
                onClick={handlePickFile}
              >
                <FileUp size={13} />
              </button>
              <button
                type="button"
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: 3, height: 'auto' }}
                title="Open Project Folder from Finder"
                onClick={handlePickFolder}
              >
                <FolderOpen size={13} />
              </button>
              <button
                type="button"
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: 3, height: 'auto' }}
                title="New File in Root"
                onClick={() => {
                  setCreatingItem({ parentPath: rootPath, isDir: false });
                  setNewItemName('');
                }}
              >
                <FilePlus size={13} />
              </button>
              <button
                type="button"
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: 3, height: 'auto' }}
                title="New Folder in Root"
                onClick={() => {
                  setCreatingItem({ parentPath: rootPath, isDir: true });
                  setNewItemName('');
                }}
              >
                <FolderPlus size={13} />
              </button>
              <button
                type="button"
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: 3, height: 'auto' }}
                title="Refresh Explorer"
                onClick={refreshTree}
              >
                <RefreshCw size={13} className={loadingTree ? 'spin' : ''} />
              </button>
            </div>
          </div>

          {/* Quick Search */}
          <div style={{ padding: '6px 8px', borderBottom: `1px solid ${t.colors.border.subtle}` }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, opacity: 0.5, pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search files in project..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchFilter('');
                }}
                style={{
                  ...inputBase(t),
                  padding: searchFilter ? '4px 26px 4px 26px' : '4px 8px 4px 26px',
                  fontSize: t.fontSize.xs,
                  width: '100%',
                  height: '26px',
                }}
              />
              {searchFilter && (
                <button
                  type="button"
                  onClick={() => setSearchFilter('')}
                  style={{
                    position: 'absolute',
                    right: 6,
                    background: 'none',
                    border: 'none',
                    padding: 2,
                    cursor: 'pointer',
                    color: t.colors.text.muted,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Clear search (Esc)"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Creation input modal / inline */}
          {creatingItem && (
            <div style={{ padding: '6px 8px', backgroundColor: t.colors.bg.tertiary, borderBottom: `1px solid ${t.colors.border.subtle}` }}>
              <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.muted, marginBottom: 4 }}>
                New {creatingItem.isDir ? 'Folder' : 'File'}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="text"
                  autoFocus
                  placeholder={creatingItem.isDir ? 'folder_name' : 'filename.ext'}
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateConfirm();
                    if (e.key === 'Escape') setCreatingItem(null);
                  }}
                  style={{ ...inputBase(t), flex: 1, padding: '3px 6px', fontSize: t.fontSize.xs, height: '24px' }}
                />
                <button
                  type="button"
                  style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'primary'), height: '24px', padding: '0 8px' }}
                  onClick={handleCreateConfirm}
                >
                  OK
                </button>
                <button
                  type="button"
                  style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), height: '24px', padding: '0 6px' }}
                  onClick={() => setCreatingItem(null)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Renaming inline prompt */}
          {renamingItem && (
            <div style={{ padding: '6px 8px', backgroundColor: t.colors.bg.tertiary, borderBottom: `1px solid ${t.colors.border.subtle}` }}>
              <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.muted, marginBottom: 4 }}>
                Rename: {renamingItem.oldName}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="text"
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameConfirm();
                    if (e.key === 'Escape') setRenamingItem(null);
                  }}
                  style={{ ...inputBase(t), flex: 1, padding: '3px 6px', fontSize: t.fontSize.xs, height: '24px' }}
                />
                <button
                  type="button"
                  style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'primary'), height: '24px', padding: '0 8px' }}
                  onClick={handleRenameConfirm}
                >
                  OK
                </button>
                <button
                  type="button"
                  style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), height: '24px', padding: '0 6px' }}
                  onClick={() => setRenamingItem(null)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Tree items & Search results */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', ...scrollbarStyle(t) }}>
            {searchFilter.trim() ? (
              <div>
                <div
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    color: t.colors.text.muted,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: `1px solid ${t.colors.border.subtle}`,
                    marginBottom: 4,
                  }}
                >
                  <span>
                    {isSearching
                      ? 'Searching...'
                      : `${searchResults.length} ${searchResults.length === 1 ? 'file' : 'files'} found`}
                  </span>
                  {isSearching && <RefreshCw size={10} className="spin" />}
                </div>

                {searchResults.length === 0 && !isSearching && (
                  <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: t.fontSize.xs, color: t.colors.text.muted }}>
                    No files found matching &quot;{searchFilter}&quot;
                  </div>
                )}

                {searchResults.map((item) => {
                  const isCurrent = activeFile === item.path;
                  const dirPart = item.rel_path.includes('/')
                    ? item.rel_path.substring(0, item.rel_path.lastIndexOf('/'))
                    : '';

                  return (
                    <div
                      key={item.path}
                      className="ide-tree-row"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '4px 8px',
                        fontSize: t.fontSize.xs,
                        cursor: 'pointer',
                        backgroundColor: isCurrent ? t.colors.accent.light : 'transparent',
                        color: isCurrent ? t.colors.accent.primary : t.colors.text.primary,
                        borderRadius: t.borderRadius.sm,
                        gap: 6,
                        userSelect: 'none',
                        transition: `background-color ${t.transition.fast}`,
                      }}
                      onClick={() => onOpenFile(item.path, item.name)}
                      title={item.path}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                        <FileIcon name={item.name} size={15} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                        <div
                          style={{
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontFamily: t.fontFamily.mono,
                          }}
                        >
                          {item.name}
                        </div>
                        {dirPart && (
                          <div
                            style={{
                              fontSize: '10px',
                              color: t.colors.text.muted,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {dirPart}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {treeData.length === 0 && !loadingTree && (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: t.fontSize.xs, color: t.colors.text.muted }}>
                    {rootPath ? 'No files found in directory' : 'Select a project path in workspace'}
                  </div>
                )}
                {treeData.map((node) => renderNode(node, 0))}
              </>
            )}
          </div>
        </div>

        {/* Explorer Resize Splitter */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = explorerWidth;
            const onMove = (moveEv: MouseEvent) => {
              const delta = moveEv.clientX - startX;
              setExplorerWidth(Math.min(550, Math.max(160, startW + delta)));
            };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
          style={{
            width: 4,
            cursor: 'col-resize',
            backgroundColor: 'transparent',
            zIndex: 10,
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.colors.accent.primary; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          title="Drag to resize explorer"
        />

        {/* Center: Multi-Tab Code Editor & Welcome Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* File Tab Strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: t.colors.bg.secondary,
              borderBottom: `1px solid ${t.colors.border.subtle}`,
              overflowX: 'auto',
              ...scrollbarStyle(t),
            }}
          >
            {openFiles.map((file) => {
              const isActive = activeFile === file.path;
              return (
                <div
                  key={file.path}
                  onClick={() => onOpenFile(file.path, file.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    fontSize: t.fontSize.sm,
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderRight: `1px solid ${t.colors.border.subtle}`,
                    borderTop: isActive ? `2px solid ${t.colors.accent.primary}` : '2px solid transparent',
                    backgroundColor: isActive ? t.colors.bg.primary : 'transparent',
                    color: isActive ? t.colors.text.primary : t.colors.text.muted,
                  }}
                >
                  <FileIcon name={file.name} size={14} />
                  <span style={{ fontFamily: t.fontFamily.mono, fontSize: t.fontSize.xs }}>{file.name}</span>
                  {file.dirty && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: t.colors.accent.primary,
                        display: 'inline-block',
                      }}
                    />
                  )}
                  <button
                    type="button"
                    title="Close File"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseFile(file.path);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      color: 'inherit',
                      opacity: 0.6,
                      borderRadius: t.borderRadius.sm,
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            {openFiles.length === 0 && (
              <div style={{ padding: '8px 14px', fontSize: t.fontSize.xs, color: t.colors.text.muted }}>
                No files open
              </div>
            )}
          </div>

          {/* Editor Body */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeFile ? (
              isImageFile(activeFile) ? (
                <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ImageViewer path={activeFile} />
                </div>
              ) : isBinary ? (
                <BinaryViewer
                  path={activeFile}
                  onOpenRaw={() => {
                    setForceRawText(activeFile);
                  }}
                />
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <CodeEditor
                    path={activeFile}
                    initialContent={fileContent ?? ''}
                    onSave={(newText) => handleSaveCurrentFile(newText)}
                    onChange={(val) => {
                      setFileContent(val);
                      onMarkDirty?.(activeFile, true);
                    }}
                    onDirtyChange={(dirty) => onMarkDirty?.(activeFile, dirty)}
                    onCursorChange={(l, c) => setCursorPos({ line: l, col: c })}
                    loading={fileLoading}
                    error={fileError}
                  />
                </div>
              )
            ) : (
              /* Antigravity Welcome Surface */
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 16,
                  color: t.colors.text.muted,
                  padding: 32,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    backgroundColor: t.colors.accent.light,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: t.colors.accent.primary,
                  }}
                >
                  <Code2 size={36} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: t.fontSize.xl, color: t.colors.text.primary }}>
                    Antigravity Developer IDE
                  </h3>
                  <p style={{ margin: 0, fontSize: t.fontSize.sm, maxWidth: 460 }}>
                    Open any file or folder from your Mac Finder, browse your workspace, or launch the interactive terminal dock below.
                  </p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
                  <button
                    type="button"
                    style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'primary'), display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={handlePickFile}
                  >
                    <FileUp size={14} />
                    <span>Open File...</span>
                    <span style={{ fontSize: '10px', opacity: 0.7, padding: '1px 4px', borderRadius: '3px', background: 'rgba(255,255,255,0.2)' }}>⌘O</span>
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'secondary'), display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={handlePickFolder}
                  >
                    <FolderOpen size={14} />
                    <span>Open Folder...</span>
                  </button>
                  {treeData[0] && (
                    <button
                      type="button"
                      style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'secondary') }}
                      onClick={() => onOpenFile(treeData[0].path, treeData[0].name)}
                    >
                      Open First File ({treeData[0].name})
                    </button>
                  )}
                  <button
                    type="button"
                    style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'secondary') }}
                    onClick={() => setTerminalDockOpen(true)}
                  >
                    Focus Terminal
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Terminal Dock Resize Splitter */}
          {terminalDockOpen && !terminalMaximized && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startH = terminalDockHeight;
                const onMove = (moveEv: MouseEvent) => {
                  const delta = startY - moveEv.clientY;
                  setTerminalDockHeight(Math.min(600, Math.max(120, startH + delta)));
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              style={{
                height: 4,
                cursor: 'row-resize',
                backgroundColor: 'transparent',
                zIndex: 10,
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.colors.accent.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              title="Drag to resize terminal dock"
            />
          )}

          {/* ── Bottom Dockable Terminal ── */}
          {terminalDockOpen && (
            <div
              style={{
                height: terminalMaximized ? '80%' : terminalDockHeight,
                borderTop: `1px solid ${t.colors.border.subtle}`,
                backgroundColor: t.colors.bg.primary,
                display: 'flex',
                flexDirection: 'column',
                transition: 'height 0.15s ease',
              }}
            >
              {/* Dock Terminal Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 10px',
                  backgroundColor: t.colors.bg.secondary,
                  borderBottom: `1px solid ${t.colors.border.subtle}`,
                  fontSize: t.fontSize.xs,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TerminalIcon size={13} style={{ color: t.colors.accent.primary }} />
                  <span style={{ fontWeight: 600 }}>IDE Terminal</span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      fontWeight: 600,
                      letterSpacing: '0.3px',
                    }}
                  >
                    Dedicated
                  </span>

                  {/* Dedicated IDE Terminal Selector Dropdown */}
                  {availableSessionIds.length > 0 && (
                    <select
                      value={activeTerminalId || ''}
                      onChange={(e) => setSelectedIdeTerminalId(e.target.value)}
                      style={{
                        ...inputBase(t),
                        padding: '2px 8px',
                        fontSize: t.fontSize.xs,
                        cursor: 'pointer',
                        height: '24px',
                        width: 'auto',
                        fontWeight: 500,
                      }}
                    >
                      {idePanes.map((p, idx) => {
                        if (!p.tty) return null;
                        const label = p.label || `IDE Terminal ${idx + 1}`;
                        return (
                          <option key={p.tty} value={p.tty}>
                            {label} ({p.tty})
                          </option>
                        );
                      })}
                    </select>
                  )}

                  {onAddIdeTerminal && (
                    <button
                      type="button"
                      style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: '2px 5px', height: '24px' }}
                      title="New Dedicated IDE Terminal"
                      onClick={async () => {
                        const sid = await onAddIdeTerminal();
                        if (sid) setSelectedIdeTerminalId(sid);
                      }}
                    >
                      <Plus size={12} />
                    </button>
                  )}

                  {availableSessionIds.length > 1 && activeTerminalId && onRemoveIdeTerminal && (
                    <button
                      type="button"
                      style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: '2px 5px', height: '24px' }}
                      title="Close Current IDE Terminal"
                      onClick={() => onRemoveIdeTerminal(activeTerminalId)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: 3, height: 'auto' }}
                    title={terminalMaximized ? 'Restore' : 'Maximize'}
                    onClick={() => setTerminalMaximized((v) => !v)}
                  >
                    {terminalMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: 3, height: 'auto' }}
                    title="Close Terminal Dock"
                    onClick={() => setTerminalDockOpen(false)}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>

              {/* Real PTY Terminal Anchor */}
              <div
                style={{
                  flex: 1,
                  position: 'relative',
                  overflow: 'hidden',
                  width: '100%',
                  height: '100%',
                  minHeight: 0,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: '#0a0a0a',
                }}
              >
                {activeTerminalId ? (
                  <TerminalAnchor key={activeTerminalId} sessionId={activeTerminalId} />
                ) : (
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: t.colors.text.muted,
                      fontSize: t.fontSize.sm,
                      gap: 8,
                    }}
                  >
                    <RefreshCw size={14} className="animate-spin" />
                    Initializing dedicated IDE terminal in {rootPath || 'project'}...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bottom Status Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '2px 10px',
              backgroundColor: t.colors.bg.tertiary,
              borderTop: `1px solid ${t.colors.border.subtle}`,
              fontSize: '11px',
              color: t.colors.text.muted,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {gitStatus?.branch ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: t.colors.text.primary }}>
                  <GitBranch size={11} /> {gitStatus.branch}
                </span>
              ) : (
                <span>No Git repo</span>
              )}
              {activeFile && (
                <span style={{ fontFamily: t.fontFamily.mono }}>{baseName(activeFile)}</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
              <span>{activeLanguage}</span>
              <span>UTF-8</span>
              {activeTerminalId && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#38bdf8' }} />
                  IDE PTY: {activeTerminalId}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
