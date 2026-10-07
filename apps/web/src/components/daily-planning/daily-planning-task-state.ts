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
        plannedMinutes: 45,
        sort: draft.tasks.length,
        selectionSource: 'explicit',
        durationSource: 'default',
      },
    ],
  };
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
  const rename = useRenameDailyTask(input.date);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  }, [input]);
  const [taskNames, setTaskNames] = useState<Record<string, string>>({});
  const [failedTitle, setFailedTitle] = useState<{ taskId: string; title: string } | null>(null);
  const [editing, setEditing] = useState<{ taskId: string; sessionId?: string } | null>(null);
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
  const addTask = (taskId: string, organizationId: string, title: string): void => {
    const draft = input.draft;
    if (!draft || draft.tasks.some((task) => task.taskId === taskId)) return;
    setTaskNames((current) => ({ ...current, [taskId]: title }));
    input.editDraft(selectedTask(draft, taskId, organizationId));
  };
  const removeTask = (taskId: string, sourceDate = input.date): void => {
    const current = latest.current;
    const draft = current.draft;
    if (current.date !== sourceDate || draft?.date !== sourceDate) return;
    current.editDraft(removeSelectedTask(draft, taskId));
  };
  const saveSession = (session: DailyPlanSession, value = input.draft): void => {
    const draft = value;
    if (!draft) return;
    try {
      if (Date.parse(session.startsAt) < Date.parse(input.startAt))
        throw new Error('Choose a time that has not passed.');
      input.editDraft(
        placeSession(
          includeSessionBudget(draft, session, input.actual),
          { ...session, placementSource: 'manual' },
          input.fixed,
          input.startAt,
        ),
      );
      setEditing(null);
    } catch {
      input.setError(
        'Choose a time within the workday that does not overlap another block or event. Check Planned time if the block is too long.',
      );
    }
  };
  return {
    taskNames,
    failedTitle,
    editing,
    setEditing,
    renameTask,
    addTask,
    removeTask,
    saveSession,
  };
}
