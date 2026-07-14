'use client';

import { ListView } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ListChecks, Plus } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

import { useSession } from '@/lib/auth-client';
import { useActiveOrg } from '@/components/active-org';
import { AgentTaskRow } from '@/components/my-work/agent-task-row';
import { SplitTabs } from '@/components/my-work/split-tabs';
import { CreateTaskDialog } from '@/components/tasks/create-task';
import { useMyWork } from '@/lib/use-my-work';

type WorkTab = 'mine' | 'delegated';

/**
 * The My Work screen (Client Component).
 *
 * @remarks
 * Mounted by the server entry in `page.tsx`, which SSR-prefetches the five slices
 * {@link useMyWork} reads (tasks, projects, members, agents, sessions) so the screen paints
 * from a warm cache on first load instead of a skeleton.
 *
 * @returns the rendered screen.
 */
export default function MyWorkClient(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const { data: authSession } = useSession();
  const userId = authSession?.user.id ?? null;

  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const projectNoun = useVocabulary('project');

  const [tab, setTab] = useState<WorkTab>('mine');
  const [composerOpen, setComposerOpen] = useState(false);

  const {
    setTasks,
    loading,
    loadError,
    myActorId,
    counts,
    pendingApprovals,
    visibleTasks,
    toRow,
    groupBy,
    subGroupBy,
  } = useMyWork(orgId, userId);

  const visible = visibleTasks(tab);

  const empty =
    tab === 'mine'
      ? {
          title: 'Nothing assigned to you yet',
          body: 'Create your first task — or capture thoughts from Today and they land here.',
        }
      : { title: 'All clear', body: 'Nothing delegated, nothing awaiting your approval.' };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-title-large">My Work</h1>
          <p className="text-on-surface-variant text-xs">
            Your work and your agents&apos; work, grouped by {projectNoun.toLowerCase()}.
          </p>
        </div>
        <Button
          type="button"
          className="gap-1.5 self-start"
          onClick={() => {
            setComposerOpen(true);
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          New task
        </Button>
      </header>

      <CreateTaskDialog
        orgId={orgId}
        teams={teams}
        defaultTeamId={defaultTeamId}
        teamsLoading={teamsLoading}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onCreated={(created) => {
          setTasks((current) => [created, ...current]);
        }}
        defaultAssigneeId={tab === 'mine' ? myActorId : null}
      />

      <SplitTabs
        label="Filter your work"
        value={tab}
        onChange={setTab}
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
        {loading ? (
          <div className="flex flex-col gap-2 p-3" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : loadError ? (
          <p role="alert" className="text-destructive text-body-medium p-4">
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setComposerOpen(true);
                }}
              >
                <Plus aria-hidden="true" className="size-4" />
                New task
              </Button>
            ) : null}
          </div>
        ) : (
          <ListView
            items={visible}
            label={tab === 'mine' ? 'Tasks assigned to me' : 'Delegated tasks and approvals'}
            getItemKey={(task) => task.id}
            groupBy={groupBy}
            subGroupBy={subGroupBy}
            rowHeight={40}
            renderRow={(task, ctx) => (
              <AgentTaskRow
                task={toRow(task, tab)}
                active={ctx.active}
                onActivate={ctx.onActivate}
              />
            )}
            onActivateItem={(task) => {
              router.push(`/orgs/${orgId}/tasks/${task.id}`);
            }}
          />
        )}
      </section>
    </div>
  );
}
