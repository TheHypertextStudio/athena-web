'use client';

import { type ProjectOut, type TaskOut, TeamId } from '@docket/types';
import { type GroupKey, ListView, TaskRow, type TaskRowData } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Input, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { recallDefaultTeam, rememberDefaultTeam } from '@/lib/active-team';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

/** Adapt a {@link TaskOut} DTO to the {@link TaskRowData} the design-system row renders. */
function toRowData(task: TaskOut): TaskRowData {
  return { id: task.id, title: task.title, stateType: stateTypeOf(task.state) };
}

/**
 * The org "My Work" view — tasks grouped by project, then by workflow state.
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/my-work`. It loads the org's tasks and
 * projects via the typed RPC and renders them in the virtualized {@link ListView}: the
 * top-level grouping is by project (the no-project bucket is the synthesized
 * Triage group), and each project is sub-grouped by canonical workflow-state so the
 * {@link StatusIcon} reads correctly. The project group label resolves through
 * {@link useVocabulary} so an agency sees "Engagements" where a startup sees "Projects".
 *
 * Creating a task needs a `teamId`; since the RPC exposes no teams-list route, it uses the
 * default team id remembered at onboarding, falling back to the team id on any existing task.
 * Data is fetched at runtime, so the production build needs no running server.
 */
export default function MyWorkPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const projectsLabel = useVocabulary('project', { plural: true });

  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Load the org's tasks and projects for grouping. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [tasksRes, projectsRes] = await Promise.all([
        api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
      ]);
      if (!tasksRes.ok) {
        setLoadError(await readProblem(tasksRes, 'Could not load your work.'));
        return;
      }
      const { items: taskItems } = await tasksRes.json();
      setTasks(taskItems);
      setTeamId(recallDefaultTeam(orgId) ?? taskItems[0]?.teamId ?? null);
      if (projectsRes.ok) {
        const { items: projectItems } = await projectsRes.json();
        setProjects(projectItems);
      }
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading your work.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const projectName = useMemo(() => {
    const byId = new Map<string, string>(projects.map((p) => [p.id, p.name]));
    return (projectId: string): string => byId.get(projectId) ?? 'Project';
  }, [projects]);

  /** Group a task by its project (or the synthesized Triage bucket when it has none). */
  const groupBy = useCallback(
    (task: TaskOut): GroupKey | null =>
      task.projectId ? { id: task.projectId, label: projectName(task.projectId) } : null,
    [projectName],
  );

  /** Sub-group a task by its canonical workflow-state type (for the state status header). */
  const subGroupBy = useCallback((task: TaskOut): GroupKey => {
    const stateType = stateTypeOf(task.state);
    return { id: stateType, label: STATE_GROUP_LABEL[stateType], stateType };
  }, []);

  /** Stable sort: project tasks ordered by canonical state, then triage last. */
  const orderedTasks = useMemo(() => {
    const rank = (task: TaskOut): number => STATE_GROUP_ORDER.indexOf(stateTypeOf(task.state));
    return [...tasks].sort((a, b) => rank(a) - rank(b));
  }, [tasks]);

  /** Create a task on the org's default team and prepend it to the list. */
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

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My Work</h1>
        <p className="text-muted-foreground text-sm">
          Your tasks for this organization, grouped by {projectsLabel.toLowerCase()}.
        </p>
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
            items={orderedTasks}
            label="My work"
            getItemKey={(task) => task.id}
            groupBy={groupBy}
            subGroupBy={subGroupBy}
            renderRow={(task, ctx) => (
              <TaskRow task={toRowData(task)} active={ctx.active} onActivate={ctx.onActivate} />
            )}
            onActivateItem={(task) => {
              if (task.projectId) router.push(`/orgs/${orgId}/projects/${task.projectId}`);
            }}
          />
        )}
      </div>
    </div>
  );
}
