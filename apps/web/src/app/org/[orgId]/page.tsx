'use client';

import { type OrgOut, type OrgSummary, type TaskOut, TeamId } from '@docket/types';
import {
  AppShell,
  ContextProvider,
  ListView,
  NO_GROUP_ID,
  type RailOrg,
  type SidebarNavKey,
  TaskRow,
  type TaskRowData,
  useContextState,
} from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { Button, Input, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, type ReactNode, useCallback, useEffect, useState } from 'react';

import { recallDefaultTeam, rememberDefaultTeam } from '@/lib/active-team';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { stateTypeOf } from '@/lib/work-state';

/** Adapt a {@link TaskOut} DTO to the {@link TaskRowData} the design-system row renders. */
function toRowData(task: TaskOut): TaskRowData {
  return { id: task.id, title: task.title, stateType: stateTypeOf(task.state) };
}

/**
 * The authenticated org work view: the app shell plus a task list and inline create.
 *
 * @remarks
 * The product's primary authenticated surface. A Client Component (it drives the typed RPC
 * client and interactive forms) reached at `/org/[orgId]`. It loads the caller's orgs (for
 * the rail), the active org (for its vocabulary skin), and the org's tasks, then renders the
 * `@docket/ui` {@link AppShell} bound to this org so the accent and entity vocabulary match.
 *
 * Creating a task needs a `teamId`; since the RPC exposes no teams-list route, it uses the
 * default team id remembered at onboarding, falling back to the team id carried by any
 * existing task. Switching orgs in the rail navigates to that org's work view; selecting the
 * Hub returns home.
 */
export default function OrgWorkPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const [orgs, setOrgs] = useState<readonly RailOrg[]>([]);
  const [org, setOrg] = useState<OrgOut | null>(null);
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Load the rail orgs, the active org, and its tasks for the current `orgId`. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const orgsRes = await api.v1.orgs.$get();
      if (orgsRes.ok) {
        const { items } = await orgsRes.json();
        setOrgs(
          items.map((o: OrgSummary): RailOrg => ({ id: o.id, name: o.name, avatar: o.avatar })),
        );
      }

      const orgRes = await api.v1.orgs[':orgId'].$get({ param: { orgId } });
      if (!orgRes.ok) {
        setLoadError(await readProblem(orgRes, 'Could not load this organization.'));
        return;
      }
      setOrg(await orgRes.json());

      const tasksRes = await api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } });
      if (tasksRes.ok) {
        const { items } = await tasksRes.json();
        setTasks(items);
        setTeamId(recallDefaultTeam(orgId) ?? items[0]?.teamId ?? null);
      } else {
        setTeamId(recallDefaultTeam(orgId));
      }
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading your workspace.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Create a task on the active org's default team and prepend it to the list. */
  async function createTask(): Promise<void> {
    if (!teamId) {
      setCreateError('No team is available yet to create a task in.');
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      const res = await api.v1.orgs[':orgId'].tasks.$post({
        param: { orgId },
        json: { title, teamId: TeamId.parse(teamId) },
      });
      if (!res.ok) {
        setCreateError(await readProblem(res, 'Could not create the task. Please try again.'));
        return;
      }
      const created = await res.json();
      rememberDefaultTeam(orgId, created.teamId);
      setTasks((current) => [created, ...current]);
      setTitle('');
    } catch (caught) {
      setCreateError(readError(caught, 'Something went wrong creating the task.'));
    } finally {
      setCreating(false);
    }
  }

  /** Route to another rail destination: the Hub (home) or a sibling org's work view. */
  function onNavigateContext(next: string): void {
    if (next === orgId) return;
    router.push(next === 'hub' ? '/' : `/org/${next}`);
  }

  /** Org-scoped sidebar nav is presentational for now; selecting a row is a no-op. */
  function onNavigate(_key: SidebarNavKey): void {
    // Sub-views (Projects, Cycles, …) are authored in later slices.
  }

  return (
    <ContextProvider initialContext={orgId}>
      <VocabularyProvider skin={org?.vocabulary ?? null}>
        <OrgWorkShell
          orgs={orgs}
          onNavigate={onNavigate}
          onAddOrg={() => {
            router.push('/onboarding');
          }}
          onNavigateContext={onNavigateContext}
          orgId={orgId}
        >
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-6">
            <header className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{org?.name ?? 'Workspace'}</h1>
              <p className="text-muted-foreground text-sm">Your work for this organization.</p>
            </header>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createTask();
              }}
              className="flex flex-col gap-2"
            >
              <div className="flex gap-2">
                <Input
                  aria-label="New task title"
                  placeholder="Add a task…"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                />
                <Button type="submit" disabled={creating || title.trim().length === 0}>
                  {creating ? 'Adding…' : 'Add task'}
                </Button>
              </div>
              {createError ? (
                <p role="alert" className="text-destructive text-sm">
                  {createError}
                </p>
              ) : null}
            </form>

            <div className="border-border flex-1 overflow-hidden rounded-lg border">
              {loading ? (
                <div className="flex flex-col gap-2 p-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : loadError ? (
                <p role="alert" className="text-destructive p-4 text-sm">
                  {loadError}
                </p>
              ) : tasks.length === 0 ? (
                <p className="text-muted-foreground p-4 text-sm">
                  No tasks yet — add your first one above.
                </p>
              ) : (
                <ListView
                  items={tasks.map(toRowData)}
                  label="Tasks"
                  getItemKey={(t) => t.id}
                  groupBy={() => ({ id: NO_GROUP_ID, label: 'All tasks' })}
                  renderRow={(t, ctx) => (
                    <TaskRow task={t} active={ctx.active} onActivate={ctx.onActivate} />
                  )}
                />
              )}
            </div>
          </div>
        </OrgWorkShell>
      </VocabularyProvider>
    </ContextProvider>
  );
}

/** Props for {@link OrgWorkShell}. */
interface OrgWorkShellProps {
  /** The orgs to render in the rail. */
  orgs: readonly RailOrg[];
  /** The current org id (kept bound as the rail's active context). */
  orgId: string;
  /** Invoked when a sidebar nav row is selected. */
  onNavigate: (key: SidebarNavKey) => void;
  /** Invoked when the add-org affordance is used. */
  onAddOrg: () => void;
  /** Invoked when the rail rebinds the active context (Hub or another org). */
  onNavigateContext: (next: string) => void;
  /** The main-area content. */
  children: ReactNode;
}

/**
 * The app shell wrapper that keeps the rail's active context pinned to the routed org and
 * turns rail selections into navigation.
 *
 * @remarks
 * Split out from the page so it can read the shell's context state (which only exists inside
 * the page's {@link ContextProvider}). It binds the active context to `orgId` on mount/route
 * change, and bridges the rail's context changes into Next navigation via `onNavigateContext`.
 */
function OrgWorkShell({
  orgs,
  orgId,
  onNavigate,
  onAddOrg,
  onNavigateContext,
  children,
}: OrgWorkShellProps): JSX.Element {
  const { context, setContext } = useContextState();

  // Keep the bound context in step with the route.
  useEffect(() => {
    setContext(orgId);
  }, [orgId, setContext]);

  // When the rail rebinds the context to a different destination, navigate to it.
  useEffect(() => {
    if (context !== orgId) onNavigateContext(context);
  }, [context, orgId, onNavigateContext]);

  return (
    <AppShell orgs={orgs} activeNavKey="my-work" onNavigate={onNavigate} onAddOrg={onAddOrg}>
      {children}
    </AppShell>
  );
}
