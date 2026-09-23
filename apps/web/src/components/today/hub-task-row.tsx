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
 * Deliberately read-only. The rail's row wires inline rename, which costs it a members + roles
 * fetch per workspace to resolve edit capability; Today is a place to see where things stand and
 * click through, so it pays neither.
 */
import type { HubTaskItem, HubTodayPlanItem } from '../../lib/contracts/hub';
import { EntityListRow, RowMeta, StatusIcon } from '@docket/ui/components';
import { CircleStop } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { formatDay } from '@/components/date-picker';
import { OrgChip } from '@/components/org-chip';
import { ObjectSurface } from '@/components/objects/object-surface';
import { todayISODate } from '@/lib/today';

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
   * Exists so a list can make the row flex beside sibling controls. Row actions are deliberately
   * NOT a slot on this component: the row renders an `<a>`, and a `<button>` inside an anchor is
   * invalid HTML no matter how carefully its click is stopped. A caller that wants row actions
   * puts them next to the row, not inside it — see `day-plan.tsx`.
   */
  readonly className?: string;
}

/** Whether an item carries the accepted-plan enrichment. */
function isPlanItem(task: HubTaskItem | HubTodayPlanItem): task is HubTodayPlanItem {
  return 'planItemId' in task;
}

/** One cross-workspace task row, draggable onto the calendar and linking into the task. */
export default function HubTaskRow({
  task,
  orgLabel,
  lead,
  displayTimezone,
  className,
}: HubTaskRowProps): JSX.Element {
  const overdue = task.dueDate != null && task.dueDate < todayISODate();
  const due =
    task.dueDate == null ? null : formatDay(task.dueDate, { month: 'short', day: 'numeric' });
  const plan = isPlanItem(task) ? task : null;
  const time = plan ? planTiming(plan, displayTimezone) : null;
  const href = `/orgs/${task.organizationId}/tasks/${task.id}`;
  const object = {
    kind: 'task' as const,
    id: task.id,
    organizationId: task.organizationId,
    title: task.title,
  };

  return (
    <ObjectSurface object={object} surfaceId="today">
      <EntityListRow
        {...(className === undefined ? {} : { className })}
        href={href}
        render={(props) => (
          <Link {...props} href={href}>
            {props.children}
          </Link>
        )}
        leading={<StatusIcon type={task.stateType} />}
        {...(task.summary === null ? {} : { subtitle: task.summary })}
        title={
          <>
            {lead ? (
              <span className="text-on-surface-variant text-label-small w-14 shrink-0 tabular-nums">
                {lead}
              </span>
            ) : null}
            <span className="truncate">{task.title}</span>
          </>
        }
        meta={
          <>
            {plan?.blocked ? (
              <RowMeta tone="error">
                <CircleStop aria-hidden="true" className="size-3.5" /> Blocked
              </RowMeta>
            ) : null}
            {/* Only worth a slot when unblocking this actually frees something else up. */}
            {plan && plan.dependencyImpact > 0 ? (
              <RowMeta tabular>Unblocks {String(plan.dependencyImpact)}</RowMeta>
            ) : null}
            {/* Floors, not fixed widths. The meta band is a right-packed flex, so a start of
                `10:30 AM` and an estimate of `0:30` put their glyphs on different axes and the
                column jitters down the list. Reserving the box stops that. `min-w-*` rather than
                `w-*` because `RowMeta` does not truncate: a hard width makes an unusually long
                value overflow into the column beside it, where a floor lets that one row grow and
                leaves every realistic value aligned. */}
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
        }
      />
    </ObjectSurface>
  );
}
