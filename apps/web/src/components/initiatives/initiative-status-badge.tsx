/**
 * Initiative status badge component.
 *
 * Displays the current status of an initiative with appropriate
 * color coding and styling.
 *
 * @packageDocumentation
 */

import { cn } from '@/lib/utils';
import type { InitiativeStatusCategory } from '@/lib/api-client';

const statusConfig: Record<
  InitiativeStatusCategory,
  { label: string; bgColor: string; textColor: string }
> = {
  planning: {
    label: 'Planning',
    bgColor: 'bg-slate-500/10',
    textColor: 'text-slate-600 dark:text-slate-400',
  },
  active: {
    label: 'Active',
    bgColor: 'bg-primary/10',
    textColor: 'text-primary',
  },
  completed: {
    label: 'Completed',
    bgColor: 'bg-green-500/10',
    textColor: 'text-green-600 dark:text-green-400',
  },
  archived: {
    label: 'Archived',
    bgColor: 'bg-slate-500/10',
    textColor: 'text-slate-500 dark:text-slate-500',
  },
};

export interface InitiativeStatusBadgeProps {
  /** The status to display */
  status: InitiativeStatusCategory;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional class names */
  className?: string;
}

/**
 * Badge component for displaying initiative status.
 *
 * @example
 * ```tsx
 * <InitiativeStatusBadge status="active" />
 * <InitiativeStatusBadge status="planning" size="sm" />
 * ```
 */
export function InitiativeStatusBadge({
  status,
  size = 'md',
  className,
}: InitiativeStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        config.bgColor,
        config.textColor,
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
        className,
      )}
    >
      {config.label}
    </span>
  );
}
