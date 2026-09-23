'use client';

/**
 * `today/hub-task-row` — one cross-workspace task as a row, on the shared row primitive.
 *
 * @remarks
 * The Hub's cross-workspace surfaces all render the same item shape and had each hand-rolled it.
 * `day-tasks-panel.tsx` and `all-tasks-client.tsx` grew their own `formatDue` and their own row
 * markup, and Today's own list rendered three of the eight fields `HubTaskItem` carries — dropping
 * `state`, `priority`, and `dueDate`, so the page showed strictly less than the rail beside it while
 * reading the identical payload.
 *
 * This row is now composed from {@link EntityListRow} rather than a bespoke flex container, so the
 * density, hover tone, inset focus ring, and truncation behaviour are the product's one row
 * vocabulary instead of this file's opinion. The `meta` band hides itself below the row's own
 * container breakpoint, which is how a narrow Today column degrades to title-only without a media
 * query.
 *
 * It renders both shapes the day needs: a plain {@link HubTaskItem}, and the {@link HubTodayPlanItem}
 * the accepted plan carries — the plan extras (estimate, timebox, blocked, dependency impact) are
 * read off the item when present, so "Needs you" and "The day" are one component, not two.
 *
 * The title edits in place for contributors. Details open from a separate action, so the editing
 * control never sits inside a row link.
 */
import type { HubTaskItem, HubTodayPlanItem } from '../../lib/contracts/hub';
import { EntityListRow, RowMeta, StatusIcon } from '@docket/ui/components';
import { CircleStop, OpenInNew } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { useEffect, useState, type JSX } from 'react';

import { formatDay } from '@/components/date-picker';
import { EditableTitle } from '@/components/editor/editable-title';
import { OrgChip } from '@/components/org-chip';
import { ObjectSurface } from '@/components/objects/object-surface';
import { useRenameDailyTask } from '@/components/daily-planning/daily-planning-queries';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { useOrgCapability } from '@/lib/use-org-capability';

import { planTiming, PlanTimingLabel } from './plan-timing';

/** Props for {@link HubTaskRow}. */
export interface HubTaskRowProps {
  /** The task to render. Accepts the accepted-plan shape so the day's rows carry their extras. */
  readonly task: HubTaskItem | HubTodayPlanItem;
  /** Display name for the task's workspace, for the chip. */
  readonly orgLabel: string;
  /** Optional lead shown before the title — a time, or why the row is here. */
  readonly lead?: string;
  /** The timezone the timebox time should be read in. */
  readonly displayTimezone?: string;
  /**
   * Extra classes for the row element.
   *
   * @remarks
   * Exists so a list can make the row flex beside sibling controls. The title editor and details
   * link sit inside the row. Task actions live beside it in `day-plan.tsx`.
   */
  readonly className?: string;
}

/** Whether an item carries the accepted-plan enrichment. */
function isPlanItem(task: HubTaskItem | HubTodayPlanItem): task is HubTodayPlanItem {
  return 'planItemId' in task;
}

function useCanRename(organizationId: string): boolean {
  const members = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(organizationId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId: organizationId }, query: {} }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
  );
  const roles = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(organizationId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId: organizationId }, query: {} }),
      'Could not load roles.',
      { staleTime: STALE.static },
    ),
  );
  return useOrgCapability(members.data?.items ?? [], roles.data?.items ?? [], 'contribute');
}

function TaskRowMeta({
  task,
  orgLabel,
  displayTimezone,
}: {
  readonly task: HubTaskRowProps['task'];
  readonly orgLabel: string;
  readonly displayTimezone: string | undefined;
}): JSX.Element {
  const plan = isPlanItem(task) ? task : null;
  const time = plan ? planTiming(plan, displayTimezone) : null;
  const overdue = task.dueDate != null && task.dueDate < todayISODate();
  const due =
    task.dueDate == null ? null : formatDay(task.dueDate, { month: 'short', day: 'numeric' });
  return (
    <>
      {plan?.blocked ? (
        <RowMeta tone="error">
          <CircleStop aria-hidden="true" className="size-3.5" /> Blocked
        </RowMeta>
      ) : null}
      {plan && plan.dependencyImpact > 0 ? (
        <RowMeta tabular>Unblocks {String(plan.dependencyImpact)}</RowMeta>
      ) : null}
      {time ? (
        <RowMeta tabular className="min-w-20">
          <PlanTimingLabel timing={time} />
        </RowMeta>
      ) : null}
      {due ? (
        <RowMeta tabular tone={overdue ? 'error' : 'default'} className="min-w-12">
          {due}
        </RowMeta>
      ) : null}
      <RowMeta>
        <OrgChip orgId={task.organizationId} name={orgLabel} />
      </RowMeta>
    </>
  );
}

/** One cross-workspace task row, draggable onto the calendar and linking into the task. */
export default function HubTaskRow({
  task,
  orgLabel,
  lead,
  displayTimezone,
  className,
}: HubTaskRowProps): JSX.Element {
  const href = `/orgs/${task.organizationId}/tasks/${task.id}`;
  const object = {
    kind: 'task' as const,
    id: task.id,
    organizationId: task.organizationId,
    title: task.title,
  };
  const canRename = useCanRename(task.organizationId);
  const rename = useRenameDailyTask(todayISODate());
  const [visibleTitle, setVisibleTitle] = useState(task.title);
  const [failedTitle, setFailedTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!failedTitle) setVisibleTitle(task.title);
  }, [task.title, failedTitle]);
  const saveTitle = async (title: string): Promise<void> => {
    setVisibleTitle(title);
    try {
      await rename.mutateAsync({ organizationId: task.organizationId, taskId: task.id, title });
      setFailedTitle(null);
    } catch {
      setFailedTitle(title);
    }
  };

  return (
    <ObjectSurface object={object} surfaceId="today">
      <EntityListRow
        {...(className === undefined ? {} : { className })}
        interactive={false}
        leading={<StatusIcon type={task.stateType} />}
        {...(task.summary === null ? {} : { subtitle: task.summary })}
        title={
          <>
            {lead ? (
              <span className="text-on-surface-variant text-label-small w-14 shrink-0 tabular-nums">
                {lead}
              </span>
            ) : null}
            <EditableTitle
              value={visibleTitle}
              onSave={(title) => {
                void saveTitle(title);
              }}
              canEdit={canRename}
              ariaLabel={`Task title: ${visibleTitle}`}
              className="text-on-surface text-label-large min-w-0 truncate"
            />
          </>
        }
        trailing={
          <>
            {failedTitle ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void saveTitle(failedTitle);
                }}
              >
                Retry
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm" iconOnly>
              <Link href={href} aria-label={`Open ${visibleTitle} details`}>
                <OpenInNew aria-hidden="true" />
              </Link>
            </Button>
          </>
        }
        meta={<TaskRowMeta task={task} orgLabel={orgLabel} displayTimezone={displayTimezone} />}
      />
    </ObjectSurface>
  );
}
