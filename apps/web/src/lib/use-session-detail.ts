import type { AgentOut, AgentSessionDetailOut, MemberOut } from '@docket/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildActorDirectory, type ActorDirectory } from '@/components/agents/actor-directory';
import type { ChangeReceiptItem, SessionControlsState } from '@/components/agents/session-sidebar';
import { api } from './api';
import { readError, readProblem } from './problem';

/** SessionDetailState describes the use session detail data contract shared by the hook or component. */
export interface SessionDetailState {
  session: AgentSessionDetailOut | null;
  orgName: string | null;
  taskTitle: string | null;
  loading: boolean;
  loadError: string | null;
  actionError: string | null;
  pendingActivityId: string | null;
  controlPending: boolean;
  directory: ActorDirectory;
  agentActor: { name: string; kind: 'human' | 'agent' | 'team'; avatarUrl?: string | null };
  ownerName: string | null;
  initiatorName: string | null;
  changes: readonly ChangeReceiptItem[];
  controls: SessionControlsState;
  approve: (activityId: string) => Promise<void>;
  reject: (activityId: string) => Promise<void>;
  reply: (activityId: string, body: string) => Promise<void>;
  transition: (action: 'pause' | 'resume' | 'cancel') => Promise<void>;
}

/** useSessionDetail coordinates use session detail state, loading, and mutations for its screen. */
export function useSessionDetail(orgId: string, sessionId: string): SessionDetailState {
  const [session, setSession] = useState<AgentSessionDetailOut | null>(null);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [agents, setAgents] = useState<readonly AgentOut[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(null);
  const [controlPending, setControlPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const sessionRes = await api.v1.orgs[':orgId'].sessions[':id'].$get({
        param: { orgId, id: sessionId },
      });
      if (!sessionRes.ok) {
        setLoadError(await readProblem(sessionRes, 'Could not load this session.'));
        return;
      }
      const detail = await sessionRes.json();
      setSession(detail);

      const [membersRes, agentsRes, orgRes] = await Promise.all([
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].$get({ param: { orgId } }),
      ]);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (agentsRes.ok) setAgents((await agentsRes.json()).items);
      if (orgRes.ok) setOrgName((await orgRes.json()).name);

      if (detail.taskId) {
        const taskRes = await api.v1.orgs[':orgId'].tasks[':id'].$get({
          param: { orgId, id: detail.taskId },
        });
        setTaskTitle(taskRes.ok ? (await taskRes.json()).title : null);
      } else {
        setTaskTitle(null);
      }
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading this session.'));
    } finally {
      setLoading(false);
    }
  }, [orgId, sessionId]);

  const reloadActivities = useCallback(async (): Promise<void> => {
    const res = await api.v1.orgs[':orgId'].sessions[':id'].activity.$get({
      param: { orgId, id: sessionId },
    });
    if (res.ok) {
      const { items } = await res.json();
      setSession((current) => (current ? { ...current, activities: items } : current));
    } else {
      await load();
    }
  }, [orgId, sessionId, load]);

  useEffect(() => {
    void load();
  }, [load]);

  const directory = useMemo(() => buildActorDirectory(members, agents), [members, agents]);

  const agentActor = useMemo(() => {
    const agentActorId = session ? directory.actorIdForAgent(session.agentId) : null;
    return directory.resolve(agentActorId);
  }, [directory, session]);

  const ownerName = useMemo(
    () => (session ? directory.ownerNameForAgent(session.agentId) : null),
    [directory, session],
  );

  const initiatorName = useMemo(() => {
    if (!session?.initiatorId) return null;
    return directory.resolve(session.initiatorId).name;
  }, [directory, session]);

  const changes = useMemo<readonly ChangeReceiptItem[]>(() => {
    if (!session) return [];
    return session.activities
      .map((activity): ChangeReceiptItem | null => {
        if (activity.type !== 'action') return null;
        const action = activity.body['action'];
        if (action && typeof action === 'object' && 'summary' in action) {
          const value = action as { kind?: unknown; summary?: unknown };
          return {
            id: activity.id,
            kind: typeof value.kind === 'string' ? value.kind : 'change',
            summary: typeof value.summary === 'string' ? value.summary : '',
            approvalStatus: activity.approvalStatus ?? null,
          };
        }
        return null;
      })
      .filter((c): c is ChangeReceiptItem => c !== null);
  }, [session]);

  const controls = useMemo<SessionControlsState>(() => {
    const status = session?.status;
    return {
      canPause: status === 'running',
      canTakeOver: status === 'awaiting_input',
      canCancel:
        status === 'pending' ||
        status === 'running' ||
        status === 'awaiting_input' ||
        status === 'awaiting_approval',
    };
  }, [session]);

  const approve = useCallback(
    async (activityId: string): Promise<void> => {
      setActionError(null);
      setPendingActivityId(activityId);
      try {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].activity[
          ':activityId'
        ].approve.$post({ param: { orgId, id: sessionId, activityId }, json: {} });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not approve this action.'));
          return;
        }
        await load();
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong approving this action.'));
      } finally {
        setPendingActivityId(null);
      }
    },
    [orgId, sessionId, load],
  );

  const reject = useCallback(
    async (activityId: string): Promise<void> => {
      setActionError(null);
      setPendingActivityId(activityId);
      try {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].activity[
          ':activityId'
        ].reject.$post({ param: { orgId, id: sessionId, activityId }, json: {} });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not reject this action.'));
          return;
        }
        await load();
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong rejecting this action.'));
      } finally {
        setPendingActivityId(null);
      }
    },
    [orgId, sessionId, load],
  );

  const reply = useCallback(
    async (activityId: string, body: string): Promise<void> => {
      setActionError(null);
      setPendingActivityId(activityId);
      try {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].activity[':activityId'].reply.$post(
          {
            param: { orgId, id: sessionId, activityId },
            json: { body },
          },
        );
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not send your reply.'));
          return;
        }
        await reloadActivities();
        const sessionRes = await api.v1.orgs[':orgId'].sessions[':id'].$get({
          param: { orgId, id: sessionId },
        });
        if (sessionRes.ok) {
          const detail = await sessionRes.json();
          setSession((current) => (current ? { ...current, status: detail.status } : detail));
        }
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong sending your reply.'));
      } finally {
        setPendingActivityId(null);
      }
    },
    [orgId, sessionId, reloadActivities],
  );

  const transition = useCallback(
    async (action: 'pause' | 'resume' | 'cancel'): Promise<void> => {
      setActionError(null);
      setControlPending(true);
      try {
        const param = { orgId, id: sessionId };
        const res =
          action === 'pause'
            ? await api.v1.orgs[':orgId'].sessions[':id'].pause.$post({ param })
            : action === 'resume'
              ? await api.v1.orgs[':orgId'].sessions[':id'].resume.$post({ param })
              : await api.v1.orgs[':orgId'].sessions[':id'].cancel.$post({ param });
        if (!res.ok) {
          setActionError(await readProblem(res, `Could not ${action} this session.`));
          return;
        }
        await load();
      } catch (caught) {
        setActionError(readError(caught, `Something went wrong trying to ${action} this session.`));
      } finally {
        setControlPending(false);
      }
    },
    [orgId, sessionId, load],
  );

  return {
    session,
    orgName,
    taskTitle,
    loading,
    loadError,
    actionError,
    pendingActivityId,
    controlPending,
    directory,
    agentActor,
    ownerName,
    initiatorName,
    changes,
    controls,
    approve,
    reject,
    reply,
    transition,
  };
}
