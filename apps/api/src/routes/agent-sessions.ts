/** `@docket/api` — agent-sessions router (mounted at `/v1/orgs/:orgId/sessions`). */
import { agentSession, db, sessionActivity } from '@docket/db';
import {
  AgentSessionDetailOut,
  AgentSessionOut,
  pageOf,
  ProposalEditBody,
  ProposalGroupDecision,
  ProposalGroupOut,
  SessionActivityOut,
  SessionFromPromptBody,
  SessionReplyBody,
} from '@docket/types';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc, describeRoute } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchUpsert } from '../search/write-through';

import {
  activityParam,
  idParam,
  listQuery,
  loadSession,
  toActivityOut,
  toSessionOut,
  transitionLifecycle,
  loadActivity,
} from './agent-session-helpers';
import { createAndRunFromPrompt, postReplyAndResume, runSession } from './agent-session-runner';
import { replyToElicitation, resolveAction } from './agent-session-approval';
import { approveAndResume, approveGroupAndResume, driveSession } from '../agent/loop';
import { ensureDefaultAgent } from '../lib/default-agent';
import { editProposalInput, listProposalGroups } from '../agent/proposals';
import { loadTranscript } from '../agent/transcript';

/**
 * Get — or lazily create — the org's ONE persistent chat session (`kind: 'chat'`),
 * bound to the default agent. The newest chat session wins so repeated calls converge.
 */
