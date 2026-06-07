'use client';

import type { ProjectOut, TaskOut } from '@docket/types';
import { type GroupKey, ListView, TaskRow, type TaskRowData } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

/** Adapt a {@link TaskOut} DTO to the {@link TaskRowData} the design-system row renders. */
function toRowData(task: TaskOut): TaskRowData {
  return { id: task.id, title: task.title, stateType: stateTypeOf(task.state) };
}

/** Format an ISO date string as a short, locale-aware day, or a dash when absent. */
function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** A labeled metric in the project's overview status strip. */
function StatItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className="text-foreground text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * The project detail view — overview status strip plus the project's task list.
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/projects/[projectId]`. The RPC surface exposes
 * project list + create (no single-project read), so it resolves the project by id from the
 * org's project list and filters the org's tasks to this project. The overview leads with a
 * status strip (status, health, start/target dates, open-task count), then the task
 * {@link ListView} grouped by canonical workflow state with the matching {@link StatusIcon}.
 * Data is fetched at runtime, so the production build needs no running server.
 */
export default function ProjectDetailPage(): JSX.Element {
  const params = useParams<{ orgId: string; projectId: string }>();
  const { orgId, projectId } = params;
  const projectLabel = useVocabulary('project');

  const [project, setProject] = useState<ProjectOut | null>(null);
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Load the project (from the org's project list) and its tasks. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [projectsRes, tasksRes] = await Promise.all([
        api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
      ]);
      if (!projectsRes.ok) {
        setError(await readProblem(projectsRes, 'Could not load this project.'));
        return;
      }
      const { items: projectItems } = await projectsRes.json();
      const found = projectItems.find((p) => p.id === projectId) ?? null;
      setProject(found);
      if (tasksRes.ok) {
        const { items: taskItems } = await tasksRes.json();
        setTasks(taskItems.filter((t) => t.projectId === projectId));
      }
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading this project.'));
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Sub-group a task by its canonical workflow-state type. */
  const groupBy = useCallback((task: TaskOut): GroupKey => {
    const stateType = stateTypeOf(task.state);
    return { id: stateType, label: STATE_GROUP_LABEL[stateType], stateType };
  }, []);

  /** Tasks ordered by canonical state so the list reads as work progresses. */
  const orderedTasks = useMemo(() => {
    const rank = (task: TaskOut): number => STATE_GROUP_ORDER.indexOf(stateTypeOf(task.state));
    return [...tasks].sort((a, b) => rank(a) - rank(b));
  }, [tasks]);

  const openCount = useMemo(
    () => tasks.filter((t) => !['done', 'canceled'].includes(t.state)).length,
    [tasks],
  );

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl p-8">
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {error}
        </p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-4xl p-8">
        <p className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          This {projectLabel.toLowerCase()} could not be found.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <Badge variant="secondary">{project.status}</Badge>
        </div>
        {project.description ? (
          <p className="text-muted-foreground max-w-2xl text-sm">{project.description}</p>
        ) : null}
      </header>

      <section
        aria-label="Project overview"
        className="border-border bg-card grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4"
      >
        <StatItem label="Status" value={project.status} />
        <StatItem label="Health" value={project.health ?? '—'} />
        <StatItem label="Start" value={formatDate(project.startDate)} />
        <StatItem label="Target" value={formatDate(project.targetDate)} />
      </section>

      <section
        className="flex min-h-0 flex-1 flex-col gap-2"
        aria-labelledby="project-tasks-heading"
      >
        <h2 id="project-tasks-heading" className="text-muted-foreground text-sm font-medium">
          Tasks · {openCount} open
        </h2>
        <div className="border-border min-h-64 flex-1 overflow-hidden rounded-lg border">
          {tasks.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              No tasks in this {projectLabel.toLowerCase()} yet.
            </p>
          ) : (
            <ListView
              items={orderedTasks}
              label={`${project.name} tasks`}
              getItemKey={(task) => task.id}
              groupBy={groupBy}
              renderRow={(task, ctx) => (
                <TaskRow task={toRowData(task)} active={ctx.active} onActivate={ctx.onActivate} />
              )}
            />
          )}
        </div>
      </section>
    </div>
  );
}
