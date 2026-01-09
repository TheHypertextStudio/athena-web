'use client';

/**
 * Surface - Container Component
 *
 * Surfaces are containers that hold objects and define drop behavior.
 * They register as drop zones and handle reordering within.
 */

import { useEffect, useCallback, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useDragDrop } from '../context/DragDropContext';
import { useSelection } from '../context/SelectionContext';
import type { AnyObject, ObjectType, SurfaceId, SurfaceType, DropPosition } from '../types';

// =============================================================================
// Types
// =============================================================================

interface SurfaceProps {
  /** Unique identifier for this surface */
  id: SurfaceId;

  /** Type of surface (affects layout strategy) */
  type?: SurfaceType;

  /** Object types this surface accepts for drops */
  accepts?: ObjectType[];

  /** Ordered list of item IDs for sortable */
  items: string[];

  /** Callback when items are reordered */
  onReorder?: (activeId: string, overId: string) => void;

  /** Callback when objects are dropped from another surface */
  onDrop?: (objects: AnyObject[], position: DropPosition) => void | Promise<void>;

  /** Children to render */
  children: ReactNode;

  /** Additional class names */
  className?: string;

  /** Whether to enable sorting */
  sortable?: boolean;

  /** Custom sorting strategy (defaults based on type) */
  sortingStrategy?: SortingStrategy;
}

// =============================================================================
// Helpers
// =============================================================================

function getDefaultStrategy(type: SurfaceType): SortingStrategy {
  switch (type) {
    case 'list':
    case 'timeline':
      return verticalListSortingStrategy;
    case 'board':
      return horizontalListSortingStrategy;
    case 'calendar':
      return rectSortingStrategy;
    default:
      return verticalListSortingStrategy;
  }
}

// =============================================================================
// Component
// =============================================================================

export function Surface({
  id,
  type = 'list',
  accepts = [],
  items,
  onReorder: _onReorder,
  onDrop,
  children,
  className,
  sortable = true,
  sortingStrategy,
}: SurfaceProps) {
  const dragDrop = useDragDrop();
  const selection = useSelection();

  // Set up droppable
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      surfaceId: id,
      type: 'surface',
      accepts,
    },
  });

  // Register as drop zone
  useEffect(() => {
    if (onDrop && accepts.length > 0) {
      dragDrop.registerDropZone({
        surfaceId: id,
        accepts,
        onDrop,
      });

      return () => {
        dragDrop.unregisterDropZone(id);
      };
    }
    return undefined;
  }, [dragDrop, id, accepts, onDrop]);

  // Track when this surface gains focus for selection
  const handleFocus = useCallback(() => {
    selection.setFocusedSurface(id);
  }, [selection, id]);

  // Determine if we can accept the current drag
  const canAcceptDrag = dragDrop.canAccept(id);
  const showDropIndicator = isOver && canAcceptDrag;

  // Get sorting strategy
  const strategy = sortingStrategy ?? getDefaultStrategy(type);

  // Surface styling
  const surfaceClasses = cn(
    'surface',
    `surface-${type}`,
    showDropIndicator && 'object-drop-target',
    className,
  );

  const content = sortable ? (
    <SortableContext items={items} strategy={strategy}>
      {children}
    </SortableContext>
  ) : (
    children
  );

  return (
    <motion.div
      ref={setNodeRef}
      className={surfaceClasses}
      onFocus={handleFocus}
      data-surface-id={id}
      data-surface-type={type}
    >
      {content}
    </motion.div>
  );
}

// =============================================================================
// Specialized Surfaces
// =============================================================================

interface ListSurfaceProps extends Omit<SurfaceProps, 'type' | 'sortingStrategy'> {
  /** Gap between items */
  gap?: 'none' | 'sm' | 'md' | 'lg';
}

/**
 * List surface optimized for vertical lists.
 */
export function ListSurface({ gap = 'sm', className, ...props }: ListSurfaceProps) {
  const gapClasses = {
    none: '',
    sm: 'space-y-1',
    md: 'space-y-2',
    lg: 'space-y-4',
  };

  return (
    <Surface
      type="list"
      sortingStrategy={verticalListSortingStrategy}
      className={cn(gapClasses[gap], className)}
      {...props}
    />
  );
}

interface CalendarSurfaceProps extends Omit<SurfaceProps, 'type' | 'sortingStrategy' | 'sortable'> {
  /** Start time of the calendar view */
  startTime: Date;
  /** End time of the calendar view */
  endTime: Date;
  /** Time slot duration in minutes */
  slotDuration?: number;
}

/**
 * Calendar surface for time-based layouts.
 */
export function CalendarSurface({
  className,
  startTime: _startTime,
  endTime: _endTime,
  slotDuration: _slotDuration = 30,
  ...props
}: CalendarSurfaceProps) {
  return (
    <Surface
      type="calendar"
      sortable={false}
      className={cn('calendar-grid', className)}
      {...props}
    />
  );
}

interface BoardSurfaceProps extends Omit<SurfaceProps, 'type' | 'sortingStrategy'> {
  /** Column width */
  columnWidth?: 'auto' | 'fixed';
}

/**
 * Board surface for Kanban-style layouts.
 */
export function BoardSurface({ columnWidth = 'fixed', className, ...props }: BoardSurfaceProps) {
  return (
    <Surface
      type="board"
      sortingStrategy={horizontalListSortingStrategy}
      className={cn('flex gap-4', columnWidth === 'fixed' && 'board-fixed-columns', className)}
      {...props}
    />
  );
}

type TimelineSurfaceProps = Omit<SurfaceProps, 'type' | 'sortingStrategy' | 'sortable'>;

/**
 * Timeline surface for activity feeds.
 */
export function TimelineSurface({ className, ...props }: TimelineSurfaceProps) {
  return (
    <Surface type="timeline" sortable={false} className={cn('timeline', className)} {...props} />
  );
}
