import type {
  AgentOut,
  AgentSessionOut,
  MemberOut,
  ProjectOut,
  SessionStatus,
  TaskOut,
} from '@docket/types';
import type { GroupKey } from '@docket/ui/components';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { type AgentTaskRowData, type RowActor } from '@/components/my-work/agent-task-row';
import { type PillStatus, pillStatusOf } from '@/components/my-work/live-session-pill';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from './work-state';
import { myWorkDefs } from './my-work-defs';
import { queryKeys, useApiQuery } from './query';

/** Shared frozen empty list for the slice fallbacks (stable identity, no per-render allocation). */
const EMPTY: readonly never[] = [];

const SESSION_RANK: Record<SessionStatus, number> = {
  awaiting_approval: 5,
  running: 4,
  awaiting_input: 3,
  failed: 2,
  pending: 1,
  completed: 0,
  canceled: 0,
};

/** MyWorkState describes the use my work data contract shared by the hook or component. */
export interface MyWorkState {
  tasks: readonly TaskOut[];
  setTasks: (updater: (prev: readonly TaskOut[]) => readonly TaskOut[]) => void;
  loading: boolean;
  loadError: string | null;
  myActorId: string | null;
  counts: { mine: number; delegated: number };
  pendingApprovals: number;
  visibleTasks: (tab: 'mine' | 'delegated') => readonly TaskOut[];
  toRow: (task: TaskOut, tab: 'mine' | 'delegated') => AgentTaskRowData;
  groupBy: (task: TaskOut) => GroupKey | null;
  subGroupBy: (task: TaskOut) => GroupKey;
  isDelegated: (task: TaskOut) => boolean;
}

/** useMyWork coordinates use my work state, loading, and mutations for its screen. */
export function useMyWork(orgId: string, userId: string | null): MyWorkState {
  const queryClient = useQueryClient();

  // The five slices flow through myWorkDefs — the same definitions the SSR entry prefetches with —
  // so a warm first paint hits the cache and any create/mutation elsewhere reconciles this screen
  // automatically, with no key/fetcher/staleTime drift between server and client.
  const defs = myWorkDefs(orgId);
  const tasksQ = useApiQuery(defs.tasks);
  const projectsQ = useApiQuery(defs.projects);
  const membersQ = useApiQuery(defs.members);
  const agentsQ = useApiQuery(defs.agents);
  const sessionsQ = useApiQuery(defs.sessions);

  // react-query keeps `data` referentially stable across renders, so `data.items` is already
  // stable; the shared frozen EMPTY keeps the fallback stable too — no useMemo needed.
  const tasks: readonly TaskOut[] = tasksQ.data?.items ?? EMPTY;
  const projects: readonly ProjectOut[] = projectsQ.data?.items ?? EMPTY;
  const members: readonly MemberOut[] = membersQ.data?.items ?? EMPTY;
  const agents: readonly AgentOut[] = agentsQ.data?.items ?? EMPTY;
  const sessions: readonly AgentSessionOut[] = sessionsQ.data?.items ?? EMPTY;

  // Tasks gate the load (the others enrich); only a failed tasks read is fatal — the rosters
  // degrade to benign empties, exactly as the prior best-effort load did.
  const loading =
    tasksQ.isPending ||
    projectsQ.isPending ||
    membersQ.isPending ||
    agentsQ.isPending ||
    sessionsQ.isPending;
  const loadError = tasksQ.isError ? tasksQ.error.message : null;

  /** Optimistically patch the cached task roster (e.g. prepend a just-created task). */
  const setTasks = useCallback(
    (updater: (prev: readonly TaskOut[]) => readonly TaskOut[]): void => {
      queryClient.setQueryData<{ items: readonly TaskOut[] }>(queryKeys.tasks(orgId), (prev) =>
        prev ? { ...prev, items: updater(prev.items) } : { items: updater([]) },
      );
    },
    [queryClient, orgId],
  );

  const myActorId = useMemo(
    () => (userId ? (members.find((m) => m.userId === userId)?.actorId ?? null) : null),
    [members, userId],
  );

  const myAgentActorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const agent of agents) {
      if (myActorId && agent.accountableOwnerId === myActorId) ids.add(agent.actorId);
    }
    return ids;
  }, [agents, myActorId]);

  const agentActorIds = useMemo(() => new Set(agents.map((agent) => agent.actorId)), [agents]);

  const actorInfo = useMemo(() => {
    const byId = new Map<
      string,
      { name: string; kind: 'human' | 'agent' | 'team'; avatarUrl?: string | null }
    >();
    for (const member of members) {
      byId.set(member.actorId, {
        name: member.displayName,
        kind: 'human',
        avatarUrl: member.avatar,
      });
    }
    for (const agent of agents) {
      const existing = byId.get(agent.actorId);
      byId.set(
        agent.actorId,
        existing ? { ...existing, kind: 'agent' } : { name: 'Agent', kind: 'agent' },
      );
    }
    return byId;
  }, [agents, members]);

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

  const counts = useMemo(() => {
    let mine = 0;
    let delegated = 0;
    for (const task of tasks) {
      if (myActorId && task.assigneeId === myActorId) mine += 1;
      if (isDelegated(task)) delegated += 1;
    }
    return { mine, delegated };
  }, [tasks, myActorId, isDelegated]);

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

  const visibleTasks = useCallback(
    (tab: 'mine' | 'delegated'): readonly TaskOut[] => {
      const inTab = tasks.filter((task) =>
        tab === 'mine' ? Boolean(myActorId) && task.assigneeId === myActorId : isDelegated(task),
      );
      const rank = (task: TaskOut): number => STATE_GROUP_ORDER.indexOf(stateTypeOf(task.state));
      return [...inTab].sort((a, b) => rank(a) - rank(b));
    },
    [tasks, myActorId, isDelegated],
  );

  const toRow = useCallback(
    (task: TaskOut, tab: 'mine' | 'delegated'): AgentTaskRowData => {
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
    [actorInfo, orgId, sessionByTask],
  );

  const groupBy = useCallback(
    (task: TaskOut): GroupKey | null =>
      task.projectId ? { id: task.projectId, label: projectName(task.projectId) } : null,
    [projectName],
  );

  const subGroupBy = useCallback((task: TaskOut): GroupKey => {
    const stateType = stateTypeOf(task.state);
    return { id: stateType, label: STATE_GROUP_LABEL[stateType], stateType };
  }, []);

  return {
    tasks,
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
    isDelegated,
  };
}
