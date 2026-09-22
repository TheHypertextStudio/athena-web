'use client';

/**
 * The task page's relationship controls: the writes, and which control is open.
 *
 * @remarks
 * The open control is one value, so opening one control closes any other: the new-subtask
 * composer, or the task search for one kind of link. The Subtasks and Relations sections and the
 * properties sidebar read it; the command palette writes it, so "Add blocker" typed into ⌘K opens
 * the same search the section's `+` opens. A control opened by a click also records which search
 * opened it, so a search mounted twice (a chip row keeps a hidden copy for measuring) opens once.
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import type { TaskLink, TaskRelationWrites } from '@/lib/use-task-relations';

/**
 * A relationship control on the task page: the new-subtask composer, or the task search for one
 * kind of link (`subtask` attaches an existing task).
 */
export type TaskRelationCommand = TaskLink | 'newSubtask';

/** How one kind of link reads wherever the page offers it. */
export interface TaskLinkCopy {
  /** The action that adds one: a menu item and a palette command. */
  readonly add: string;
  /** The label over a list of them. */
  readonly group: string;
  /** A row's remove button, followed by the task's title. */
  readonly remove: string;
  /** The task search's placeholder. */
  readonly placeholder: string;
  /** The task search's accessible name. */
  readonly searchLabel: string;
}

/** Every kind of link's wording, shared by the sections, the task search, and the palette. */
export const LINK_COPY: Readonly<Record<TaskLink, TaskLinkCopy>> = {
  subtask: {
    add: 'Add existing task as subtask',
    group: 'Subtasks',
    remove: 'Remove from subtasks',
    placeholder: 'Add an existing task…',
    searchLabel: 'Existing task to add as a subtask',
  },
  parent: {
    add: 'Set parent task',
    group: 'Parent',
    remove: 'Remove parent',
    placeholder: 'File this task under…',
    searchLabel: 'Parent task',
  },
  blockedBy: {
    add: 'Add blocker',
    group: 'Blocked by',
    remove: 'Remove blocker',
    placeholder: 'Find the task this one waits on…',
    searchLabel: 'Task that blocks this one',
  },
  blocking: {
    add: 'Add blocked task',
    group: 'Blocking',
    remove: 'Remove blocked task',
    placeholder: 'Find a task this one blocks…',
    searchLabel: 'Task this one blocks',
  },
  related: {
    add: 'Add related task',
    group: 'Related',
    remove: 'Remove related task',
    placeholder: 'Find a related task…',
    searchLabel: 'Related task',
  },
};

/** The page's relationship writes, the open control, and the way to change it. */
export interface TaskRelationControls {
  readonly writes: TaskRelationWrites;
  readonly active: TaskRelationCommand | null;
  /** The search that opened `active`, or `null` when any search for it may show it. */
  readonly owner: string | null;
  readonly setActive: (command: TaskRelationCommand | null, owner?: string) => void;
}

/** What {@link TaskRelationsProvider} holds besides its writes. */
interface OpenControl {
  readonly command: TaskRelationCommand | null;
  readonly owner: string | null;
}

const CLOSED: OpenControl = { command: null, owner: null };

const NONE: TaskRelationControls = {
  writes: { link: () => undefined, unlink: () => undefined, rename: () => undefined },
  active: null,
  owner: null,
  setActive: () => undefined,
};

const TaskRelationsContext = createContext<TaskRelationControls>(NONE);

/** Props for {@link TaskRelationsProvider}. */
export interface TaskRelationsProviderProps {
  readonly writes: TaskRelationWrites;
  readonly children: ReactNode;
}

/**
 * Hold the task page's relationship writes and its open relationship control.
 *
 * @param props - See {@link TaskRelationsProviderProps}.
 * @returns the provider.
 */
export function TaskRelationsProvider({
  writes,
  children,
}: TaskRelationsProviderProps): JSX.Element {
  const [open, setOpen] = useState<OpenControl>(CLOSED);
  const setActive = useCallback<TaskRelationControls['setActive']>((command, owner) => {
    setOpen(command === null ? CLOSED : { command, owner: owner ?? null });
  }, []);
  const value = useMemo<TaskRelationControls>(
    () => ({ writes, active: open.command, owner: open.owner, setActive }),
    [open, setActive, writes],
  );
  return <TaskRelationsContext.Provider value={value}>{children}</TaskRelationsContext.Provider>;
}

/**
 * Read the task page's relationship controls.
 *
 * @returns the writes and the open control; outside a task page, nothing opens or writes.
 */
export function useTaskRelationControls(): TaskRelationControls {
  return useContext(TaskRelationsContext);
}
