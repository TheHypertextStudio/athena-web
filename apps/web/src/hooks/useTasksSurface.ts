/**
 * UI state layer hook for the Tasks surface.
 *
 * Manages filter/sort state, task organization into sections,
 * selection state, and interaction handlers.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTransitionRouter } from 'next-view-transitions';
import { type Task, type UpdateTaskInput, type CreateTaskInput } from '@/lib/api-client';

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

export interface TaskFilters {
  search?: string;
  status?: TaskStatus | 'all';
  priority?: TaskPriority | 'all';
  projectId?: string;
}

export type TaskSortField = 'deadline' | 'priority' | 'createdAt' | 'updatedAt' | 'title' | 'none';

export interface TaskSort {
  field: TaskSortField;
  direction: 'asc' | 'desc';
}

export interface TaskSection {
  id: string;
  title: string;
  tasks: Task[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface UseTasksSurfaceOptions {
  /** Tasks to display */
  tasks: Task[];
  /** Mutation handlers */
  mutations: {
    onCreateTask: (input: CreateTaskInput) => Promise<Task>;
    onUpdateTask: (id: string, input: UpdateTaskInput) => Promise<Task>;
    onDeleteTask: (id: string) => Promise<void>;
  };
  /** Initial filter state */
  initialFilters?: TaskFilters;
  /** Initial sort state */
  initialSort?: TaskSort;
}

export interface UseTasksSurfaceReturn {
  // Filtered/sorted tasks
  displayedTasks: Task[];
  sections: TaskSection[];

  // Filter state
  filters: TaskFilters;
  setFilters: (filters: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
  updateFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;

  // Sort state
  sort: TaskSort;
  setSort: (sort: TaskSort) => void;
  toggleSortDirection: () => void;
  isOrganizedMode: boolean;

  // Selection
  selectedTaskIds: Set<string>;
  selectTask: (id: string) => void;
  deselectTask: (id: string) => void;
  toggleTaskSelection: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;

  // Creation modal
  creationModalOpen: boolean;
  creationModalLayoutId: string | null;
  openCreationModal: (layoutId?: string) => void;
  closeCreationModal: () => void;

  // Context menu
  contextMenu: { task: Task | null; position: { x: number; y: number } | null };
  openContextMenu: (task: Task, position: { x: number; y: number }) => void;
  closeContextMenu: () => void;

  // Search expanded state
  searchExpanded: boolean;
  setSearchExpanded: (expanded: boolean) => void;
  toggleSearch: () => void;

  // Handlers
  handlers: {
    onTaskClick: (task: Task) => void;
    onTaskContextMenu: (task: Task, e: React.MouseEvent) => void;
    onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>;
    onProjectChange: (taskId: string, projectId: string | null) => Promise<void>;
    onPriorityChange: (taskId: string, priority: TaskPriority) => Promise<void>;
    onDeleteTask: (taskId: string) => Promise<void>;
    onCreateTask: (input: CreateTaskInput) => Promise<Task>;
  };
}

const DEFAULT_FILTERS: TaskFilters = {
  search: '',
  status: 'all',
  priority: 'all',
  projectId: 'all',
};

const DEFAULT_SORT: TaskSort = {
  field: 'none',
  direction: 'asc',
};

/**
 * Check if a deadline is overdue.
 */
function isOverdue(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  const now = new Date();
  deadlineDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return deadlineDate < now;
}

/**
 * Check if a deadline is within the next N days.
 */
function isWithinDays(deadline: string | null | undefined, days: number): boolean {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + days);

  deadlineDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  future.setHours(0, 0, 0, 0);

  return deadlineDate >= now && deadlineDate <= future;
}

/**
 * Check if a task was completed today.
 */
function isCompletedToday(task: Task): boolean {
  if (task.status !== 'completed') return false;
  const updated = new Date(task.updatedAt);
  const today = new Date();
  return (
    updated.getDate() === today.getDate() &&
    updated.getMonth() === today.getMonth() &&
    updated.getFullYear() === today.getFullYear()
  );
}

/**
 * Organize tasks into smart sections (Focus, Up Next, Later, Completed).
 */
