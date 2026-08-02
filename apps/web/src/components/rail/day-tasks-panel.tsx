'use client';

/**
 * `rail` — the Tasks day-plan panel: today's tasks as a draggable list for the calendar rail.
 *
 * @remarks
 * One of the shell's supplemental rail panels (paired with the Agenda). On the calendar it is the
 * default panel — a Sunsama-style *day plan* of the tasks relevant to today (the cross-workspace
 * `hub.today` `plan` set), so the rail shows work you can act on instead of duplicating the
 * calendar's own timeline. Each row is a shared `entityDragSource` of `kind: 'task'`, so a task can
 * be dragged straight onto the calendar to timebox it (the drop side is a follow-up).
 *
 * Reads through the shared TanStack Query layer (`hub.today`, org-agnostic); rows mirror the proven
 * `/tasks` row (status glyph · title · due · workspace chip) and link into the task. Tonal cards, no
 * borders — the surface step carries the separation.
 */
import type { HubTaskItem } from '@docket/types';
import { cn } from '@docket/ui';
import { StatusIcon } from '@docket/ui/components';
import { dragSourceProps } from '@docket/ui/lib/draggable';
import { Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { EditableTitle } from '@/components/editor/editable-title';
import { OrgChip } from '@/components/org-chip';
import { api } from '@/lib/api';
import { entityDragSource } from '@/lib/entity-drag';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery, useApiQuery } from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useRenameTask } from '@/lib/use-rename-task';
import { stateTypeOf } from '@/lib/work-state';

/** Format a `YYYY-MM-DD` due date as `Jul 1`. */
function formatDue(dueDate: string): string {
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** One plan task: status glyph · title · due · workspace chip, draggable onto the calendar. */
function DayTaskRow({
  task,
  orgLabel,
  date,
}: {
  task: HubTaskItem;
  orgLabel: string;
  date: string;
}): JSX.Element {
  const router = useRouter();
  const href = `/orgs/${task.organizationId}/tasks/${task.id}`;
  const overdue = task.dueDate != null && task.dueDate < todayISODate();

  // The day plan is cross-workspace, so the viewer's edit capability is resolved per row's org.
  // React Query dedupes these by key, so rows sharing an org share one members/roles fetch.
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
  const rename = useRenameTask(task.organizationId, [queryKeys.today(date)]);

  // The canonical entity payload also mirrors the legacy scheduling object, so dropping a row on
  // the calendar still timeboxes it.
  const dragProps = dragSourceProps(
    entityDragSource({
      kind: 'task',
      id: task.id,
      organizationId: task.organizationId,
      title: task.title,
    }),
  );

  return (
    <Link
      href={href}
      {...dragProps}
      className={cn(
        'bg-surface-container-low hover:bg-surface-container focus-visible:ring-ring flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none',
        dragProps?.className,
      )}
    >
      <StatusIcon type={stateTypeOf(task.state)} />
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
          className="text-on-surface text-body-medium min-w-0 flex-1 truncate"
        />
      ) : (
        <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">
          {task.title}
        </span>
      )}
      {task.dueDate ? (
        <span
          className={`text-body-small shrink-0 tabular-nums ${overdue ? 'text-destructive' : 'text-on-surface-variant'}`}
        >
          {formatDue(task.dueDate)}
        </span>
      ) : null}
      <OrgChip orgId={task.organizationId} name={orgLabel} />
    </Link>
  );
}

/** The Tasks day-plan rail panel. */
export default function DayTasksPanel(): JSX.Element {
  const { orgName } = useActiveOrg();
  const date = todayISODate();
  const todayQ = useApiQuery(
    apiQueryOptions(
      queryKeys.today(date),
      () => api.v1.hub.today.$get({ query: { date } }),
      'Could not load your day.',
    ),
  );

  const plan = todayQ.data?.plan ?? [];
  const error = todayQ.isError ? userErrorMessage(todayQ.error, 'Could not load your day.') : null;

  return (
    <section aria-label="Tasks" className="flex h-full min-h-0 flex-col">
      {/*
        The panel names *itself*, not the date. Beside an open calendar the long form ("Sunday,
        August 2") restated the date the grid's own `Sun 2` lane header already carries and the
        toolbar's `August 2026` already scopes — the same day written three ways within one screen.
        The rail's job here is "the work you planned for today", so that is what it says.
      */}
      <header className="shrink-0 px-3 pt-3 pb-2">
        <h2 className="text-on-surface text-title-small">Today&rsquo;s plan</h2>
        {!todayQ.isPending && !error ? (
          <p className="text-on-surface-variant text-body-small">
            {plan.length === 0
              ? 'Nothing planned'
              : `${String(plan.length)} task${plan.length === 1 ? '' : 's'}`}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {/* placeholder: today's planned tasks — how many there are and each one's title, time and
            state. The rail's header, its date and its empty-state copy all render immediately. */}
        {todayQ.isPending ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <p role="alert" className="text-destructive text-body-medium">
            {error}
          </p>
        ) : plan.length === 0 ? (
          <div className="bg-surface-container-low text-on-surface-variant text-body-medium flex flex-col gap-1 rounded-lg p-4">
            <span className="text-on-surface font-medium">Nothing planned for today.</span>
            <span>Tasks due today land here — drag one onto the calendar to timebox it.</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {plan.map((task) => (
              <li key={task.id}>
                <DayTaskRow task={task} orgLabel={orgName(task.organizationId)} date={date} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
