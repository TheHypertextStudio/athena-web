'use client';

/**
 * Which relationship control on the task page is open: the new-subtask composer, a task search for
 * an existing subtask, a blocker, a blocked task, a related task, or the parent.
 *
 * @remarks
 * One value, so opening one control closes any other. The Subtasks and Relations sections and the
 * properties sidebar read it; the command palette writes it, so "Add blocker" typed into ⌘K opens
 * the same search the section's `+` opens.
 */
import { createContext, type JSX, type ReactNode, useContext, useMemo, useState } from 'react';

/** A relationship control on the task page. */
export type TaskRelationCommand =
  'newSubtask' | 'existingSubtask' | 'blockedBy' | 'blocking' | 'related' | 'parent';

/** The open control and the way to change it. */
export interface TaskRelationCommands {
  readonly active: TaskRelationCommand | null;
  readonly setActive: (command: TaskRelationCommand | null) => void;
}

const NONE: TaskRelationCommands = { active: null, setActive: () => undefined };

const TaskRelationCommandsContext = createContext<TaskRelationCommands>(NONE);

/**
 * Hold the task page's open relationship control.
 *
 * @param props - The page content.
 * @returns the provider.
 */
export function TaskRelationCommandsProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const [active, setActive] = useState<TaskRelationCommand | null>(null);
  const value = useMemo(() => ({ active, setActive }), [active]);
  return (
    <TaskRelationCommandsContext.Provider value={value}>
      {children}
    </TaskRelationCommandsContext.Provider>
  );
}

/**
 * Read the task page's open relationship control.
 *
 * @returns the control state; outside a task page, nothing is ever open.
 */
export function useTaskRelationCommands(): TaskRelationCommands {
  return useContext(TaskRelationCommandsContext);
}

/**
 * Read one control's open state as a boolean pair.
 *
 * @param command - The control.
 * @returns whether it is open, and a setter that opens it or closes it.
 */
export function useTaskRelationCommand(
  command: TaskRelationCommand,
): readonly [boolean, (open: boolean) => void] {
  const { active, setActive } = useTaskRelationCommands();
  return [
    active === command,
    (open: boolean) => {
      if (open) setActive(command);
      else if (active === command) setActive(null);
    },
  ];
}
