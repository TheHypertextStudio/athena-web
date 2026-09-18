'use client';

/** One filterable, chronological task Activity surface. */
import type { TaskActivityCategory, TaskActivityOut } from '@docket/connections/activity-contract';
import { ActorAvatar, InlineBanner } from '@docket/ui/components';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Skeleton,
  Surface,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import { AthenaJobCard } from '@/components/athena/athena-job-card';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { QueryLoadFailure } from '@/components/feedback';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { relativeTime } from '@/components/project-detail/format-time';
import { api } from '@/lib/api';
import { jobsFromQueue } from '@/lib/athena/job-presentation';
import type { PersonalAthenaSessionSummary } from '@/lib/athena/presentation';
import { personalAthenaQueueDef, type PersonalAthenaQueuePayload } from '@/lib/athena/query-defs';
import {
  apiInfiniteQueryOptions,
  queryKeys,
  useInfiniteApiQuery,
  useLiveApiQuery,
} from '@/lib/query';

import { activityActorName, activitySentence } from './format-activity';
import { TaskSection } from './task-section';

const ALL_CATEGORIES = 'all';
type ActivityFilter = TaskActivityCategory | typeof ALL_CATEGORIES;

/** How often the task page re-reads the personal queue for delegated work on this task. */
const TASK_ATHENA_QUEUE_INTERVAL_MS = 10_000;

/** This task's delegated Athena work, newest first. */
function jobsForTask(
  payload: PersonalAthenaQueuePayload,
  taskId: string,
): readonly PersonalAthenaSessionSummary[] {
  const matching = jobsFromQueue(payload).filter(
    (job) => job.context?.source?.type === 'task' && job.context.source.id === taskId,
  );
  return [...matching].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The task's delegated Athena work, newest first; renders nothing when there is none. */
function TaskAthenaWork({ taskId }: { readonly taskId: string }): JSX.Element | null {
  const queue = useLiveApiQuery(personalAthenaQueueDef(), TASK_ATHENA_QUEUE_INTERVAL_MS);
  const jobs = queue.data ? jobsForTask(queue.data, taskId) : [];
  if (jobs.length === 0) return null;

  return (
    <section aria-label="Athena" className="flex flex-col gap-3">
      <h2 className="text-label-small text-on-surface-variant">Athena</h2>
      <div className="flex flex-col gap-3">
        {jobs.map((job) => (
          <AthenaJobCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}

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

/** Props for {@link ActivityFilterMenu}. */
interface ActivityFilterMenuProps {
  readonly filter: ActivityFilter;
  readonly onFilterChange: (filter: ActivityFilter) => void;
}

/** The dropdown that narrows the Activity list to one category. */
function ActivityFilterMenu({ filter, onFilterChange }: ActivityFilterMenuProps): JSX.Element {
  return (
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
            onFilterChange(value as ActivityFilter);
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
  );
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
          <StaticMarkdown value={entry.body} className="mt-1 [&>*]:max-w-none" />
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
        'Could not load this task activity.',
      ),
    [filter, orgId, taskId],
  );
  const query = useInfiniteApiQuery(activityQuery);
  const entries = query.data?.pages.flatMap((page) => page.items) ?? [];

  async function post(): Promise<void> {
    const text = body.trim();
    if (!onComment || !canComment || posting || text.length === 0) return;
    setPosting(true);
    try {
      await onComment(text);
      setBody('');
    } catch {
      // The failed write reaches the person as a notice, raised by the mutation layer, and the
      // draft stays in the composer so posting again is one press.
    } finally {
      setPosting(false);
    }
  }

  // placeholder: this task's comments and activity, at the chosen filter.
  return (
    <div className="flex flex-col gap-6">
      <TaskAthenaWork taskId={taskId} />
      <TaskSection
        id="activity"
        title="Activity"
        gap={4}
        headerEnd={<ActivityFilterMenu filter={filter} onFilterChange={setFilter} />}
      >
        {query.isPending ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-5 w-3/5 rounded" />
            <Skeleton className="h-5 w-2/5 rounded" />
          </div>
        ) : query.isError && entries.length === 0 ? (
          <QueryLoadFailure size="panel" title="Activity" query={query} />
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
              <div className="mt-2">
                <InlineBanner
                  tone="critical"
                  density="compact"
                  title="Newer activity could not load"
                >
                  The activity above is still current.
                </InlineBanner>
              </div>
            ) : null}
          </div>
        ) : null}

        {canComment && onComment ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void post();
            }}
          >
            <Surface tone="floating" pad="comfortable" className="flex flex-col gap-2">
              <FreeformTextEditor
                value={body}
                onChange={setBody}
                placeholder="Leave a comment…"
                ariaLabel="Add a comment"
                onSubmit={() => {
                  void post();
                }}
                className="rounded-md p-3"
              />
              <div className="flex items-center justify-end">
                <Button type="submit" size="sm" disabled={posting || body.trim().length === 0}>
                  {posting ? 'Posting…' : 'Comment'}
                </Button>
              </div>
            </Surface>
          </form>
        ) : null}
      </TaskSection>
    </div>
  );
}
