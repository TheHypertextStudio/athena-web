import type {
  AgentOut,
  AgentSessionDetailOut,
  ProposalGroupOut,
} from '@docket/athena/agent-contract';
import type { MemberOut } from '@docket/identity-access/member-contract';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildActorDirectory, type ActorDirectory } from '@/components/agents/actor-directory';
import type { ChangeReceiptItem, SessionControlsState } from '@/components/agents/session-sidebar';
import { presentFailure, presentRejectedResponse } from '@/components/feedback';
import { api } from './api';
import {
  fetchAllAgents,
  fetchAllMembers,
  fetchAllSessionActivity,
  fetchAllSessionProposals,
} from './org-collection-pages';
import { readProblemError } from './problem';
import { startViewTransition } from './view-transition';

/** SessionDetailState describes the use session detail data contract shared by the hook or component. */
export interface SessionDetailState {
  session: AgentSessionDetailOut | null;
  /** Pending proposal groups (one per assistant turn), ghost-projected for review. */
  proposals: readonly ProposalGroupOut[];
  orgName: string | null;
  taskTitle: string | null;
  loading: boolean;
  /** The session read's failure, when it did not arrive; null otherwise. */
  loadError: unknown;
  /** Re-issue the session read after a failure. */
  reload: () => Promise<void>;
  pendingActivityId: string | null;
  controlPending: boolean;
  directory: ActorDirectory;
  agentActor: {
    name: string;
    kind: 'human' | 'agent' | 'team';
    avatarUrl?: string | null | undefined;
  };
  ownerName: string | null;
  initiatorName: string | null;
  changes: readonly ChangeReceiptItem[];
  controls: SessionControlsState;
  approve: (activityId: string) => Promise<void>;
  reject: (activityId: string) => Promise<void>;
  reply: (activityId: string, body: string) => Promise<void>;
  transition: (action: 'pause' | 'resume' | 'cancel') => Promise<void>;
  /** Decide a whole proposal group (or the checked subset). */
  decideGroup: (
    groupId: string,
    decision: 'approve' | 'reject',
    activityIds?: readonly string[],
  ) => Promise<void>;
  /** Replace a pending proposal's tool input (inline ghost editing). */
  editProposal: (activityId: string, input: Record<string, unknown>) => Promise<void>;
}

