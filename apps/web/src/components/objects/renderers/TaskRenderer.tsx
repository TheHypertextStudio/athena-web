'use client';

/**
 * TaskRenderer - Visual Representation of Tasks
 *
 * Renders tasks in various contexts with appropriate variants.
 * Follows MD3 Expressive design language.
 */

import { forwardRef, useCallback, type MouseEvent } from 'react';
import { GripVertical, Calendar, MoreHorizontal } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { TaskObject, RenderVariant, DragHandleProps } from '../types';

// =============================================================================
// Types
// =============================================================================

interface TaskRendererProps {
  /** The task object */
  object: TaskObject;

  /** Display variant */
  variant?: RenderVariant;

  /** Selection state */
  selected?: boolean;

  /** Focus state */
  focused?: boolean;

  /** Drag state */
  dragging?: boolean;

  /** Drop target state */
  dropTarget?: boolean;

  /** Drag handle props (for handle-based dragging) */
  dragHandleProps?: DragHandleProps | null;

  /** Callback when task is toggled */
  onToggle?: (completed: boolean) => void;

  /** Callback when task is clicked */
  onClick?: (event: MouseEvent) => void;

  /** Callback when schedule button is clicked */
  onSchedule?: () => void;

  /** Callback when more button is clicked */
  onMore?: () => void;

  /** Show hover actions */
  showActions?: boolean;

  /** Additional class names */
  className?: string;
}

// =============================================================================
// Priority Indicator
// =============================================================================

interface PriorityIndicatorProps {
  priority: string;
  className?: string;
}

function PriorityIndicator({ priority, className }: PriorityIndicatorProps) {
  const styles = {
    urgent: 'bg-error',
    high: 'bg-warning',
    medium: 'border-2 border-primary bg-transparent',
    low: 'border-2 border-outline-variant bg-transparent',
  };

  const labels = {
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  };

  const style = styles[priority as keyof typeof styles] || styles.medium;
  const label = labels[priority as keyof typeof labels] || priority;

  return (
    <span
      className={cn('inline-flex h-2.5 w-2.5 rounded-full', style, className)}
      title={label}
      aria-label={`Priority: ${label}`}
    />
  );
}

// =============================================================================
// Compact Variant
// =============================================================================

function TaskCompact({
  object,
  selected,
  dragging,
  onToggle,
  onClick,
  className,
}: TaskRendererProps) {
  const task = object.data;
  const isCompleted = task.status === 'completed';

  const handleCheckboxChange = useCallback(
    (checked: boolean) => {
      if (onToggle) {
        onToggle(checked);
      }
    },
    [onToggle],
  );

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
        'hover:bg-surface-container-high',
        selected && 'bg-selection-background',
        dragging && 'opacity-50',
        className,
      )}
      onClick={onClick}
    >
      <Checkbox
        checked={isCompleted}
        onCheckedChange={handleCheckboxChange}
        className="h-4 w-4"
        onClick={(e) => {
          e.stopPropagation();
        }}
      />
      <span
        className={cn(
          'flex-1 truncate text-sm',
          isCompleted && 'text-on-surface-variant line-through',
        )}
      >
        {task.title}
      </span>
      <PriorityIndicator priority={task.priority} />
    </div>
  );
}

// =============================================================================
// Normal Variant
// =============================================================================

