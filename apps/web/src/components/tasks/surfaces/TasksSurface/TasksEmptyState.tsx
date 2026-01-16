/**
 * Empty state component for the Tasks surface.
 *
 * Displays contextual messaging based on whether filters are active
 * or if the user has no tasks at all.
 *
 * @packageDocumentation
 */

'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type EmptyStateVariant = 'no-tasks' | 'filtered-empty' | 'all-done';

export interface TasksEmptyStateProps {
  /** The type of empty state to display */
  variant: EmptyStateVariant;
  /** Whether filters are currently active */
  hasActiveFilters?: boolean;
  /** Callback when create button is clicked */
  onCreateClick?: () => void;
  /** Layout ID for shared element transitions */
  createButtonLayoutId?: string;
  /** Callback when clear filters is clicked */
  onClearFilters?: () => void;
  /** Additional class name */
  className?: string;
}

const emptyStateContent: Record<
  EmptyStateVariant,
  {
    icon: React.ReactNode;
    title: string;
    description: string;
    showCreate: boolean;
    showClearFilters: boolean;
  }
> = {
  'no-tasks': {
    icon: <AddOutlined sx={{ fontSize: 40 }} />,
    title: 'No tasks yet',
    description: 'Create your first task to get started.',
    showCreate: true,
    showClearFilters: false,
  },
  'filtered-empty': {
    icon: <SearchOutlined sx={{ fontSize: 40 }} />,
    title: 'No matching tasks',
    description: 'Try adjusting your filters to see more tasks.',
    showCreate: false,
    showClearFilters: true,
  },
  'all-done': {
    icon: <AutoAwesomeOutlined sx={{ fontSize: 40 }} />,
    title: "You're all caught up!",
    description: 'Nice work. Time to relax or add something new.',
    showCreate: true,
    showClearFilters: false,
  },
};

/**
 * Determine the appropriate empty state variant.
 */
export function getEmptyStateVariant(
  totalTasks: number,
  filteredTasks: number,
  hasActiveFilters: boolean,
): EmptyStateVariant {
  if (totalTasks === 0) {
    return 'no-tasks';
  }
  if (hasActiveFilters && filteredTasks === 0) {
    return 'filtered-empty';
  }
  return 'all-done';
}

/**
 * Empty state component with contextual messaging.
 */
export const TasksEmptyState = memo(function TasksEmptyState({
  variant,
  hasActiveFilters = false,
  onCreateClick,
  createButtonLayoutId,
  onClearFilters,
  className,
}: TasksEmptyStateProps) {
  const content = emptyStateContent[variant];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className={cn(
        'flex flex-col items-center justify-center px-4 py-16',
        'text-center',
        className,
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'mb-4 rounded-2xl p-4',
          'bg-surface-container-high text-on-surface-variant',
          'transition-colors duration-150',
        )}
      >
        {content.icon}
      </div>

      {/* Title */}
      <h3 className="text-on-surface mb-1 text-lg font-semibold">{content.title}</h3>

      {/* Description */}
      <p className="text-on-surface-variant mb-6 max-w-sm text-sm">{content.description}</p>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {content.showCreate && onCreateClick && (
          <motion.div layoutId={createButtonLayoutId} className="inline-flex">
            <Button variant="filled" size="md" onClick={onCreateClick}>
              <AddOutlined sx={{ fontSize: 16 }} className="mr-1.5" />
              Create task
            </Button>
          </motion.div>
        )}

        {content.showClearFilters && hasActiveFilters && onClearFilters && (
          <Button variant="outlined" size="md" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    </motion.div>
  );
});

export default TasksEmptyState;
