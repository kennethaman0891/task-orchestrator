import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * usePointerFileDrag — deterministic file drag-and-drop for the sidebar.
 *
 * In macOS WKWebView (Tauri), native HTML5 drag events (dragover/drop)
 * over xterm canvases can be unreliable or blocked. This hook implements
 * drag-and-drop using raw pointer/mouse events:
 *  - On mousedown, arms a drag candidate.
 *  - When movement passes a 5px threshold, activates the drag, creates a
 *    floating ghost that tracks the cursor, and highlights drop targets.
 *  - On mouseup, hit-tests the element under the cursor and routes the file.
 *  - If dropped on a terminal pane, triggers a flash and drops the path into the PTY.
 *  - If dropped on the code editor, opens the file.
 */

export interface PointerDragItem {
  label: string;
  path: string;
  kind: 'file' | 'folder';
  icon?: string;
}

interface UsePointerFileDragOptions {
  onDropTerminal?: (paths: string[], sessionId?: string) => void;
  onDropEditor?: (path: string, name: string) => void;
  onDropFolder?: (sourcePath: string, targetFolderPath: string) => void;
}

const DRAG_THRESHOLD = 5; // px of movement before drag activates
const GHOST_CLASS = 'tto-drag-ghost';
const TARGET_CLASS = 'tto-drag-target';
const FLASH_CLASS = 'tto-drop-flash';

export function usePointerFileDrag(options: UsePointerFileDragOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [isDragging, setIsDragging] = useState(false);
  const armedRef = useRef<PointerDragItem | null>(null);
  const activeRef = useRef<PointerDragItem | null>(null);
  const originRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const highlightedRef = useRef<HTMLElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const clearGhost = () => {
    if (ghostElRef.current) {
      ghostElRef.current.remove();
      ghostElRef.current = null;
    }
  };

  const clearHighlight = () => {
    if (highlightedRef.current) {
      highlightedRef.current.classList.remove(TARGET_CLASS);
      highlightedRef.current.classList.remove('drag-over');
      delete highlightedRef.current.dataset.ttoIcon;
      delete highlightedRef.current.dataset.ttoName;
      highlightedRef.current = null;
    }
  };

  const cancel = useCallback(() => {
    armedRef.current = null;
    activeRef.current = null;
    setIsDragging(false);
    clearGhost();
    clearHighlight();
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!armedRef.current && !activeRef.current) return;

      // Check distance threshold before activating drag
      if (!activeRef.current) {
        const dx = e.clientX - originRef.current.x;
        const dy = e.clientY - originRef.current.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        activeRef.current = armedRef.current;
        movedRef.current = true;
        setIsDragging(true);
      }

      // Prevent native text selection during drag
      e.preventDefault();

      const item = activeRef.current!;

      // Create or update cursor ghost
      if (!ghostElRef.current) {
        const ghost = document.createElement('div');
        ghost.className = GHOST_CLASS;
        const emoji = item.kind === 'folder' ? '📁' : '📄';
        ghost.textContent = `${emoji} ${item.label}`;
        document.body.appendChild(ghost);
        ghostElRef.current = ghost;
      }
      const ghost = ghostElRef.current;
      ghost.style.left = `${e.clientX + 14}px`;
      ghost.style.top = `${e.clientY + 10}px`;

      // Hit-test target element
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const termPane = (el instanceof Element ? el.closest('.term-pane') : null) as HTMLElement | null;
      const editorPane = (!termPane && el instanceof Element ? el.closest('.ide-editor-drop, [data-drop-target="editor"]') : null) as HTMLElement | null;
      const folderTarget = (!termPane && !editorPane && el instanceof Element ? el.closest('[data-folder-path]') : null) as HTMLElement | null;

      const currentTarget = termPane || editorPane || folderTarget;

      if (currentTarget !== highlightedRef.current) {
        clearHighlight();
        if (currentTarget) {
          const emoji = item.kind === 'folder' ? '📁' : '📄';
          currentTarget.dataset.ttoIcon = emoji;
          currentTarget.dataset.ttoName = item.label;
          currentTarget.classList.add(TARGET_CLASS);
          if (editorPane) currentTarget.classList.add('drag-over');
          highlightedRef.current = currentTarget;
        }
      }
    };

    const onUp = (e: MouseEvent) => {
      if (!activeRef.current) {
        armedRef.current = null;
        return;
      }

      const item = activeRef.current;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const termPane = (el instanceof Element ? el.closest('.term-pane') : null) as HTMLElement | null;
      const editorPane = (!termPane && el instanceof Element ? el.closest('.ide-editor-drop, [data-drop-target="editor"]') : null) as HTMLElement | null;
      const folderTarget = (!termPane && !editorPane && el instanceof Element ? el.closest('[data-folder-path]') : null) as HTMLElement | null;

      if (termPane) {
        // Flash success feedback on terminal
        termPane.classList.remove(TARGET_CLASS);
        const flashEmoji = item.kind === 'folder' ? '📁' : '📄';
        termPane.dataset.ttoFlash = flashEmoji;
        termPane.dataset.ttoFlashName = item.label;
        termPane.classList.add(FLASH_CLASS);
        if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => {
          termPane.classList.remove(FLASH_CLASS);
          delete termPane.dataset.ttoFlash;
          delete termPane.dataset.ttoFlashName;
        }, 900);

        const sessionId = termPane.getAttribute('data-tto-session') || undefined;
        optionsRef.current.onDropTerminal?.([item.path], sessionId);
      } else if (editorPane) {
        optionsRef.current.onDropEditor?.(item.path, item.label);
      } else if (folderTarget) {
        const destFolder = folderTarget.getAttribute('data-folder-path');
        if (destFolder && destFolder !== item.path) {
          optionsRef.current.onDropFolder?.(item.path, destFolder);
        }
      }

      cancel();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);

    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', cancel);
      clearGhost();
      clearHighlight();
    };
  }, [cancel]);

  const beginDrag = useCallback((e: React.MouseEvent, item: PointerDragItem) => {
    if (e.button !== 0) return; // Left mouse button only
    // Don't arm if clicking an input, button, or link
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, button, a')) return;

    originRef.current = { x: e.clientX, y: e.clientY };
    armedRef.current = item;
    movedRef.current = false;
  }, []);

  const consumeDrag = useCallback(() => {
    const wasMoved = movedRef.current;
    movedRef.current = false;
    return wasMoved;
  }, []);

  return {
    beginDrag,
    consumeDrag,
    isDragging,
  };
}