function TaskNormal({
  object,
  selected,
  focused,
  dragging,
  dragHandleProps,
  onToggle,
  onClick,
  onSchedule,
  onMore,
  showActions = true,
  className,
}: TaskRendererProps) {
  const task = object.data;
  const isCompleted = task.status === 'completed';

  const handleCheckboxChange = useCallback(
    (checked: boolean) => {
      if (onToggle) {
        onToggle(checked);
      }
    },
    [onToggle],
  );

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-lg border p-3 transition-all',
        'bg-surface-container border-outline-variant',
        'hover:bg-surface-container-high',
        selected && 'bg-selection-background border-primary ring-primary/20 ring-2',
        focused && 'ring-primary ring-2',
        dragging && 'scale-[1.02] opacity-90 shadow-lg',
        isCompleted && 'bg-surface-dim opacity-60',
        className,
      )}
      onClick={onClick}
    >
      {/* Drag Handle */}
      {dragHandleProps && (
        <div
          ref={dragHandleProps.setNodeRef}
          className="cursor-grab opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
        >
          <GripVertical className="text-on-surface-variant h-4 w-4" />
        </div>
      )}

      {/* Checkbox */}
      <Checkbox
        checked={isCompleted}
        onCheckedChange={handleCheckboxChange}
        className="h-5 w-5"
        onClick={(e) => {
          e.stopPropagation();
        }}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm font-medium',
            isCompleted && 'text-on-surface-variant line-through',
          )}
        >
          {task.title}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <PriorityIndicator priority={task.priority} />
          <span className="text-on-surface-variant text-xs capitalize">{task.priority}</span>
          {task.estimatedMinutes && (
            <>
              <span className="text-on-surface-variant text-xs">·</span>
              <span className="text-on-surface-variant text-xs">
                {task.estimatedMinutes >= 60
                  ? `${String(Math.floor(task.estimatedMinutes / 60))}h`
                  : `${String(task.estimatedMinutes)}m`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Hover Actions */}
      {showActions && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onSchedule && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onSchedule();
              }}
            >
              <Calendar className="h-4 w-4" />
            </Button>
          )}
          {onMore && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onMore();
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Expanded Variant
// =============================================================================

function TaskExpanded({ object, selected, onToggle, onClick, className }: TaskRendererProps) {
  const task = object.data;
  const isCompleted = task.status === 'completed';

  const handleCheckboxChange = useCallback(
    (checked: boolean) => {
      if (onToggle) {
        onToggle(checked);
      }
    },
    [onToggle],
  );

  return (
    <div
      className={cn(
        'bg-surface-container space-y-4 rounded-lg border p-4',
        selected && 'border-primary ring-primary/20 ring-2',
        className,
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isCompleted}
          onCheckedChange={handleCheckboxChange}
          className="mt-0.5 h-5 w-5"
          onClick={(e) => {
            e.stopPropagation();
          }}
        />
        <h3
          className={cn(
            'text-base font-medium',
            isCompleted && 'text-on-surface-variant line-through',
          )}
        >
          {task.title}
        </h3>
      </div>

      {/* Description */}
      {task.description && (
        <div className="pl-8">
          <p className="text-on-surface-variant text-sm">{task.description}</p>
        </div>
      )}

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-4 pl-8 text-sm">
        <div>
          <span className="text-on-surface-variant">Priority</span>
          <div className="mt-1 flex items-center gap-2">
            <PriorityIndicator priority={task.priority} />
            <span className="capitalize">{task.priority}</span>
          </div>
        </div>

        {task.deadline && (
          <div>
            <span className="text-on-surface-variant">Due</span>
            <p className="mt-1">
              {new Date(task.deadline).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
        )}

        {task.estimatedMinutes && (
          <div>
            <span className="text-on-surface-variant">Estimate</span>
            <p className="mt-1">
              {task.estimatedMinutes >= 60
                ? `${String(Math.floor(task.estimatedMinutes / 60))} hours`
                : `${String(task.estimatedMinutes)} minutes`}
            </p>
          </div>
        )}

        <div>
          <span className="text-on-surface-variant">Status</span>
          <p className="mt-1 capitalize">{task.status.replace('_', ' ')}</p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export const TaskRenderer = forwardRef<HTMLDivElement, TaskRendererProps>(function TaskRenderer(
  { variant = 'normal', ...props },
  ref,
) {
  const Component = {
    compact: TaskCompact,
    normal: TaskNormal,
    expanded: TaskExpanded,
  }[variant];

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 5 }}
      transition={{ duration: 0.15 }}
    >
      <Component {...props} />
    </motion.div>
  );
});
