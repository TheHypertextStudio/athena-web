/**
 * TasksSurface - Reusable task list surface component.
 *
 * A composable surface for displaying and managing tasks.
 * Can be embedded in various contexts: full page, sidebar, modal, etc.
 *
 * Follows the HIG surface pattern:
 * - Surfaces are mediums for interaction
 * - Objects (tasks) can be transferred between surfaces
 * - Components resolve intents, not screens
 *
 * @packageDocumentation
 */

'use client';

import { useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTasksData, type TaskFilters } from '@/hooks/useTasksData';
import { useTasksSurface, type TaskSort } from '@/hooks/useTasksSurface';
import { useTimeBlocksForDay, useLinkTaskToTimeBlock } from '@/hooks/useTimeBlocks';
import { useSnackbar } from '@/components/ui/snackbar';
import { TasksToolbar, type Project } from './TasksToolbar';
import { TasksList } from './TasksList';
import { TasksEmptyState, getEmptyStateVariant } from './TasksEmptyState';
import { TaskContextMenu } from '@/components/tasks/TaskContextMenu';
import { TaskCreationModal } from '@/components/tasks/TaskCreationModal';
import { Skeleton } from '@/components/ui/skeleton';
import { type Task } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const CREATE_TASK_EMPTY_LAYOUT_ID = 'create-task-empty';