function organizeTasks(tasks: Task[]): TaskSection[] {
  const sections: TaskSection[] = [];

  // Focus: In-progress + overdue pending tasks
  const focusTasks = tasks.filter(
    (t) => t.status === 'in_progress' || (t.status === 'pending' && isOverdue(t.deadline)),
  );
  if (focusTasks.length > 0) {
    sections.push({
      id: 'focus',
      title: 'Focus',
      tasks: focusTasks.sort((a, b) => {
        if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
        if (a.status !== 'in_progress' && b.status === 'in_progress') return 1;
        if (a.deadline && b.deadline) {
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        }
        return 0;
      }),
    });
  }

  // Up Next: Pending tasks due within 7 days (not overdue)
  const upNextTasks = tasks.filter(
    (t) => t.status === 'pending' && !isOverdue(t.deadline) && isWithinDays(t.deadline, 7),
  );
  if (upNextTasks.length > 0) {
    sections.push({
      id: 'up-next',
      title: 'Up Next',
      tasks: upNextTasks.sort((a, b) => {
        if (a.deadline && b.deadline) {
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        }
        return 0;
      }),
    });
  }

  // Later: Pending tasks with no deadline or deadline > 7 days
  const laterTasks = tasks.filter(
    (t) => t.status === 'pending' && !isOverdue(t.deadline) && !isWithinDays(t.deadline, 7),
  );
  if (laterTasks.length > 0) {
    sections.push({
      id: 'later',
      title: 'Later',
      tasks: laterTasks.sort((a, b) => {
        if (a.deadline && !b.deadline) return -1;
        if (!a.deadline && b.deadline) return 1;
        if (a.deadline && b.deadline) {
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        }
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }),
    });
  }

  // Completed: Recently completed tasks (today)
  const completedTasks = tasks.filter((t) => isCompletedToday(t));
  if (completedTasks.length > 0) {
    sections.push({
      id: 'completed',
      title: 'Completed Today',
      tasks: completedTasks.sort((a, b) => {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
      collapsible: true,
      defaultCollapsed: true,
    });
  }

  return sections;
}

/**
 * Sort tasks by the specified field and direction.
 */
function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  const { field, direction } = sort;
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...tasks].sort((a, b) => {
    switch (field) {
      case 'deadline': {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return multiplier * (new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
      }
      case 'priority': {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        return multiplier * (priorityOrder[a.priority] - priorityOrder[b.priority]);
      }
      case 'createdAt':
        return multiplier * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case 'updatedAt':
        return multiplier * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      case 'title':
        return multiplier * a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
}

/**
 * Filter tasks by the specified filters.
 */
function filterTasks(tasks: Task[], filters: TaskFilters): Task[] {
  return tasks.filter((task) => {
    // Search filter
    if (filters.search) {
      const query = filters.search.toLowerCase();
      const matchesTitle = task.title.toLowerCase().includes(query);
      const matchesDescription = task.description?.toLowerCase().includes(query);
      if (!matchesTitle && !matchesDescription) {
        return false;
      }
    }

    // Status filter
    if (filters.status && filters.status !== 'all' && task.status !== filters.status) {
      return false;
    }

    // Priority filter
    if (filters.priority && filters.priority !== 'all' && task.priority !== filters.priority) {
      return false;
    }

    // Project filter
    if (filters.projectId && filters.projectId !== 'all') {
      if (task.projectId !== filters.projectId) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Hook for managing Tasks surface UI state.
 */
export function useTasksSurface(options: UseTasksSurfaceOptions): UseTasksSurfaceReturn {
  const { tasks, mutations, initialFilters, initialSort } = options;
  const router = useTransitionRouter();

  // Filter state
  const [filters, setFilters] = useState<TaskFilters>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  });

  // Sort state
  const [sort, setSort] = useState<TaskSort>({
    ...DEFAULT_SORT,
    ...initialSort,
  });

  // Selection state
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  // Creation modal state
  const [creationModalOpen, setCreationModalOpen] = useState(false);
  const [creationModalLayoutId, setCreationModalLayoutId] = useState<string | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    task: Task | null;
    position: { x: number; y: number } | null;
  }>({ task: null, position: null });

  // Search expanded state
  const [searchExpanded, setSearchExpanded] = useState(false);

  // Derived state: filtered tasks
  const filteredTasks = useMemo(() => filterTasks(tasks, filters), [tasks, filters]);

  // Derived state: whether we're in organized mode (smart sections) or sorted mode (flat list)
  const isOrganizedMode = sort.field === 'none';

  // Derived state: displayed tasks (sorted if not in organized mode)
  const displayedTasks = useMemo(() => {
    if (isOrganizedMode) {
      return filteredTasks;
    }
    return sortTasks(filteredTasks, sort);
  }, [filteredTasks, sort, isOrganizedMode]);

  // Derived state: sections (only in organized mode)
  const sections = useMemo(() => {
    if (!isOrganizedMode) {
      return [];
    }
    return organizeTasks(filteredTasks);
  }, [filteredTasks, isOrganizedMode]);

  // Derived state: whether any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      Boolean(filters.search) ||
      (filters.status !== undefined && filters.status !== 'all') ||
      (filters.priority !== undefined && filters.priority !== 'all') ||
      (filters.projectId !== undefined && filters.projectId !== 'all')
    );
  }, [filters]);

  // Filter actions
  const updateFilter = useCallback(<K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  // Sort actions
  const toggleSortDirection = useCallback(() => {
    setSort((prev) => ({
      ...prev,
      direction: prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  // Selection actions
  const selectTask = useCallback((id: string) => {
    setSelectedTaskIds((prev) => new Set([...prev, id]));
  }, []);

  const deselectTask = useCallback((id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleTaskSelection = useCallback((id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedTaskIds(new Set(displayedTasks.map((t) => t.id)));
  }, [displayedTasks]);

  // Creation modal actions
  const openCreationModal = useCallback((layoutId?: string) => {
    setCreationModalOpen(true);
    setCreationModalLayoutId(layoutId ?? null);
  }, []);

  const closeCreationModal = useCallback(() => {
    setCreationModalOpen(false);
    setCreationModalLayoutId(null);
  }, []);

  // Context menu actions
  const openContextMenu = useCallback((task: Task, position: { x: number; y: number }) => {
    setContextMenu({ task, position });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu({ task: null, position: null });
  }, []);

  // Search actions
  const toggleSearch = useCallback(() => {
    setSearchExpanded((prev) => !prev);
    if (searchExpanded) {
      setFilters((prev) => ({ ...prev, search: '' }));
    }
  }, [searchExpanded]);

  // Event handlers
  const handleTaskClick = useCallback(
    (task: Task) => {
      router.push(`/tasks/${task.id}`);
    },
    [router],
  );

  const handleTaskContextMenu = useCallback(
    (task: Task, e: React.MouseEvent) => {
      e.preventDefault();
      openContextMenu(task, { x: e.clientX, y: e.clientY });
    },
    [openContextMenu],
  );

  const handleStatusChange = useCallback(
    async (taskId: string, status: TaskStatus) => {
      await mutations.onUpdateTask(taskId, { status });
    },
    [mutations],
  );

  const handleProjectChange = useCallback(
    async (taskId: string, projectId: string | null) => {
      await mutations.onUpdateTask(taskId, { projectId });
    },
    [mutations],
  );

  const handlePriorityChange = useCallback(
    async (taskId: string, priority: TaskPriority) => {
      await mutations.onUpdateTask(taskId, { priority });
    },
    [mutations],
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      await mutations.onDeleteTask(taskId);
      closeContextMenu();
    },
    [mutations, closeContextMenu],
  );

  const handleCreateTask = useCallback(
    async (input: CreateTaskInput) => {
      const task = await mutations.onCreateTask(input);
      closeCreationModal();
      return task;
    },
    [mutations, closeCreationModal],
  );

  return {
    displayedTasks,
    sections,

    filters,
    setFilters,
    updateFilter,
    clearFilters,
    hasActiveFilters,

    sort,
    setSort,
    toggleSortDirection,
    isOrganizedMode,

    selectedTaskIds,
    selectTask,
    deselectTask,
    toggleTaskSelection,
    clearSelection,
    selectAll,

    creationModalOpen,
    creationModalLayoutId,
    openCreationModal,
    closeCreationModal,

    contextMenu,
    openContextMenu,
    closeContextMenu,

    searchExpanded,
    setSearchExpanded,
    toggleSearch,

    handlers: {
      onTaskClick: handleTaskClick,
      onTaskContextMenu: handleTaskContextMenu,
      onStatusChange: handleStatusChange,
      onProjectChange: handleProjectChange,
      onPriorityChange: handlePriorityChange,
      onDeleteTask: handleDeleteTask,
      onCreateTask: handleCreateTask,
    },
  };
}
