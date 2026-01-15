'use client';

/**
 * DragDrop Context
 *
 * Unified drag and drop state management built on @dnd-kit.
 * Provides object-aware drag/drop with type validation.
 */

import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragCancelEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { AnyObject, ObjectType, SurfaceId, DropPosition } from '../types';
import { DROP_ACCEPT_MAP } from '../types';

// =============================================================================
// Types
// =============================================================================

interface DragState {
  /** Whether a drag is in progress */
  isDragging: boolean;

  /** ID of object being dragged (primary) */
  activeId: UniqueIdentifier | null;

  /** IDs of all objects being dragged (supports multi-drag) */
  draggedIds: string[];

  /** Type of the dragged objects */
  draggedType: ObjectType | null;

  /** Source surface ID */
  sourceSurfaceId: SurfaceId | null;

  /** Current drop target surface */
  overSurfaceId: SurfaceId | null;

  /** Current over ID (item being hovered) */
  overId: UniqueIdentifier | null;
}

interface DropZoneConfig {
  surfaceId: SurfaceId;
  accepts: ObjectType[];
  onDrop: (objects: AnyObject[], position: DropPosition) => void | Promise<void>;
}

interface DragDropContextValue {
  /** Current drag state */
  state: DragState;

  /** Register a drop zone */
  registerDropZone: (config: DropZoneConfig) => void;

  /** Unregister a drop zone */
  unregisterDropZone: (surfaceId: SurfaceId) => void;

  /** Check if a surface can accept the current drag */
  canAccept: (surfaceId: SurfaceId) => boolean;

  /** Check if an object is being dragged */
  isDragged: (id: string) => boolean;

  /** Check if a surface is a valid drop target */
  isDropTarget: (surfaceId: SurfaceId) => boolean;

  /** Set the dragged type (called by draggable components) */
  setDraggedType: (type: ObjectType | null) => void;

  /** Set the source surface (called by draggable components) */
  setSourceSurface: (surfaceId: SurfaceId | null) => void;

  /** Set all dragged IDs for multi-select drag */
  setDraggedIds: (ids: string[]) => void;

  /** Get the active dragged object for overlay rendering */
  getActiveObject: () => AnyObject | null;

  /** Set the active object for overlay */
  setActiveObject: (object: AnyObject | null) => void;
}

const initialDragState: DragState = {
  isDragging: false,
  activeId: null,
  draggedIds: [],
  draggedType: null,
  sourceSurfaceId: null,
  overSurfaceId: null,
  overId: null,
};

// =============================================================================
// Context
// =============================================================================

const DragDropContext = createContext<DragDropContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface DragDropProviderProps {
  children: ReactNode;
  /** Optional render function for drag overlay */
  renderDragOverlay?: (object: AnyObject) => ReactNode;
}

