'use client';

/**
 * The Session view — "watch the work happen" (mvp-plan §8.6).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/sessions/[sessionId]`. It is the agent-native
 * flagship's transparency surface: a calm two-column split over one agent session.
 *
 * - **Header** — a back-to-task link (when the session is bound to a task) and an org chip.
 * - **LEFT (Activity)** — the plain-English ordered `session_activity` stream
 *   (`GET /sessions/:id/activity`): thought 💭 / response 💬 / action / elicitation ❓ / error.
 *   PROPOSED actions render the approval gate ([Approve ▸] / [Reject], hitting
 *   `.../activity/:activityId/approve|reject`); elicitations render an inline reply box
 *   (`.../activity/:activityId/reply`).
 * - **RIGHT (Sidebar)** — the changes receipt, the accountability line
 *   (`<agent> · on behalf of <owner>`), and the [Pause] / [Take over] / [Cancel session]
 *   lifecycle controls (`.../pause|resume|cancel`).
 *
 * Every mutation re-reads the affected slice so the view stays truthful. Data is fetched at
 * runtime, so the production build needs no running server.
 */
import type { AgentOut, AgentSessionDetailOut, MemberOut, SessionActivityOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft, Sparkles } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { OrgChip } from '@/components/org-chip';
import { ActivityItem } from '@/components/agents/activity-item';
import { buildActorDirectory } from '@/components/agents/actor-directory';
import { SessionStatusPill } from '@/components/agents/session-status';
import {
  type ChangeReceiptItem,
  SessionSidebar,
  type SessionControlsState,
} from '@/components/agents/session-sidebar';

/** Read the structured action summary off an `action` activity for the changes receipt. */
function toChange(activity: SessionActivityOut): ChangeReceiptItem | null {
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
}

/**
 * The single-session "watch the work happen" view.
 */
export default function SessionViewPage(): JSX.Element {
  const params = useParams<{ orgId: string; sessionId: string }>();
  const { orgId, sessionId } = params;

  const taskLabel = useVocabulary('task');

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

  /** Load the session detail and the slices needed to name the agent, owner, and org. */
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
        if (taskRes.ok) setTaskTitle((await taskRes.json()).title);
        else setTaskTitle(null);
      } else {
        setTaskTitle(null);
      }
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading this session.'));
    } finally {
      setLoading(false);
    }
  }, [orgId, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read only the activity stream after a stream-scoped mutation (approve/reject/reply). */
  const reloadActivities = useCallback(async (): Promise<void> => {
    const res = await api.v1.orgs[':orgId'].sessions[':id'].activity.$get({
      param: { orgId, id: sessionId },
    });
    if (res.ok) {
      const { items } = await res.json();
      setSession((current) => (current ? { ...current, activities: items } : current));
    } else {
      // The decision succeeded but the re-read failed; fall back to a full reload.
      await load();
    }
  }, [orgId, sessionId, load]);

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
    const initiator = directory.resolve(session.initiatorId);
    return initiator.name;
  }, [directory, session]);

  const changes = useMemo<readonly ChangeReceiptItem[]>(() => {
    if (!session) return [];
    return session.activities
      .map(toChange)
      .filter((change): change is ChangeReceiptItem => change !== null);
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

  /** Approve a proposed action, then re-read the stream + lifecycle. */
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

  /** Reject a proposed action, then re-read the stream + lifecycle. */
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

  /** Reply to an elicitation, then re-read the stream (appends the human response). */
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
        // A reply may resume an awaiting_input session — refresh the lifecycle too.
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

  /** Drive a lifecycle transition (pause/resume/cancel), then re-read the session. */
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

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid grid-cols-1 gap-8 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {loadError}
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
        <p className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          This session could not be found.
        </p>
      </div>
    );
  }

  const canAct = controls.canCancel || session.status === 'awaiting_approval';

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header: back-to-task link + org chip + status. */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          {session.taskId ? (
            <Link
              href={`/orgs/${orgId}/tasks/${session.taskId}`}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 inline-flex items-center gap-1 rounded px-1 text-sm transition-colors outline-none focus-visible:ring-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to {taskTitle ?? taskLabel.toLowerCase()}
            </Link>
          ) : (
            <span className="text-muted-foreground text-sm">Ad-hoc session</span>
          )}
          {orgName ? <OrgChip orgId={orgId} name={orgName} /> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">
            {taskTitle ?? `${agentActor.name}’s session`}
          </h1>
          <SessionStatusPill status={session.status} />
        </div>

        {actionError ? (
          <p role="alert" className="text-destructive text-sm">
            {actionError}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-8 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* LEFT: the activity stream. */}
        <section aria-labelledby="activity-heading" className="flex min-w-0 flex-col gap-3">
          <h2
            id="activity-heading"
            className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
          >
            Activity
          </h2>
          {session.activities.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No activity yet"
              body="When the agent starts working, its steps will appear here."
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {session.activities.map((activity) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  canAct={canAct}
                  pending={pendingActivityId === activity.id}
                  onApprove={(id) => {
                    void approve(id);
                  }}
                  onReject={(id) => {
                    void reject(id);
                  }}
                  onReply={(id, body) => {
                    void reply(id, body);
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        {/* RIGHT: changes receipt + accountability + controls. */}
        <SessionSidebar
          status={session.status}
          agentName={agentActor.name}
          agentAvatarUrl={agentActor.avatarUrl}
          ownerName={ownerName}
          initiatorName={initiatorName}
          changes={changes}
          controls={controls}
          controlPending={controlPending}
          onPause={() => {
            void transition('pause');
          }}
          onTakeOver={() => {
            void transition('resume');
          }}
          onCancel={() => {
            void transition('cancel');
          }}
        />
      </div>
    </div>
  );
}
