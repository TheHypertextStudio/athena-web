'use client';

import { ListView } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ListChecks, Plus } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { useAppParams } from '@/lib/app-location';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';

import { InPageSearchField } from '@/components/in-page-search/in-page-search-field';
import { useInPageSearchTarget } from '@/components/in-page-search/in-page-search-provider';
import { useResidentInPageSearch } from '@/components/in-page-search/use-resident-in-page-search';
import { useSession } from '@/lib/auth-client';
import { entityDragSource } from '@/lib/entity-drag';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { AgentTaskRow } from '@/components/my-work/agent-task-row';
import { pillLabelOf } from '@/components/my-work/live-session-pill';
import { SplitTabs } from '@/components/my-work/split-tabs';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { taskListKey } from '@/components/views/task-list-key';
import { useMyWork } from '@/lib/use-my-work';

type WorkTab = 'mine' | 'delegated';

/**
 * The My Work screen (Client Component).
 *
 * @remarks
 * Mounted by the server entry in `page.tsx`, which SSR-prefetches the six slices
 * {@link useMyWork} reads (tasks, projects, members, agents, teams, and sessions) so the screen
 * paints from a warm cache on first load instead of a skeleton.
 *
 * @returns the rendered screen.
 */
export default function MyWorkClient(): JSX.Element {
  const router = useRouter();
  const params = useAppParams<{ orgId: string }>();
  const orgId = params.orgId;
  const { data: authSession } = useSession();
  const userId = authSession?.user.id ?? null;

  const { openCreate } = useCreateObject();
  const projectNoun = useVocabulary('project');

  const [tab, setTab] = useState<WorkTab>('mine');
  const categoryOf = useCategoryOf('task');

  const {
    setTasks,
    loading,
    loadError,
    myActorId,
    counts,
    pendingApprovals,
    visibleTasks,
    actorName,
    toRow,
    groupBy,
    subGroupBy,
    canEdit,
    rename,
  } = useMyWork(orgId, userId, categoryOf);
  const statusRegistry = useStatusRegistry();

  const visible = useMemo(() => visibleTasks(tab), [tab, visibleTasks]);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const source = useMemo(() => ({ completeness: 'complete' as const, items: visible }), [visible]);
  const searchableText = useCallback(
    (task: (typeof visible)[number]): string => {
      const row = toRow(task, tab);
      const sessionLabel = row.session ? pillLabelOf(row.session.status) : null;
      return [
        task.title,
        groupBy(task)?.label,
        subGroupBy(task).label,
        statusRegistry.statusOf('task', task.state, task.teamId)?.name ?? task.state,
        actorName(task.assigneeId),
        row.actor?.name,
        sessionLabel,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ');
    },
    [actorName, groupBy, statusRegistry, subGroupBy, tab, toRow],
  );
  const search = useResidentInPageSearch({ source, searchableText });
  const { restoreFocus } = useInPageSearchTarget({
    id: `my-work:${tab}`,
    rootRef,
    inputRef: searchInputRef,
    enabled: !loading && !loadError,
    onOpen: () => {
      setFindOpen(true);
    },
  });

  const openTaskComposer = (): void => {
    openCreate({
      kind: 'task',
      initialWorkspaceId: orgId,
      sameWorkspaceCompletion: 'stay',
      defaultAssigneeId: tab === 'mine' ? myActorId : null,
      onCreated: (created) => {
        setTasks((current) => [created, ...current]);
      },
    });
  };

  const empty =
    tab === 'mine'
      ? {
          title: 'Nothing assigned to you yet',
          body: 'Create your first task — or capture thoughts from Today and they land here.',
        }
      : { title: 'All clear', body: 'Nothing delegated, nothing awaiting your approval.' };

  return (
    <div
      ref={rootRef}
      className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8"
    >
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-title-large">My Work</h1>
          <p className="text-on-surface-variant text-xs">
            Your work and your agents&apos; work, grouped by {projectNoun.toLowerCase()}.
          </p>
        </div>
        <Button type="button" className="gap-1.5 self-start" onClick={openTaskComposer}>
          <Plus aria-hidden="true" className="size-4" />
          New task
        </Button>
      </header>

      <SplitTabs
        label="Filter your work"
        value={tab}
        onChange={(nextTab) => {
          search.setDraft('');
          setTab(nextTab);
        }}
        tabs={[
          { value: 'mine', label: 'Assigned to me', count: counts.mine },
          {
            value: 'delegated',
            label: 'Delegated & approvals',
            count: counts.delegated,
            emphasis: pendingApprovals > 0,
          },
        ]}
      />

      {findOpen ? (
        <InPageSearchField
          inputRef={searchInputRef}
          value={search.draft}
          onValueChange={search.setDraft}
          onEscapeEmpty={() => {
            setFindOpen(false);
            restoreFocus();
          }}
          label="Search My Work"
          placeholder="Search My Work"
          resultCount={search.items.length}
          pending={search.draft !== search.settledQuery}
        />
      ) : null}

      <section
        id={`tabpanel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className={
          visible.length === 0 && !loading && !loadError
            ? undefined
            : 'border-outline-variant flex-1 overflow-hidden rounded-xl border'
        }
      >
        {/* placeholder: the rows for the selected tab — which items are assigned to, created by or
            watched by the caller, and each one's title, state and workspace. The tab strip itself
            carries static labels and renders before the read. */}
        {loading ? (
          <div className="flex flex-col gap-2 p-3" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : loadError ? (
          <p role="alert" className="text-error text-body-medium p-4">
            {loadError}
          </p>
        ) : visible.length === 0 ? (
          <div className="border-outline-variant bg-surface-container-low/60 flex flex-col items-center gap-3 rounded-xl border p-10 text-center">
            <span
              aria-hidden="true"
              className="bg-surface-container text-on-surface-variant flex size-10 items-center justify-center rounded-full"
            >
              <ListChecks className="size-5" />
            </span>
            <p className="text-on-surface text-body-medium font-medium">{empty.title}</p>
            <p className="text-on-surface-variant text-body-medium max-w-xs leading-relaxed">
              {empty.body}
            </p>
            {tab === 'mine' ? (
              <Button type="button" variant="outline" size="sm" onClick={openTaskComposer}>
                <Plus aria-hidden="true" className="size-4" />
                New task
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="relative h-full min-h-0">
            <ListView
              stateKey={search.settledQuery.trim().length > 0 ? 'search' : 'browse'}
              items={search.items}
              label={tab === 'mine' ? 'Tasks assigned to me' : 'Delegated tasks and approvals'}
              getItemKey={taskListKey}
              groupBy={groupBy}
              subGroupBy={subGroupBy}
              rowHeight={40}
              className={search.items.length === 0 ? 'invisible' : undefined}
              renderRow={(task, ctx) => (
                <AgentTaskRow
                  task={toRow(task, tab)}
                  drag={entityDragSource({
                    kind: 'task',
                    id: task.id,
                    organizationId: task.organizationId,
                    title: task.title,
                  })}
                  active={ctx.active}
                  onActivate={ctx.onActivate}
                  rowProps={ctx.rowProps}
                  canEdit={canEdit}
                  onRename={rename}
                />
              )}
              onActivateItem={(task) => {
                router.push(`/orgs/${orgId}/tasks/${task.id}`);
              }}
            />
            {search.items.length === 0 ? (
              <p className="text-on-surface-variant text-body-medium absolute inset-0 flex items-center justify-center p-8 text-center">
                No tasks in this tab match this search.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
