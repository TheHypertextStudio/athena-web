'use client';

/**
 * useResizable - Resizable Behavior Hook
 *
 * Provides resize behavior for calendar events and time blocks.
 * Handles edge dragging with time snapping.
 */

import {
  useCallback,
  useState,
  useRef,
  useEffect,
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import type { AnyObject } from '../types';
import { OBJECT_CAPABILITIES } from '../types';

// =============================================================================
// Types
// =============================================================================

type ResizeEdge = 'top' | 'bottom' | 'left' | 'right';

interface UseResizableOptions {
  /** The object being resized */
  object: AnyObject;

  /** Initial dimensions or time bounds */
  initialBounds: {
    startTime?: Date;
    endTime?: Date;
    width?: number;
    height?: number;
  };

  /** Which edges can be resized */
  edges?: ResizeEdge[];

  /** Minimum size constraints */
  minSize?: {
    width?: number;
    height?: number;
    durationMinutes?: number;
  };

  /** Time snap interval in minutes (for calendar) */
  snapMinutes?: number;

  /** Pixel snap interval (for non-time based) */
  snapPixels?: number;

  /** Callback during resize */
  onResize?: (bounds: ResizeBounds) => void;

  /** Callback when resize completes */
  onResizeEnd?: (bounds: ResizeBounds) => void;

  /** Whether resizing is disabled */
  disabled?: boolean;
}

interface ResizeBounds {
  startTime?: Date;
  endTime?: Date;
  width?: number;
  height?: number;
  durationMinutes?: number;
}

interface UseResizableReturn {
  /** Whether currently resizing */
  isResizing: boolean;

  /** Which edge is being resized */
  activeEdge: ResizeEdge | null;

  /** Current bounds during resize */
  currentBounds: ResizeBounds;

  /** Get props for a resize handle */
  getResizeHandleProps: (edge: ResizeEdge) => {
    onMouseDown: (e: ReactMouseEvent) => void;
    onTouchStart: (e: ReactTouchEvent) => void;
    style: React.CSSProperties;
    'data-resize-edge': ResizeEdge;
    'data-resizing': boolean;
  };

  /** Props for the resizable container */
  resizableProps: {
    'data-resizable': boolean;
    'data-resizing': boolean;
  };
}

// =============================================================================
// Helpers
// =============================================================================

function snapToInterval(value: number, interval: number): number {
  return Math.round(value / interval) * interval;
}

function minutesBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (60 * 1000);
}

// =============================================================================
// Hook
// =============================================================================

