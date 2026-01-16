/**
 * Task list component for the Tasks surface.
 *
 * Displays tasks either in smart sections (organized mode) or as a flat list (sorted mode).
 * Supports collapsible sections, staggered animations, and context menu integration.
 *
 * @packageDocumentation
 */

'use client';

import { useState, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import { TaskRow } from '@/components/tasks/TaskRow';
import { type Task } from '@/lib/api-client';
import { type TaskSection, type TaskSort } from '@/hooks/useTasksSurface';
import { cn } from '@/lib/utils';

type TaskStatus = Task['status'];

export interface TasksListProps {
  /** Tasks to display (for sorted mode) */
  tasks: Task[];
  /** Sections to display (for organized mode) */
  sections: TaskSection[];
  /** Current sort configuration */
  sort: TaskSort;
  /** Whether we're in organized mode (smart sections) */
  isOrganizedMode: boolean;
  /** Map of project IDs to names for display */
  projectNames?: Map<string, string>;
  /** Callback when a task is clicked */
  onTaskClick: (task: Task) => void;
  /** Callback when task context menu should open */
  onTaskContextMenu: (task: Task, e: React.MouseEvent) => void;
  /** Callback when task status changes */
  onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>;
  /** Set of selected task IDs */
  selectedTaskIds?: Set<string>;
  /** Callback when task selection changes */
  onTaskSelect?: (taskId: string) => void;
  /** Additional class name */
  className?: string;
}

interface TaskSectionViewProps {
  section: TaskSection;
  projectNames?: Map<string, string>;
  onTaskClick: (task: Task) => void;
  onTaskContextMenu: (task: Task, e: React.MouseEvent) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>;
  selectedTaskIds?: Set<string>;
  onTaskSelect?: (taskId: string) => void;
}

const sortLabels: Record<TaskSort['field'], string> = {
  none: 'Organized',
  deadline: 'Deadline',
  priority: 'Priority',
  createdAt: 'Created',
  updatedAt: 'Updated',
  title: 'Title',
};

/**
 * Individual section component with collapsible support.
 */
const TaskSectionView = memo(function TaskSectionView({
  section,
  projectNames,
  onTaskClick,
  onTaskContextMenu,
  onStatusChange,
  selectedTaskIds,
  onTaskSelect,
}: TaskSectionViewProps) {
  const [isCollapsed, setIsCollapsed] = useState(section.defaultCollapsed ?? false);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <section className="space-y-1">
      {/* Section Header */}
      <div className="flex items-center gap-2 px-1 py-2">
        {section.collapsible ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              'flex items-center gap-1',
              'text-on-surface-variant hover:text-on-surface',
              'transition-colors duration-150',
              'focus-visible:ring-primary/50 focus:outline-none focus-visible:rounded focus-visible:ring-2',
            )}
          >
            <motion.span animate={{ rotate: isCollapsed ? 0 : 90 }} transition={{ duration: 0.15 }}>
              <ChevronRightOutlined sx={{ fontSize: 16 }} />
            </motion.span>
            <span className="text-xs font-semibold tracking-wide uppercase">{section.title}</span>
          </button>
        ) : (
          <span className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
            {section.title}
          </span>
        )}
        <span className="text-on-surface-variant/60 text-xs tabular-nums">
          {section.tasks.length}
        </span>
      </div>

      {/* Section Content */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5">
              {section.tasks.map((task, index) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.15,
                    delay: index * 0.03,
                    ease: [0.2, 0, 0, 1],
                  }}
                >
                  <TaskRow
                    task={task}
                    projectName={task.projectId ? projectNames?.get(task.projectId) : undefined}
                    onClick={onTaskClick}
                    onContextMenu={onTaskContextMenu}
                    onStatusToggle={onStatusChange}
                    selected={selectedTaskIds?.has(task.id)}
                    _onSelect={onTaskSelect}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
});

/**
 * Sorted list header showing current sort configuration.
 */
function SortedListHeader({ sort, taskCount }: { sort: TaskSort; taskCount: number }) {
  const directionLabel = sort.direction === 'asc' ? 'Low → High' : 'High → Low';
  const fieldLabel = sortLabels[sort.field];

  return (
    <div className="flex items-center justify-between px-1 py-2">
      <span className="text-on-surface-variant text-xs">
        Sorted by <span className="font-medium">{fieldLabel}</span>{' '}
        <span className="text-on-surface-variant/60">({directionLabel})</span>
      </span>
      <span className="text-on-surface-variant/60 text-xs tabular-nums">
        {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
      </span>
    </div>
  );
}

/**
 * Task list component supporting both organized and sorted modes.
 */
export const TasksList = memo(function TasksList({
  tasks,
  sections,
  sort,
  isOrganizedMode,
  projectNames,
  onTaskClick,
  onTaskContextMenu,
  onStatusChange,
  selectedTaskIds,
  onTaskSelect,
  className,
}: TasksListProps) {
  if (isOrganizedMode) {
    // Organized mode: render sections
    return (
      <div className={cn('space-y-6', className)}>
        {sections.map((section) => (
          <TaskSectionView
            key={section.id}
            section={section}
            projectNames={projectNames}
            onTaskClick={onTaskClick}
            onTaskContextMenu={onTaskContextMenu}
            onStatusChange={onStatusChange}
            selectedTaskIds={selectedTaskIds}
            onTaskSelect={onTaskSelect}
          />
        ))}
      </div>
    );
  }

  // Sorted mode: render flat list with header
  return (
    <div className={cn('space-y-1', className)}>
      <SortedListHeader sort={sort} taskCount={tasks.length} />
      <div className="space-y-0.5">
        {tasks.map((task, index) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: 0.15,
              delay: index * 0.03,
              ease: [0.2, 0, 0, 1],
            }}
          >
            <TaskRow
              task={task}
              projectName={task.projectId ? projectNames?.get(task.projectId) : undefined}
              onClick={onTaskClick}
              onContextMenu={onTaskContextMenu}
              onStatusToggle={onStatusChange}
              selected={selectedTaskIds?.has(task.id)}
              _onSelect={onTaskSelect}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
});

export default TasksList;
