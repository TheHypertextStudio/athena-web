'use client';

/** One filterable, chronological task Activity surface. */
import type { DeliverableOut } from '@docket/work/attachment-contract';
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
  Timeline,
  TimelineItem,
} from '@docket/ui/primitives';
import { ActivityAgentAvatar } from './activity-agent-avatar';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { QueryLoadFailure } from '@/components/feedback';
import { DeliverableList, DeliverablePicker } from '@/components/entity-detail/deliverables';
import { api } from '@/lib/api';
import { apiInfiniteQueryOptions, queryKeys, useInfiniteApiQuery } from '@/lib/query';
import { clearContentPostRequestKey, contentPostRequestKey } from '@/lib/content-post-retry';

import { activityPerformer } from './format-activity';
import { TaskActivityContent } from './task-activity-content';
import { activitySessionGroups } from './activity-session-groups';
import { TaskActivitySession } from './task-activity-session';
import { TaskDelegatedWork } from './task-delegated-work';
import { DetailSection } from '@/components/entity-detail/detail-section';

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
  readonly onComment?:
    ((body: string, attachmentIds?: string[], requestId?: string) => Promise<void>) | undefined;
  /** Whether the current viewer may add a task comment. */
  readonly canComment?: boolean | undefined;
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
        <Button variant="secondary" size="sm" className="gap-1.5" aria-label="Filter activity">
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

/** Props for {@link ActivityRow}. */
interface ActivityRowProps {
  readonly entry: TaskActivityOut;
  readonly compact?: boolean;
}

/** Prefer recorded agent artwork while retaining the existing human and system identities. */
function ActivityIdentity({
  entry,
  name,
  kind,
}: {
  readonly entry: TaskActivityOut;
  readonly name: string;
  readonly kind: 'human' | 'agent' | 'team';
}): JSX.Element {
  if (
    entry.agentIconUrl ||
    entry.actorKind === 'agent' ||
    entry.origin?.performerKind === 'agent' ||
    entry.origin?.performerKind === 'athena'
  ) {
    return (
      <ActivityAgentAvatar
        name={name}
        iconUrl={entry.agentIconUrl ?? null}
        native={entry.origin?.performerKind === 'athena'}
        size={24}
      />
    );
  }
  return <ActorAvatar kind={kind} name={name} size={24} />;
}

/** One chronological Activity row, naming whoever performed the change. */
function ActivityRow({ entry, compact = false }: ActivityRowProps): JSX.Element {
  const performer = activityPerformer(entry, null);
  const content = (
    <>
      <TaskActivityContent entry={entry} showPerformer={!compact} />
      <DeliverableList files={entry.attachments} />
    </>
  );
  if (compact) return <li className="min-w-0">{content}</li>;
  return (
    <TimelineItem
      node={<ActivityIdentity entry={entry} name={performer.name} kind={performer.avatarKind} />}
    >
      <div className="px-3">{content}</div>
    </TimelineItem>
  );
}

/** Keep one shared rail while the source records retain their ordered contribution boundaries. */
function ActivityContributions({
  entries,
}: {
  readonly entries: readonly TaskActivityOut[];
  readonly orgId: string;
}): JSX.Element {
  const contributions = activitySessionGroups(entries);
  return (
    <Timeline aria-label="Task activity">
      {contributions.map((group) =>
        group.session ? (
          <TaskActivitySession key={group.key} group={group} />
        ) : (
          group.entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
        ),
      )}
    </Timeline>
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

  return (
    <>
      <TaskDelegatedWork orgId={orgId} taskId={taskId} />
      <DetailSection
        id="activity"
        title="Activity"
        actions={<ActivityFilterMenu filter={filter} onFilterChange={setFilter} />}
        className="gap-4"
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
          <ActivityContributions entries={entries} orgId={orgId} />
        )}

        {query.hasNextPage ? (
          <div>
            <Button
              type="button"
              variant="secondary"
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

        <TaskCommentComposer
          orgId={orgId}
          taskId={taskId}
          onComment={onComment}
          canComment={canComment}
        />
      </DetailSection>
    </>
  );
}

function TaskCommentComposer({
  orgId,
  taskId,
  onComment,
  canComment,
}: Pick<
  TaskActivityFeedProps,
  'orgId' | 'taskId' | 'onComment' | 'canComment'
>): JSX.Element | null {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<DeliverableOut[]>([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  async function post(): Promise<void> {
    const text = body.trim();
    if (!onComment || !canComment || posting || filesBusy || text.length === 0) return;
    setPosting(true);
    try {
      const payload = { body: text, attachmentIds: files.map((file) => file.id) };
      const scope = `comment:${orgId}:task:${taskId}`;
      const requestId = await contentPostRequestKey(scope, payload);
      await onComment(payload.body, payload.attachmentIds, requestId);
      await clearContentPostRequestKey(scope, payload, requestId);
      setFiles([]);
      setBody('');
    } catch {
      // The mutation layer shows the failure; keep the draft and uploaded files for retry.
    } finally {
      setPosting(false);
    }
  }
  if (!canComment || !onComment) return null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void post();
      }}
    >
      <Surface tone="floating" pad="comfortable" className="flex flex-col gap-2">
        <FreeformTextEditor
          mentionOrgId={orgId}
          disabled={posting}
          value={body}
          onChange={setBody}
          placeholder="Leave a comment…"
          ariaLabel="Add a comment"
          onSubmit={() => {
            void post();
          }}
          className="rounded-md p-3"
        />
        <DeliverablePicker
          orgId={orgId}
          files={files}
          disabled={posting}
          onChange={setFiles}
          onBusy={setFilesBusy}
          primaryAction={
            <Button
              type="submit"
              size="sm"
              disabled={posting || filesBusy || body.trim().length === 0}
            >
              {posting ? 'Posting…' : 'Comment'}
            </Button>
          }
        />
      </Surface>
    </form>
  );
}
