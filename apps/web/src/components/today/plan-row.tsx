'use client';

import type { HubTaskItem } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
import Link from 'next/link';
import type { JSX } from 'react';

import { OrgChip } from '@/components/org-chip';
import { stateTypeOf } from '@/lib/work-state';

import { PriorityDot } from './priority-dot';

/** Build the canonical deep-link for a Hub task (project view when scoped, else my-work). */
function taskHref(task: HubTaskItem): string {
  return task.projectId
    ? `/orgs/${task.organizationId}/projects/${task.projectId}`
    : `/orgs/${task.organizationId}/my-work`;
}

/** Props for {@link PlanRow}. */
export interface PlanRowProps {
  /** The org-chipped task to render. */
  task: HubTaskItem;
  /** The originating org's display name (for the trailing chip). */
  orgName: string;
}

/**
 * A single task row in the Today plan pane.
 *
 * @remarks
 * A keyboard-focusable link to the task's home (its project, or the org's My Work when it
 * has no project). The leading {@link StatusIcon} reads the canonical workflow state, a
 * {@link PriorityDot} signals urgency, and a trailing {@link OrgChip} attributes the row to
 * its originating tenant so the cross-org plan is never ambiguous. The whole row lifts on
 * hover and shows a focus ring for keyboard navigation.
 */
export function PlanRow({ task, orgName }: PlanRowProps): JSX.Element {
  return (
    <Link
      href={taskHref(task)}
      className="group border-outline-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring focus-visible:ring-offset-background flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <StatusIcon type={stateTypeOf(task.state)} />
      <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
        {task.title}
      </span>
      <PriorityDot priority={task.priority} />
      <OrgChip orgId={task.organizationId} name={orgName} />
    </Link>
  );
}
