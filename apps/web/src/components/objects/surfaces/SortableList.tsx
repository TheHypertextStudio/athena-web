'use client';

/**
 * SortableList - Reorderable List Surface
 *
 * A complete sortable list implementation using dnd-kit.
 * Handles reordering, multi-select drag, and drop from external sources.
 */

import { useMemo, type ReactNode } from 'react';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useDroppableContainer } from '../behaviors/useDroppableContainer';
import { useSelection } from '../context/SelectionContext';
import type { AnyObject, ObjectType, SurfaceId, DropPosition } from '../types';

// =============================================================================
// Types
// =============================================================================

interface SortableListProps<T extends AnyObject> {
  /** Unique ID for this list */
  id: SurfaceId;

  /** Items to display */
  items: T[];

  /** Render function for each item */
  renderItem: (item: T, index: number, context: SortableItemContext) => ReactNode;

  /** Object types this list accepts for drops */
  accepts?: ObjectType[];

  /** Callback when items are reordered */
  onReorder?: (items: T[]) => void;

  /** Callback when external items are dropped */
  onDrop?: (objects: AnyObject[], position: DropPosition) => void;

  /** Empty state content */
  emptyState?: ReactNode;

  /** Additional class names */
  className?: string;

  /** Gap between items */
  gap?: 'none' | 'sm' | 'md' | 'lg';

  /** Whether the list is sortable */
  sortable?: boolean;

  /** Animation configuration */
  animate?: boolean;
}

interface SortableItemContext {
  /** Whether this item is being dragged */
  isDragging: boolean;

  /** Whether this item is selected */
  isSelected: boolean;

  /** Index in the list */
  index: number;

  /** Props for the sortable wrapper */
  sortableProps: {
    ref: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    'data-dragging': boolean;
  };

  /** Drag handle props (for handle-based dragging) */
  dragHandleProps: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners;
  };
}

// =============================================================================
// SortableItem Component
// =============================================================================

interface SortableItemProps<T extends AnyObject> {
  item: T;
  index: number;
  renderItem: SortableListProps<T>['renderItem'];
  surfaceId: SurfaceId;
  animate: boolean;
}

function SortableItem<T extends AnyObject>({
  item,
  index,
  renderItem,
  surfaceId,
  animate,
}: SortableItemProps<T>) {
  const selection = useSelection();
  const isSelected = selection.isSelected(item.id);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: {
      type: item.type,
      surfaceId,
      index,
      object: item,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : undefined,
  };

  const context: SortableItemContext = {
    isDragging,
    isSelected,
    index,
    sortableProps: {
      ref: setNodeRef,
      style,
      'data-dragging': isDragging,
    },
    dragHandleProps: {
      attributes,
      listeners: listeners ?? {},
    },
  };

  const content = renderItem(item, index, context);

  if (animate) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
      >
        {content}
      </motion.div>
    );
  }

  return <>{content}</>;
}

// =============================================================================
// SortableList Component
// =============================================================================

export function SortableList<T extends AnyObject>({
  id,
  items,
  renderItem,
  accepts = [],
  onReorder: _onReorder,
  onDrop,
  emptyState,
  className,
  gap = 'sm',
  sortable = true,
  animate = true,
}: SortableListProps<T>) {
  // Set up droppable for external drops
  const { isActiveDropTarget, droppableProps } = useDroppableContainer({
    id,
    surfaceId: id,
    accepts,
    onDrop,
  });

  // Extract item IDs for SortableContext
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  // Gap classes
  const gapClasses = {
    none: '',
    sm: 'space-y-1',
    md: 'space-y-2',
    lg: 'space-y-4',
  };

  const listContent = (
    <div
      {...droppableProps}
      className={cn(
        'sortable-list',
        gapClasses[gap],
        isActiveDropTarget && 'object-drop-target',
        className,
      )}
      data-surface-id={id}
      data-surface-type="list"
      role="listbox"
      aria-multiselectable="true"
    >
      {items.length === 0 ? (
        (emptyState ?? <div className="text-on-surface-variant py-8 text-center">No items</div>)
      ) : animate ? (
        <AnimatePresence mode="popLayout">
          {items.map((item, index) => (
            <SortableItem
              key={item.id}
              item={item}
              index={index}
              renderItem={renderItem}
              surfaceId={id}
              animate={animate}
            />
          ))}
        </AnimatePresence>
      ) : (
        items.map((item, index) => (
          <SortableItem
            key={item.id}
            item={item}
            index={index}
            renderItem={renderItem}
            surfaceId={id}
            animate={false}
          />
        ))
      )}
    </div>
  );

  if (sortable) {
    return (
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {listContent}
      </SortableContext>
    );
  }

  return listContent;
}

// =============================================================================
// Convenience Wrapper
// =============================================================================

interface SimpleSortableListProps<T extends AnyObject> {
  id: SurfaceId;
  items: T[];
  onReorder?: (items: T[]) => void;
  onDrop?: (objects: AnyObject[], position: DropPosition) => void;
  accepts?: ObjectType[];
  emptyState?: ReactNode;
  className?: string;
  renderItem: (item: T) => ReactNode;
}

/**
 * Simplified SortableList that handles the sortable wrapper internally.
 */
export function SimpleSortableList<T extends AnyObject>({
  renderItem,
  ...props
}: SimpleSortableListProps<T>) {
  return (
    <SortableList
      {...props}
      renderItem={(item, index, context) => (
        <div
          ref={context.sortableProps.ref}
          style={context.sortableProps.style}
          data-dragging={context.sortableProps['data-dragging']}
          className={cn(
            context.isSelected && 'object-selected',
            context.isDragging && 'object-dragging',
          )}
        >
          {renderItem(item)}
        </div>
      )}
    />
  );
}