export interface TasksSurfaceProps {
  /** Pre-filtered tasks (optional - fetches own data if not provided) */
  tasks?: Task[];
  /** Whether data is loading (only used when tasks are provided externally) */
  isLoading?: boolean;
  /** External filter control */
  filters?: TaskFilters;
  /** Callback when filters change (for controlled mode) */
  onFiltersChange?: (filters: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
  /** External sort control */
  sort?: TaskSort;
  /** Callback when sort changes (for controlled mode) */
  onSortChange?: (sort: TaskSort) => void;
  /** Whether to show the toolbar */
  showToolbar?: boolean;
  /** Available projects for filtering and assignment */
  projects?: Project[];
  /** Map of project IDs to names */
  projectNames?: Map<string, string>;
  /** Maximum height (for embedding in constrained containers) */
  maxHeight?: number | string;
  /** Additional class name */
  className?: string;
}

/**
 * Loading skeleton for the tasks surface.
 */
function TasksSurfaceSkeleton({ showToolbar = true }: { showToolbar?: boolean }) {
  return (
    <div className="space-y-4">
      {showToolbar && (
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-20" />
        </div>
      )}
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Internal implementation of TasksSurface with all features.
 */
function TasksSurfaceInternal({
  tasks: externalTasks,
  isLoading: externalLoading,
  filters: externalFilters,
  onFiltersChange,
  sort: externalSort,
  onSortChange,
  showToolbar = true,
  projects = [],
  projectNames,
  maxHeight,
  className,
}: TasksSurfaceProps) {
  const snackbar = useSnackbar();

  // Use internal data fetching if tasks not provided
  const internalData = useTasksData({
    filters: externalFilters,
    enabled: !externalTasks,
  });

  const tasks = externalTasks ?? internalData.tasks;
  const isLoading = externalLoading ?? internalData.isLoading;

  // Fetch today's time blocks for context menu
  const today = useMemo(() => new Date(), []);
  const { data: timeBlocksData } = useTimeBlocksForDay(today);
  const timeBlocks = timeBlocksData?.data ?? [];

  // Link task to time block mutation
  const linkTaskMutation = useLinkTaskToTimeBlock();

  // Build project names map if not provided
  const projectNamesMap = useMemo(() => {
    if (projectNames) return projectNames;
    const map = new Map<string, string>();
    projects.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [projectNames, projects]);

  // Use surface state management
  const surface = useTasksSurface({
    tasks,
    mutations: {
      onCreateTask: internalData.createTask,
      onUpdateTask: internalData.updateTask,
      onDeleteTask: internalData.deleteTask,
    },
    initialFilters: externalFilters,
    initialSort: externalSort,
  });

  // Determine if controlled or uncontrolled
  const filters = externalFilters ?? surface.filters;
  const sort = externalSort ?? surface.sort;
  const setFilters = onFiltersChange ?? surface.setFilters;
  const setSort = onSortChange ?? surface.setSort;

  // Handler for adding task to time block
  const handleAddToTimeBlock = async (taskId: string, timeBlockId: string) => {
    try {
      await linkTaskMutation.mutateAsync({ timeBlockId, taskId });
      const block = timeBlocks.find((b) => b.id === timeBlockId);
      snackbar.show({ message: `Added to "${block?.label ?? 'time block'}"` });
    } catch {
      snackbar.show({ message: 'Failed to add task to time block' });
    }
  };

  // Calculate empty state
  const emptyVariant = getEmptyStateVariant(
    tasks.length,
    surface.displayedTasks.length,
    surface.hasActiveFilters,
  );
  const isEmpty = surface.displayedTasks.length === 0 && surface.sections.length === 0;

  if (isLoading) {
    return <TasksSurfaceSkeleton showToolbar={showToolbar} />;
  }

  return (
    <div
      className={cn('flex flex-col', className)}
      style={maxHeight ? { maxHeight, overflow: 'hidden' } : undefined}
    >
      {/* Toolbar */}
      {showToolbar && (
        <TasksToolbar
          filters={filters}
          onFiltersChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          searchExpanded={surface.searchExpanded}
          onSearchExpandedChange={surface.setSearchExpanded}
          projects={projects}
          hasActiveFilters={surface.hasActiveFilters}
          onClearFilters={surface.clearFilters}
          className="mb-4 flex-shrink-0"
        />
      )}

      {/* Content */}
      <div className={cn('flex-1', maxHeight && 'overflow-y-auto')}>
        <AnimatePresence mode="wait">
          {isEmpty ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <TasksEmptyState
                variant={emptyVariant}
                hasActiveFilters={surface.hasActiveFilters}
                onCreateClick={() => {
                  surface.openCreationModal(CREATE_TASK_EMPTY_LAYOUT_ID);
                }}
                createButtonLayoutId={CREATE_TASK_EMPTY_LAYOUT_ID}
                onClearFilters={surface.clearFilters}
              />
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <TasksList
                tasks={surface.displayedTasks}
                sections={surface.sections}
                sort={sort}
                isOrganizedMode={surface.isOrganizedMode}
                projectNames={projectNamesMap}
                onTaskClick={surface.handlers.onTaskClick}
                onTaskContextMenu={surface.handlers.onTaskContextMenu}
                onStatusChange={surface.handlers.onStatusChange}
                selectedTaskIds={surface.selectedTaskIds}
                onTaskSelect={surface.toggleTaskSelection}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Context Menu */}
      <TaskContextMenu
        task={surface.contextMenu.task}
        position={surface.contextMenu.position}
        onClose={surface.closeContextMenu}
        onStatusChange={surface.handlers.onStatusChange}
        onPriorityChange={surface.handlers.onPriorityChange}
        onProjectChange={surface.handlers.onProjectChange}
        onDelete={surface.handlers.onDeleteTask}
        onAddToTimeBlock={handleAddToTimeBlock}
        projects={projects}
        timeBlocks={timeBlocks}
      />

      {/* Creation Modal */}
      <TaskCreationModal
        open={surface.creationModalOpen}
        layoutId={surface.creationModalLayoutId ?? undefined}
        onClose={surface.closeCreationModal}
        onCreate={surface.handlers.onCreateTask}
        projects={projects}
        timeBlocks={timeBlocks}
        onLinkToTimeBlock={async (taskId, blockId) => {
          await linkTaskMutation.mutateAsync({ timeBlockId: blockId, taskId });
        }}
      />
    </div>
  );
}

/**
 * TasksSurface - A reusable surface component for displaying and managing tasks.
 *
 * Can operate in two modes:
 * 1. **Standalone**: Fetches its own data using `useTasksData`
 * 2. **Controlled**: Receives tasks and callbacks from parent
 *
 * @example
 * ```tsx
 * // Standalone mode - fetches own data
 * <TasksSurface projects={projects} />
 *
 * // Controlled mode - receives external data
 * <TasksSurface
 *   tasks={filteredTasks}
 *   filters={filters}
 *   onFiltersChange={setFilters}
 *   projects={projects}
 * />
 *
 * // Embedded in constrained container
 * <TasksSurface
 *   maxHeight={400}
 *   showToolbar={false}
 *   projects={projects}
 * />
 * ```
 */
export const TasksSurface = memo(TasksSurfaceInternal);

export default TasksSurface;
