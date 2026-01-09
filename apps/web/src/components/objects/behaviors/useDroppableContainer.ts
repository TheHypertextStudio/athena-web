'use client';

/**
 * useDroppableContainer - Object-Aware Droppable Hook
 *
 * Wraps dnd-kit's useDroppable with object system integration.
 * Handles type validation and drop zone registration.
 */

import { useEffect, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useDragDrop } from '../context/DragDropContext';
import type { AnyObject, ObjectType, SurfaceId, DropPosition } from '../types';
import { DROP_ACCEPT_MAP, OBJECT_CAPABILITIES } from '../types';

// =============================================================================
// Types
// =============================================================================

interface UseDroppableContainerOptions {
  /** Unique ID for this drop zone */
  id: string;

  /** Surface ID (if this is a surface-level droppable) */
  surfaceId?: SurfaceId;

  /** Object types this container accepts */
  accepts: ObjectType[];

  /** Callback when objects are dropped */
  onDrop?: (objects: AnyObject[], position: DropPosition) => void | Promise<void>;

  /** Whether dropping is disabled */
  disabled?: boolean;

  /** Additional data to attach to the droppable */
  data?: Record<string, unknown>;
}

interface UseDroppableContainerReturn {
  /** Whether something is currently over this container */
  isOver: boolean;

  /** Whether the current drag can be accepted */
  canAccept: boolean;

  /** Whether this is an active drop target (over + can accept) */
  isActiveDropTarget: boolean;

  /** Props for the droppable element */
  droppableProps: {
    ref: (node: HTMLElement | null) => void;
    'data-drop-target': boolean;
    'data-can-accept': boolean;
  };
}

// =============================================================================
// Hook
// =============================================================================

export function useDroppableContainer({
  id,
  surfaceId,
  accepts,
  onDrop,
  disabled = false,
  data = {},
}: UseDroppableContainerOptions): UseDroppableContainerReturn {
  const dragDrop = useDragDrop();

  // Set up dnd-kit droppable
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled,
    data: {
      type: 'container',
      surfaceId,
      accepts,
      ...data,
    },
  });

  // Register drop zone with context
  useEffect(() => {
    if (surfaceId && onDrop && accepts.length > 0 && !disabled) {
      dragDrop.registerDropZone({
        surfaceId,
        accepts,
        onDrop,
      });

      return () => {
        dragDrop.unregisterDropZone(surfaceId);
      };
    }
    return undefined;
  }, [dragDrop, surfaceId, accepts, onDrop, disabled]);

  // Check if current drag can be accepted
  const canAccept = useMemo(() => {
    if (!dragDrop.state.isDragging || !dragDrop.state.draggedType) {
      return false;
    }
    return accepts.includes(dragDrop.state.draggedType);
  }, [dragDrop.state.isDragging, dragDrop.state.draggedType, accepts]);

  // Active drop target = over + can accept
  const isActiveDropTarget = isOver && canAccept;

  // Droppable props
  const droppableProps = useMemo(
    () => ({
      ref: setNodeRef,
      'data-drop-target': isActiveDropTarget,
      'data-can-accept': canAccept,
    }),
    [setNodeRef, isActiveDropTarget, canAccept],
  );

  return {
    isOver,
    canAccept,
    isActiveDropTarget,
    droppableProps,
  };
}

// =============================================================================
// Helper: Object Container Droppable
// =============================================================================

interface UseObjectDroppableOptions {
  /** The container object (project, initiative, moment) */
  object: AnyObject;

  /** Callback when objects are dropped into this container */
  onDrop?: (droppedObjects: AnyObject[]) => void | Promise<void>;

  /** Whether dropping is disabled */
  disabled?: boolean;
}

/**
 * Specialized hook for objects that can contain other objects.
 * Automatically determines accepted types based on object type.
 */
export function useObjectDroppable({
  object,
  onDrop,
  disabled = false,
}: UseObjectDroppableOptions): UseDroppableContainerReturn {
  // Get accepted types from the drop accept map
  const accepts = DROP_ACCEPT_MAP[object.type];
  const capabilities = OBJECT_CAPABILITIES[object.type];

  // Only enable if the object type supports being a drop target
  const isDisabled = disabled || !capabilities.droppable || accepts.length === 0;

  // Wrap the onDrop to provide position context
  const handleDrop = useMemo(() => {
    if (!onDrop) return undefined;
    return (objects: AnyObject[], _position: DropPosition) => {
      return onDrop(objects);
    };
  }, [onDrop]);

  return useDroppableContainer({
    id: `object-${object.id}`,
    accepts,
    onDrop: handleDrop,
    disabled: isDisabled,
    data: {
      containerId: object.id,
      containerType: object.type,
    },
  });
}
