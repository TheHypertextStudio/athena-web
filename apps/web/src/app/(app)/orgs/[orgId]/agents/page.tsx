'use client';

/**
 * The Agents view — a live, filterable feed of agent *sessions* (mvp-plan §8.6).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/agents`. This is the agent-native flagship's
 * front door: NOT a roster of registered agents, but the running record of work agents are
 * doing right now. It lists the org's agent sessions (`GET /sessions`) newest-first, each row
 * showing the task, the agent (with its accountable owner — "on behalf of …"), a token-colored
 * status pill, and a when/elapsed stamp; a styled status filter narrows the feed to Running /
 * Needs approval / Done / Errored. Rows open the {@link import('./[..]') | Session view}.
 *
 * It composes three slices in parallel — sessions, members (to name human owners + initiators),
 * and agents (to name the agent + resolve its owner) — through the {@link buildActorDirectory}
 * helper. The tasks list is joined client-side so each row can lead with the task title rather
 * than an opaque id. Sessions awaiting approval are surfaced as the feed's emphasis. Data is
 * fetched at runtime, so the production build needs no running server.
 */
import type { AgentOut, AgentSessionOut, MemberOut, TaskOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Sparkles } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { buildActorDirectory } from '@/components/agents/actor-directory';
import {
  type SessionFilter,
  SessionFilterMenu,
  statusesForFilter,
} from '@/components/agents/session-filter';
import { SessionRow, type SessionRowData } from '@/components/agents/session-row';

/**
 * The Agents (sessions) feed page.
 */
export default function AgentsFeedPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const taskLabel = useVocabulary('task');

  const [sessions, setSessions] = useState<readonly AgentSessionOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [agents, setAgents] = useState<readonly AgentOut[]>([]);
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SessionFilter>('all');

  /** Load the sessions feed and the slices needed to name + describe each row. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sessionsRes, membersRes, agentsRes, tasksRes] = await Promise.all([
        api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
      ]);
      if (!sessionsRes.ok) {
        setLoadError(await readProblem(sessionsRes, 'Could not load agent sessions.'));
        return;
      }
      setSessions((await sessionsRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (agentsRes.ok) setAgents((await agentsRes.json()).items);
      if (tasksRes.ok) setTasks((await tasksRes.json()).items);
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading agent sessions.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const directory = useMemo(() => buildActorDirectory(members, agents), [members, agents]);

  const taskTitleById = useMemo(() => new Map(tasks.map((task) => [task.id, task.title])), [tasks]);

  /** Adapt a session DTO to its feed-row view-model (task title + agent + owner). */
  const toRow = useCallback(
    (session: AgentSessionOut): SessionRowData => {
      const agentActorId = directory.actorIdForAgent(session.agentId);
      const agentActor = directory.resolve(agentActorId);
      const taskTitle = session.taskId
        ? (taskTitleById.get(session.taskId) ?? `Untitled ${taskLabel.toLowerCase()}`)
        : `Ad-hoc ${taskLabel.toLowerCase()}`;
      return {
        id: session.id,
        taskTitle,
        agentName: agentActor.name,
        agentAvatarUrl: agentActor.avatarUrl,
        ownerName: directory.ownerNameForAgent(session.agentId),
        status: session.status,
        startedAt: session.startedAt ?? null,
        endedAt: session.endedAt ?? null,
        createdAt: session.createdAt,
      };
    },
    [directory, taskTitleById, taskLabel],
  );

  /** Per-bucket counts for the filter menu (always computed over the full feed). */
  const counts = useMemo<Record<SessionFilter, number>>(() => {
    const tally: Record<SessionFilter, number> = {
      all: sessions.length,
      running: 0,
      awaiting_approval: 0,
      done: 0,
      errored: 0,
    };
    for (const session of sessions) {
      if (statusesForFilter('running')?.has(session.status)) tally.running += 1;
      if (statusesForFilter('awaiting_approval')?.has(session.status)) tally.awaiting_approval += 1;
      if (statusesForFilter('done')?.has(session.status)) tally.done += 1;
      if (statusesForFilter('errored')?.has(session.status)) tally.errored += 1;
    }
    return tally;
  }, [sessions]);

  /** The sessions visible under the active filter (server already orders newest-first). */
  const visible = useMemo(() => {
    const allowed = statusesForFilter(filter);
    return allowed ? sessions.filter((session) => allowed.has(session.status)) : sessions;
  }, [sessions, filter]);

  const openSession = useCallback(
    (sessionId: string): void => {
      router.push(`/orgs/${orgId}/sessions/${sessionId}`);
    },
    [router, orgId],
  );

  const empty =
    filter === 'all'
      ? {
          title: 'No agent sessions yet',
          body: 'When an agent picks up work, you can watch it happen here.',
        }
      : {
          title: 'No sessions match this filter',
          body: 'Try a different status filter to see other sessions.',
        };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-on-surface text-xl font-semibold tracking-tight">Agents</h1>
        <p className="text-on-surface-variant text-sm">
          A live feed of what your agents are working on — watch the work happen.
        </p>
      </header>

      <div className="flex items-center justify-between gap-3">
        <SessionFilterMenu value={filter} counts={counts} onChange={setFilter} />
        {!loading && !loadError ? (
          <p className="text-on-surface-variant text-xs">
            {visible.length} {visible.length === 1 ? 'session' : 'sessions'}
          </p>
        ) : null}
      </div>

      <section
        aria-label="Agent sessions"
        className="border-outline-variant flex-1 overflow-hidden rounded-lg border"
      >
        {loading ? (
          // The default Skeleton's `bg-accent` tone is near-invisible against the `bg-surface`
          // panel in dark mode, so the loading state reads as an empty box. Override the shimmer
          // to `bg-surface-container-high` (a visible step above the panel in both themes) so the
          // panel clearly reads as loading. Row count/height mirror typical session rows — no
          // layout shift, since loaded + loading both fill the `flex-1` section.
          <div className="flex flex-col gap-1 p-3" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-center gap-4 px-1 py-2">
                <Skeleton className="bg-surface-container-high h-7 w-7 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="bg-surface-container-high h-4 w-2/3" />
                  <Skeleton className="bg-surface-container-high h-3 w-1/3" />
                </div>
                <Skeleton className="bg-surface-container-high h-5 w-24 rounded-full" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <p role="alert" className="text-destructive p-4 text-sm">
            {loadError}
          </p>
        ) : visible.length === 0 ? (
          // Drop the EmptyState's own dashed border (`border-none`) since it already sits inside
          // the bordered feed `<section>`; a nested second border would read as heavy.
          <EmptyState
            icon={Sparkles}
            title={empty.title}
            body={empty.body}
            className="border-none p-12"
          />
        ) : (
          <ul className="divide-outline-variant flex flex-col divide-y p-1">
            {visible.map((session) => (
              <li key={session.id}>
                <SessionRow session={toRow(session)} onOpen={openSession} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
