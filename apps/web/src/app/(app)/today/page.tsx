'use client';

import type { HubTaskItem, HubTodayOut } from '@docket/types';
import { CheckCircle2, Inbox, RefreshCw, Sparkles, XCircle } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { AttentionCard } from '@/components/today/attention-card';
import { CalendarPane } from '@/components/today/calendar-pane';
import { PlanRow } from '@/components/today/plan-row';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { todayISODate } from '@/lib/today';

/** A plan group: one organization and the caller's tasks for the day within it. */
interface PlanGroup {
  /** The originating organization's id. */
  orgId: string;
  /** The organization's display name. */
  orgName: string;
  /** The caller's planned + due tasks in this org for the day. */
  tasks: HubTaskItem[];
}

/**
 * The Hub "Today" three-pane cockpit — the default authenticated landing.
 *
 * @remarks
 * A Client Component that aggregates across every org the caller is an active human Actor in.
 * It reads the cross-org day via `api.v1.hub.today.$get` (which returns the day's `plan`
 * tasks, timeboxed `calendar` blocks, and the `needsAttention` trio + inbox count) and lays
 * it out as three calm panes:
 *
 * - **Plan** — the day's pulled + due tasks, grouped by organization, each row org-chipped
 *   (via {@link PlanRow} → {@link OrgChip}) and state-glyphed.
 * - **Calendar** — the day's timeboxed blocks in a single day column ({@link CalendarPane}).
 * - **Needs attention** — approvals, blocked, and due-today digests as expandable
 *   {@link AttentionCard}s, plus the unread inbox count.
 *
 * Every surfaced item carries its originating `organizationId` so the cross-org day is never
 * ambiguous. Data is fetched at runtime (no build-time API dependency).
 */
