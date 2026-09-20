/** `@docket/api` — agent-sessions router (mounted at `/v1/orgs/:orgId/sessions`). */
import { agentSession, db, sessionActivity } from '@docket/db';
import {
  AgentSessionDetailOut,
  AgentSessionOut,
  ProposalEditBody,
  ApprovalDecision,
  ApprovalDecisionBody,
  ProposalGroupDecision,
  ProposalGroupOut,
  SessionActivityOut,
  SessionFromPromptBody,
  SessionReplyBody,
} from '@docket/athena/agent-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  admitAthenaGeneration,
  asynchronousRunnerEnabled,
  queueWaitingAthenaWake,
  wakeWaitingAthenaGeneration,
} from '../agent/async-runner';
import type { AppEnv } from '../context';
import { accepted, created, ok } from '../lib/ok';
import { pageResult, pageResultByKey, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchUpsert } from '../search/write-through';

import {
  activityParam,
  idParam,
  loadSessionDeliveryAccess,
  listSessionAccess,
  listQuery,
  loadSessionAccess,
  requestUserId,
  toActivityOut,
  toSessionOut,
  transitionLifecycle,
  loadActivity,
} from './agent-session-helpers';
import { createAndRunFromPrompt, postReplyAndResume, runSession } from './agent-session-runner';
import { streamOrganizationActivity } from './agent-session-stream';
import {
  decideActivity,
  decideProposalGroup,
  replyToElicitation,
  resolveAction,
} from './agent-session-approval';
import {
  approveAndResume,
  approveGroupAndResume,
  approveLatestAndResume,
  resumeSessionExecution,
} from '../agent/loop';
import { editProposalInput, latestProposedAction, listProposalGroups } from '../agent/proposals';
import { cancelLatticeDelegation } from '../agent/lattice-delegations';
import { latticeDelegationDependencies } from '../agent/lattice-delegation-runtime';
import { assertHostedExecutionSurface } from '../agent/execution-surface';
import { loadTranscript } from '../agent/transcript';
import { organizationSessionMonitor } from './session-monitor';
import { organizationAgentActivityStreamOperation } from './stream-contracts';

/**
 * Get — or lazily create — the user's persistent Athena chat session (`kind: 'chat'`).
 * The newest personal chat wins so repeated contextual workspace calls converge.
 */
async function getOrCreateChatSession(
  orgId: string,
  actorId: string,
  ownerUserId: string,
): Promise<typeof agentSession.$inferSelect> {
  const existing = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.executorKind, 'athena'),
        eq(agentSession.ownerUserId, ownerUserId),
        eq(agentSession.kind, 'chat'),
      ),
    )
    .orderBy(desc(agentSession.createdAt))
    .limit(1);
  if (existing[0]) {
    if (existing[0].contextOrganizationId === orgId) return existing[0];
    const [focused] = await db
      .update(agentSession)
      .set({ contextOrganizationId: orgId })
      .where(eq(agentSession.id, existing[0].id))
      .returning();
    /* v8 ignore next -- @preserve defensive: update always returns a row */
    if (!focused) throw new Error('chat session update returned no row');
    return focused;
  }
  const [created] = await db
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      contextOrganizationId: orgId,
      kind: 'chat',
      trigger: 'delegation',
      status: 'pending',
      initiatorId: actorId,
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!created) throw new Error('chat session insert returned no row');
  return created;
}

/** Route params for the proposal-group routes. */
const groupParam = z.object({ id: z.string(), groupId: z.string() });
const paginatedSessionListQuery = listQuery.extend(CursorQuery.shape);

/**
 * A decision on one gated activity, optionally widened to the whole session.
 *
 * @remarks
 * Local rather than shared: `scope` only means something where activities are decided one at
 * a time, and the group and session decisions carry their own breadth in the URL instead.
 */
