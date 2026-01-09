'use client';

/**
 * useDraggableObject - Object-Aware Draggable Hook
 *
 * Wraps dnd-kit's useDraggable with object system integration.
 * Handles multi-drag with selection and type awareness.
 */

import { useEffect, useMemo } from 'react';
import { useDraggable, type DraggableAttributes } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useDragDrop } from '../context/DragDropContext';
import { useSelection } from '../context/SelectionContext';
import type { AnyObject, SurfaceId, DragHandleProps } from '../types';
import { OBJECT_CAPABILITIES } from '../types';

// =============================================================================
// Types
// =============================================================================

interface UseDraggableObjectOptions {
  /** The object being made draggable */
  object: AnyObject;

  /** Surface this object belongs to */
  surfaceId: SurfaceId;

  /** Whether dragging is disabled */
  disabled?: boolean;

  /** Use handle-based dragging (only drag handle initiates drag) */
  useHandle?: boolean;
}

interface UseDraggableObjectReturn {
  /** Whether this object is currently being dragged */
  isDragging: boolean;

  /** Whether this object is part of a multi-drag */
  isPartOfMultiDrag: boolean;

  /** Props for the draggable element */
  draggableProps: {
    ref: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    'data-dragging': boolean;
  };

  /** Props for the drag handle (if useHandle is true) */
  dragHandleProps: DragHandleProps | null;

  /** Attributes to spread (for full-element drag) */
  attributes: DraggableAttributes;

  /** Listeners for drag events (for full-element drag) */
  listeners: ReturnType<typeof useDraggable>['listeners'];

  /** Transform style string */
  transform: string | undefined;
}

// =============================================================================
// Hook
// =============================================================================

export function useDraggableObject({
  object,
  surfaceId,
  disabled = false,
  useHandle = false,
}: UseDraggableObjectOptions): UseDraggableObjectReturn {
  const dragDrop = useDragDrop();
  const selection = useSelection();

  // Check if object type is draggable
  const capabilities = OBJECT_CAPABILITIES[object.type];
  const isDisabled = disabled || !capabilities.draggable;

  // Get selection state
  const isSelected = selection.isSelected(object.id);
  const selectedCount = selection.count;

  // Set up dnd-kit draggable
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: object.id,
    disabled: isDisabled,
    data: {
      type: object.type,
      surfaceId,
      object,
      isMultiDrag: isSelected && selectedCount > 1,
    },
  });

  // Update drag context when drag starts
  useEffect(() => {
    if (isDragging) {
      dragDrop.setDraggedType(object.type);
      dragDrop.setSourceSurface(surfaceId);
      dragDrop.setActiveObject(object);

      // If this item is selected and there are multiple selections,
      // include all selected items in the drag
      if (isSelected && selectedCount > 1) {
        dragDrop.setDraggedIds(selection.selectedIds);
      } else {
        dragDrop.setDraggedIds([object.id]);
      }
    }
  }, [isDragging, dragDrop, object, surfaceId, isSelected, selectedCount, selection.selectedIds]);

  // Check if this object is part of a multi-drag (but not the active one)
  const isPartOfMultiDrag = useMemo(() => {
    return (
      dragDrop.state.isDragging &&
      dragDrop.state.draggedIds.includes(object.id) &&
      dragDrop.state.activeId !== object.id
    );
  }, [dragDrop.state, object.id]);

  // Build transform style
  const transformStyle = transform ? CSS.Transform.toString(transform) : undefined;

  // Draggable props for the element
  const draggableProps = useMemo(
    () => ({
      ref: setNodeRef,
      style: {
        transform: transformStyle,
        opacity: isDragging ? 0.5 : isPartOfMultiDrag ? 0.3 : 1,
        cursor: isDisabled ? 'default' : isDragging ? 'grabbing' : 'grab',
      } as React.CSSProperties,
      'data-dragging': isDragging,
    }),
    [setNodeRef, transformStyle, isDragging, isPartOfMultiDrag, isDisabled],
  );

  // Drag handle props (only if useHandle is true)
  const dragHandleProps: DragHandleProps | null = useMemo(() => {
    if (!useHandle || isDisabled) return null;
    return {
      attributes,
      listeners,
      setNodeRef,
    };
  }, [useHandle, isDisabled, attributes, listeners, setNodeRef]);

  return {
    isDragging,
    isPartOfMultiDrag,
    draggableProps,
    dragHandleProps,
    attributes: useHandle ? ({} as DraggableAttributes) : attributes,
    listeners: useHandle ? undefined : listeners,
    transform: transformStyle,
  };
}
