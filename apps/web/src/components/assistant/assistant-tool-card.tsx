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
import type { LucideIcon } from 'lucide-react';
import {
  ListTodo,
  Plus,
  Pencil,
  CheckCircle,
  Search,
  FolderKanban,
  Calendar,
  CalendarPlus,
  CalendarDays,
  Play,
  Square,
  Timer,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssistantToolCardProps } from '@/lib/assistant';
import { TOOL_LABELS } from '@/lib/assistant';

/**
 * Icon mapping for tool names.
 */
const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  list_tasks: ListTodo,
  create_task: Plus,
  update_task: Pencil,
  complete_task: CheckCircle,
  search_tasks: Search,
  list_projects: FolderKanban,
  list_events: Calendar,
  create_event: CalendarPlus,
  get_agenda: CalendarDays,
  start_timer: Play,
  stop_timer: Square,
  get_timer_status: Timer,
  get_productivity_summary: BarChart3,
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
  const ToolIcon = TOOL_ICON_MAP[toolCall.name] ?? Search;

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
          statusIcon: Loader2,
          statusColor: 'text-primary',
          animate: 'animate-spin',
        };
      case 'complete':
        return {
          border: 'border-outline-variant',
          bg: 'bg-surface-container',
          statusIcon: Check,
          statusColor: 'text-primary',
        };
      case 'error':
        return {
          border: 'border-error',
          bg: 'bg-error-container/20',
          statusIcon: AlertCircle,
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
          className={cn(
            'flex-shrink-0',
            compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
            'text-on-surface-variant',
          )}
          aria-hidden="true"
        />

        {/* Label */}
        <span className={cn('flex-1 truncate', compact ? 'text-xs' : 'text-sm', 'text-on-surface')}>
          {label}
        </span>

        {/* Status icon */}
        {StatusIcon && (
          <StatusIcon
            className={cn(
              compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
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
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