export default function TodayPage(): JSX.Element {
  const { orgName } = useActiveOrg();
  const [data, setData] = useState<HubTodayOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Load today's cross-org cockpit. `initial` drives the skeleton vs. the inline refresh. */
  const load = useCallback(async (initial: boolean): Promise<void> => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    const date = todayISODate();
    try {
      const res = await api.v1.hub.today.$get({ query: { date } });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not load your day.'));
        return;
      }
      setData(await res.json());
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading your day.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
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

  /** The plan tasks grouped by originating org (insertion order = first-seen org order). */
  const planGroups = useMemo<PlanGroup[]>(() => {
    if (!data) return [];
    const byOrg = new Map<string, PlanGroup>();
    for (const task of data.plan) {
      const group = byOrg.get(task.organizationId);
      if (group) group.tasks.push(task);
      else
        byOrg.set(task.organizationId, {
          orgId: task.organizationId,
          orgName: orgName(task.organizationId),
          tasks: [task],
        });
    }
    return [...byOrg.values()];
  }, [data, orgName]);

  /** Resolve a plan task's title by id (for calendar block labels). */
  const taskTitle = useMemo(() => {
    const byId = new Map<string, string>(data?.plan.map((t) => [t.id, t.title]) ?? []);
    return (taskId: string): string => byId.get(taskId) ?? 'Timeboxed work';
  }, [data]);

  const planCount = data?.plan.length ?? 0;
  const inbox = data?.needsAttention.inbox ?? 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-on-surface-variant text-xs">{heading}</p>
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">Today</h1>
          <p className="text-on-surface-variant text-xs">Your plan and what needs you today.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void load(false);
            }}
            disabled={loading || refreshing}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Plan day'}
          </Button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex items-center justify-between gap-4 rounded-lg border p-4 text-sm"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void load(true);
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {/* Container-relative panes: the grid reflows against the main panel's own width, not the
          viewport. Below `@2xl` (~672px panel) the three panes stack; from `@2xl` Plan + Calendar
          sit side-by-side with Needs-attention beneath; from `@5xl` (~1024px panel) all three sit
          in one row. Every column is `minmax(0,…)`/`min-w-0` so nothing clips at medium widths. */}
      <div className="grid flex-1 gap-6 @2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @5xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ── Pane 1: PLAN ─────────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="today-plan-heading">
          <div className="flex items-center justify-between">
            <h2 id="today-plan-heading" className="text-on-surface text-base font-semibold">
              Plan
            </h2>
            {!loading && planCount > 0 ? (
              <span className="text-on-surface-variant text-xs tabular-nums">
                {planCount} {planCount === 1 ? 'task' : 'tasks'}
              </span>
            ) : null}
          </div>

          {loading ? (
            <PlanSkeleton />
          ) : planGroups.length > 0 ? (
            <div className="flex flex-col gap-6">
              {planGroups.map((group) => (
                <div key={group.orgId} className="flex flex-col gap-1.5">
                  <h3 className="text-on-surface-variant px-3 text-xs font-medium">
                    {group.orgName}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {group.tasks.map((task) => (
                      <li key={task.id}>
                        <PlanRow task={task} orgName={group.orgName} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPane
              title="Nothing planned or due today"
              body="Enjoy the calm — or pull work into your day."
            />
          )}
        </section>

        {/* ── Pane 2: CALENDAR ─────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="today-calendar-heading">
          <h2 id="today-calendar-heading" className="text-on-surface text-base font-semibold">
            Calendar
          </h2>
          {loading ? (
            <Skeleton className="h-[28rem] w-full rounded-lg" />
          ) : (
            <CalendarPane blocks={data?.calendar ?? []} taskTitle={taskTitle} orgName={orgName} />
          )}
        </section>

        {/* ── Pane 3: NEEDS ATTENTION ──────────────────────────────────── */}
        {/* Spans the full width in the 2-column intermediate (sits beneath Plan + Calendar); becomes
            its own third column only once the panel is wide enough (`@5xl`). */}
        <section
          className="flex min-w-0 flex-col gap-3 @2xl:col-span-2 @5xl:col-span-1"
          aria-labelledby="today-attention-heading"
        >
          <div className="flex items-center justify-between">
            <h2 id="today-attention-heading" className="text-on-surface text-base font-semibold">
              Needs attention
            </h2>
            {!loading && inbox > 0 ? (
              <Badge variant="secondary" className="gap-1 tabular-nums">
                <Inbox className="h-3 w-3" />
                {inbox} unread
              </Badge>
            ) : null}
          </div>

          {loading ? (
            <AttentionSkeleton />
          ) : data ? (
            <div className="flex flex-col gap-3">
              <AttentionCard
                icon={CheckCircle2}
                title="Approvals"
                tasks={data.needsAttention.approvals}
                orgName={orgName}
                activeDescription="Agent work waiting on your sign-off"
                clearDescription="No approvals waiting on you"
                alert
              />
              <AttentionCard
                icon={XCircle}
                title="Blocked"
                tasks={data.needsAttention.blocked}
                orgName={orgName}
                activeDescription="Your tasks held up by a dependency"
                clearDescription="Nothing of yours is blocked"
              />
              <AttentionCard
                icon={Sparkles}
                title="Due today"
                tasks={data.needsAttention.dueToday}
                orgName={orgName}
                activeDescription="Tasks with a deadline today"
                clearDescription="Nothing due today"
              />
            </div>
          ) : (
            <EmptyPane title="All clear" body="Nothing needs your attention right now." />
          )}
        </section>
      </div>
    </div>
  );
}

/** Props for {@link EmptyPane}. */
interface EmptyPaneProps {
  /** The empty-state headline. */
  title: string;
  /** The empty-state supporting copy. */
  body: string;
}

/** A calm, content-sized empty state for a pane with no content. */
function EmptyPane({ title, body }: EmptyPaneProps): JSX.Element {
  return (
    <div className="border-outline-variant flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-8 text-center">
      <p className="text-on-surface text-sm font-medium">{title}</p>
      <p className="text-on-surface-variant max-w-xs text-xs">{body}</p>
    </div>
  );
}

/** Loading placeholder for the plan pane: a labeled org group of task rows. */
function PlanSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="mb-1 h-3 w-24" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}

/** Loading placeholder for the needs-attention pane: three digest cards. */
function AttentionSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-[4.5rem] w-full rounded-xl" />
      <Skeleton className="h-[4.5rem] w-full rounded-xl" />
      <Skeleton className="h-[4.5rem] w-full rounded-xl" />
    </div>
  );
}