/** useSessionDetail coordinates use session detail state, loading, and mutations for its screen. */
export function useSessionDetail(orgId: string, sessionId: string): SessionDetailState {
  const [session, setSession] = useState<AgentSessionDetailOut | null>(null);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [agents, setAgents] = useState<readonly AgentOut[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(null);
  const [controlPending, setControlPending] = useState(false);
  const [proposals, setProposals] = useState<readonly ProposalGroupOut[]>([]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const sessionRes = await api.v1.orgs[':orgId'].sessions[':id'].$get({
        param: { orgId, id: sessionId },
      });
      if (!sessionRes.ok) {
        setLoadError(await readProblemError(sessionRes, 'Could not load this session.'));
        return;
      }
      const detail = await sessionRes.json();

      const proposalsRes = await fetchAllSessionProposals(api, orgId, sessionId);
      const nextProposals = proposalsRes.ok ? (await proposalsRes.json()).items : null;

      // The session's activities and its proposal groups render the ghost grammar together — commit
      // both inside one View Transition so an approved/rejected group's ghost rows morph in place
      // (each carries a stable `view-transition-name`) instead of popping out of the list.
      startViewTransition(() => {
        setSession(detail);
        if (nextProposals) setProposals(nextProposals);
      });

      const [membersRes, agentsRes, orgRes] = await Promise.all([
        fetchAllMembers(api, orgId),
        fetchAllAgents(api, orgId),
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
      setLoadError(caught);
    } finally {
      setLoading(false);
    }
  }, [orgId, sessionId]);

  const reloadActivities = useCallback(async (): Promise<void> => {
    const res = await fetchAllSessionActivity(api, orgId, sessionId);
    if (res.ok) {
      const { items } = await res.json();
      setSession((current) => (current ? { ...current, activities: [...items] } : current));
    } else {
      await load();
    }
  }, [orgId, sessionId, load]);

  useEffect(() => {
    void load();
  }, [load]);

  const directory = useMemo(() => buildActorDirectory(members, agents), [members, agents]);

  const agentActor = useMemo(() => {
    if (session?.executorKind === 'athena') {
      return { name: 'Athena', kind: 'agent' as const, avatarUrl: null };
    }
    const agentActorId = session ? directory.actorIdForAgent(session.agentId) : null;
    return directory.resolve(agentActorId);
  }, [directory, session]);

  const ownerName = useMemo(
    () =>
      session?.executorKind === 'registered_agent'
        ? directory.ownerNameForAgent(session.agentId)
        : null,
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
      setPendingActivityId(activityId);
      try {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].activity[
          ':activityId'
        ].decision.$put({
          param: { orgId, id: sessionId, activityId },
          json: { decision: 'approved' },
        });
        if (!res.ok) {
          await presentRejectedResponse(res, 'Could not approve this action.');
          return;
        }
        await load();
      } catch (caught) {
        presentFailure(caught, 'Could not approve this action.');
      } finally {
        setPendingActivityId(null);
      }
    },
    [orgId, sessionId, load],
  );

  const reject = useCallback(
    async (activityId: string): Promise<void> => {
      setPendingActivityId(activityId);
      try {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].activity[
          ':activityId'
        ].decision.$put({
          param: { orgId, id: sessionId, activityId },
          json: { decision: 'rejected' },
        });
        if (!res.ok) {
          await presentRejectedResponse(res, 'Could not reject this action.');
          return;
        }
        await load();
      } catch (caught) {
        presentFailure(caught, 'Could not reject this action.');
      } finally {
        setPendingActivityId(null);
      }
    },
    [orgId, sessionId, load],
  );

  const reply = useCallback(
    async (activityId: string, body: string): Promise<void> => {
      setPendingActivityId(activityId);
      try {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].activity[':activityId'].reply.$post(
          {
            param: { orgId, id: sessionId, activityId },
            json: { body },
          },
        );
        if (!res.ok) {
          await presentRejectedResponse(res, 'Could not send your reply.');
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
        presentFailure(caught, 'Could not send your reply.');
      } finally {
        setPendingActivityId(null);
      }
    },
    [orgId, sessionId, reloadActivities],
  );

  const transition = useCallback(
    async (action: 'pause' | 'resume' | 'cancel'): Promise<void> => {
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
          await presentRejectedResponse(res, `Could not ${action} this session.`);
          return;
        }
        await load();
      } catch (caught) {
        presentFailure(caught, `Could not ${action} this session.`);
      } finally {
        setControlPending(false);
      }
    },
    [orgId, sessionId, load],
  );

  const decideGroup = useCallback(
    async (
      groupId: string,
      decision: 'approve' | 'reject',
      activityIds?: readonly string[],
    ): Promise<void> => {
      setControlPending(true);
      try {
        const param = { orgId, id: sessionId, groupId };
        const res = await api.v1.orgs[':orgId'].sessions[':id'].proposals[':groupId'].decision.$put(
          {
            param,
            json: {
              decision: decision === 'approve' ? 'approved' : 'rejected',
              ...(activityIds ? { activityIds: [...activityIds] } : {}),
            },
          },
        );
        if (!res.ok) {
          await presentRejectedResponse(res, `Could not ${decision} the batch.`);
          return;
        }
        await load();
      } catch (caught) {
        presentFailure(caught, `Could not ${decision} the batch.`);
      } finally {
        setControlPending(false);
      }
    },
    [orgId, sessionId, load],
  );

  const editProposal = useCallback(
    async (activityId: string, input: Record<string, unknown>): Promise<void> => {
      setPendingActivityId(activityId);
      try {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].activity[
          ':activityId'
        ].proposal.$patch({ param: { orgId, id: sessionId, activityId }, json: { input } });
        if (!res.ok) {
          await presentRejectedResponse(res, 'Could not save the edit.');
          return;
        }
        const proposalsRes = await fetchAllSessionProposals(api, orgId, sessionId);
        if (proposalsRes.ok) setProposals((await proposalsRes.json()).items);
      } catch (caught) {
        presentFailure(caught, 'Could not save the edit.');
      } finally {
        setPendingActivityId(null);
      }
    },
    [orgId, sessionId],
  );

  return {
    session,
    proposals,
    orgName,
    taskTitle,
    loading,
    loadError,
    reload: load,
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
    decideGroup,
    editProposal,
  };
}
