'use client';

/** One filterable, chronological task Activity surface. */
import type { TaskActivityCategory, TaskActivityOut } from '@docket/connections/activity-contract';
import { ActorAvatar } from '@docket/ui/components';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { relativeTime } from '@/components/project-detail/format-time';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiInfiniteQueryOptions, queryKeys, useInfiniteApiQuery } from '@/lib/query';

import { activityActorName, activitySentence } from './format-activity';

const LOAD_FAILURE = 'Could not load this task activity.';
const LOAD_NEWER_FAILURE = 'Could not load newer activity.';
const POST_FAILURE = 'Could not post your comment.';
const ALL_CATEGORIES = 'all';
type ActivityFilter = TaskActivityCategory | typeof ALL_CATEGORIES;

const FILTER_LABEL: Record<ActivityFilter, string> = {
  all: 'All activity',
  task: 'Task changes',
  comment: 'Comments',
  time: 'Time tracking',
  resource: 'Resources',
  relationship: 'Relationships',
  subtask: 'Subtasks',
  automation: 'Automated updates',
};

/** Props for {@link TaskActivityFeed}. */
export interface TaskActivityFeedProps {
  readonly orgId: string;
  readonly taskId: string;
  /** Posts a comment through the task page's canonical mutation. */
  readonly onComment?: ((body: string) => Promise<void>) | undefined;
  /** Whether the current viewer may add a task comment. */
  readonly canComment?: boolean | undefined;
}

/** Build one application-owned sentence for a non-comment entry. */
function entrySentence(entry: TaskActivityOut): string {
  if (entry.type === 'comment') return '';
  if (entry.body) return entry.body;
  const change = activitySentence(entry);
  if (entry.type === 'child' && entry.subjectTaskTitle) {
    return `${entry.subjectTaskTitle}: ${change}`;
  }
  if (entry.type === 'dependency' && entry.subjectTaskTitle) {
    return `${entry.subjectTaskTitle}: ${change}`;
  }
  return change;
}

/** One chronological Activity row. */
function ActivityRow({ entry }: { readonly entry: TaskActivityOut }): JSX.Element {
  const name = activityActorName(entry);
  return (
    <li className="flex items-start gap-2.5">
      <ActorAvatar kind="human" name={name} size={24} className="mt-0.5 shrink-0" />
      <div className="text-body-medium text-on-surface-variant min-w-0 flex-1">
        <div>
          <span className="text-on-surface">{name}</span>{' '}
          {entry.type === 'comment' ? 'commented' : entrySentence(entry)}{' '}
          <time
            dateTime={entry.createdAt}
            title={entry.createdAt}
            className="text-label-medium text-on-surface-variant whitespace-nowrap"
          >
            {relativeTime(entry.createdAt)}
          </time>
        </div>
        {entry.type === 'comment' && entry.body ? (
          <StaticMarkdown value={entry.body} className="mt-1 max-w-none" />
        ) : null}
      </div>
    </li>
  );
}

/** The task's one chronological Activity history. */
export function TaskActivityFeed({
  orgId,
  taskId,
  onComment,
  canComment = false,
}: TaskActivityFeedProps): JSX.Element {
  const [filter, setFilter] = useState<ActivityFilter>(ALL_CATEGORIES);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const activityQuery = useMemo(
    () =>
      apiInfiniteQueryOptions(
        [...queryKeys.taskActivity(orgId, taskId), filter],
        (cursor, signal) =>
          api.v1.orgs[':orgId'].tasks[':id'].activity.$get(
            {
              param: { orgId, id: taskId },
              query: {
                ...(filter === ALL_CATEGORIES ? {} : { category: filter }),
                ...(cursor ? { cursor } : {}),
              },
            },
            { init: { signal } },
          ),
        (page) => page.nextCursor,
        LOAD_FAILURE,
      ),
    [filter, orgId, taskId],
  );
  const query = useInfiniteApiQuery(activityQuery);
  const entries = query.data?.pages.flatMap((page) => page.items) ?? [];

  async function post(): Promise<void> {
    const text = body.trim();
    if (!onComment || !canComment || posting || text.length === 0) return;
    setPosting(true);
    setPostError(null);
    try {
      await onComment(text);
      setBody('');
    } catch {
      setPostError(POST_FAILURE);
    } finally {
      setPosting(false);
    }
  }

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="activity-heading" className="text-title-small text-on-surface">
          Activity
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" aria-label="Filter activity">
              {FILTER_LABEL[filter]}
              <ChevronDown className="size-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width="sm">
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(value) => {
                setFilter(value as ActivityFilter);
              }}
            >
              {(Object.keys(FILTER_LABEL) as ActivityFilter[]).map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {FILTER_LABEL[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {query.isPending ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-5 w-3/5 rounded" />
          <Skeleton className="h-5 w-2/5 rounded" />
        </div>
      ) : query.isError && entries.length === 0 ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(query.error, LOAD_FAILURE)}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-on-surface-variant text-body-medium">
          Nothing has happened to this task yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {entries.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ol>
      )}

      {query.hasNextPage ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Load newer activity"
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load newer'}
          </Button>
          {query.isFetchNextPageError ? (
            <p role="alert" className="text-error text-body-medium mt-2">
              {userErrorMessage(query.error, LOAD_NEWER_FAILURE)}
            </p>
          ) : null}
        </div>
      ) : null}

      {canComment && onComment ? (
        <form
          className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-xl border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void post();
          }}
        >
          <FreeformTextEditor
            value={body}
            onChange={setBody}
            placeholder="Leave a comment…"
            ariaLabel="Add a comment"
            onSubmit={() => {
              void post();
            }}
            className="bg-surface-container rounded-md p-3"
          />
          <div className="flex items-center justify-end">
            <Button type="submit" size="sm" disabled={posting || body.trim().length === 0}>
              {posting ? 'Posting…' : 'Comment'}
            </Button>
          </div>
          {postError ? (
            <p role="alert" className="text-error text-body-medium">
              {postError}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
