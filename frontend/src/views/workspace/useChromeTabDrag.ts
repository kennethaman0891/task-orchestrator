'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TerminalManager } from '@/terminal/TerminalManager';

export interface TabDescriptor {
  paneId: string;
  tty: string;
}

export interface ChromeTabDragSession {
  originPaneId: string;
  originTty: string;
  originIndex: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  tabWidth: number;
  pointerOffsetInTab: number;
  tabWidths: number[];
  initialMidpoints: number[];
  hasStartedDrag: boolean;
  targetIndex: number;
}

export interface ChromeTabDragState {
  draggedPaneId: string;
  draggedIndex: number;
  targetIndex: number;
  translateX: number;
  tabWidth: number;
  shiftOffsets: number[];
  isSnapping: boolean;
}

export interface UseChromeTabDragOptions<T extends TabDescriptor> {
  tabs: T[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  tabRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  activeWorkspaceId?: string;
  isEditing?: boolean;
  onSelectTab: (tty: string) => void;
  onReorderPanes?: (
    workspaceId: string,
    fromPaneOrIndex: string | number,
    toPaneOrIndex: string | number,
    position: 'before' | 'after' | 'swap'
  ) => void;
}

// ── Pure Mathematical & Physics Functions ──

/**
 * Calculates which slot index the dragged tab should occupy based on its center
 * coordinate and the initial container-relative midpoints of all tabs.
 * Tested against fixed original slot centers to prevent flickering / hysteresis.
 */
export function computeChromeTargetIndex(
  originIndex: number,
  draggedCenter: number,
  midpoints: number[]
): number {
  if (midpoints.length <= 1) return 0;
  let targetIndex = 0;
  for (let j = 0; j < midpoints.length; j++) {
    if (j === originIndex) continue;
    const isLeftOfDragged =
      j < originIndex ? draggedCenter >= midpoints[j] : draggedCenter > midpoints[j];
    if (isLeftOfDragged) {
      targetIndex++;
    }
  }
  return Math.max(0, Math.min(midpoints.length - 1, targetIndex));
}

/**
 * Computes horizontal translation offsets (shiftOffsets) for all sibling tabs.
 * Sibling tabs dynamically glide left or right to make room when the dragged tab crosses them.
 */
export function computeChromeShiftOffsets(
  originIndex: number,
  targetIndex: number,
  draggedTabWidth: number,
  tabCount: number
): number[] {
  const shifts = new Array(tabCount).fill(0);
  if (originIndex < targetIndex) {
    // Dragged rightward: tabs between origin+1 and targetIndex shift LEFT
    for (let j = originIndex + 1; j <= targetIndex; j++) {
      shifts[j] = -draggedTabWidth;
    }
  } else if (originIndex > targetIndex) {
    // Dragged leftward: tabs between targetIndex and origin-1 shift RIGHT
    for (let j = targetIndex; j < originIndex; j++) {
      shifts[j] = draggedTabWidth;
    }
  }
  return shifts;
}

/**
 * Computes the exact pixel distance from the origin tab slot to the destination slot
 * taking into account individual widths of all intermediate tabs.
 */
export function computeChromeSnapOffset(
  originIndex: number,
  targetIndex: number,
  tabWidths: number[]
): number {
  if (targetIndex === originIndex) return 0;
  let offset = 0;
  if (targetIndex > originIndex) {
    for (let k = originIndex + 1; k <= targetIndex; k++) {
      offset += tabWidths[k] ?? 0;
    }
  } else {
    for (let k = targetIndex; k < originIndex; k++) {
      offset -= tabWidths[k] ?? 0;
    }
  }
  return offset;
}

/**
 * Computes horizontal scrolling velocity for edge auto-scrolling when dragging near
 * container boundaries. Returns 0 if outside the trigger zone.
 */
export function computeEdgeScrollVelocity(
  clientX: number,
  containerLeft: number,
  containerRight: number,
  edgeZone: number = 48,
  maxSpeed: number = 14
): number {
  if (clientX >= containerLeft && clientX < containerLeft + edgeZone) {
    const factor = 1 - Math.max(0, clientX - containerLeft) / edgeZone;
    return -Math.max(2, Math.round(factor * maxSpeed));
  }
  if (clientX <= containerRight && clientX > containerRight - edgeZone) {
    const factor = 1 - Math.max(0, containerRight - clientX) / edgeZone;
    return Math.max(2, Math.round(factor * maxSpeed));
  }
  return 0;
}

// ── Main Chrome Tab Drag Hook ──

export function useChromeTabDrag<T extends TabDescriptor>({
  tabs,
  containerRef,
  tabRefs,
  activeWorkspaceId,
  isEditing,
  onSelectTab,
  onReorderPanes,
}: UseChromeTabDragOptions<T>) {
  const [draggingState, setDraggingState] = useState<ChromeTabDragState | null>(null);

  // Active drag session ref for high-frequency tracking
  const dragSessionRef = useRef<ChromeTabDragSession | null>(null);
  const wasDraggingRef = useRef(false);
  const lastClientXRef = useRef(0);

  // Edge auto-scroll animation frame refs
  const edgeScrollRafRef = useRef<number | null>(null);
  const edgeScrollVelocityRef = useRef<number>(0);

  // Stop edge scrolling
  const stopEdgeScroll = useCallback(() => {
    if (edgeScrollRafRef.current !== null) {
      cancelAnimationFrame(edgeScrollRafRef.current);
      edgeScrollRafRef.current = null;
    }
    edgeScrollVelocityRef.current = 0;
  }, []);

  // Update dragged tab translation and sibling slot shifts
  const updateDragPositions = useCallback(
    (clientX: number) => {
      const session = dragSessionRef.current;
      const container = containerRef.current;
      if (!session || !container) return;

      const currentScroll = container.scrollLeft;
      const scrollDelta = currentScroll - session.startScrollLeft;
      const deltaX = clientX - session.startX;
      const translateX = deltaX + scrollDelta;

      // const containerRect = container.getBoundingClientRect();
      const initialTabLeft =
        session.initialMidpoints[session.originIndex] - session.tabWidth / 2;
      const draggedLeft = initialTabLeft + translateX;
      const draggedCenter = draggedLeft + session.tabWidth / 2;

      const targetIndex = computeChromeTargetIndex(
        session.originIndex,
        draggedCenter,
        session.initialMidpoints
      );

      session.targetIndex = targetIndex;

      const shiftOffsets = computeChromeShiftOffsets(
        session.originIndex,
        targetIndex,
        session.tabWidth,
        tabs.length
      );

      setDraggingState({
        draggedPaneId: session.originPaneId,
        draggedIndex: session.originIndex,
        targetIndex,
        translateX,
        tabWidth: session.tabWidth,
        shiftOffsets,
        isSnapping: false,
      });
    },
    [containerRef, tabs.length]
  );

  // Start continuous edge auto-scroll loop
  const startEdgeScroll = useCallback(
    (velocity: number) => {
      edgeScrollVelocityRef.current = velocity;
      if (edgeScrollRafRef.current !== null) return;

      const scrollLoop = () => {
        const container = containerRef.current;
        const session = dragSessionRef.current;
        if (!container || !session || !session.hasStartedDrag || edgeScrollVelocityRef.current === 0) {
          edgeScrollRafRef.current = null;
          return;
        }

        // Boundary safety checks
        if (edgeScrollVelocityRef.current < 0 && container.scrollLeft <= 0) {
          stopEdgeScroll();
          return;
        }
        if (
          edgeScrollVelocityRef.current > 0 &&
          container.scrollLeft + container.clientWidth >= container.scrollWidth - 1
        ) {
          stopEdgeScroll();
          return;
        }

        container.scrollLeft += edgeScrollVelocityRef.current;
        updateDragPositions(lastClientXRef.current);
        edgeScrollRafRef.current = requestAnimationFrame(scrollLoop);
      };

      edgeScrollRafRef.current = requestAnimationFrame(scrollLoop);
    },
    [containerRef, stopEdgeScroll, updateDragPositions]
  );

  // Check cursor position against container edges
  const checkEdgeAutoScroll = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const velocity = computeEdgeScrollVelocity(clientX, rect.left, rect.right, 48, 14);
      if (velocity !== 0) {
        startEdgeScroll(velocity);
      } else {
        stopEdgeScroll();
      }
    },
    [containerRef, startEdgeScroll, stopEdgeScroll]
  );

  // Window pointer listeners cleanup
  const windowListenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: Event) => void;
  } | null>(null);

  const cleanupWindowListeners = useCallback(() => {
    if (windowListenersRef.current) {
      window.removeEventListener('pointermove', windowListenersRef.current.move);
      window.removeEventListener('pointerup', windowListenersRef.current.up);
      window.removeEventListener('pointercancel', windowListenersRef.current.cancel);
      window.removeEventListener('blur', windowListenersRef.current.cancel);
      windowListenersRef.current = null;
    }
  }, []);

  // Pointer Up handler — commit or snap
  const handleWindowPointerUp = useCallback(
    (_e: PointerEvent) => {
      cleanupWindowListeners();
      stopEdgeScroll();
      document.body.style.userSelect = '';

      const session = dragSessionRef.current;
      if (!session) return;

      if (!session.hasStartedDrag) {
        // Pure click (moved less than threshold 3px)
        onSelectTab(session.originTty);
        dragSessionRef.current = null;
        setDraggingState(null);
        return;
      }

      // Drag was active
      wasDraggingRef.current = true;
      setTimeout(() => {
        wasDraggingRef.current = false;
      }, 60);

      const { originIndex, targetIndex, originPaneId } = session;

      if (targetIndex === originIndex || !activeWorkspaceId || !onReorderPanes) {
        // Snap back to origin
        setDraggingState((prev) =>
          prev ? { ...prev, isSnapping: true, translateX: 0 } : null
        );
        setTimeout(() => {
          dragSessionRef.current = null;
          setDraggingState(null);
        }, 140);
        return;
      }

      // Snap to target slot
      const snapOffset = computeChromeSnapOffset(
        originIndex,
        targetIndex,
        session.tabWidths
      );

      setDraggingState((prev) =>
        prev ? { ...prev, isSnapping: true, translateX: snapOffset } : null
      );

      // Commit after snap animation
      setTimeout(() => {
        const targetTab = tabs[targetIndex];
        if (targetTab && activeWorkspaceId && onReorderPanes) {
          const position = targetIndex > originIndex ? 'after' : 'before';
          onReorderPanes(activeWorkspaceId, originPaneId, targetTab.paneId, position);

          // Refresh and refit terminal canvases
          setTimeout(() => {
            for (const [tid] of TerminalManager.handles) {
              TerminalManager.fitNow(tid);
              TerminalManager.refresh(tid);
            }
          }, 60);
        }
        dragSessionRef.current = null;
        setDraggingState(null);
      }, 140);
    },
    [
      activeWorkspaceId,
      cleanupWindowListeners,
      onReorderPanes,
      onSelectTab,
      stopEdgeScroll,
      tabs,
    ]
  );

  // Pointer Cancel / Window Blur handler
  const handleWindowPointerCancel = useCallback(() => {
    cleanupWindowListeners();
    stopEdgeScroll();
    document.body.style.userSelect = '';
    dragSessionRef.current = null;
    setDraggingState(null);
  }, [cleanupWindowListeners, stopEdgeScroll]);

  // Pointer Move handler
  const handleWindowPointerMove = useCallback(
    (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;

      lastClientXRef.current = e.clientX;
      const deltaX = e.clientX - session.startX;
      const deltaY = e.clientY - session.startY;

      if (!session.hasStartedDrag) {
        // 3px drag initiation threshold
        if (Math.hypot(deltaX, deltaY) < 3) {
          return;
        }
        session.hasStartedDrag = true;
        document.body.style.userSelect = 'none';
      }

      checkEdgeAutoScroll(e.clientX);
      updateDragPositions(e.clientX);
    },
    [checkEdgeAutoScroll, updateDragPositions]
  );

  // Tab Pointer Down handler
  const handleTabPointerDown = useCallback(
    (e: React.PointerEvent, paneId: string, tty: string, index: number) => {
      // Only handle primary (left) mouse button
      if (e.button !== 0) return;

      // Ignore if user is editing or clicked an interactive child (input, button)
      if (isEditing) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('button, input')) return;

      const container = containerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const currentScroll = container.scrollLeft;

      // Measure layout geometry of all tabs
      const tabWidths: number[] = [];
      const initialMidpoints: number[] = [];

      for (let i = 0; i < tabs.length; i++) {
        const el = tabRefs.current[tabs[i].tty];
        if (el) {
          const rect = el.getBoundingClientRect();
          tabWidths.push(rect.width);
          const midpoint = rect.left - containerRect.left + currentScroll + rect.width / 2;
          initialMidpoints.push(midpoint);
        } else {
          tabWidths.push(120);
          initialMidpoints.push(i * 120 + 60);
        }
      }

      const draggedEl = tabRefs.current[tty];
      const draggedRect = draggedEl?.getBoundingClientRect();
      const tabWidth = draggedRect?.width || tabWidths[index] || 120;
      const pointerOffsetInTab = draggedRect ? e.clientX - draggedRect.left : tabWidth / 2;

      dragSessionRef.current = {
        originPaneId: paneId,
        originTty: tty,
        originIndex: index,
        startX: e.clientX,
        startY: e.clientY,
        startScrollLeft: currentScroll,
        tabWidth,
        pointerOffsetInTab,
        tabWidths,
        initialMidpoints,
        hasStartedDrag: false,
        targetIndex: index,
      };

      lastClientXRef.current = e.clientX;

      cleanupWindowListeners();

      const listeners = {
        move: handleWindowPointerMove,
        up: handleWindowPointerUp,
        cancel: handleWindowPointerCancel,
      };
      windowListenersRef.current = listeners;

      window.addEventListener('pointermove', listeners.move);
      window.addEventListener('pointerup', listeners.up);
      window.addEventListener('pointercancel', listeners.cancel);
      window.addEventListener('blur', listeners.cancel);
    },
    [
      cleanupWindowListeners,
      containerRef,
      handleWindowPointerCancel,
      handleWindowPointerMove,
      handleWindowPointerUp,
      isEditing,
      tabRefs,
      tabs,
    ]
  );

  // Tab click wrapper that suppresses clicks after a completed drag
  const handleTabClick = useCallback(
    (tty: string) => {
      if (wasDraggingRef.current) return;
      onSelectTab(tty);
    },
    [onSelectTab]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupWindowListeners();
      stopEdgeScroll();
      document.body.style.userSelect = '';
    };
  }, [cleanupWindowListeners, stopEdgeScroll]);

  return {
    draggingState,
    isDragging: !!draggingState && !draggingState.isSnapping,
    handleTabPointerDown,
    handleTabClick,
  };
}
