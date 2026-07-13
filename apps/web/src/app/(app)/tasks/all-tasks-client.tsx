'use client';

/**
 * `tasks/all-tasks-client` — the cross-workspace task list.
 *
 * @remarks
 * Composes the caller's tasks across *every* workspace into one unified, org-chipped list by fanning
 * the existing per-org task query over `useActiveOrg().orgs` (so it shares cache with each
 * workspace's `My Work` and needs no new endpoint). "Assigned to me" is resolved per workspace — a
 * user has a distinct actor id in each — by matching the per-org members list. Rows reuse the shared
 * `StatusIcon` glyph + `OrgChip`, so the list reads like the rest of the app. A future `hub/tasks`
 * endpoint would collapse the fan-out into one request without changing this surface.
 */
import type { Priority, TaskOut } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
import { Button, Row, Skeleton, Stack } from '@docket/ui/primitives';
import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { type JSX, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { OrgChip } from '@/components/org-chip';
import { writeScheduleDragObject } from '@/components/scheduling';
import { authClient } from '@/lib/auth-client';
import { myWorkDefs } from '@/lib/my-work-defs';
import { todayISODate } from '@/lib/today';
import { stateTypeOf } from '@/lib/work-state';

/** Sort modes for the unified list. */
type TaskSort = 'due' | 'priority';

/** Urgent → none ordering for the priority sort. */
const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

/** Order tasks for display: by due date (soonest first, undated last) or by priority. */
function sortTasks(tasks: readonly TaskOut[], sort: TaskSort): TaskOut[] {
  return [...tasks].sort((a, b) => {
    if (sort === 'priority') {
      const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (byPriority !== 0) return byPriority;
    }
    // Due date is a `YYYY-MM-DD` string, so lexical compare is chronological; undated sorts last.
    const ad = a.dueDate ?? '9999-99-99';
    const bd = b.dueDate ?? '9999-99-99';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });
}

/** Format a `YYYY-MM-DD` due date as `Jul 1`. */
function formatDue(dueDate: string): string {
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** The cross-workspace task list. */
export default function AllTasksClient(): JSX.Element {
  const { orgs, orgName } = useActiveOrg();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const [sort, setSort] = useState<TaskSort>('due');

  // One query per workspace for tasks + members (members resolves this user's per-org actor id).
  const taskResults = useQueries({ queries: orgs.map((org) => myWorkDefs(org.id).tasks) });
  const memberResults = useQueries({ queries: orgs.map((org) => myWorkDefs(org.id).members) });

  const mine = useMemo<TaskOut[]>(() => {
    const out: TaskOut[] = [];
    orgs.forEach((_org, i) => {
      const tasks = taskResults[i]?.data?.items ?? [];
      const members = memberResults[i]?.data?.items ?? [];
      const myActorId = userId ? members.find((m) => m.userId === userId)?.actorId : undefined;
      if (!myActorId) return;
      for (const task of tasks) if (task.assigneeId === myActorId) out.push(task);
    });
    return out;
  }, [orgs, taskResults, memberResults, userId]);

  const sorted = useMemo(() => sortTasks(mine, sort), [mine, sort]);
  const loading =
    orgs.length === 0 ||
    taskResults.some((r) => r.isPending) ||
    memberResults.some((r) => r.isPending);

  return (
    <Stack gap={4} className="mx-auto h-full w-full max-w-4xl p-4 @2xl:p-6">
      <Row as="header" justify="between">
        <h1 className="text-on-surface text-h1">Tasks</h1>
        {sorted.length > 0 ? <SortToggle sort={sort} onSort={setSort} /> : null}
      </Row>

      {loading && mine.length === 0 ? (
        <Stack gap={1} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </Stack>
      ) : sorted.length === 0 ? (
        <Stack
          align="center"
          gap={2}
          className="border-outline-variant bg-surface-container-low/60 justify-center rounded-2xl border p-12 text-center"
        >
          <p className="text-on-surface text-body font-medium">No tasks assigned to you</p>
          <p className="text-on-surface-variant max-w-sm text-xs">
            Tasks assigned to you across every workspace land here.
          </p>
        </Stack>
      ) : (
        <Stack as="ul" gap={1} className="min-h-0 flex-1 overflow-auto">
          {sorted.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} orgLabel={orgName(task.organizationId)} />
            </li>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** Props for {@link TaskRow}. */
interface TaskRowProps {
  /** The task to render. */
  task: TaskOut;
  /** Display name of the task's workspace, for the org chip. */
  orgLabel: string;
}

/** One task row: status glyph · title · due · workspace chip, linking to the task. */
function TaskRow({ task, orgLabel }: TaskRowProps): JSX.Element {
  const overdue = task.dueDate != null && task.dueDate < todayISODate();
  return (
    <Link
      href={`/orgs/${task.organizationId}/tasks/${task.id}`}
      draggable
      onDragStart={(event) => {
        writeScheduleDragObject(event.dataTransfer, {
          kind: 'task',
          taskId: task.id,
          organizationId: task.organizationId,
          title: task.title,
        });
      }}
      className="hover:bg-surface-container-low focus-visible:ring-ring flex items-center gap-3 rounded-lg px-3 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <StatusIcon type={stateTypeOf(task.state)} />
      <span className="text-on-surface min-w-0 flex-1 truncate text-sm">{task.title}</span>
      {task.dueDate ? (
        <span
          className={
            overdue
              ? 'text-destructive shrink-0 text-xs tabular-nums'
              : 'text-on-surface-variant shrink-0 text-xs tabular-nums'
          }
        >
          {formatDue(task.dueDate)}
        </span>
      ) : null}
      <OrgChip orgId={task.organizationId} name={orgLabel} />
    </Link>
  );
}

/** Props for {@link SortToggle}. */
interface SortToggleProps {
  /** The active sort mode. */
  sort: TaskSort;
  /** Change the sort mode. */
  onSort: (sort: TaskSort) => void;
}

/** Due / Priority segmented sort control. */
function SortToggle({ sort, onSort }: SortToggleProps): JSX.Element {
  return (
    <Row gap={0} className="bg-surface-container rounded-md p-0.5">
      {(['due', 'priority'] as const).map((mode) => (
        <Button
          key={mode}
          variant={sort === mode ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={sort === mode}
          onClick={() => {
            onSort(mode);
          }}
          className="capitalize shadow-none"
        >
          {mode}
        </Button>
      ))}
    </Row>
  );
}
