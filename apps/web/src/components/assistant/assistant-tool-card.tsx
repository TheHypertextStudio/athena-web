/**
 * Tool call card component for the assistant.
 *
 * Displays tool execution status with icon, label, and result preview.
 * Shows different states: pending, running, complete, error.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useMemo } from 'react';
import type { SvgIconComponent } from '@mui/icons-material';
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';
import StopOutlined from '@mui/icons-material/StopOutlined';
import TimerOutlined from '@mui/icons-material/TimerOutlined';
import BarChartOutlined from '@mui/icons-material/BarChartOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import ExpandLessOutlined from '@mui/icons-material/ExpandLessOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import { cn } from '@/lib/utils';
import type { AssistantToolCardProps } from '@/lib/assistant';
import { TOOL_LABELS } from '@/lib/assistant';

/**
 * Icon mapping for tool names.
 */
const TOOL_ICON_MAP: Record<string, SvgIconComponent> = {
  list_tasks: ChecklistOutlined,
  create_task: AddOutlined,
  update_task: EditOutlined,
  complete_task: CheckCircleOutlined,
  search_tasks: SearchOutlined,
  list_projects: ViewKanbanOutlined,
  list_events: CalendarTodayOutlined,
  create_event: EventOutlined,
  get_agenda: CalendarMonthOutlined,
  start_timer: PlayArrowOutlined,
  stop_timer: StopOutlined,
  get_timer_status: TimerOutlined,
  get_productivity_summary: BarChartOutlined,
};

/**
 * Renders a tool call card.
 *
 * Displays the tool execution with:
 * - Status icon (spinner, check, error)
 * - Tool label (from TOOL_LABELS)
 * - Collapsible arguments preview
 * - Result preview (when complete)
 */
export function AssistantToolCard({ toolCall, compact = false }: AssistantToolCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get icon for this tool
  const ToolIcon = TOOL_ICON_MAP[toolCall.name] ?? SearchOutlined;

  // Get human-readable label
  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name;

  // Status-based styling
  const statusStyles = useMemo(() => {
    switch (toolCall.status) {
      case 'pending':
        return {
          border: 'border-outline-variant',
          bg: 'bg-surface-container',
          statusIcon: null,
          statusColor: 'text-on-surface-variant',
        };
      case 'running':
        return {
          border: 'border-primary',
          bg: 'bg-primary-container/20',
          statusIcon: SyncOutlined,
          statusColor: 'text-primary',
          animate: 'animate-spin',
        };
      case 'complete':
        return {
          border: 'border-outline-variant',
          bg: 'bg-surface-container',
          statusIcon: CheckOutlined,
          statusColor: 'text-primary',
        };
      case 'error':
        return {
          border: 'border-error',
          bg: 'bg-error-container/20',
          statusIcon: ErrorOutlineOutlined,
          statusColor: 'text-error',
        };
      default:
        return {
          border: 'border-outline-variant',
          bg: 'bg-surface-container',
          statusIcon: null,
          statusColor: 'text-on-surface-variant',
        };
    }
  }, [toolCall.status]);

  const StatusIcon = statusStyles.statusIcon;

  // Format arguments for display
  const formattedArgs = useMemo(() => {
    try {
      return JSON.stringify(toolCall.arguments, null, 2);
    } catch {
      return '[Unable to display arguments]';
    }
  }, [toolCall.arguments]);

  // Format result for display
  const formattedResult = useMemo(() => {
    if (!toolCall.result) return null;
    try {
      return JSON.stringify(toolCall.result, null, 2);
    } catch {
      return '[Unable to display result]';
    }
  }, [toolCall.result]);

  return (
    <div
      className={cn(
        'rounded-lg border',
        statusStyles.border,
        statusStyles.bg,
        compact ? 'px-2 py-1.5' : 'px-3 py-2',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        {/* Tool icon */}
        <ToolIcon
          sx={{ fontSize: compact ? 14 : 16 }}
          className={cn('flex-shrink-0', 'text-on-surface-variant')}
          aria-hidden="true"
        />

        {/* Label */}
        <span className={cn('flex-1 truncate', compact ? 'text-xs' : 'text-sm', 'text-on-surface')}>
          {label}
        </span>

        {/* Status icon */}
        {StatusIcon && (
          <StatusIcon
            sx={{ fontSize: compact ? 14 : 16 }}
            className={cn(
              statusStyles.statusColor,
              'animate' in statusStyles && statusStyles.animate,
            )}
            aria-label={toolCall.status}
          />
        )}

        {/* Expand/collapse button (non-compact only) */}
        {!compact && Object.keys(toolCall.arguments).length > 0 && (
          <button
            type="button"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            className={cn(
              'rounded p-0.5',
              'text-on-surface-variant hover:text-on-surface',
              'hover:bg-surface-container-highest transition-colors',
              'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
            )}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            {isExpanded ? (
              <ExpandLessOutlined sx={{ fontSize: 16 }} />
            ) : (
              <ExpandMoreOutlined sx={{ fontSize: 16 }} />
            )}
          </button>
        )}
      </div>

      {/* Error message */}
      {toolCall.status === 'error' && toolCall.error && (
        <div className={cn('mt-1.5 text-xs', 'text-error')}>{toolCall.error}</div>
      )}

      {/* Expanded details */}
      {isExpanded && !compact && (
        <div className="mt-2 space-y-2">
          {/* Arguments */}
          {formattedArgs && formattedArgs !== '{}' && (
            <div>
              <div className="text-on-surface-variant mb-1 text-xs font-medium">Arguments</div>
              <pre
                className={cn(
                  'bg-surface-container-highest rounded p-2',
                  'text-on-surface font-mono text-xs',
                  'max-h-32 overflow-x-auto',
                )}
              >
                {formattedArgs}
              </pre>
            </div>
          )}

          {/* Result */}
          {formattedResult && (
            <div>
              <div className="text-on-surface-variant mb-1 text-xs font-medium">Result</div>
              <pre
                className={cn(
                  'bg-surface-container-highest rounded p-2',
                  'text-on-surface font-mono text-xs',
                  'max-h-32 overflow-x-auto',
                )}
              >
                {formattedResult}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
