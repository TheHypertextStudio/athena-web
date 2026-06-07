'use client';

import type { HubProjectItem, HubTaskItem } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
import { Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { OrgChip } from '@/components/org-chip';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { todayISODate } from '@/lib/today';
import { stateTypeOf } from '@/lib/work-state';

/** The Today cockpit's loaded data: the day's cross-org tasks and at-risk projects. */
interface TodayData {
  /** The day the plan is for (`YYYY-MM-DD`). */
  date: string;
  /** The caller's planned + due tasks across every org. */
  tasks: readonly HubTaskItem[];
  /** The caller's active projects across every org (the "needs attention" column). */
  projects: readonly HubProjectItem[];
}

/**
 * The Hub "Today" cockpit — the default authenticated landing.
 *
 * @remarks
 * A Client Component that aggregates across every org the caller belongs to. It reads the
 * cross-org day plan via `api.v1.hub.today.$get` (planned + due tasks for the local calendar
 * day) and the active-project portfolio via `api.v1.hub.portfolio.$get` as a lightweight
 * "needs attention" rail. Every row is org-chipped via {@link OrgChip} so the originating
 * organization is unambiguous. Data is fetched at runtime (no build-time API dependency).
 */
export default function TodayPage(): JSX.Element {
  const { orgName } = useActiveOrg();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Load today's cross-org plan and the active-project portfolio in parallel. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const date = todayISODate();
    try {
      const [todayRes, portfolioRes] = await Promise.all([
        api.v1.hub.today.$get({ query: { date } }),
        api.v1.hub.portfolio.$get(),
      ]);
      if (!todayRes.ok) {
        setError(await readProblem(todayRes, 'Could not load your day.'));
        return;
      }
      const today = await todayRes.json();
      const projects = portfolioRes.ok ? (await portfolioRes.json()).projects : [];
      setData({ date: today.date, tasks: today.tasks, projects });
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading your day.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const heading = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{heading}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-muted-foreground text-sm">
          Your plan and what needs attention, across every organization.
        </p>
      </header>

      {error ? (
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <section className="flex flex-col gap-3" aria-labelledby="today-plan-heading">
          <h2 id="today-plan-heading" className="text-muted-foreground text-sm font-medium">
            Daily plan
          </h2>
          {loading ? (
            <DailyPlanSkeleton />
          ) : data && data.tasks.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {data.tasks.map((task) => (
                <li key={task.id}>
                  <div className="border-border bg-card flex items-center gap-3 rounded-lg border px-3 py-2.5">
                    <StatusIcon type={stateTypeOf(task.state)} />
                    <span className="text-foreground flex-1 truncate text-sm">{task.title}</span>
                    <OrgChip orgId={task.organizationId} name={orgName(task.organizationId)} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
              Nothing planned or due today. Enjoy the calm.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="needs-attention-heading">
          <h2 id="needs-attention-heading" className="text-muted-foreground text-sm font-medium">
            Needs attention
          </h2>
          {loading ? (
            <NeedsAttentionSkeleton />
          ) : data && data.projects.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {data.projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/orgs/${project.organizationId}/projects/${project.id}`}
                    className="border-border bg-card hover:bg-accent/50 flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 transition-colors"
                  >
                    <span className="text-foreground truncate text-sm font-medium">
                      {project.name}
                    </span>
                    <OrgChip
                      orgId={project.organizationId}
                      name={orgName(project.organizationId)}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
              No active projects yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** A three-row loading placeholder for the daily-plan column. */
function DailyPlanSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}

/** A two-row loading placeholder for the needs-attention column. */
function NeedsAttentionSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}