const ActivityDecisionBody = z
  .object({
    decision: ApprovalDecision,
    scope: z
      .enum(['this', 'all_in_session'])
      .optional()
      .describe('Apply the decision to just this activity (default) or every proposed one.'),
  })
  .meta({ id: 'ActivityDecisionBody', description: 'A decision on one gated session activity.' });

/** Agent-sessions router: list (status filter), read with stream, approve + reject. */
const agentSessions = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Agents',
      summary: 'List agent sessions',
      response: pageOf(AgentSessionOut),
      description: `List the organization's agent sessions in \`createdAt DESC, id DESC\` order. Pages default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Reuse a cursor only with the same \`status\` filter. The summaries omit activity; use \`GET /:id\` for detail. A read; org membership is sufficient.`,
    }),
    zQuery(paginatedSessionListQuery),
    async (c) => {
      const { status, cursor, limit } = c.req.valid('query');
      const rows = await listSessionAccess(c, status, { cursor, limit });
      return ok(
        c,
        pageOf(AgentSessionOut),
        pageResult(rows.map(toSessionOut), limit, (item) => new Date(item.createdAt)),
      );
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      status: [201, 202],
      tag: 'Agents',
      summary: 'Start an agent session from a prompt',
      capability: 'contribute',
      response: AgentSessionOut,
      description: `Create and start an agent session from a freeform \`prompt\`. Omit \`agentId\` to use the caller's personal Athena agent, or supply a registered agent in the organization. An unknown or inaccessible agent returns 404.

The prompt becomes the first activity and the instruction for the agent. Personal Athena sessions belong to the caller and use the organization as their work context. Registered-agent sessions use the selected agent's workspace permissions.

The operation returns \`202\` with a monitor URL when work continues asynchronously, or \`201\` when it finishes creating the session before the response. Activities remain available through \`GET /:id/stream\`. Approval can pause a proposed action but never grants a permission the agent lacks. Requires \`contribute\`. Related operations run, pause, resume, cancel, approve, reject, and reply to the session.`,
    }),
    zJson(SessionFromPromptBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const ownerUserId = requestUserId(c);
      const { prompt, agentId } = c.req.valid('json');
      const settled = await createAndRunFromPrompt(orgId, actorId, prompt, agentId, ownerUserId);
      await enqueueSearchUpsert(orgId, 'agent_session', settled.id);
      if (settled.executorKind === 'athena' && asynchronousRunnerEnabled()) {
        return accepted(
          c,
          AgentSessionOut,
          toSessionOut(settled),
          organizationSessionMonitor(orgId, settled.id),
        );
      }
      return created(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .get(
    '/chat',
    apiDoc({
      tag: 'Agents',
      summary: "Get (or create) the user's Athena chat thread",
      response: AgentSessionDetailOut,
      description: `Return the caller's personal Athena chat session with its complete activity history. Docket creates the session on first use and focuses it on the current organization. The thread belongs to the caller and uses the same tools, permissions, and approval behavior as other Athena sessions.`,
    }),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const session = await getOrCreateChatSession(orgId, actorId, requestUserId(c));
      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, session.id))
        .orderBy(asc(sessionActivity.createdAt));
      return ok(c, AgentSessionDetailOut, {
        ...toSessionOut(session),
        activities: activities.map(toActivityOut),
      });
    },
  )
  .post(
    '/chat/messages',
    capabilityGuard('contribute'),
    apiDoc({
      status: [200, 202],
      tag: 'Agents',
      summary: 'Send a message to the Athena chat thread',
      capability: 'contribute',
      response: AgentSessionDetailOut,
      description: `Add a message to the organization's Athena chat thread. The message appears in activity history and becomes the next user turn. The operation returns \`202\` with a monitor URL when Athena continues asynchronously. It returns \`200\` when the thread is already waiting for approval or has been canceled, because no new work starts. Requires the \`contribute\` capability.`,
    }),
    zJson(SessionReplyBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const session = await getOrCreateChatSession(orgId, actorId, requestUserId(c));
      const { session: settled, asynchronous } = await postReplyAndResume(
        orgId,
        session.id,
        actorId,
        body.body,
        // The chat door: an authenticated member typing into their own session. This is the one
        // ingress whose text carries the principal's authority.
        'principal',
      );

      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, session.id))
        .orderBy(asc(sessionActivity.createdAt));
      const detail = {
        ...toSessionOut(settled),
        activities: activities.map(toActivityOut),
      };
      return asynchronous
        ? accepted(c, AgentSessionDetailOut, detail, organizationSessionMonitor(orgId, settled.id))
        : ok(c, AgentSessionDetailOut, detail);
    },
  )
  .post(
    '/chat/new',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Agents',
      summary: 'Start a new Athena chat thread',
      capability: 'contribute',
      response: AgentSessionDetailOut,
      description: `Create a chat session and make it the current chat. Existing chat sessions and their history remain available through \`GET /:id\` and the Agents feed. After this request, \`GET /chat\` and \`POST /chat/messages\` use the new session.`,
    }),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const ownerUserId = requestUserId(c);
      const [session] = await db
        .insert(agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId,
          contextOrganizationId: orgId,
          kind: 'chat',
          trigger: 'delegation',
          status: 'pending',
          initiatorId: actorId,
        })
        .returning();
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!session) throw new Error('chat session insert returned no row');
      return created(
        c,
        AgentSessionDetailOut,
        { ...toSessionOut(session), activities: [] },
        organizationSessionMonitor(orgId, session.id),
      );
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Agents',
      summary: 'Get an agent session',
      response: AgentSessionDetailOut,
      description: `Fetch a single agent session with its **full, ordered Activity stream** as {@link AgentSessionDetailOut} — the session summary plus every persisted activity (thoughts, actions, responses, elicitations, errors) sorted oldest-first, so a client can render the whole transcript in one read. Org-scoped: a missing/cross-tenant id returns 404 (\`Session not found\`). A read; org membership suffices. Each \`action\` activity carries an \`approvalStatus\` (\`proposed\` / \`approved\` / \`rejected\` / \`applied\`) reflecting where it sits in the approval gate. For an incremental or live view use \`GET /:id/activity\` (paged) or \`GET /:id/stream\` (SSE) instead of re-fetching the whole detail.`,
    }),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { session: row } = await loadSessionDeliveryAccess(c, id);
      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, id))
        .orderBy(asc(sessionActivity.createdAt));
      return ok(c, AgentSessionDetailOut, {
        ...toSessionOut(row),
        activities: activities.map(toActivityOut),
      });
    },
  )
  .post(
    '/:id/run',
    apiDoc({
      status: [200, 202],
      tag: 'Agents',
      summary: 'Run an agent session',
      response: AgentSessionOut,
      description: `Run or continue a session whose status is \`pending\` or \`running\`. Any other status returns 409. An absent or inaccessible session returns 404, as does a session whose registered agent no longer exists.

Docket prevents two active runs for the same session. If an interrupted run stops renewing its claim, a later request can recover it. The session stops when it completes, fails, is canceled, or waits for a person. The operation returns \`202\` with a monitor URL when work continues asynchronously, or \`200\` with the settled session. Activities stream through \`GET /:id/stream\`. Personal Athena work requires its owner; registered-agent work requires \`contribute\`.`,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id, 'contribute');
      assertHostedExecutionSurface(session);
      if (session.executorKind === 'athena' && asynchronousRunnerEnabled()) {
        await admitAthenaGeneration(session, { runnableStatuses: ['pending', 'running'] });
        const { session: current } = await loadSessionAccess(c, id, 'contribute');
        await enqueueSearchUpsert(orgId, 'agent_session', current.id);
        return accepted(
          c,
          AgentSessionOut,
          toSessionOut(current),
          organizationSessionMonitor(orgId, current.id),
        );
      }
      const settled = await runSession(orgId, id);
      await enqueueSearchUpsert(orgId, 'agent_session', settled.id);
      return ok(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .get(
    '/:id/stream',
    apiDoc(organizationAgentActivityStreamOperation),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { session } = await loadSessionDeliveryAccess(c, id);
      return streamOrganizationActivity(c, session);
    },
  )
  .get(
    '/:id/proposals',
    apiDoc({
      tag: 'Agents',
      summary: 'List pending proposal groups',
      response: pageOf(ProposalGroupOut),
      description: `List the session's still-proposed actions grouped by \`proposalGroupId\`. Results use stable proposal-group-id order, default to 50 groups, accept at most 100, and omit \`nextCursor\` at exhaustion. Org-scoped 404 when the session is missing.`,
    }),
    zParam(idParam),
    zQuery(CursorQuery),
    async (c) => {
      const { id } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      await loadSessionDeliveryAccess(c, id);
      const groups = await listProposalGroups(id, { cursor, limit });
      return ok(
        c,
        pageOf(ProposalGroupOut),
        pageResultByKey(groups, limit, (item) => item.proposalGroupId),
      );
    },
  )
  .put(
    '/:id/proposals/:groupId/decision',
    apiDoc({
      status: [200, 202],
      tag: 'Agents',
      summary: 'Decide a proposal group (batch)',
      response: AgentSessionOut,
      description: `Approve or reject every pending action in a proposal group, or only the actions listed in \`activityIds\`. The response contains the current {@link AgentSessionOut}.

\`decision: "approved"\` applies each selected action after checking the caller's current permissions, then resumes the session. \`decision: "rejected"\` applies none of the selected actions, records each rejection, and resumes the session so the agent can continue with that result. The request returns 404 when the group contains no pending actions.

Docket returns 202 with a monitor URL when execution continues asynchronously. Otherwise, it returns 200 after applying the decision.`,
    }),
    zParam(groupParam),
    zJson(ProposalGroupDecision),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, groupId } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id, 'assign');
      const { decision, activityIds } = c.req.valid('json');
      const verdict = decision === 'approved' ? 'approve' : 'reject';
      if (session.executionSurface === 'lattice') {
        await decideProposalGroup(orgId, null, id, groupId, verdict, activityIds);
        const { session: current } = await loadSessionAccess(c, id, 'assign');
        return ok(c, AgentSessionOut, toSessionOut(current));
      }
      if (session.executorKind === 'athena' && asynchronousRunnerEnabled()) {
        await decideProposalGroup(orgId, null, id, groupId, verdict, activityIds, {
          queueWake: true,
        });
        await wakeWaitingAthenaGeneration(id);
        const { session: current } = await loadSessionAccess(c, id, 'assign');
        return accepted(
          c,
          AgentSessionOut,
          toSessionOut(current),
          organizationSessionMonitor(orgId, current.id),
        );
      }
      const settled = await approveGroupAndResume(
        orgId,
        actorId,
        id,
        groupId,
        verdict,
        activityIds,
      );
      return ok(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .patch(
    '/:id/activity/:activityId/proposal',
    apiDoc({
      tag: 'Agents',
      summary: "Edit a pending proposal's input",
      response: SessionActivityOut,
      description: `Replace the \`toolCall.input\` of an action whose state is still \`proposed\`. Approval executes the edited input. An action without a pending tool call returns 409, and missing or inaccessible work returns 404. Athena requires its authenticated owner; registered-agent work requires \`assign\`.`,
    }),
    zParam(activityParam),
    zJson(ProposalEditBody),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const { session, userId } = await loadSessionAccess(c, id, 'assign');
      const body = c.req.valid('json');
      const updated = await editProposalInput(
        id,
        activityId,
        body.input,
        session.executorKind === 'athena'
          ? { athenaOwnerUserId: userId }
          : { registeredOrganizationId: orgId },
      );
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .get(
    '/:id/activity',
    apiDoc({
      tag: 'Agents',
      summary: 'List agent session activity',
      response: pageOf(SessionActivityOut),
      description: `List a session's Activity entries in \`createdAt ASC, id ASC\` order. Pages default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Reuse a cursor only for the same session. This is the JSON equivalent of \`GET /:id/stream\`. The session must be visible to the caller.`,
    }),
    zParam(idParam),
    zQuery(CursorQuery),
    async (c) => {
      const { id } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      await loadSessionDeliveryAccess(c, id);
      const activities = await db
        .select()
        .from(sessionActivity)
        .where(
          and(
            eq(sessionActivity.sessionId, id),
            seekAfter(sessionActivity.createdAt, sessionActivity.id, cursor, 'asc'),
          ),
        )
        .orderBy(asc(sessionActivity.createdAt), asc(sessionActivity.id))
        .limit(limit + 1);
      return ok(
        c,
        pageOf(SessionActivityOut),
        pageResult(activities.map(toActivityOut), limit, (item) => new Date(item.createdAt)),
      );
    },
  )
  .put(
    '/:id/activity/:activityId/decision',
    apiDoc({
      status: [200, 202],
      tag: 'Agents',
      summary: 'Decide a gated session activity',
      response: SessionActivityOut,
      description: `Approve or reject a pending agent action and return its {@link SessionActivityOut}. The target must be an action in the named session with status \`proposed\`. Docket returns 404 when the session or activity is unavailable and 409 when the activity is no longer pending.

Approval applies the action after checking the caller's current permissions, records who approved it, and allows the session to continue. Rejection records the decision without applying the action and cancels the session after no pending action remains. Set \`scope: "all_in_session"\` to apply the same decision to every pending action in the session; the default scope decides only \`:activityId\`.

Docket returns 202 with a monitor URL when execution continues asynchronously. Otherwise, it returns 200 after applying the decision. Use \`POST /:id/activity/:activityId/reply\` to answer a request for information instead of deciding an action.`,
    }),
    zParam(activityParam),
    zJson(ActivityDecisionBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id, 'assign');
      const body = c.req.valid('json');
      const decision = {
        decision: body.decision === 'approved' ? 'approve' : 'reject',
        ...(body.scope ? { scope: body.scope } : {}),
      } as const;
      if (session.executionSurface === 'lattice') {
        await decideActivity(orgId, null, id, activityId, decision);
        const updated = await loadActivity(id, activityId);
        await enqueueSearchUpsert(orgId, 'agent_session', id);
        return ok(c, SessionActivityOut, toActivityOut(updated));
      }
      if (session.executorKind === 'athena' && asynchronousRunnerEnabled()) {
        await decideActivity(orgId, null, id, activityId, decision, { queueWake: true });
        await wakeWaitingAthenaGeneration(id);
        const updated = await loadActivity(id, activityId);
        await enqueueSearchUpsert(orgId, 'agent_session', id);
        return accepted(
          c,
          SessionActivityOut,
          toActivityOut(updated),
          organizationSessionMonitor(orgId, id),
        );
      }
      await approveAndResume(orgId, actorId, id, activityId, decision);
      const updated = await loadActivity(id, activityId);
      await enqueueSearchUpsert(orgId, 'agent_session', id);
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reply',
    apiDoc({
      status: [200, 202],
      tag: 'Agents',
      summary: 'Reply to a session elicitation',
      response: SessionActivityOut,
      description: `Answer an agent's \`elicitation\` (a mid-run question the agent asked the human) by appending a human \`response\` activity carrying the reply \`body\`, and return that new {@link SessionActivityOut}. The referenced \`:activityId\` must be an \`elicitation\` belonging to this org-scoped session — otherwise 404 (\`Activity not found\` / \`Session not found\`) or 409 (\`Activity is not an elicitation\`).

Side effect: when the session was parked in \`awaiting_input\` it is resumed to \`running\` so the agent can continue with the answer; if it was already running the reply is simply recorded into the stream. Athena requires its authenticated owner; registered-agent work requires \`contribute\`. Related: \`PUT /:id/activity/:activityId/decision\` (for gated actions), and \`POST /:id/resume\` (resume without a textual answer).`,
    }),
    zParam(activityParam),
    zJson(SessionReplyBody),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id, 'contribute');
      assertHostedExecutionSurface(session);
      const body = c.req.valid('json');
      const created = await replyToElicitation(
        orgId,
        id,
        activityId,
        body.body,
        session.executorKind === 'athena' && asynchronousRunnerEnabled() ? { queueWake: true } : {},
      );
      if (session.executorKind === 'athena' && asynchronousRunnerEnabled()) {
        await wakeWaitingAthenaGeneration(id);
        await enqueueSearchUpsert(orgId, 'agent_session', id);
        return accepted(
          c,
          SessionActivityOut,
          toActivityOut(created),
          organizationSessionMonitor(orgId, id),
        );
      }
      // Athena always enters through durable admission, initializing a missing transcript only
      // after its claim. Registered-agent rows keep the status-only fallback solely for legacy
      // sessions whose conversation state was never persisted.
      if (session.executorKind === 'athena' || (await loadTranscript(db, id)).length > 0) {
        await resumeSessionExecution(orgId, id);
      } else if (session.status === 'awaiting_input') {
        await transitionLifecycle(session, 'resume');
      }
      await enqueueSearchUpsert(orgId, 'agent_session', id);
      return ok(c, SessionActivityOut, toActivityOut(created));
    },
  )
  .post(
    '/:id/pause',
    apiDoc({
      tag: 'Agents',
      summary: 'Pause an agent session',
      response: AgentSessionOut,
      description: `Pause a \`running\` session, transitioning it to \`awaiting_input\` and returning the updated {@link AgentSessionOut}. Only a \`running\` session may be paused; any other state yields 409 (\`Session is not running\`), and missing or private work returns 404. Athena requires its authenticated owner; registered-agent work requires \`contribute\`. Related: \`/resume\`, \`/cancel\` (terminal stop), and \`/activity/:activityId/reply\` (which also resumes an \`awaiting_input\` session when it carries an answer).`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id, 'contribute');
      const updated = await transitionLifecycle(session, 'pause');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    '/:id/resume',
    apiDoc({
      status: [200, 202],
      tag: 'Agents',
      summary: 'Resume an agent session',
      response: AgentSessionOut,
      description: `Resume a session whose status is \`awaiting_input\`. Any other status returns 409. Docket applies the owner's concurrency limit and prevents duplicate runs for the same session. The operation returns \`202\` with a monitor URL when work continues asynchronously, or \`200\` with the current session. An absent or inaccessible session returns 404. Personal Athena work requires its owner; registered-agent work requires \`contribute\`.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id, 'contribute');
      assertHostedExecutionSurface(session);
      if (session.executorKind === 'athena' && asynchronousRunnerEnabled()) {
        await queueWaitingAthenaWake(id);
        await wakeWaitingAthenaGeneration(id);
        const { session: current } = await loadSessionAccess(c, id, 'contribute');
        await enqueueSearchUpsert(orgId, 'agent_session', current.id);
        return accepted(
          c,
          AgentSessionOut,
          toSessionOut(current),
          organizationSessionMonitor(orgId, current.id),
        );
      }
      const updated =
        session.executorKind === 'athena' || (await loadTranscript(db, id)).length > 0
          ? await resumeSessionExecution(orgId, id)
          : await transitionLifecycle(session, 'resume');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    '/:id/cancel',
    apiDoc({
      tag: 'Agents',
      summary: 'Cancel an agent session',
      response: AgentSessionOut,
      description: `Cancel a session, driving it to the terminal \`canceled\` state (stamping \`endedAt\`) and returning the updated {@link AgentSessionOut}. Any non-terminal session may be canceled; a session already in a terminal state (\`completed\`/\`failed\`/\`canceled\`) yields 409 (\`Session is already in a terminal state\`), and missing or private work returns 404. Athena requires its authenticated owner; registered-agent work requires \`contribute\`. Cancellation is final and proposed actions are never applied. Related: \`/pause\` and the reject routes.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id, 'contribute');
      if (session.executionSurface === 'lattice' && session.ownerUserId) {
        const didCancel = await cancelLatticeDelegation(
          session.ownerUserId,
          session.id,
          new Date(),
          latticeDelegationDependencies,
        );
        if (didCancel) {
          const { session: canceled } = await loadSessionAccess(c, id, 'contribute');
          await enqueueSearchUpsert(orgId, 'agent_session', canceled.id);
          return ok(c, AgentSessionOut, toSessionOut(canceled));
        }
      }
      assertHostedExecutionSurface(session);
      const shouldWake =
        session.executorKind === 'athena' &&
        asynchronousRunnerEnabled() &&
        (session.status === 'awaiting_input' || session.status === 'awaiting_approval');
      const updated = await transitionLifecycle(
        session,
        'cancel',
        shouldWake ? { queueWake: true } : {},
      );
      if (shouldWake) {
        await wakeWaitingAthenaGeneration(id);
        await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
        return ok(c, AgentSessionOut, toSessionOut(updated));
      }
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .put(
    // Athena decisions belong only to the authenticated owner; conventional registered-agent
    // decisions retain the assign-level compatibility policy. This is the coarse shortcut —
    // see `/:id/activity/:activityId/decision` for the precise form.
    '/:id/decision',
    apiDoc({
      status: [200, 202],
      tag: 'Agents',
      summary: 'Decide a session’s latest proposed action',
      response: AgentSessionOut,
      description: `Approve or reject the session's latest proposed action without supplying an activity ID. Use the activity-specific decision endpoint when you need to select one proposal or narrow its scope.

\`decision: "approved"\` returns the session to \`running\`. \`decision: "rejected"\` cancels the session and sets \`endedAt\`.

The session must be \`awaiting_approval\` (else 409 \`Session is not awaiting approval\`) with a proposed action present (else 409 \`No proposed action awaiting approval\`); a missing or cross-tenant id 404s.

Athena requires its owner and checks the owner's current permissions again before executing the action. Registered-agent work requires \`assign\`. An approved action may return 202 with a monitor URL while work continues. A rejection is terminal and returns 200.`,
    }),
    zParam(idParam),
    zJson(ApprovalDecisionBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { decision } = c.req.valid('json');
      const { session } = await loadSessionAccess(c, id, 'assign');
      const approving = decision === 'approved';
      if (session.executionSurface === 'lattice') {
        const action = await latestProposedAction(id);
        await decideActivity(orgId, null, id, action.id, {
          decision: approving ? 'approve' : 'reject',
        });
        const { session: current } = await loadSessionAccess(c, id, 'assign');
        await enqueueSearchUpsert(orgId, 'agent_session', current.id);
        return ok(c, AgentSessionOut, toSessionOut(current));
      }
      if (session.executorKind === 'athena' && asynchronousRunnerEnabled()) {
        const action = await latestProposedAction(id);
        await decideActivity(
          orgId,
          null,
          id,
          action.id,
          { decision: approving ? 'approve' : 'reject' },
          { queueWake: true, ...(approving ? {} : { cancelSession: true }) },
        );
        await wakeWaitingAthenaGeneration(id);
        const { session: current } = await loadSessionAccess(c, id, 'assign');
        await enqueueSearchUpsert(orgId, 'agent_session', current.id);
        return approving
          ? accepted(
              c,
              AgentSessionOut,
              toSessionOut(current),
              organizationSessionMonitor(orgId, current.id),
            )
          : ok(c, AgentSessionOut, toSessionOut(current));
      }
      const updated = approving
        ? await approveLatestAndResume(orgId, actorId, id)
        : await resolveAction(orgId, id, 'rejected');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  );

export default agentSessions;
