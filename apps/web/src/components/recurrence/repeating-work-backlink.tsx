'use client';

/** Backlink from ordinary generated work to the series that created it. */
import type { GeneratedWorkRecurrenceOut } from '@docket/types';
import { RefreshCw } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/** Props shared by generated task and project backlinks. */
interface RepeatingWorkBacklinkProps {
  readonly orgId: string;
  readonly entityId: string;
}

/** The visible series provenance banner once a generated-work lookup resolves. */
function Backlink({
  orgId,
  context,
}: {
  readonly orgId: string;
  readonly context: GeneratedWorkRecurrenceOut | null | undefined;
}): JSX.Element | null {
  if (!context) return null;
  const date = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${context.scheduledFor}T12:00:00.000Z`));
  return (
    <aside className="bg-secondary-container text-on-secondary-container flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <RefreshCw className="size-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-body-medium truncate font-medium">Part of {context.seriesName}</p>
          <p className="text-body-small opacity-80">
            This work was created for the {date} occurrence.
          </p>
        </div>
      </div>
      <Button asChild variant="ghost" size="sm">
        <Link href={`/orgs/${orgId}/recurrence-series/${context.seriesId}`}>
          Manage repeating work
        </Link>
      </Button>
    </aside>
  );
}

/** Backlink shown on a generated ordinary task. */
export function TaskRepeatingWorkBacklink({
  orgId,
  entityId,
}: RepeatingWorkBacklinkProps): JSX.Element | null {
  const query = useApiQuery(
    apiQueryOptions(
      [...queryKeys.task(orgId, entityId), 'recurrence'] as const,
      () =>
        api.v1.orgs[':orgId']['recurrence-series']['for-task'][':taskId'].$get({
          param: { orgId, taskId: entityId },
        }),
      'Could not load repeating-work details.',
    ),
  );
  return <Backlink orgId={orgId} context={query.data} />;
}

/** Backlink shown on a generated ordinary project. */
export function ProjectRepeatingWorkBacklink({
  orgId,
  entityId,
}: RepeatingWorkBacklinkProps): JSX.Element | null {
  const query = useApiQuery(
    apiQueryOptions(
      [...queryKeys.project(orgId, entityId), 'recurrence'] as const,
      () =>
        api.v1.orgs[':orgId']['recurrence-series']['for-project'][':projectId'].$get({
          param: { orgId, projectId: entityId },
        }),
      'Could not load repeating-work details.',
    ),
  );
  return <Backlink orgId={orgId} context={query.data} />;
}
