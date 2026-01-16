/**
 * Object card component for the assistant.
 *
 * Renders tasks, events, and other objects returned by tool calls
 * with appropriate styling and interactive actions.
 *
 * @packageDocumentation
 */

'use client';

import { useMemo } from 'react';
import type { SvgIconComponent } from '@mui/icons-material';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import { cn } from '@/lib/utils';
import type { AssistantObjectCardProps, ObjectType } from '@/lib/assistant';

/**
 * Icon mapping for object types.
 */
const OBJECT_ICONS: Record<ObjectType, SvgIconComponent> = {
  task: CheckCircleOutlined,
  event: CalendarTodayOutlined,
  project: ViewKanbanOutlined,
  initiative: FlagOutlined,
};

/**
 * Color mapping for object types.
 */
const OBJECT_COLORS: Record<ObjectType, string> = {
  task: 'text-primary',
  event: 'text-tertiary',
  project: 'text-secondary',
  initiative: 'text-error',
};

/**
 * Action labels for object actions.
 */
const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  returned: '',
  deleted: 'Deleted',
};

/**
 * Renders a card for an object reference (task, event, project).
 *
 * Displays:
 * - Object icon and type indicator
 * - Object title/name
 * - Relevant metadata (due date, status, etc.)
 * - Action indicator (created, updated, etc.)
 * - Click to navigate/view
 */
export function AssistantObjectCard({
  reference,
  variant = 'normal',
  onAction,
}: AssistantObjectCardProps) {
  const Icon = OBJECT_ICONS[reference.type];
  const colorClass = OBJECT_COLORS[reference.type];
  const actionLabel = ACTION_LABELS[reference.action];
  const isCompact = variant === 'compact';

  // Extract display data based on object type
  const displayData = useMemo(() => {
    const data = reference.data as Record<string, unknown> | null;
    if (!data) return { title: reference.id, subtitle: null };

    switch (reference.type) {
      case 'task': {
        const title =
          (data.title as string | undefined) ?? (data.name as string | undefined) ?? reference.id;
        const dueDate = data.dueDate as string | undefined;
        const status = data.status as string | undefined;
        const priority = data.priority as string | undefined;

        let subtitle = '';
        if (dueDate) {
          try {
            const date = new Date(dueDate);
            subtitle = date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
          } catch {
            subtitle = dueDate;
          }
        }
        if (priority) {
          subtitle = subtitle ? `${subtitle} · ${priority}` : priority;
        }

        return {
          title,
          subtitle: subtitle || null,
          isComplete: status === 'completed' || status === 'done',
        };
      }

      case 'event': {
        const title =
          (data.title as string | undefined) ?? (data.name as string | undefined) ?? reference.id;
        const startTime = data.startTime as string | undefined;
        // endTime is available for future use
        const _endTime = data.endTime as string | undefined;

        let subtitle = '';
        if (startTime) {
          try {
            const start = new Date(startTime);
            const time = start.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            });
            const date = start.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
            subtitle = `${date} at ${time}`;
          } catch {
            subtitle = startTime;
          }
        }

        return { title, subtitle: subtitle || null };
      }

      case 'project': {
        const title =
          (data.name as string | undefined) ?? (data.title as string | undefined) ?? reference.id;
        const taskCount = data.taskCount as number | undefined;
        const status = data.status as string | undefined;

        let subtitle = '';
        if (taskCount !== undefined) {
          subtitle = `${String(taskCount)} task${taskCount !== 1 ? 's' : ''}`;
        }
        if (status) {
          subtitle = subtitle ? `${subtitle} · ${status}` : status;
        }

        return { title, subtitle: subtitle || null };
      }

      default:
        return {
          title:
            (data.name as string | undefined) ?? (data.title as string | undefined) ?? reference.id,
          subtitle: null,
        };
    }
  }, [reference]);

  // Handle click to view/navigate
  const handleClick = () => {
    onAction?.('view');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full rounded-lg border text-left transition-colors',
        'border-outline-variant bg-surface-container',
        'hover:bg-surface-container-high hover:border-outline',
        'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
        isCompact ? 'px-2 py-1.5' : 'px-3 py-2',
      )}
    >
      <div className="flex items-start gap-2">
        {/* Icon */}
        <Icon
          sx={{ fontSize: isCompact ? 14 : 16 }}
          className={cn(
            'mt-0.5 flex-shrink-0',
            colorClass,
            'isComplete' in displayData && displayData.isComplete && 'opacity-50',
          )}
          aria-hidden="true"
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Title */}
            <span
              className={cn(
                'truncate',
                isCompact ? 'text-xs' : 'text-sm',
                'text-on-surface font-medium',
                'isComplete' in displayData && displayData.isComplete && 'line-through opacity-75',
              )}
            >
              {displayData.title}
            </span>

            {/* Action badge */}
            {actionLabel && (
              <span
                className={cn(
                  'flex-shrink-0 rounded px-1 py-0.5',
                  'text-[10px] font-medium uppercase',
                  reference.action === 'created' &&
                    'bg-primary-container text-on-primary-container',
                  reference.action === 'updated' &&
                    'bg-secondary-container text-on-secondary-container',
                  reference.action === 'deleted' && 'bg-error-container text-on-error-container',
                )}
              >
                {actionLabel}
              </span>
            )}
          </div>

          {/* Subtitle */}
          {displayData.subtitle && (
            <span
              className={cn(
                'block truncate',
                isCompact ? 'text-[10px]' : 'text-xs',
                'text-on-surface-variant',
              )}
            >
              {displayData.subtitle}
            </span>
          )}
        </div>

        {/* External link indicator */}
        {!isCompact && (
          <OpenInNewOutlined
            sx={{ fontSize: 14 }}
            className="text-on-surface-variant flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        )}
      </div>
    </button>
  );
}
