'use client';

/**
 * ObjectNode - Universal Object Wrapper
 *
 * Every object in the UI is wrapped in ObjectNode. This component:
 * - Registers the object with the global registry
 * - Provides selection state and handlers
 * - Integrates with drag/drop via dnd-kit
 * - Provides action context
 * - Enables shared element transitions via Framer Motion
 */

import { useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, type MotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useObjectRegistry } from '../context/ObjectRegistryContext';
import { useSelection, useIsSelected } from '../context/SelectionContext';
import { useDragDrop } from '../context/DragDropContext';
import { useActions } from '../context/ActionContext';
import type {
  AnyObject,
  SurfaceId,
  ObjectContext,
  ObjectNodeRenderProp,
  DragHandleProps,
} from '../types';
import { OBJECT_CAPABILITIES } from '../types';

// =============================================================================
// Types
// =============================================================================

interface ObjectNodeProps<T extends AnyObject = AnyObject> {
  /** The object to wrap */
  object: T;

  /** Surface this object belongs to */
  surfaceId: SurfaceId;

  /** Ordered list of IDs for shift-select (optional) */
  orderedIds?: string[];

  /** Whether to enable sortable behavior */
  sortable?: boolean;

  /** Whether the item can be dragged (overrides capability) */
  draggable?: boolean;

  /** Children (can be render prop for context access) */
  children: ReactNode | ObjectNodeRenderProp<T>;

  /** Additional class names */
  className?: string;

  /** Motion props for animations */
  motionProps?: MotionProps;

  /** Disable layout animation */
  disableLayoutAnimation?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function ObjectNode<T extends AnyObject = AnyObject>({
  object,
  surfaceId,
  orderedIds = [],
  sortable = false,
  draggable: draggableOverride,
  children,
  className,
  motionProps,
  disableLayoutAnimation = false,
}: ObjectNodeProps<T>) {
  const registry = useObjectRegistry();
  const selection = useSelection();
  const dragDrop = useDragDrop();
  const actions = useActions();

  const id = object.id;
  const type = object.type;
  const capabilities = OBJECT_CAPABILITIES[type];

  // Determine if draggable
  const isDraggable = draggableOverride ?? capabilities.draggable;

  // Selection state
  const isSelected = useIsSelected(id);

  // Register/unregister with registry
  useEffect(() => {
    registry.register(object, surfaceId);
    return () => {
      registry.unregister(id);
    };
  }, [registry, object, surfaceId, id]);

  // Sortable hook (dnd-kit)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable || !isDraggable,
    data: {
      type,
      surfaceId,
      object,
    },
  });

  // Update drag context when dragging starts
  useEffect(() => {
    if (isDragging) {
      dragDrop.setDraggedType(type);
      dragDrop.setSourceSurface(surfaceId);
      dragDrop.setActiveObject(object);

      // Include selected items in multi-drag if this is selected
      if (isSelected && selection.count > 1) {
        dragDrop.setDraggedIds(selection.selectedIds);
      } else {
        dragDrop.setDraggedIds([id]);
      }
    }
  }, [isDragging, dragDrop, type, surfaceId, object, id, isSelected, selection]);

  // Selection handlers
  const handleSelect = useCallback(() => {
    selection.select(id, surfaceId);
  }, [selection, id, surfaceId]);

  const handleToggleSelect = useCallback(() => {
    selection.toggle(id, surfaceId);
  }, [selection, id, surfaceId]);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.shiftKey && selection.state.anchor) {
        selection.selectRange(selection.state.anchor, id, orderedIds, surfaceId);
      } else if (event.metaKey || event.ctrlKey) {
        handleToggleSelect();
      } else {
        handleSelect();
      }
    },
    [selection, id, orderedIds, surfaceId, handleSelect, handleToggleSelect],
  );

  // Action handling
  const availableActions = useMemo(() => actions.getActionsForObjects([object]), [actions, object]);

  const executeAction = useCallback(
    (actionId: string) => {
      const objectsToActOn =
        isSelected && selection.count > 1
          ? selection.selectedIds
              .map((selectedId) => registry.getObject(selectedId))
              .filter((obj): obj is AnyObject => obj !== undefined)
          : [object];

      void actions.executeAction(actionId, objectsToActOn);
    },
    [actions, object, isSelected, selection, registry],
  );

  // Drag handle props
  const dragHandleProps: DragHandleProps | null =
    isDraggable && sortable
      ? {
          attributes,
          listeners,
          setNodeRef,
        }
      : null;

  // Build context for render prop
  const context: ObjectContext<T> = useMemo(
    () => ({
      object,
      type,
      isSelected,
      isFocused: false, // TODO: Implement focus tracking
      isDragging,
      isDropTarget: false, // TODO: Implement via droppable
      select: handleSelect,
      toggleSelect: handleToggleSelect,
      dragHandleProps,
      actions: availableActions,
      executeAction,
      parent: null, // TODO: Implement via registry
      children: [], // TODO: Implement via registry
    }),
    [
      object,
      type,
      isSelected,
      isDragging,
      handleSelect,
      handleToggleSelect,
      dragHandleProps,
      availableActions,
      executeAction,
    ],
  );

  // Sortable styles
  const sortableStyle = sortable
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
      }
    : undefined;

  // Render children
  const renderedChildren = typeof children === 'function' ? children(context) : children;

  // Base classes
  const baseClasses = cn(
    'object-node',
    isSelected && 'object-selected',
    isDragging && 'object-dragging',
    className,
  );

  // If using sortable, apply ref and styles
  if (sortable) {
    return (
      <motion.div
        ref={setNodeRef}
        style={sortableStyle}
        className={baseClasses}
        onClick={handleClick}
        layoutId={disableLayoutAnimation ? undefined : `object-${id}`}
        {...motionProps}
      >
        {renderedChildren}
      </motion.div>
    );
  }

  // Non-sortable wrapper
  return (
    <motion.div
      className={baseClasses}
      onClick={handleClick}
      layoutId={disableLayoutAnimation ? undefined : `object-${id}`}
      {...motionProps}
    >
      {renderedChildren}
    </motion.div>
  );
}

// =============================================================================
// Convenience Components
// =============================================================================

/**
 * Drag handle component for ObjectNode.
 * Use inside ObjectNode render prop to get a visible drag handle.
 */
interface DragHandleComponentProps {
  dragHandleProps: DragHandleProps | null;
  children: ReactNode;
  className?: string;
}

export function DragHandle({ dragHandleProps, children, className }: DragHandleComponentProps) {
  if (!dragHandleProps) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={dragHandleProps.setNodeRef}
      className={cn('cursor-grab active:cursor-grabbing', className)}
      {...dragHandleProps.attributes}
      {...dragHandleProps.listeners}
    >
      {children}
    </div>
  );
}
