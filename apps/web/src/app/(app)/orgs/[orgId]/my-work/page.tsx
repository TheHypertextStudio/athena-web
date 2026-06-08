'use client';

import {
  type AgentOut,
  type AgentSessionOut,
  type MemberOut,
  type ProjectOut,
  type SessionStatus,
  type TaskOut,
  TeamId,
} from '@docket/types';
import { type GroupKey, ListView } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ListChecks } from '@docket/ui/icons';
import { Button, Input, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';
import { useActiveOrg } from '@/components/active-org';
import {
  AgentTaskRow,
  type AgentTaskRowData,
  type RowActor,
} from '@/components/my-work/agent-task-row';
import { type PillStatus, pillStatusOf } from '@/components/my-work/live-session-pill';
import { SplitTabs } from '@/components/my-work/split-tabs';
import { TeamPicker } from '@/components/teams/team-picker';

/** The two halves of the agent-aware work split. */
type WorkTab = 'mine' | 'delegated';

/** A lightweight actor descriptor (name + kind + avatar) resolved from members/agents. */
interface ActorInfo {
  name: string;
  kind: 'human' | 'agent' | 'team';
  avatarUrl?: string | null;
}

/**
 * Rank of a {@link SessionStatus} by how much it wants the reviewer's attention.
 *
 * @remarks
 * When a task has several sessions, the row shows the single most actionable one: an action
 * awaiting approval outranks a still-running session, which outranks a paused (awaiting
 * input) one, then an errored run, then a queued one. Settled states never carry a pill, so
 * they rank lowest. Used to pick the live session per task.
 */
const SESSION_RANK: Record<SessionStatus, number> = {
  awaiting_approval: 5,
  running: 4,
  awaiting_input: 3,
  failed: 2,
  pending: 1,
  completed: 0,
  canceled: 0,
};

/**
 * The org "My Work" view — agent-aware, split into "Assigned to me" and "Delegated to my
 * agents / awaiting my approval".
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/my-work`. It resolves the caller's own actor
 * (matching the Better Auth session user against the org's human members), then loads the
 * org's tasks, projects, agents, and agent sessions and partitions the work into two tabs:
 *
 * - **Assigned to me** — tasks whose `assigneeId` is the caller's actor.
 * - **Delegated** — tasks delegated (`delegateId`) to an agent the caller owns, plus any task
 *   whose live session is awaiting approval (the human-review surface).
 *
 * Each tab keeps the familiar group-by-{@link useVocabulary | project} → sub-group-by-state
 * {@link ListView}. Agent-run rows carry a {@link AgentTaskRow | live-session pill} (running /
 * awaiting-approval / paused / errored) that deep-links to the task detail / session; rows
 * open the task detail route. Inline task creation is preserved.
 *
 * Creating a task needs a `teamId`; the active org's teams come from {@link useActiveOrg} (which
 * loads `GET /v1/orgs/:orgId/teams`), defaulting to the org's "General" team and offering a
 * {@link TeamPicker} when the org has more than one. Data is fetched at runtime, so the
 * production build needs no running server.
 */
export default function MyWorkPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const { data: authSession } = useSession();
  const userId = authSession?.user.id ?? null;

  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();

  const projectNoun = useVocabulary('project');

  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [agents, setAgents] = useState<readonly AgentOut[]>([]);
  const [sessions, setSessions] = useState<readonly AgentSessionOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<WorkTab>('mine');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // The team new tasks land in: a user override (via the picker) or the org's default team.
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const teamId = teamOverride ?? defaultTeamId;

  /** Load the org's tasks, projects, members, agents, and sessions for the split. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [tasksRes, projectsRes, membersRes, agentsRes, sessionsRes] = await Promise.all([
        api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
      ]);
      if (!tasksRes.ok) {
        setLoadError(await readProblem(tasksRes, 'Could not load your work.'));
        return;
      }
      const { items: taskItems } = await tasksRes.json();
      setTasks(taskItems);
      if (projectsRes.ok) setProjects((await projectsRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (agentsRes.ok) setAgents((await agentsRes.json()).items);
      if (sessionsRes.ok) setSessions((await sessionsRes.json()).items);
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading your work.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The caller's own actor id, matched from the session user against org members. */
  const myActorId = useMemo(
    () => (userId ? (members.find((m) => m.userId === userId)?.actorId ?? null) : null),
    [members, userId],
  );

  /** The actor ids of agents the caller owns (drives the "delegated to my agents" rule). */
  const myAgentActorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const agent of agents) {
      if (myActorId && agent.accountableOwnerId === myActorId) ids.add(agent.actorId);
    }
    return ids;
  }, [agents, myActorId]);

  /** Every agent's backing actor id (a task delegated to one of these is agent-run). */
  const agentActorIds = useMemo(() => new Set(agents.map((agent) => agent.actorId)), [agents]);

  /** Resolve an actor id to its display info: humans from members, agents from members fallback. */
  const actorInfo = useMemo(() => {
    const byId = new Map<string, ActorInfo>();
    for (const member of members) {
      byId.set(member.actorId, {
        name: member.displayName,
        kind: 'human',
        avatarUrl: member.avatar,
      });
    }
    // Agents are Actors too; the agents list carries only the actor id, so synthesize a
    // readable label from any member/agent we know, defaulting to a short "Agent" tag.
    for (const agent of agents) {
      if (!byId.has(agent.actorId)) {
        byId.set(agent.actorId, { name: 'Agent', kind: 'agent' });
      } else {
        const existing = byId.get(agent.actorId);
        /* The branch above guarantees the entry exists when we reach here. */
        if (existing) byId.set(agent.actorId, { ...existing, kind: 'agent' });
      }
    }
    return byId;
  }, [agents, members]);

  /** The most actionable live session per task id (highest {@link SESSION_RANK}). */
  const sessionByTask = useMemo(() => {
    const byTask = new Map<string, AgentSessionOut>();
    for (const session of sessions) {
      if (!session.taskId) continue;
      const current = byTask.get(session.taskId);
      if (!current || SESSION_RANK[session.status] > SESSION_RANK[current.status]) {
        byTask.set(session.taskId, session);
      }
    }
    return byTask;
  }, [sessions]);

  /** A task is "delegated" when an owned agent runs it, or it awaits the caller's approval. */
  const isDelegated = useCallback(
    (task: TaskOut): boolean => {
      const delegatedToMyAgent = task.delegateId ? myAgentActorIds.has(task.delegateId) : false;
      const session = sessionByTask.get(task.id);
      const awaitsApproval =
        session?.status === 'awaiting_approval' &&
        Boolean(task.delegateId && agentActorIds.has(task.delegateId));
      return delegatedToMyAgent || awaitsApproval;
    },
    [agentActorIds, myAgentActorIds, sessionByTask],
  );

  /** Count of tasks in each tab (drives the tab count badges). */
  const counts = useMemo(() => {
    let mine = 0;
    let delegated = 0;
    for (const task of tasks) {
      if (myActorId && task.assigneeId === myActorId) mine += 1;
      if (isDelegated(task)) delegated += 1;
    }
    return { mine, delegated };
  }, [tasks, myActorId, isDelegated]);

  /** Count of delegated tasks awaiting the caller's approval (the "needs you" emphasis). */
  const pendingApprovals = useMemo(
    () =>
      tasks.filter(
        (task) => isDelegated(task) && sessionByTask.get(task.id)?.status === 'awaiting_approval',
      ).length,
    [tasks, isDelegated, sessionByTask],
  );

  const projectName = useMemo(() => {
    const byId = new Map<string, string>(projects.map((p) => [p.id, p.name]));
    return (projectId: string): string => byId.get(projectId) ?? 'Project';
  }, [projects]);

  /** The tasks shown in the active tab, ordered by canonical workflow state. */
  const visibleTasks = useMemo(() => {
    const inTab = tasks.filter((task) =>
      tab === 'mine' ? Boolean(myActorId) && task.assigneeId === myActorId : isDelegated(task),
    );
    const rank = (task: TaskOut): number => STATE_GROUP_ORDER.indexOf(stateTypeOf(task.state));
    return [...inTab].sort((a, b) => rank(a) - rank(b));
  }, [tasks, tab, myActorId, isDelegated]);

  /** Adapt a task DTO to the agent-aware row view-model (actor + live-session pill). */
  const toRow = useCallback(
    (task: TaskOut): AgentTaskRowData => {
      // On "mine" show the assignee; on "delegated" show the agent delegate doing the work.
      const actorId = tab === 'mine' ? task.assigneeId : task.delegateId;
      const info = actorId ? actorInfo.get(actorId) : undefined;
      const actor: RowActor | null = info
        ? { name: info.name, kind: info.kind, avatarUrl: info.avatarUrl }
        : null;

      const session = sessionByTask.get(task.id);
      const pill: PillStatus | null = session ? pillStatusOf(session.status) : null;
      const pillModel =
        session && pill
          ? { status: pill, href: `/orgs/${orgId}/tasks/${task.id}?session=${session.id}` }
          : null;

      return {
        id: task.id,
        title: task.title,
        stateType: stateTypeOf(task.state),
        actor,
        session: pillModel,
      };
    },
    [actorInfo, orgId, sessionByTask, tab],
  );

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
        json: {
          title,
          teamId: TeamId.parse(teamId),
          ...(tab === 'mine' && myActorId ? { assigneeId: myActorId } : {}),
        },
      });
      if (!res.ok) {
        setCreateError(await readProblem(res, 'Could not create the task. Please try again.'));
        return;
      }
      const created = await res.json();
      setTasks((current) => [created, ...current]);
      setTitle('');
    } catch (caught) {
      setCreateError(readError(caught, 'Something went wrong creating the task.'));
    } finally {
      setCreating(false);
    }
  }

  const empty =
    tab === 'mine'
      ? { title: 'Nothing assigned to you yet', body: 'Add a task above to get started.' }
      : {
          title: 'All clear',
          body: 'Nothing delegated, nothing awaiting your approval.',
        };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-on-surface text-xl font-semibold tracking-tight">My Work</h1>
        <p className="text-on-surface-variant text-xs">
          Your work and your agents&apos; work, grouped by {projectNoun.toLowerCase()}.
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void createTask();
        }}
        className="flex flex-col gap-2"
      >
        <div className="flex flex-col gap-2 @2xl:flex-row">
          <Input
            aria-label="New task title"
            placeholder="Add a task…"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
          <div className="flex gap-2">
            <TeamPicker
              teams={teams}
              value={teamId}
              onChange={setTeamOverride}
              disabled={creating}
            />
            <Button
              type="submit"
              className="flex-1 @2xl:flex-none"
              disabled={creating || teamsLoading || teamId === null || title.trim().length === 0}
            >
              {creating ? 'Adding…' : 'Add task'}
            </Button>
          </div>
        </div>
        {createError ? (
          <p role="alert" className="text-destructive text-sm">
            {createError}
          </p>
        ) : null}
      </form>

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
          visibleTasks.length === 0 && !loading && !loadError
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
          <p role="alert" className="text-destructive p-4 text-sm">
            {loadError}
          </p>
        ) : visibleTasks.length === 0 ? (
          <div className="border-outline-variant flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
            <span
              aria-hidden="true"
              className="bg-surface-container text-on-surface-variant flex size-10 items-center justify-center rounded-full"
            >
              <ListChecks className="size-5" />
            </span>
            <p className="text-on-surface text-sm font-medium">{empty.title}</p>
            <p className="text-on-surface-variant max-w-xs text-sm leading-relaxed">{empty.body}</p>
          </div>
        ) : (
          <ListView
            items={visibleTasks}
            label={tab === 'mine' ? 'Tasks assigned to me' : 'Delegated tasks and approvals'}
            getItemKey={(task) => task.id}
            groupBy={groupBy}
            subGroupBy={subGroupBy}
            rowHeight={40}
            renderRow={(task, ctx) => (
              <AgentTaskRow task={toRow(task)} active={ctx.active} onActivate={ctx.onActivate} />
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