export function useResizable({
  object,
  initialBounds,
  edges = ['top', 'bottom'],
  minSize = { durationMinutes: 15 },
  snapMinutes = 15,
  snapPixels = 10,
  onResize,
  onResizeEnd,
  disabled = false,
}: UseResizableOptions): UseResizableReturn {
  // Check if object type supports resizing
  const capabilities = OBJECT_CAPABILITIES[object.type];
  const isDisabled = disabled || !capabilities.resizable;

  // State
  const [isResizing, setIsResizing] = useState(false);
  const [activeEdge, setActiveEdge] = useState<ResizeEdge | null>(null);
  const [currentBounds, setCurrentBounds] = useState<ResizeBounds>(initialBounds);

  // Refs for tracking resize
  const startPosRef = useRef({ x: 0, y: 0 });
  const startBoundsRef = useRef<ResizeBounds>(initialBounds);

  // Update bounds when initialBounds changes (and not resizing)
  useEffect(() => {
    if (!isResizing) {
      setCurrentBounds(initialBounds);
    }
  }, [initialBounds, isResizing]);

  // Handle mouse/touch move during resize
  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isResizing || !activeEdge) return;

      const deltaX = clientX - startPosRef.current.x;
      const deltaY = clientY - startPosRef.current.y;
      const startBounds = startBoundsRef.current;

      const newBounds: ResizeBounds = { ...startBounds };

      // Calculate new bounds based on edge
      switch (activeEdge) {
        case 'top':
          if (startBounds.startTime) {
            // For time-based resize, convert pixel delta to time
            // Assuming ~2px per minute (this should be configurable)
            const pixelsPerMinute = 2;
            const minutesDelta = -deltaY / pixelsPerMinute;
            const snappedMinutes = snapToInterval(minutesDelta, snapMinutes);
            const newStart = new Date(startBounds.startTime.getTime() + snappedMinutes * 60 * 1000);

            // Enforce minimum duration
            if (startBounds.endTime) {
              const duration = minutesBetween(newStart, startBounds.endTime);
              if (duration >= (minSize.durationMinutes ?? 15)) {
                newBounds.startTime = newStart;
                newBounds.durationMinutes = duration;
              }
            }
          } else if (startBounds.height !== undefined) {
            const snappedDelta = snapToInterval(deltaY, snapPixels);
            const newHeight = Math.max(minSize.height ?? 20, startBounds.height - snappedDelta);
            newBounds.height = newHeight;
          }
          break;

        case 'bottom':
          if (startBounds.endTime && startBounds.startTime) {
            const pixelsPerMinute = 2;
            const minutesDelta = deltaY / pixelsPerMinute;
            const snappedMinutes = snapToInterval(minutesDelta, snapMinutes);
            const newEnd = new Date(startBounds.endTime.getTime() + snappedMinutes * 60 * 1000);

            const duration = minutesBetween(startBounds.startTime, newEnd);
            if (duration >= (minSize.durationMinutes ?? 15)) {
              newBounds.endTime = newEnd;
              newBounds.durationMinutes = duration;
            }
          } else if (startBounds.height !== undefined) {
            const snappedDelta = snapToInterval(deltaY, snapPixels);
            const newHeight = Math.max(minSize.height ?? 20, startBounds.height + snappedDelta);
            newBounds.height = newHeight;
          }
          break;

        case 'left':
          if (startBounds.width !== undefined) {
            const snappedDelta = snapToInterval(deltaX, snapPixels);
            const newWidth = Math.max(minSize.width ?? 50, startBounds.width - snappedDelta);
            newBounds.width = newWidth;
          }
          break;

        case 'right':
          if (startBounds.width !== undefined) {
            const snappedDelta = snapToInterval(deltaX, snapPixels);
            const newWidth = Math.max(minSize.width ?? 50, startBounds.width + snappedDelta);
            newBounds.width = newWidth;
          }
          break;
      }

      setCurrentBounds(newBounds);
      onResize?.(newBounds);
    },
    [isResizing, activeEdge, snapMinutes, snapPixels, minSize, onResize],
  );

  // Handle resize end
  const handleEnd = useCallback(() => {
    if (isResizing) {
      onResizeEnd?.(currentBounds);
    }
    setIsResizing(false);
    setActiveEdge(null);
  }, [isResizing, currentBounds, onResizeEnd]);

  // Set up global event listeners during resize
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleMouseUp = () => {
      handleEnd();
    };
    const handleTouchEnd = () => {
      handleEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isResizing, handleMove, handleEnd]);

  // Start resize from mouse
  const startResize = useCallback(
    (edge: ResizeEdge, clientX: number, clientY: number) => {
      if (isDisabled) return;

      startPosRef.current = { x: clientX, y: clientY };
      startBoundsRef.current = { ...currentBounds };
      setActiveEdge(edge);
      setIsResizing(true);
    },
    [isDisabled, currentBounds],
  );

  // Get props for resize handles
  const getResizeHandleProps = useCallback(
    (edge: ResizeEdge) => {
      const isEdgeEnabled = edges.includes(edge);

      return {
        onMouseDown: (e: ReactMouseEvent) => {
          if (isEdgeEnabled && !isDisabled) {
            e.preventDefault();
            e.stopPropagation();
            startResize(edge, e.clientX, e.clientY);
          }
        },
        onTouchStart: (e: ReactTouchEvent) => {
          if (isEdgeEnabled && !isDisabled && e.touches[0]) {
            e.preventDefault();
            e.stopPropagation();
            startResize(edge, e.touches[0].clientX, e.touches[0].clientY);
          }
        },
        style: {
          cursor:
            isEdgeEnabled && !isDisabled
              ? edge === 'top' || edge === 'bottom'
                ? 'ns-resize'
                : 'ew-resize'
              : 'default',
          pointerEvents: isEdgeEnabled ? 'auto' : 'none',
        } as React.CSSProperties,
        'data-resize-edge': edge,
        'data-resizing': isResizing && activeEdge === edge,
      };
    },
    [edges, isDisabled, isResizing, activeEdge, startResize],
  );

  const resizableProps = useMemo(
    () => ({
      'data-resizable': !isDisabled,
      'data-resizing': isResizing,
    }),
    [isDisabled, isResizing],
  );

  return {
    isResizing,
    activeEdge,
    currentBounds,
    getResizeHandleProps,
    resizableProps,
  };
}
