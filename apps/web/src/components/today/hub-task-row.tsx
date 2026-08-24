'use client';

/**
 * `today/hub-task-row` — one `HubTaskItem` as a row: status glyph · title · due · workspace chip.
 *
 * @remarks
 * The Hub's cross-workspace surfaces all render the same item shape and had each hand-rolled it.
 * `day-tasks-panel.tsx` and `all-tasks-client.tsx` grew their own `formatDue` and their own row
 * markup, and Today's own list rendered three of the eight fields `HubTaskItem` carries — dropping
 * `state`, `priority`, and `dueDate`, so the page showed strictly less than the rail beside it while
 * reading the identical payload.
 *
 * Deliberately read-only. The rail's row wires inline rename, which costs it a members + roles
 * fetch per workspace to resolve edit capability; Today is a place to see where things stand and
 * click through, so it pays neither.
 */
import type { HubTaskItem } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
import Link from 'next/link';
import type { JSX } from 'react';

import { formatDay } from '@/components/date-picker';
import { OrgChip } from '@/components/org-chip';
import { ObjectSurface } from '@/components/objects/object-surface';
import { todayISODate } from '@/lib/today';

/** Props for {@link HubTaskRow}. */
export interface HubTaskRowProps {
  /** The task to render. */
  readonly task: HubTaskItem;
  /** Display name for the task's workspace, for the chip. */
  readonly orgLabel: string;
  /** Optional lead shown before the title — a time, or why the row is here. */
  readonly lead?: string;
}

/** One cross-workspace task row, draggable onto the calendar and linking into the task. */
export default function HubTaskRow({ task, orgLabel, lead }: HubTaskRowProps): JSX.Element {
  const overdue = task.dueDate != null && task.dueDate < todayISODate();
  const due =
    task.dueDate == null ? null : formatDay(task.dueDate, { month: 'short', day: 'numeric' });
  const object = {
    kind: 'task' as const,
    id: task.id,
    organizationId: task.organizationId,
    title: task.title,
  };

  return (
    <ObjectSurface object={object} surfaceId="today">
      <Link
        href={`/orgs/${task.organizationId}/tasks/${task.id}`}
        className="hover:bg-surface-container-low focus-visible:ring-ring -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <StatusIcon type={task.stateType} />
        {lead ? (
          <span className="text-on-surface-variant text-body-small w-14 shrink-0 tabular-nums">
            {lead}
          </span>
        ) : null}
        <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">
          {task.title}
        </span>
        {due ? (
          <span
            className={`text-body-small shrink-0 tabular-nums ${overdue ? 'text-error' : 'text-on-surface-variant'}`}
          >
            {due}
          </span>
        ) : null}
        <OrgChip orgId={task.organizationId} name={orgLabel} />
      </Link>
    </ObjectSurface>
  );
}
