import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderIcon, FileIcon } from '../lib/treeIcons';

export type CreateItemType = 'file' | 'folder';

interface CreateItemModalProps {
  isOpen: boolean;
  type: CreateItemType;
  currentPath: string;
  onClose: () => void;
  onConfirm: (name: string, targetPath?: string) => void;
}

/** Extract base name from path for smart defaults. */
function pathBase(path: string): string {
  const last = path.split(/[/\\]/).filter(Boolean).pop();
  return last || '';
}

/** Derive a smart default name from the current directory path. */
function smartDefault(type: CreateItemType, path: string): string {
  const base = pathBase(path);
  if (!base) return '';
  return type === 'file' ? `${base}.ts` : base;
}

export function CreateItemModal({
  isOpen,
  type,
  currentPath,
  onClose,
  onConfirm,
}: CreateItemModalProps) {
  const [name, setName] = useState('');
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const title = type === 'file' ? 'New File' : 'New Folder';
  const placeholder = type === 'file' ? 'e.g., component.tsx' : 'e.g., components';

  // Ext colour: accent for file, amber for folder
  const accentColor = type === 'file' ? 'var(--accent)' : '#f5c542';

  // Extract extension preview state
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const hasExt = ext.length > 0;

  // Focus + smart default when modal opens
  useEffect(() => {
    if (isOpen) {
      const def = smartDefault(type, currentPath);
      setName(def);
      setPickedPath(null);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, type, currentPath]);

  // Escape → close; Ctrl/Cmd+Enter → submit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed) {
          onConfirm(trimmed, pickedPath ?? currentPath);
          onClose();
        }
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, name, pickedPath, currentPath, onClose, onConfirm]);

  const handleBrowse = async () => {
    try {
      const dir = await open({
        directory: true,
        title: 'Choose destination folder',
        defaultPath: currentPath,
      });
      if (dir === null) return;
      const picked = Array.isArray(dir) ? dir[0] : dir;
      if (picked && picked.trim() !== '') setPickedPath(picked);
    } catch {
      // Non-Tauri environments: keep default path
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      onConfirm(trimmed, pickedPath ?? currentPath);
      onClose();
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="cim-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <form className="cim-modal" onSubmit={handleSubmit}>
        {/* Accent top bar */}
        <div className="cim-accent-bar" style={{ background: accentColor }} />

        {/* Header */}
        <div className="cim-header">
          <span className="cim-icon" aria-hidden="true">
            {type === 'file' ? <FileIcon name={name || 'file'} /> : <FolderIcon open />}
          </span>
          <h2 className="cim-title">{title}</h2>
          <button
            type="button"
            className="cim-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Path context */}
        <div
          className="cim-path-context"
          title={(pickedPath ?? currentPath) || 'Workspace root'}
        >
          <span className="cim-path-label">Create in:</span>
          <span className="cim-path-value">{(pickedPath ?? currentPath) || '/'}</span>
          {pickedPath != null && (
            <button
              type="button"
              className="cim-path-reset"
              onClick={() => setPickedPath(null)}
              title="Use default folder"
              aria-label="Use default folder"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            className={`cim-browse${pickedPath != null ? ' picked' : ''}`}
            onClick={handleBrowse}
          >
            Browse…
          </button>
        </div>

        {/* Input field */}
        <div className="cim-input-wrapper">
          <label htmlFor="cim-name" className="cim-label">
            {type === 'file' ? 'File name' : 'Folder name'}
          </label>
          <input
            ref={inputRef}
            id="cim-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            className="cim-input"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="cim-hint"
          />
          <span id="cim-hint" className="cim-hint">
            {type === 'file' && hasExt ? (
              <>
                Extension <code>{ext}</code> detected · creates{' '}
                <span style={{ color: accentColor }}>{name}</span>
              </>
            ) : type === 'file' ? (
              'Add an extension (e.g. .tsx) to pick a file type'
            ) : (
              'Will create as directory'
            )}
            <span className="cim-shortcut"> ⌘↵ to create</span>
          </span>
        </div>

        {/* Actions */}
        <div className="cim-actions">
          <button type="button" className="cim-btn cim-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="cim-btn cim-btn-create"
            disabled={!name.trim()}
            style={name.trim() ? { background: accentColor } : {}}
          >
            Create {type === 'file' ? 'File' : 'Folder'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
