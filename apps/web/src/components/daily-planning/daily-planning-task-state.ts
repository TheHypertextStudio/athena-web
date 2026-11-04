'use client';

import type { DailyPlanSession, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { useEffect, useRef, useState } from 'react';
import type { Task } from './daily-planning-controller';
import type { EventBlock } from './daily-planning-agenda';
import { includeSessionBudget, placeSession } from './daily-planning-model';
import { useRenameDailyTask } from './daily-planning-queries';

function removeSelectedTask(draft: DailyPlanSnapshot, taskId: string): DailyPlanSnapshot {
  return {
    ...draft,
    settings: {
      ...draft.settings,
      excludedTaskIds: [...new Set([...(draft.settings?.excludedTaskIds ?? []), taskId])],
    },
    mainTaskId: draft.mainTaskId === taskId ? null : draft.mainTaskId,
    tasks: draft.tasks.filter((task) => task.taskId !== taskId),
    sessions: draft.sessions
      .map((session) => ({
        ...session,
        allocations: session.allocations.filter((part) => part.taskId !== taskId),
      }))
      .filter((session) => session.allocations.length > 0),
  };
}

function selectedTask(
  draft: DailyPlanSnapshot,
  taskId: string,
  organizationId: string,
  plannedMinutes?: number,
): DailyPlanSnapshot {
  return {
    ...draft,
    settings: {
      ...draft.settings,
      excludedTaskIds: draft.settings?.excludedTaskIds?.filter((id) => id !== taskId),
    },
    tasks: [
      ...draft.tasks,
      {
        taskId,
        organizationId,
        plannedMinutes: plannedMinutes ?? 45,
        sort: draft.tasks.length,
        selectionSource: 'explicit',
        durationSource: plannedMinutes === undefined ? 'default' : 'estimate',
      },
    ],
  };
}

function useTaskNames(date: string) {
  const rename = useRenameDailyTask(date);
  const [taskNames, setTaskNames] = useState<Record<string, string>>({});
  const [failedTitle, setFailedTitle] = useState<{ taskId: string; title: string } | null>(null);
  const renameTask = async (
    task: Pick<Task, 'taskId' | 'organizationId'>,
    title: string,
  ): Promise<void> => {
    setTaskNames((current) => ({ ...current, [task.taskId]: title }));
    try {
      await rename.mutateAsync({ organizationId: task.organizationId, taskId: task.taskId, title });
      setFailedTitle(null);
    } catch {
      setFailedTitle({ taskId: task.taskId, title });
    }
  };
  return { taskNames, setTaskNames, failedTitle, renameTask };
}

/** Edit shared task values and place manual sessions in the planning draft. */
export function useDailyPlanningTasks(input: {
  date: string;
  timezone: string;
  draft: DailyPlanSnapshot | null;
  editDraft: (value: DailyPlanSnapshot) => void;
  setError: (value: string | null) => void;
  fixed: readonly EventBlock[];
  startAt: string;
  actual: readonly { taskId: string | null; recordedMinutes: number }[];
}) {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  }, [input]);
  const { taskNames, setTaskNames, failedTitle, renameTask } = useTaskNames(input.date);
  const [editing, setEditing] = useState<{ taskId: string; sessionId?: string } | null>(null);
  const addTasks = (
    items: readonly {
      taskId: string;
      organizationId: string;
      title: string;
      plannedMinutes?: number;
    }[],
  ): void => {
    let draft = input.draft;
    if (!draft) return;
    for (const item of items) {
      if (!draft.tasks.some((task) => task.taskId === item.taskId))
        draft = selectedTask(draft, item.taskId, item.organizationId, item.plannedMinutes);
    }
    setTaskNames((current) => ({
      ...current,
      ...Object.fromEntries(items.map((item) => [item.taskId, item.title])),
    }));
    input.editDraft(draft);
  };
  const addTask = (taskId: string, organizationId: string, title: string): void => {
    addTasks([{ taskId, organizationId, title }]);
  };
  const removeTask = (taskId: string, sourceDate = input.date): void => {
    const current = latest.current;
    const draft = current.draft;
    if (current.date !== sourceDate || draft?.date !== sourceDate) return;
    current.editDraft(removeSelectedTask(draft, taskId));
  };
  const saveSession = (session: DailyPlanSession, value = input.draft): boolean => {
    const draft = value;
    if (!draft) return false;
    try {
      input.editDraft(
        placeSession(
          includeSessionBudget(draft, session, input.actual),
          { ...session, placementSource: 'manual' },
          input.fixed,
          input.startAt,
        ),
      );
      setEditing(null);
      return true;
    } catch {
      input.setError(
        'Choose a time within the workday that does not overlap another block or event. Check Planned time if the block is too long.',
      );
      return false;
    }
  };
  return {
    taskNames,
    failedTitle,
    editing,
    setEditing,
    renameTask,
    addTask,
    addTasks,
    removeTask,
    saveSession,
  };
}
