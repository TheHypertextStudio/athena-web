'use client';

/**
 * The trail above a task's title: where it sits, one link per level.
 *
 * @remarks
 * A task lives in a project (or in none) and, when it is a subtask, under a parent task. The trail
 * names each of those and links to it, project first. It states place only; the task's own title
 * is the page heading below it.
 */
import { ChevronRight } from '@docket/ui/icons';
import type { JSX } from 'react';

import Link from '@/components/docket-link';
import { useApiQuery } from '@/lib/query';
import { taskDetailDef } from '@/lib/use-task-detail';

/** Props for {@link TaskBreadcrumb}. */
export interface TaskBreadcrumbProps {
  readonly orgId: string;
  /** The task's project, or `null` when it has none. */
  readonly projectId: string | null;
  /** The project's display name; the workspace's noun for a project until it resolves. */
  readonly projectName: string;
  /** The workspace's noun for a project, for the task that has none. */
  readonly projectLabel: string;
  /** The task's parent, when it is a subtask. */
  readonly parentTaskId: string | null;
}

/** The parent task's link, titled from the task read that a list has usually already warmed. */
function ParentLink({
  orgId,
  parentTaskId,
}: {
  readonly orgId: string;
  readonly parentTaskId: string;
}): JSX.Element {
  const parent = useApiQuery(taskDetailDef(orgId, parentTaskId));
  return (
    <Link
      href={`/orgs/${orgId}/tasks/${parentTaskId}`}
      className="hover:text-on-surface min-w-0 truncate"
    >
      {parent.data?.title ?? 'Parent task'}
    </Link>
  );
}

/**
 * Render the task's breadcrumb.
 *
 * @param props - See {@link TaskBreadcrumbProps}.
 * @returns the labelled trail.
 */
export function TaskBreadcrumb({
  orgId,
  projectId,
  projectName,
  projectLabel,
  parentTaskId,
}: TaskBreadcrumbProps): JSX.Element {
  return (
    <nav
      aria-label="Breadcrumb"
      className="no-print text-on-surface-variant text-body-medium flex min-w-0 items-center gap-1"
    >
      <Link
        href={projectId ? `/orgs/${orgId}/projects/${projectId}` : `/orgs/${orgId}/tasks`}
        className="hover:text-on-surface min-w-0 truncate"
      >
        {projectId ? projectName : `No ${projectLabel.toLowerCase()}`}
      </Link>
      {parentTaskId ? (
        <>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
          <ParentLink orgId={orgId} parentTaskId={parentTaskId} />
        </>
      ) : null}
    </nav>
  );
}