async function getOrCreateChatSession(
  orgId: string,
  actorId: string,
): Promise<typeof agentSession.$inferSelect> {
  const agent = await ensureDefaultAgent(orgId, actorId);
  const existing = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.organizationId, orgId),
        eq(agentSession.agentId, agent.id),
        eq(agentSession.kind, 'chat'),
      ),
    )
    .orderBy(desc(agentSession.createdAt))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(agentSession)
    .values({
      organizationId: orgId,
      agentId: agent.id,
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

/** SSE live-tail poll cadence (DB-backed, restart-safe). */
const STREAM_POLL_MS = 750;
/** SSE heartbeat cadence (keeps proxies from idling the connection out). */
const STREAM_HEARTBEAT_MS = 15_000;

/** Route params for the proposal-group routes. */
const groupParam = z.object({ id: z.string(), groupId: z.string() });

/** Agent-sessions router: list (status filter), read with stream, approve + reject. */
const agentSessions = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Agents',
      summary: 'List agent sessions',
      response: pageOf(AgentSessionOut),
      description: `List the organization's agent sessions, newest first, as a single page of {@link AgentSessionOut} summaries (no activity stream — use \`GET /:id\` for that). An agent session is the Docket-hosted lifecycle of one agent task: it tracks status, trigger, the bound agent, an optional linked task, the human initiator, and start/end timestamps, but deliberately does NOT model compute/cost/telemetry (the external provider owns execution). Pass \`?status=\` to filter to a single lifecycle state (\`pending\`, \`running\`, \`awaiting_input\`, \`awaiting_approval\`, \`completed\`, \`failed\`, or \`canceled\`) — useful for surfacing the review queue (\`awaiting_approval\`) or live work (\`running\`). A read; org membership is sufficient. Related: start one via \`POST /\`, inspect via \`GET /:id\`, and watch live via \`GET /:id/stream\`.`,
    }),
    zQuery(listQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { status } = c.req.valid('query');
      const where = status
        ? and(eq(agentSession.organizationId, orgId), eq(agentSession.status, status))
        : eq(agentSession.organizationId, orgId);
      const rows = await db
        .select()
        .from(agentSession)
        .where(where)
        .orderBy(desc(agentSession.createdAt));
      return ok(c, pageOf(AgentSessionOut), { items: rows.map(toSessionOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Start an agent session from a prompt',
      capability: 'contribute',
      response: AgentSessionOut,
      description: `Create and run an agent session from a freeform \`prompt\`, returning the **settled** {@link AgentSessionOut} (the call runs the session synchronously to its first resting point, so the returned \`status\` is already past \`running\` — typically \`awaiting_approval\` or \`completed\`). This is the "ask Athena to plan" escalation of the hybrid Home prompt box; its sibling, plain quick-capture, lives at \`POST /v1/orgs/:orgId/capture\` and never invokes an agent.

Behavior: the session binds to the supplied \`agentId\` (validated to be a registered agent in this org, else 404 \`Agent not found\`) or, when omitted, to the org's **default agent**, which is lazily created on first use so escalation works with zero agent pre-setup. The prompt is persisted as the session's first \`response\` activity (there is no schema brief column) and threaded through as the runtime task brief. \`trigger\` is recorded as \`delegation\` (a human delegating planning), and the caller becomes the session \`initiatorId\`.

Side effects: dispatches the agent against the runtime; each yielded activity (thought/action/response/elicitation/error) is persisted as a {@link SessionActivityOut} row and streams live over \`GET /:id/stream\`. The agent acts as its own Actor under the same capability checks as a human, plus an orthogonal **approval gate**: a proposed \`action\` it emits is stamped \`proposed\` and parks the session in \`awaiting_approval\` until a reviewer approves/rejects it. Requires \`contribute\` (the same bar as creating a task directly). Related: \`POST /:id/run\` (re-run an existing session), the activity approve/reject/reply routes, and the pause/resume/cancel lifecycle routes.`,
    }),
    zJson(SessionFromPromptBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { prompt, agentId } = c.req.valid('json');
      const settled = await createAndRunFromPrompt(orgId, actorId, prompt, agentId);
      await enqueueSearchUpsert(orgId, 'agent_session', settled.id);
      return ok(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .get(
    '/chat',
    apiDoc({
      tag: 'Agents',
      summary: "Get (or create) the org's Athena chat thread",
      response: AgentSessionDetailOut,
      description: `Return the organization's ONE persistent conversational session (\`kind: 'chat'\`) with its full activity stream — creating it (bound to the lazily-resolved default agent) on first use, so the chat door works with zero setup. The chat thread is the same session substrate as delegated jobs — same loop, transcript, toolbox, and approval gate — rendered conversationally; a job spawned from chat is just another session. Send messages via \`POST /chat/messages\`. A read (plus the idempotent lazy create); org membership suffices.`,
    }),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const session = await getOrCreateChatSession(orgId, actorId);
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
      tag: 'Agents',
      summary: 'Send a message to the Athena chat thread',
      capability: 'contribute',
      response: AgentSessionDetailOut,
      description: `Append a natural-language message to the org's chat thread and drive Athena's reply: the text lands as a visible \`response\` activity (author: user) AND as the next user turn of the durable transcript, then the loop runs — reads answer instantly, writes obey the same approval dial as any session (a proposed batch parks the thread \`awaiting_approval\` and reviews through the ghost system). Returns the settled thread with its full stream. Requires \`contribute\` (chatting IS contributing). This is the "one engine, many doors" door: the home prompt box and delegation drive the identical machinery.`,
    }),
    zJson(SessionReplyBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const session = await getOrCreateChatSession(orgId, actorId);
      const settled = await postReplyAndResume(orgId, session.id, actorId, body.body);

      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, session.id))
        .orderBy(asc(sessionActivity.createdAt));
      return ok(c, AgentSessionDetailOut, {
        ...toSessionOut(settled),
        activities: activities.map(toActivityOut),
      });
    },
  )
  .post(
    '/chat/new',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Start a new Athena chat thread',
      capability: 'contribute',
      response: AgentSessionDetailOut,
      description: `Start a genuinely new conversational session (\`kind: 'chat'\`), leaving the prior chat session's history in place rather than deleting or reusing it. \`GET /chat\` and \`POST /chat/messages\` always resume the newest \`kind: 'chat'\` session, so once this returns, every other door onto "the" chat thread (the ⌘J panel, the standalone page) continues from the fresh session automatically. Older chat sessions remain queryable like any other session (\`GET /:id\`, or the Agents feed) — this only changes which one is "current"; there is deliberately no dedicated past-chat browser yet. Requires \`contribute\` (starting a thread IS contributing).`,
    }),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const agent = await ensureDefaultAgent(orgId, actorId);
      const [created] = await db
        .insert(agentSession)
        .values({
          organizationId: orgId,
          agentId: agent.id,
          kind: 'chat',
          trigger: 'delegation',
          status: 'pending',
          initiatorId: actorId,
        })
        .returning();
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!created) throw new Error('chat session insert returned no row');
      return ok(c, AgentSessionDetailOut, { ...toSessionOut(created), activities: [] });
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
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(agentSession)
        .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Session not found');
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
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Run an agent session',
      capability: 'contribute',
      response: AgentSessionOut,
      description: `Run (or resume execution of) an existing session against the agent runtime and return the **settled** {@link AgentSessionOut}. Only a session in a *runnable* state — \`pending\` (created but not yet dispatched, e.g. a proactively drafted plan) or \`running\` — may be run; any other state (terminal, or parked awaiting human input/approval) yields 409 (\`Session is not in a runnable state\`). A missing/cross-tenant id returns 404, and a session whose agent has since been deregistered returns 404 (\`Agent not found\`).

Behavior & side effects: derives the task brief (a linked task's title, else the session's seed \`response\` prompt), flips the session to \`running\` (stamping \`startedAt\` on first run), then consumes the runtime's activity stream — persisting one {@link SessionActivityOut} per yielded activity and stamping \`proposed\` on gated actions. When the stream ends the session settles to \`awaiting_approval\` if any proposed action remains unresolved, otherwise \`completed\` (stamping \`endedAt\`). Activities stream live to \`GET /:id/stream\`. Requires \`contribute\`. The body is an empty object. Related: \`POST /\` (create-and-run from a prompt), the approve/reject routes to clear an \`awaiting_approval\` gate.`,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const settled = await runSession(orgId, id);
      await enqueueSearchUpsert(orgId, 'agent_session', settled.id);
      return ok(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .get(
    '/:id/stream',
    describeRoute({
      tags: ['Agents'],
      summary: 'Stream agent session activity (SSE)',
      description: `Stream a session's Activity entries as **Server-Sent Events** (\`text/event-stream\`), rather than a JSON envelope. Each persisted activity is emitted as one SSE message whose \`id\` is the activity id, whose \`event\` name is the activity \`type\` (\`thought\` | \`action\` | \`response\` | \`elicitation\` | \`error\`), and whose \`data\` is the JSON-serialized {@link SessionActivityOut}. A client subscribes (e.g. via \`EventSource\`) to render the agent's reasoning, proposed actions, questions, and results as they arrive — the live counterpart to the one-shot \`GET /:id\` transcript.

Semantics: the org-scoped session must exist (404 \`Session not found\` otherwise). The stream replays the session's existing activities in chronological order. Because each event carries the activity \`id\`, a reconnecting client can use the standard SSE \`Last-Event-ID\` header to resume after the last entry it saw. Reads only; org membership suffices. Approval is driven separately via the activity approve/reject/reply routes; this endpoint is read-only observation.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const sessionRows = await db
        .select()
        .from(agentSession)
        .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
        .limit(1);
      if (!sessionRows[0]) throw new NotFoundError('Session not found');
      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, id))
        .orderBy(asc(sessionActivity.createdAt));
      // Live tail: after replaying history, poll the DB for new rows until the session
      // settles terminally. DB-backed (not process-coupled), so the tail survives the
      // loop and the SSE reader living in different processes/restarts. `Last-Event-ID`
      // resumes after the last activity a reconnecting client saw (ULIDs sort by id).
      const lastEventId = c.req.header('last-event-id');
      const terminal = new Set(['completed', 'failed', 'canceled']);
      return streamSSE(c, async (stream) => {
        let lastSeen = lastEventId ?? '';
        const replay = activities.filter((activity) => !lastSeen || activity.id > lastSeen);
        if (replay.length > 0) {
          // A finite replay is one atomic stream write. This prevents an in-memory/test reader
          // from observing EOF between queued frames when a terminal session is under load.
          await stream.write(
            replay
              .map(
                (activity) =>
                  `event: ${activity.type}\ndata: ${JSON.stringify(toActivityOut(activity))}\nid: ${activity.id}\n\n`,
              )
              .join(''),
          );
          lastSeen = replay.at(-1)?.id ?? lastSeen;
        }
        let status = sessionRows[0]?.status ?? 'completed';
        let sincePing = 0;
        while (!terminal.has(status) && !stream.aborted) {
          await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS));
          const fresh = await db
            .select()
            .from(sessionActivity)
            .where(and(eq(sessionActivity.sessionId, id), gt(sessionActivity.id, lastSeen)))
            .orderBy(asc(sessionActivity.id));
          for (const activity of fresh) {
            await stream.writeSSE({
              id: activity.id,
              event: activity.type,
              data: JSON.stringify(toActivityOut(activity)),
            });
            lastSeen = activity.id;
          }
          sincePing += STREAM_POLL_MS;
          if (sincePing >= STREAM_HEARTBEAT_MS) {
            await stream.writeSSE({ event: 'ping', data: '{}' });
            sincePing = 0;
          }
          const rows = await db
            .select({ status: agentSession.status })
            .from(agentSession)
            .where(eq(agentSession.id, id))
            .limit(1);
          status = rows[0]?.status ?? 'completed';
        }
        // Hono closes again when the callback returns, but awaiting the close here is
        // important for finite replays: it drains every queued SSE frame before the
        // in-memory/test response reader observes EOF.
        await stream.close();
      });
    },
  )
  .get(
    '/:id/proposals',
    apiDoc({
      tag: 'Agents',
      summary: 'List pending proposal groups',
      response: z.array(ProposalGroupOut),
      description: `List the session's still-\`proposed\` actions grouped by \`proposalGroupId\` (one batch per assistant turn), each member ghost-projected as {@link ProposalItemOut} — the read behind both the session proposal card ("review all N") and the workspace ghost rows. A \`create_task\` proposal carries a \`ghost\` task shape (title/team/project/dueDate) that views render as a translucent, editable row; proposals without a spatial home have \`ghost: null\` and review in the session card. Editing goes through \`PATCH /:id/activity/:activityId/proposal\`; deciding through the group approve/reject routes. Org-scoped 404 when the session is missing. A read; org membership suffices.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadSession(orgId, id);
      const groups = await listProposalGroups(orgId, id);
      return ok(c, z.array(ProposalGroupOut), groups);
    },
  )
  .post(
    '/:id/proposals/:groupId/approve',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Approve a proposal group (batch)',
      capability: 'assign',
      response: AgentSessionOut,
      description: `Approve every still-\`proposed\` action of one proposal group — or the subset named by \`activityIds\` ("approve selected") — in one transaction, then EXECUTE the approved tool calls as the agent's own Actor and resume the session so the agent hears the results. This is the batch gate behind "Approve all N" on an import: the group is one assistant turn's related creations. Per-action \`approved\` audit rows are written (approver recorded), execution stamps each action \`applied\` with its real result, and the returned {@link AgentSessionOut} reflects the session AFTER any resume (typically \`completed\` or paused on the next gate). Requires \`assign\` (the approval bar). 404 when the group has no proposed member.`,
    }),
    zParam(groupParam),
    zJson(ProposalGroupDecision.optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, groupId } = c.req.valid('param');
      const body = c.req.valid('json');
      const session = await approveGroupAndResume(
        orgId,
        actorId,
        id,
        groupId,
        'approve',
        body?.activityIds,
      );
      return ok(c, AgentSessionOut, toSessionOut(session));
    },
  )
  .post(
    '/:id/proposals/:groupId/reject',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Reject a proposal group (batch)',
      capability: 'assign',
      response: AgentSessionOut,
      description: `Reject every still-\`proposed\` action of one proposal group (or the \`activityIds\` subset) in one transaction. Nothing executes; per-action \`rejected\` audit rows are written, and — reject-and-continue — the session resumes so the agent hears each veto as an error result and adapts instead of being canceled. Returns the {@link AgentSessionOut} after any resume. Requires \`assign\`. 404 when the group has no proposed member.`,
    }),
    zParam(groupParam),
    zJson(ProposalGroupDecision.optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, groupId } = c.req.valid('param');
      const body = c.req.valid('json');
      const session = await approveGroupAndResume(
        orgId,
        actorId,
        id,
        groupId,
        'reject',
        body?.activityIds,
      );
      return ok(c, AgentSessionOut, toSessionOut(session));
    },
  )
  .patch(
    '/:id/activity/:activityId/proposal',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: "Edit a pending proposal's input",
      capability: 'assign',
      response: SessionActivityOut,
      description: `Replace the stored \`toolCall.input\` of a still-\`proposed\` action — the write behind inline ghost editing (retitle/redate a translucent row before blessing it). Approval then executes the edited input verbatim. Only \`proposed\` actions with a stored tool call are editable (409 otherwise); org-scoped 404 for a missing activity. Requires \`assign\`: shaping what will be applied is part of the approval act.`,
    }),
    zParam(activityParam),
    zJson(ProposalEditBody),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await editProposalInput(orgId, id, activityId, body.input);
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .get(
    '/:id/activity',
    apiDoc({
      tag: 'Agents',
      summary: 'List agent session activity',
      response: pageOf(SessionActivityOut),
      description: `List a session's Activity entries as a single page of {@link SessionActivityOut}, oldest-first — the JSON (non-streaming) equivalent of \`GET /:id/stream\`, suited to a plain fetch/poll rather than an \`EventSource\`. The org-scoped session must exist (404 \`Session not found\`). Each entry has a \`type\` (\`thought\`/\`action\`/\`response\`/\`elicitation\`/\`error\`) and, for \`action\` rows, an \`approvalStatus\` showing its position in the approval gate. A read; org membership suffices. To drive the gate, see the activity-scoped \`/activity/:activityId/approve|reject|reply\` routes.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadSession(orgId, id);
      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, id))
        .orderBy(asc(sessionActivity.createdAt));
      return ok(c, pageOf(SessionActivityOut), { items: activities.map(toActivityOut) });
    },
  )
  .post(
    '/:id/activity/:activityId/approve',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Approve a gated session activity',
      capability: 'assign',
      response: SessionActivityOut,
      description: `Approve a single gated \`action\` the agent has proposed, clearing the approval gate so the mutation may apply. Returns the decided {@link SessionActivityOut} (the one named by \`:activityId\`), now \`applied\`. The target must belong to this org-scoped session, be \`type='action'\`, and currently be \`proposed\` — otherwise 404 (\`Activity not found\` / \`Session not found\`) or 409 (\`Activity is not a proposed action\`).

Side effects (transactional): the activity advances \`proposed → applied\` (the gate's terminal applied state) and an \`audit_event\` (\`type='approved'\`, \`subjectType='agent_session'\`) is written with the **agent's** Actor as \`actorId\`, the session \`initiatorId\` as \`initiatorId\`, and the approved activity id + approver recorded in \`metadata\` — so the feed always shows both who acted (the agent) and who authorized it. Pass body \`{ scope: 'all_in_session' }\` to approve every still-\`proposed\` action in the session in one transaction (default \`{ scope: 'this' }\`, just the target). Once no proposed action remains, the session advances from \`awaiting_approval\` back to \`running\` so the agent can continue.

Requires \`assign\` — the approval gate is orthogonal to the \`contribute\` bar that lets a human *propose* work: clearing an agent's write is an authorization act, so a contribute-only actor must not self-approve. Related: \`/reject\` (deny), \`/reply\` (answer an elicitation instead of a gated action), and the session-level \`POST /:id/approve\` shortcut.`,
    }),
    zParam(activityParam),
    zJson(z.object({ scope: z.enum(['this', 'all_in_session']).optional() }).optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      await approveAndResume(orgId, actorId, id, activityId, {
        decision: 'approve',
        ...(body?.scope ? { scope: body.scope } : {}),
      });
      const updated = await loadActivity(orgId, id, activityId);
      await enqueueSearchUpsert(orgId, 'agent_session', id);
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reject',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Reject a gated session activity',
      capability: 'assign',
      response: SessionActivityOut,
      description: `Reject a single gated \`action\` the agent has proposed, so the mutation is **never applied**. Returns the decided {@link SessionActivityOut} (named by \`:activityId\`), now \`rejected\`. Same preconditions as approve: the target must belong to the org-scoped session, be \`type='action'\`, and be \`proposed\` (else 404 or 409 \`Activity is not a proposed action\`).

Side effects (transactional): the activity becomes \`rejected\` (no apply) and a \`type='rejected'\` \`audit_event\` is written attributing the agent as \`actorId\`, the session \`initiatorId\`, and the rejecting approver in \`metadata\`. Pass \`{ scope: 'all_in_session' }\` to reject every still-\`proposed\` action at once (default \`{ scope: 'this' }\`). When no proposed action remains after a rejection, the session is moved to \`canceled\` (stamping \`endedAt\`) — a rejection ends the run rather than resuming it.

Requires \`assign\`: vetoing an agent's proposed write is an authorization act, the same bar as approving. Related: \`/approve\` (allow), \`/reply\` (answer an elicitation), and the session-level \`POST /:id/reject\` shortcut.`,
    }),
    zParam(activityParam),
    zJson(z.object({ scope: z.enum(['this', 'all_in_session']).optional() }).optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      await approveAndResume(orgId, actorId, id, activityId, {
        decision: 'reject',
        ...(body?.scope ? { scope: body.scope } : {}),
      });
      const updated = await loadActivity(orgId, id, activityId);
      await enqueueSearchUpsert(orgId, 'agent_session', id);
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reply',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Reply to a session elicitation',
      capability: 'contribute',
      response: SessionActivityOut,
      description: `Answer an agent's \`elicitation\` (a mid-run question the agent asked the human) by appending a human \`response\` activity carrying the reply \`body\`, and return that new {@link SessionActivityOut}. The referenced \`:activityId\` must be an \`elicitation\` belonging to this org-scoped session — otherwise 404 (\`Activity not found\` / \`Session not found\`) or 409 (\`Activity is not an elicitation\`).

Side effect: when the session was parked in \`awaiting_input\` it is resumed to \`running\` so the agent can continue with the answer; if it was already running the reply is simply recorded into the stream. This is distinct from the approval gate — replying *steers/answers* the agent, whereas approve/reject *authorizes or vetoes a proposed write* — which is why this is a \`contribute\` act (participating in the conversation) rather than the \`assign\`-level approval bar. Related: \`/approve\` & \`/reject\` (for gated actions), and \`POST /:id/resume\` (resume without a textual answer).`,
    }),
    zParam(activityParam),
    zJson(SessionReplyBody),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      const created = await replyToElicitation(orgId, id, activityId, body.body);
      // Resume-on-user-message: when the reply un-parked the session and the loop owns
      // it (a transcript exists), drive it forward — the reconcile step feeds the reply
      // to the model as the ask_user tool result.
      const replySession = await db
        .select({ status: agentSession.status })
        .from(agentSession)
        .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
        .limit(1);
      if (replySession[0]?.status === 'running' && (await loadTranscript(db, id)).length > 0) {
        await driveSession(orgId, id);
      }
      await enqueueSearchUpsert(orgId, 'agent_session', id);
      return ok(c, SessionActivityOut, toActivityOut(created));
    },
  )
  .post(
    '/:id/pause',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Pause an agent session',
      capability: 'contribute',
      response: AgentSessionOut,
      description: `Pause a \`running\` session, transitioning it to \`awaiting_input\` and returning the updated {@link AgentSessionOut}. Only a \`running\` session may be paused; any other state yields 409 (\`Session is not running\`), and a missing/cross-tenant id 404. Pausing parks the session pending human attention without ending it; \`POST /:id/resume\` returns it to \`running\`. Requires \`contribute\` (steering an in-flight run is a contribution act, not an authorization one). Related: \`/resume\`, \`/cancel\` (terminal stop), and \`/activity/:activityId/reply\` (which also resumes an \`awaiting_input\` session when it carries an answer).`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await transitionLifecycle(orgId, id, 'pause');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    '/:id/resume',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Resume an agent session',
      capability: 'contribute',
      response: AgentSessionOut,
      description: `Resume a session that is parked in \`awaiting_input\`, transitioning it back to \`running\` and returning the updated {@link AgentSessionOut}. Only an \`awaiting_input\` session may be resumed; any other state yields 409 (\`Session is not awaiting input\`), and a missing/cross-tenant id 404. This is the inverse of \`POST /:id/pause\`. Note resuming does not by itself re-drive the runtime — use \`POST /:id/run\` to continue consuming the activity stream — and that replying to an elicitation via \`/activity/:activityId/reply\` resumes automatically. Requires \`contribute\`. Related: \`/pause\`, \`/cancel\`.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await transitionLifecycle(orgId, id, 'resume');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    '/:id/cancel',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Cancel an agent session',
      capability: 'contribute',
      response: AgentSessionOut,
      description: `Cancel a session, driving it to the terminal \`canceled\` state (stamping \`endedAt\`) and returning the updated {@link AgentSessionOut}. Any non-terminal session may be canceled; a session already in a terminal state (\`completed\`/\`failed\`/\`canceled\`) yields 409 (\`Session is already in a terminal state\`), and a missing/cross-tenant id 404. Cancellation is final — unlike pause, it cannot be resumed, and any still-\`proposed\` gated actions are abandoned (never applied). Requires \`contribute\`. Related: \`/pause\` (recoverable stop), and the reject routes (which can also cancel a session by vetoing its last proposed action).`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await transitionLifecycle(orgId, id, 'cancel');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    // Approving/rejecting an agent's proposed write is an `assign`-level act (permissions
    // §9.3; api-rpc-contract `POST /:sessionId/approvals/:activityId` → org:assign), the
    // same bar as the activity-scoped approval routes above. A contribute-only actor must
    // not clear an agent's gated action via this legacy session-level shortcut.
    '/:id/approve',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Approve a session-level proposed action',
      capability: 'assign',
      response: AgentSessionOut,
      description: `Legacy session-level approval shortcut: approve the session's **latest** \`proposed\` action and move the session forward, returning the updated {@link AgentSessionOut}. Unlike the activity-scoped \`/activity/:activityId/approve\`, this does not name a specific activity — it flips the most recent proposed action to \`approved\` and transitions the session from \`awaiting_approval\` to \`running\`. The session must be \`awaiting_approval\` (else 409 \`Session is not awaiting approval\`) with a proposed action present (else 409 \`No proposed action awaiting approval\`); a missing/cross-tenant id 404. The body is an empty object.

Requires \`assign\` — the same authorization bar as the activity-scoped route: clearing an agent's proposed write is an authorization act (permissions §9.3; the contract maps \`POST /:sessionId/approvals/:activityId\` → \`org:assign\`), so a contribute-only actor must not clear a gate via this shortcut. Prefer the activity-scoped \`/activity/:activityId/approve\` (which writes a richer audit event and supports \`scope: 'all_in_session'\`); this route remains for the simple single-gate case. Related: \`POST /:id/reject\`.`,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await resolveAction(orgId, id, 'approved');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    // See `/:id/approve`: rejecting a proposed action is likewise an `assign`-level act.
    '/:id/reject',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Reject a session-level proposed action',
      capability: 'assign',
      response: AgentSessionOut,
      description: `Legacy session-level rejection shortcut: reject the session's **latest** \`proposed\` action and move the session to \`canceled\` (stamping \`endedAt\`), returning the updated {@link AgentSessionOut}. The session must be \`awaiting_approval\` (else 409 \`Session is not awaiting approval\`) with a proposed action present (else 409 \`No proposed action awaiting approval\`); a missing/cross-tenant id 404. The body is an empty object.

Requires \`assign\` — rejecting a proposed write is likewise an authorization act, the same bar as approving. Prefer the activity-scoped \`/activity/:activityId/reject\` (richer audit event, \`scope\` support); this remains for the simple single-gate case. Related: \`POST /:id/approve\`.`,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await resolveAction(orgId, id, 'rejected');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  );

export default agentSessions;
