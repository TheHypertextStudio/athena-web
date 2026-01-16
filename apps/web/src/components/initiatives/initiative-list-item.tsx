/**
 * Initiative list item component.
 *
 * Displays an initiative card with progress metrics, status, and quick actions.
 * Follows the wireframe design with progress ring, project count, and task summary.
 *
 * @packageDocumentation
 */

'use client';

import Link from 'next/link';
import GpsFixedOutlined from '@mui/icons-material/GpsFixedOutlined';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined';
import { cn } from '@/lib/utils';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CustomInitiativeStatusBadge } from './initiative-status-select';
import type { Initiative } from '@/lib/api-client';

export interface InitiativeWithMetrics extends Initiative {
  /** Number of projects under this initiative */
  projectCount?: number;
  /** Number of completed tasks */
  completedTasks?: number;
  /** Total number of tasks */
  totalTasks?: number;
  /** Estimated hours remaining */
  estimatedHoursRemaining?: number;
  /** Whether this is a strategic priority */
  isStrategicPriority?: boolean;
  /** Whether this initiative has child initiatives */
  hasChildren?: boolean;
}

export interface InitiativeListItemProps {
  /** The initiative to display */
  initiative: InitiativeWithMetrics;
  /** Additional class names */
  className?: string;
}

/**
 * Calculate progress percentage from task counts.
 */
function calculateProgress(completed?: number, total?: number): number {
  if (!total || total === 0) return 0;
  return Math.round(((completed ?? 0) / total) * 100);
}

/**
 * Progress ring SVG component.
 */
function ProgressRing({
  progress,
  size = 48,
  strokeWidth = 4,
  className,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className={cn('relative', className)} style={{ width: size, height: size }}>
      <svg className="rotate-[-90deg]" width={size} height={size}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-surface-container-highest"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary transition-all duration-500"
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-semibold tabular-nums">{progress}%</span>
      </div>
    </div>
  );
}

/**
 * Initiative list item card component.
 *
 * Displays an initiative with:
 * - Name and description
 * - Status badge
 * - Progress ring
 * - Project and task counts
 * - Strategic priority indicator
 *
 * @example
 * ```tsx
 * <InitiativeListItem
 *   initiative={{
 *     id: '1',
 *     name: 'Become More Social',
 *     description: 'Build deeper friendships',
 *     status: 'active',
 *     projectCount: 3,
 *     completedTasks: 12,
 *     totalTasks: 28,
 *   }}
 * />
 * ```
 */
export function InitiativeListItem({ initiative, className }: InitiativeListItemProps) {
  const progress = calculateProgress(initiative.completedTasks, initiative.totalTasks);
  const hasMetrics = initiative.totalTasks !== undefined && initiative.totalTasks > 0;

  return (
    <Link
      href={`/initiatives/${initiative.id}`}
      className={cn(
        'group block rounded-xl p-4 transition-all duration-200',
        'bg-surface-container-high hover:bg-surface-container-highest',
        'hover:border-outline-variant/30 border border-transparent',
        'focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      {/* Header: Icon, Name, Status */}
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
          <GpsFixedOutlined sx={{ fontSize: 20 }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-on-surface truncate text-base font-semibold">{initiative.name}</h3>
            <CustomInitiativeStatusBadge status={initiative.customStatus} size="small" />
          </div>

          {initiative.description && (
            <p className="text-on-surface-variant mt-0.5 line-clamp-1 text-sm">
              {initiative.description}
            </p>
          )}
        </div>

        <ChevronRightOutlined
          sx={{ fontSize: 20 }}
          className="text-on-surface-variant flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>

      {/* Metrics section */}
      <div className="mt-4 flex items-center gap-4">
        {/* Progress ring */}
        <ProgressRing progress={progress} size={48} />

        {/* Stats */}
        <div className="flex flex-1 flex-col gap-1">
          {/* Project and task count */}
          <div className="text-on-surface-variant flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1">
              <ViewKanbanOutlined sx={{ fontSize: 14 }} />
              {initiative.projectCount ?? 0} project{initiative.projectCount !== 1 ? 's' : ''}
            </span>
            {hasMetrics && (
              <>
                <span className="text-outline">•</span>
                <span>
                  {initiative.completedTasks}/{initiative.totalTasks} tasks
                </span>
              </>
            )}
          </div>

          {/* Progress bar */}
          {hasMetrics && <ProgressBar progress={progress} size="sm" />}

          {/* Estimated time remaining */}
          {initiative.estimatedHoursRemaining !== undefined &&
            initiative.estimatedHoursRemaining > 0 && (
              <span className="text-on-surface-variant text-xs">
                Est. {initiative.estimatedHoursRemaining}h remaining
              </span>
            )}
        </div>
      </div>

      {/* Strategic priority indicator */}
      {initiative.isStrategicPriority && (
        <div className="text-tertiary mt-3 flex items-center gap-1.5 text-xs font-medium">
          <BoltOutlined sx={{ fontSize: 14 }} />
          Strategic Priority
        </div>
      )}

      {/* Nested initiatives indicator */}
      {initiative.hasChildren && (
        <div className="text-on-surface-variant mt-2 text-xs">Contains sub-initiatives</div>
      )}
    </Link>
  );
}
