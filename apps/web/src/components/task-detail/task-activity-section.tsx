'use client';

/**
 * The task detail view's Activity section — the task's complete metadata history.
 *
 * @remarks
 * Modeled on a GitHub issue's event log and Sunsama's task history: the creation event first, then
 * one line per field that has changed since, oldest at the top so the task reads as a story rather
 * than a stack. Nothing is coalesced — "changed Status" and "changed Assignee" applied in the same
 * edit stay two separate lines, because the question this section answers is *what exactly*
 * changed, not roughly what happened.
 *
 * The section is self-contained: it owns its own read, its own loading skeleton, and its own empty
 * and error states, so the page that renders it only has to say where it goes. Timestamps are
 * relative ("2h ago") because that is what a reader scans for, with the exact ISO time on the
 * element's `title` for when precision matters.
 */
import type { TaskActivityOut } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { relativeTime } from '@/components/project-detail/format-time';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';

import { activityActorName, activitySentence } from './format-activity';

/** Application-owned copy for a failed read, used as both the query fallback and the alert. */
const LOAD_FAILURE = "Could not load this task's history.";

/** Props for {@link TaskActivitySection}. */
export interface TaskActivitySectionProps {
  /** The owning organization id. */
  readonly orgId: string;
  /** The task whose history to render. */
  readonly taskId: string;
}

/** One entry: who, what changed, and when. */
function ActivityEntryRow({ entry }: { readonly entry: TaskActivityOut }): JSX.Element {
  const name = activityActorName(entry);
  return (
    <li className="flex items-start gap-2.5">
      <ActorAvatar kind="human" name={name} size={24} className="mt-0.5 shrink-0" />
      <p className="text-body-medium text-on-surface-variant min-w-0 flex-1">
        <span className="text-on-surface font-medium">{name}</span> {activitySentence(entry)}{' '}
        <time
          dateTime={entry.createdAt}
          title={entry.createdAt}
          className="text-label-medium text-on-surface-variant whitespace-nowrap"
        >
          {relativeTime(entry.createdAt)}
        </time>
      </p>
    </li>
  );
}

/**
 * The Activity section of a task's detail view.
 *
 * @remarks
 * The read is keyed by {@link queryKeys.taskActivity}, which nests under the task's own detail key,
 * so any invalidation of the coarser task key — which every task mutation already issues — reaches
 * the history by prefix match and an edit made on this page shows up in it without a bespoke
 * invalidation.
 *
 * @param props - The org and task to render history for.
 * @returns the Activity section.
 *
 * @example
 * ```tsx
 * <TaskActivitySection orgId={orgId} taskId={taskId} />
 * ```
 */
export function TaskActivitySection({ orgId, taskId }: TaskActivitySectionProps): JSX.Element {
  const query = useApiListQuery(
    apiQueryOptions(
      queryKeys.taskActivity(orgId, taskId),
      () => api.v1.orgs[':orgId'].tasks[':id'].activity.$get({ param: { orgId, id: taskId } }),
      LOAD_FAILURE,
    ),
  );
  const entries = query.data?.items ?? [];

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <h2 id="activity-heading" className="text-title-small text-on-surface">
        Activity
      </h2>

      {query.isPending ? (
        // placeholder: this task's history — how many changes it has, who made each, and when.
        <div className="flex flex-col gap-3" aria-hidden="true">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-3/5 rounded" />
          </div>
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-2/5 rounded" />
          </div>
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(query.error, LOAD_FAILURE)}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-on-surface-variant text-body-medium">
          Nothing has happened to this task yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <ActivityEntryRow key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}