export function DragDropProvider({ children, renderDragOverlay }: DragDropProviderProps) {
  const [state, setState] = useState<DragState>(initialDragState);
  const [dropZones, setDropZones] = useState<Map<SurfaceId, DropZoneConfig>>(new Map());
  const [activeObject, setActiveObject] = useState<AnyObject | null>(null);

  // Configure sensors for mouse/touch and keyboard
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Drag event handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    setState((prev) => ({
      ...prev,
      isDragging: true,
      activeId: active.id,
      // draggedIds and draggedType should be set by the draggable component
    }));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    const newOverId = over?.id ?? null;
    // Only update state if overId actually changed to prevent unnecessary re-renders
    setState((prev) => {
      if (prev.overId === newOverId) return prev;
      return {
        ...prev,
        overId: newOverId,
      };
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { over } = event;

      if (over && state.draggedType) {
        // Find the drop zone for the target
        const overData = over.data.current as { surfaceId?: SurfaceId; index?: number } | undefined;
        const targetSurfaceId = overData?.surfaceId;

        if (targetSurfaceId) {
          const zone = dropZones.get(targetSurfaceId);
          if (zone?.accepts.includes(state.draggedType)) {
            // Drop handling is delegated to the zone configuration
            // The zone's onDrop handler will use the overData?.index for positioning
          }
        }
      }

      // Reset state
      setState(initialDragState);
      setActiveObject(null);
    },
    [state.draggedType, dropZones],
  );

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setState(initialDragState);
    setActiveObject(null);
  }, []);

  // Context methods
  const registerDropZone = useCallback((config: DropZoneConfig) => {
    setDropZones((prev) => {
      const next = new Map(prev);
      next.set(config.surfaceId, config);
      return next;
    });
  }, []);

  const unregisterDropZone = useCallback((surfaceId: SurfaceId) => {
    setDropZones((prev) => {
      const next = new Map(prev);
      next.delete(surfaceId);
      return next;
    });
  }, []);

  const canAccept = useCallback(
    (surfaceId: SurfaceId): boolean => {
      if (!state.isDragging || !state.draggedType) {
        return false;
      }

      // Allow reordering within same surface
      if (surfaceId === state.sourceSurfaceId) {
        return true;
      }

      // Check registered drop zone
      const zone = dropZones.get(surfaceId);
      if (zone) {
        return zone.accepts.includes(state.draggedType);
      }

      return false;
    },
    [state.isDragging, state.draggedType, state.sourceSurfaceId, dropZones],
  );

  const isDragged = useCallback(
    (id: string): boolean => {
      return state.draggedIds.includes(id) || state.activeId === id;
    },
    [state.draggedIds, state.activeId],
  );

  const isDropTarget = useCallback(
    (surfaceId: SurfaceId): boolean => {
      return state.overSurfaceId === surfaceId;
    },
    [state.overSurfaceId],
  );

  const setDraggedType = useCallback((type: ObjectType | null) => {
    setState((prev) => ({ ...prev, draggedType: type }));
  }, []);

  const setSourceSurface = useCallback((surfaceId: SurfaceId | null) => {
    setState((prev) => ({ ...prev, sourceSurfaceId: surfaceId }));
  }, []);

  const setDraggedIds = useCallback((ids: string[]) => {
    setState((prev) => ({ ...prev, draggedIds: ids }));
  }, []);

  const getActiveObject = useCallback(() => activeObject, [activeObject]);

  const value = useMemo(
    (): DragDropContextValue => ({
      state,
      registerDropZone,
      unregisterDropZone,
      canAccept,
      isDragged,
      isDropTarget,
      setDraggedType,
      setSourceSurface,
      setDraggedIds,
      getActiveObject,
      setActiveObject,
    }),
    [
      state,
      registerDropZone,
      unregisterDropZone,
      canAccept,
      isDragged,
      isDropTarget,
      setDraggedType,
      setSourceSurface,
      setDraggedIds,
      getActiveObject,
      setActiveObject,
    ],
  );

  return (
    <DragDropContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        <DragOverlay
          dropAnimation={{
            duration: 200,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
          }}
        >
          {activeObject && renderDragOverlay ? renderDragOverlay(activeObject) : null}
        </DragOverlay>
      </DndContext>
    </DragDropContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Access the drag/drop context.
 */
export function useDragDrop(): DragDropContextValue {
  const context = useContext(DragDropContext);
  if (!context) {
    throw new Error('useDragDrop must be used within a DragDropProvider');
  }
  return context;
}

/**
 * Check if an object is currently being dragged.
 */
export function useIsDragged(id: string): boolean {
  const { isDragged } = useDragDrop();
  return isDragged(id);
}

/**
 * Check if a drop is currently in progress.
 */
export function useIsDragging(): boolean {
  const { state } = useDragDrop();
  return state.isDragging;
}

/**
 * Get the type of the object(s) being dragged.
 */
export function useDraggedType(): ObjectType | null {
  const { state } = useDragDrop();
  return state.draggedType;
}

/**
 * Check what types a container object can accept.
 */
export function useDropAcceptTypes(containerType: ObjectType): ObjectType[] {
  return DROP_ACCEPT_MAP[containerType];
}

// Re-export dnd-kit hooks for convenience
export { useDraggable, useDroppable } from '@dnd-kit/core';

export {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';

export { CSS } from '@dnd-kit/utilities';
