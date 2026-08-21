'use client';

/** Planned work and task search for the Focus rail. */
import type { HubTodayPlanItem, SearchOut, SearchResult } from '@docket/types';
import { Plus, Search } from '@docket/ui/icons';
import { Skeleton, Text } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { useRemoteSearch } from '@/lib/use-remote-search';

import type { TimerStartInput } from './use-timer';

/** Props for {@link FocusTaskQueue}. */
export interface FocusTaskQueueProps {
  /** The task already being tracked, which must not appear as a switch target. */
  readonly activeTaskId: string | null;
  /** Whether a start or switch request is in flight. */
  readonly starting: boolean;
  /** Start existing work or create and start personal work in one request. */
  readonly onStart: (input: TimerStartInput) => Promise<void>;
}

/** Return the workspace label for one task without exposing a raw id. */
function workspaceLabel(
  organizationId: string | null,
  orgName: (organizationId: string) => string,
): string {
  return organizationId ? orgName(organizationId) : 'Personal';
}

/** Props shared by planned and searched task rows. */
interface TaskChoiceProps {
  readonly id: string;
  readonly title: string;
  readonly organizationId: string | null;
  readonly disabled: boolean;
  readonly orgName: (organizationId: string) => string;
  readonly onChoose: (taskId: string, title: string) => void;
}

/** One task that can replace the current timer target. */
function TaskChoice({
  id,
  title,
  organizationId,
  disabled,
  orgName,
  onChoose,
}: TaskChoiceProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className="bg-surface-container-low hover:bg-surface-container-high focus-visible:outline-primary flex min-h-12 w-full min-w-0 flex-col items-start justify-center rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
      onClick={() => {
        onChoose(id, title);
      }}
    >
      <span className="text-on-surface text-body-medium w-full break-words whitespace-normal">
        {title}
      </span>
      <span className="text-on-surface-variant text-body-small">
        {workspaceLabel(organizationId, orgName)}
      </span>
    </button>
  );
}

/** Keep only task search hits that can replace the current timer target. */
function availableTaskResults(
  results: readonly SearchResult[],
  activeTaskId: string | null,
): readonly SearchResult[] {
  return results
    .filter((result) => result.kind === 'task' && result.entityId !== activeTaskId)
    .slice(0, 8);
}

/** Show today's accepted work and let a person find or create another task without leaving Focus. */
export default function FocusTaskQueue({
  activeTaskId,
  starting,
  onStart,
}: FocusTaskQueueProps): JSX.Element {
  const { orgName } = useActiveOrg();
  const [query, setQuery] = useState('');
  const date = todayISODate();
  const todayQ = useApiQuery(
    apiQueryOptions(
      queryKeys.today(date),
      () => api.v1.hub.today.$get({ query: { date } }),
      'Could not load upcoming work.',
    ),
  );
  const searchQ = useRemoteSearch<SearchOut>({
    query,
    debounceMs: 180,
    minChars: 1,
    key: (term) => [...queryKeys.search('hub', term), 'focus-tasks'],
    fetch: (term) =>
      api.v1.hub.search.$get({
        query: { q: term, kinds: ['task'], limit: '8', surface: 'palette' },
      }),
    fallbackMessage: 'Could not search your tasks.',
  });

  const planned = (todayQ.data?.plan ?? [])
    .filter((item: HubTodayPlanItem) => item.id !== activeTaskId && item.planStatus === 'planned')
    .slice(0, 4);
  const results = availableTaskResults(searchQ.data?.items ?? [], activeTaskId);
  const trimmed = query.trim();

  const start = async (input: TimerStartInput): Promise<void> => {
    try {
      await onStart(input);
      setQuery('');
    } catch {
      // The parent owns the application copy. Keep the typed query so the person can retry it.
    }
  };

  return (
    <section aria-labelledby="focus-up-next" className="flex min-w-0 flex-col gap-2">
      <h3 id="focus-up-next" className="text-on-surface text-title-small">
        Up next
      </h3>
      <div className="border-outline-variant focus-within:border-primary flex min-h-11 items-center gap-2 rounded-lg border px-3">
        <Search aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
        <input
          type="search"
          value={query}
          aria-label="Find or create a task"
          placeholder="Find or create a task"
          disabled={starting}
          className="text-on-surface text-body-medium placeholder:text-on-surface-variant min-h-11 min-w-0 flex-1 bg-transparent outline-none"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || trimmed.length === 0) return;
            event.preventDefault();
            void start({ label: trimmed });
          }}
        />
      </div>

      {trimmed.length > 0 ? (
        <div className="flex flex-col gap-2">
          {searchQ.pending ? <Skeleton className="h-12 w-full rounded-lg" /> : null}
          {!searchQ.pending
            ? results.map((result) => (
                <TaskChoice
                  key={result.id}
                  id={result.entityId}
                  title={result.title}
                  organizationId={result.organizationId}
                  disabled={starting}
                  orgName={orgName}
                  onChoose={(taskId, title) => {
                    void start({ label: title, taskId });
                  }}
                />
              ))
            : null}
          <button
            type="button"
            disabled={starting}
            className="text-on-surface hover:bg-surface-container-low focus-visible:outline-primary flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            onClick={() => {
              void start({ label: trimmed });
            }}
          >
            <Plus aria-hidden="true" className="size-4 shrink-0" />
            <span className="text-body-medium min-w-0 break-words whitespace-normal">
              Create “{trimmed}” and track it
            </span>
          </button>
          {searchQ.error ? (
            <Text token="body-small" role="status" className="text-on-surface-variant">
              {searchQ.error}
            </Text>
          ) : null}
        </div>
      ) : todayQ.isPending ? (
        <div className="flex flex-col gap-2" aria-label="Loading upcoming work">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : todayQ.isError ? (
        <Text token="body-small" role="status" className="text-on-surface-variant">
          Could not load upcoming work.
        </Text>
      ) : planned.length > 0 ? (
        <div className="flex flex-col gap-2">
          {planned.map((item: HubTodayPlanItem) => (
            <TaskChoice
              key={item.id}
              id={item.id}
              title={item.title}
              organizationId={item.organizationId}
              disabled={starting}
              orgName={orgName}
              onChoose={(taskId, title) => {
                void start({ label: title, taskId });
              }}
            />
          ))}
        </div>
      ) : (
        <Text token="body-small" tone="muted">
          Nothing else is planned for today.
        </Text>
      )}
    </section>
  );
}
