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
 *
 * Because the read is a fan-out, it has three outcomes rather than two, and the surface renders all
 * three. Every workspace answered and none had a task for you → the empty state. None answered → a
 * failure state, never the empty state: "No tasks assigned to you" is a claim about the world, and
 * with the API unreachable it is a claim we have no standing to make. Some answered → the rows we
 * do have, above a notice saying the list may be incomplete, because a silently-short list reads as
 * a complete one.
 */
import type { TaskOut } from '@docket/types';
import type { Priority } from '@docket/work/task-contract';
import { StatusGlyph } from '@docket/ui/components';
import { Button, Row, Skeleton, Stack } from '@docket/ui/primitives';
import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { formatDay } from '@/components/date-picker';
import { EditableTitle } from '@/components/editor/editable-title';
import { ObjectSurface } from '@/components/objects/object-surface';
import { OrgChip } from '@/components/org-chip';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { myWorkDefs } from '@/lib/my-work-defs';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useRenameTask } from '@/lib/use-rename-task';
import { useCategoryOf } from '@/components/entity-display/use-work-status';

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

/**
 * Format a due date as `Jul 1`, or `null` when the row carries nothing readable.
 *
 * @remarks
 * This used to concatenate `T00:00:00` onto the stored value before parsing, which produced
 * `2026-08-02T00:00:00.000ZT00:00:00` whenever the API returned a full instant — and React
 * rendered the resulting literal `"Invalid Date"` in the due column. {@link formatDay} accepts
 * either shape and returns `null` rather than a broken string.
 */
function formatDue(dueDate: string): string | null {
  return formatDay(dueDate, { month: 'short', day: 'numeric' });
}

/** The cross-workspace task list. */
export default function AllTasksClient(): JSX.Element {
  const { orgs, orgName } = useActiveOrg();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const [sort, setSort] = useState<TaskSort>('due');

  // One query per workspace for tasks + members (members resolves this user's per-org actor id).
  const taskResults = useQueries({ queries: orgs.map((org) => myWorkDefs(org.id, api).tasks) });
  const memberResults = useQueries({
    queries: orgs.map((org) => myWorkDefs(org.id, api).members),
  });

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

  // "No tasks assigned to you" is a claim about the world, and it is only true if we actually
  // asked. With the API unreachable every query above errors, `loading` goes false and `mine` is
  // empty — which used to render the empty state, telling someone they have nothing to do at the
  // exact moment we could not find out. A read that failed is a failure, not an emptiness.
  const reads = [...taskResults, ...memberResults];
  const failure = reads.find((r) => r.isError)?.error ?? null;
  const loadError = failure ? userErrorMessage(failure, 'Could not load your tasks.') : null;
  const partial = loadError !== null && sorted.length > 0;
  const refetchAll = (): void => {
    for (const r of reads) void r.refetch();
  };

  return (
    <Stack gap={4} className="h-full w-full px-3 py-4 @2xl:gap-5 @2xl:p-6 @4xl:p-8">
      <Row as="header" justify="between">
        <h1 className="text-on-surface text-title-large">Tasks</h1>
        {sorted.length > 0 ? <SortToggle sort={sort} onSort={setSort} /> : null}
      </Row>

      {/* placeholder: the caller's task rows — how many they have and each one's title, state,
          due date and workspace. Guarded on `mine.length === 0`, so a warm cache renders its rows
          rather than animating over tasks that are already known. */}
      {/* Shown above whatever else renders when some workspaces answered and some did not: the
          rows below are then real but incomplete, and silently presenting a short list as the whole
          list is the same lie in a quieter voice. */}
      {partial ? (
        <div
          role="alert"
          className="border-error/40 bg-error/5 text-error text-body-medium flex items-center justify-between gap-4 rounded-lg border p-4"
        >
          <span>Some workspaces did not answer, so this list may be incomplete.</span>
          <Button variant="outline" size="sm" onClick={refetchAll}>
            Try again
          </Button>
        </div>
      ) : null}

      {loading && mine.length === 0 ? (
        <Stack gap={1} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
          ))}
        </Stack>
      ) : loadError && sorted.length === 0 ? (
        <Stack align="center" gap={2} role="alert" className="justify-center p-12 text-center">
          <p className="text-error text-body-medium font-medium">{loadError}</p>
          <Button variant="outline" size="sm" onClick={refetchAll}>
            Try again
          </Button>
        </Stack>
      ) : sorted.length === 0 ? (
        <Stack align="center" gap={2} className="justify-center p-12 text-center">
          <p className="text-on-surface text-body-medium font-medium">No tasks assigned to you</p>
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
  const router = useRouter();
  const categoryOf = useCategoryOf('task');
  const href = `/orgs/${task.organizationId}/tasks/${task.id}`;
  const overdue = task.dueDate != null && task.dueDate < todayISODate();

  // The unified list spans every workspace, so the viewer's edit capability is resolved per row's
  // org (React Query dedupes these by key, sharing the members fetch with the parent's own query).
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(task.organizationId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId: task.organizationId } }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(task.organizationId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId: task.organizationId } }),
      'Could not load roles.',
      { staleTime: STALE.static },
    ),
  );
  const canEdit = useOrgCapability(
    membersQ.data?.items ?? [],
    rolesQ.data?.items ?? [],
    'contribute',
  );
  const rename = useRenameTask(task.organizationId, [queryKeys.tasks(task.organizationId)]);

  return (
    <ObjectSurface
      object={{
        kind: 'task',
        id: task.id,
        organizationId: task.organizationId,
        title: task.title,
      }}
      surfaceId="all-tasks-list"
      href={href}
    >
      <Link
        href={href}
        className="hover:bg-surface-container-low focus-visible:ring-ring flex min-h-[72px] items-center gap-3 rounded-lg px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <StatusGlyph type={categoryOf(task.state)} />
        {canEdit ? (
          <EditableTitle
            value={task.title}
            onSave={(title) => {
              rename(task.id, title);
            }}
            canEdit
            activate="doubleClick"
            onActivate={() => {
              router.push(href);
            }}
            ariaLabel="Task title"
            className="text-on-surface min-w-0 flex-1 truncate text-sm font-medium"
          />
        ) : (
          <span className="text-on-surface min-w-0 flex-1 truncate text-sm font-medium">
            {task.title}
          </span>
        )}
        {task.dueDate ? (
          <span
            className={
              overdue
                ? 'text-error shrink-0 text-xs tabular-nums'
                : 'text-on-surface-variant shrink-0 text-xs tabular-nums'
            }
          >
            {formatDue(task.dueDate)}
          </span>
        ) : null}
        <OrgChip orgId={task.organizationId} name={orgLabel} />
      </Link>
    </ObjectSurface>
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
