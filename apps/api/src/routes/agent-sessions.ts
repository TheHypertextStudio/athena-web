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
import { ok } from '../lib/ok';
import { apiDoc, describeRoute } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchUpsert } from '../search/write-through';

import {
  activityParam,
  idParam,
  listSessionAccess,
  listQuery,
  loadSessionAccess,
  requestUserId,
  toActivityOut,
  toSessionOut,
  transitionLifecycle,
  loadActivity,
} from './agent-session-helpers';
import { createAndRunFromPrompt, runSession } from './agent-session-runner';
import { replyToElicitation, resolveAction } from './agent-session-approval';
import { approveAndResume, approveGroupAndResume, driveSession } from '../agent/loop';
import { editProposalInput, listProposalGroups } from '../agent/proposals';
import { loadTranscript, saveTranscript } from '../agent/transcript';

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
      const { status } = c.req.valid('query');
      const rows = await listSessionAccess(c, status);
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

Behavior: the session binds to the supplied \`agentId\` (validated to be a registered agent in this workspace, else 404 \`Agent not found\`) or, when omitted, to the caller's personal Athena executor. Athena stores the caller's user id as owner and this workspace only as context; no workspace agent or grant is created. The prompt is persisted as the session's first \`response\` activity (there is no schema brief column) and threaded through as the runtime task brief. \`trigger\` is recorded as \`delegation\`, and the caller becomes the session \`initiatorId\`.

Side effects: dispatches the executor against the runtime; each yielded activity is persisted and streams live over \`GET /:id/stream\`. Athena resolves the owner's current human Actor and permissions on every Docket call; a registered agent retains its own Actor. The approval gate may delay a call but never grants missing authority. Requires \`contribute\`. Related: \`POST /:id/run\`, the activity approve/reject/reply routes, and the pause/resume/cancel lifecycle routes.`,
    }),
    zJson(SessionFromPromptBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const ownerUserId = requestUserId(c);
      const { prompt, agentId } = c.req.valid('json');
      const settled = await createAndRunFromPrompt(orgId, actorId, prompt, agentId, ownerUserId);
      await enqueueSearchUpsert(orgId, 'agent_session', settled.id);
      return ok(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .get(
    '/chat',
    apiDoc({
      tag: 'Agents',
      summary: "Get (or create) the user's Athena chat thread",
      response: AgentSessionDetailOut,
      description: `Return the caller's persistent personal Athena session (\`kind: 'chat'\`) with its full activity stream, creating it on first use and focusing it on the current workspace context. The thread belongs to the user and uses the same loop, transcript, toolbox, and approval gate as delegated work. No workspace agent or grant is created. This workspace route is a temporary compatibility door pending the personal Athena API.`,
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
      const session = await getOrCreateChatSession(orgId, actorId, requestUserId(c));

      await db.insert(sessionActivity).values({
        sessionId: session.id,
        organizationId: session.executorKind === 'athena' ? null : orgId,
        type: 'response',
        body: { text: body.body, author: 'user' },
      });
      const messages = await loadTranscript(db, session.id);
      await saveTranscript(
        db,
        session.id,
        session.executorKind === 'athena' ? null : orgId,
        [...messages, { role: 'user', content: [{ type: 'text', text: body.body }] }],
        session.ownerUserId,
      );
      // A chat thread is never "done": terminal statuses just mean idle, so a new
      // message re-opens it for the loop (pending stays pending — first run gates
      // entitlement there).
      if (session.status !== 'pending' && session.status !== 'running') {
        await db
          .update(agentSession)
          .set({ status: 'running' })
          .where(eq(agentSession.id, session.id));
      }
      const settled = await driveSession(orgId, session.id);

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
      const ownerUserId = requestUserId(c);
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
      const { id } = c.req.valid('param');
      const { session: row } = await loadSessionAccess(c, id);
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
      tag: 'Agents',
      summary: 'Run an agent session',
      response: AgentSessionOut,
      description: `Run (or resume execution of) an existing session against the agent runtime and return the **settled** {@link AgentSessionOut}. Only a session in a *runnable* state — \`pending\` (created but not yet dispatched, e.g. a proactively drafted plan) or \`running\` — may be run; any other state (terminal, or parked awaiting human input/approval) yields 409 (\`Session is not in a runnable state\`). A missing/cross-tenant id returns 404, and a session whose agent has since been deregistered returns 404 (\`Agent not found\`).

Behavior & side effects: derives the task brief (a linked task's title, else the session's seed \`response\` prompt), flips the session to \`running\` (stamping \`startedAt\` on first run), then consumes the runtime's activity stream — persisting one {@link SessionActivityOut} per yielded activity and stamping \`proposed\` on gated actions. When the stream ends the session settles to \`awaiting_approval\` if any proposed action remains unresolved, otherwise \`completed\` (stamping \`endedAt\`). Activities stream live to \`GET /:id/stream\`. Personal Athena work requires its authenticated owner; registered-agent work requires \`contribute\`. The body is an empty object. Related: \`POST /\` (create-and-run from a prompt), the approve/reject routes to clear an \`awaiting_approval\` gate.`,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadSessionAccess(c, id, 'contribute');
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
      const { id } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id);
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
        let status = session.status;
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
      const { id } = c.req.valid('param');
      await loadSessionAccess(c, id);
      const groups = await listProposalGroups(id);
      return ok(c, z.array(ProposalGroupOut), groups);
    },
  )
  .post(
    '/:id/proposals/:groupId/approve',
    apiDoc({
      tag: 'Agents',
      summary: 'Approve a proposal group (batch)',
      response: AgentSessionOut,
      description: `Approve every still-\`proposed\` action of one proposal group — or the subset named by \`activityIds\` — then execute each stored tool call through the persisted executor and resume the session. Athena requires its authenticated owner and re-resolves that owner's current human Actor and permissions for every call; registered-agent work requires \`assign\`. Approval never supplies missing authority. Execution stores the real result and returns the session after any resume.`,
    }),
    zParam(groupParam),
    zJson(ProposalGroupDecision.optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, groupId } = c.req.valid('param');
      await loadSessionAccess(c, id, 'assign');
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
    apiDoc({
      tag: 'Agents',
      summary: 'Reject a proposal group (batch)',
      response: AgentSessionOut,
      description: `Reject every still-\`proposed\` action of one proposal group (or the \`activityIds\` subset) in one transaction. Nothing executes; per-action \`rejected\` audit rows are written, and — reject-and-continue — the session resumes so the agent hears each veto as an error result and adapts instead of being canceled. Athena requires its authenticated owner; registered-agent work requires \`assign\`. Returns the {@link AgentSessionOut} after any resume. 404 when the group has no proposed member.`,
    }),
    zParam(groupParam),
    zJson(ProposalGroupDecision.optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, groupId } = c.req.valid('param');
      await loadSessionAccess(c, id, 'assign');
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
    apiDoc({
      tag: 'Agents',
      summary: "Edit a pending proposal's input",
      response: SessionActivityOut,
      description: `Replace the stored \`toolCall.input\` of a still-\`proposed\` action — the write behind inline ghost editing (retitle/redate a translucent row before blessing it). Approval then executes the edited input verbatim. Only \`proposed\` actions with a stored tool call are editable (409 otherwise); missing or private work returns 404. Athena requires its authenticated owner; registered-agent work requires \`assign\`.`,
    }),
    zParam(activityParam),
    zJson(ProposalEditBody),
    async (c) => {
      const { id, activityId } = c.req.valid('param');
      await loadSessionAccess(c, id, 'assign');
      const body = c.req.valid('json');
      const updated = await editProposalInput(id, activityId, body.input);
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
      const { id } = c.req.valid('param');
      await loadSessionAccess(c, id);
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
    apiDoc({
      tag: 'Agents',
      summary: 'Approve a gated session activity',
      response: SessionActivityOut,
      description: `Approve a single gated \`action\` the agent has proposed, clearing the approval gate so the mutation may apply. Returns the decided {@link SessionActivityOut} (the one named by \`:activityId\`), now \`applied\`. The target must belong to this org-scoped session, be \`type='action'\`, and currently be \`proposed\` — otherwise 404 (\`Activity not found\` / \`Session not found\`) or 409 (\`Activity is not a proposed action\`).

Side effects (transactional): the activity advances \`proposed → applied\` (the gate's terminal applied state) and an \`audit_event\` (\`type='approved'\`, \`subjectType='agent_session'\`) is written with the **agent's** Actor as \`actorId\`, the session \`initiatorId\` as \`initiatorId\`, and the approved activity id + approver recorded in \`metadata\` — so the feed always shows both who acted (the agent) and who authorized it. Pass body \`{ scope: 'all_in_session' }\` to approve every still-\`proposed\` action in the session in one transaction (default \`{ scope: 'this' }\`, just the target). Once no proposed action remains, the session advances from \`awaiting_approval\` back to \`running\` so the agent can continue.

Athena approval requires the authenticated owner; registered-agent approval requires \`assign\`. The stored tool still rechecks the Athena owner's current permissions when it executes. Related: \`/reject\` (deny), \`/reply\` (answer an elicitation instead of a gated action), and the session-level \`POST /:id/approve\` shortcut.`,
    }),
    zParam(activityParam),
    zJson(z.object({ scope: z.enum(['this', 'all_in_session']).optional() }).optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      await loadSessionAccess(c, id, 'assign');
      const body = c.req.valid('json');
      await approveAndResume(orgId, actorId, id, activityId, {
        decision: 'approve',
        ...(body?.scope ? { scope: body.scope } : {}),
      });
      const updated = await loadActivity(id, activityId);
      await enqueueSearchUpsert(orgId, 'agent_session', id);
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reject',
    apiDoc({
      tag: 'Agents',
      summary: 'Reject a gated session activity',
      response: SessionActivityOut,
      description: `Reject a single gated \`action\` the agent has proposed, so the mutation is **never applied**. Returns the decided {@link SessionActivityOut} (named by \`:activityId\`), now \`rejected\`. Same preconditions as approve: the target must belong to the org-scoped session, be \`type='action'\`, and be \`proposed\` (else 404 or 409 \`Activity is not a proposed action\`).

Side effects (transactional): the activity becomes \`rejected\` (no apply) and a \`type='rejected'\` \`audit_event\` is written attributing the agent as \`actorId\`, the session \`initiatorId\`, and the rejecting approver in \`metadata\`. Pass \`{ scope: 'all_in_session' }\` to reject every still-\`proposed\` action at once (default \`{ scope: 'this' }\`). When no proposed action remains after a rejection, the session is moved to \`canceled\` (stamping \`endedAt\`) — a rejection ends the run rather than resuming it.

Athena rejection requires the authenticated owner; registered-agent rejection requires \`assign\`. Related: \`/approve\` (allow), \`/reply\` (answer an elicitation), and the session-level \`POST /:id/reject\` shortcut.`,
    }),
    zParam(activityParam),
    zJson(z.object({ scope: z.enum(['this', 'all_in_session']).optional() }).optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      await loadSessionAccess(c, id, 'assign');
      const body = c.req.valid('json');
      await approveAndResume(orgId, actorId, id, activityId, {
        decision: 'reject',
        ...(body?.scope ? { scope: body.scope } : {}),
      });
      const updated = await loadActivity(id, activityId);
      await enqueueSearchUpsert(orgId, 'agent_session', id);
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reply',
    apiDoc({
      tag: 'Agents',
      summary: 'Reply to a session elicitation',
      response: SessionActivityOut,
      description: `Answer an agent's \`elicitation\` (a mid-run question the agent asked the human) by appending a human \`response\` activity carrying the reply \`body\`, and return that new {@link SessionActivityOut}. The referenced \`:activityId\` must be an \`elicitation\` belonging to this org-scoped session — otherwise 404 (\`Activity not found\` / \`Session not found\`) or 409 (\`Activity is not an elicitation\`).

Side effect: when the session was parked in \`awaiting_input\` it is resumed to \`running\` so the agent can continue with the answer; if it was already running the reply is simply recorded into the stream. Athena requires its authenticated owner; registered-agent work requires \`contribute\`. Related: \`/approve\` & \`/reject\` (for gated actions), and \`POST /:id/resume\` (resume without a textual answer).`,
    }),
    zParam(activityParam),
    zJson(SessionReplyBody),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      await loadSessionAccess(c, id, 'contribute');
      const body = c.req.valid('json');
      const created = await replyToElicitation(orgId, id, activityId, body.body);
      // Resume-on-user-message: when the reply un-parked the session and the loop owns
      // it (a transcript exists), drive it forward — the reconcile step feeds the reply
      // to the model as the ask_user tool result.
      const replySession = await db
        .select({ status: agentSession.status })
        .from(agentSession)
        .where(eq(agentSession.id, id))
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
      tag: 'Agents',
      summary: 'Resume an agent session',
      response: AgentSessionOut,
      description: `Resume a session that is parked in \`awaiting_input\`, transitioning it back to \`running\` and returning the updated {@link AgentSessionOut}. Only an \`awaiting_input\` session may be resumed; any other state yields 409 (\`Session is not awaiting input\`), and missing or private work returns 404. This is the inverse of \`POST /:id/pause\`. Athena requires its authenticated owner; registered-agent work requires \`contribute\`. Note resuming does not by itself re-drive the runtime — use \`POST /:id/run\` to continue consuming the activity stream. Related: \`/pause\`, \`/cancel\`.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { session } = await loadSessionAccess(c, id, 'contribute');
      const updated = await transitionLifecycle(session, 'resume');
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
      const updated = await transitionLifecycle(session, 'cancel');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    // Athena decisions belong only to the authenticated owner; conventional registered-agent
    // decisions retain the assign-level compatibility policy.
    '/:id/approve',
    apiDoc({
      tag: 'Agents',
      summary: 'Approve a session-level proposed action',
      response: AgentSessionOut,
      description: `Legacy session-level approval shortcut: approve the session's **latest** \`proposed\` action and move the session forward, returning the updated {@link AgentSessionOut}. Unlike the activity-scoped \`/activity/:activityId/approve\`, this does not name a specific activity — it flips the most recent proposed action to \`approved\` and transitions the session from \`awaiting_approval\` to \`running\`. The session must be \`awaiting_approval\` (else 409 \`Session is not awaiting approval\`) with a proposed action present (else 409 \`No proposed action awaiting approval\`); a missing/cross-tenant id 404. The body is an empty object.

Athena requires its authenticated owner and reauthorizes the stored tool with that owner's current permissions; registered-agent work requires \`assign\`. Prefer the activity-scoped \`/activity/:activityId/approve\` for richer audit data and scope control. Related: \`POST /:id/reject\`.`,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadSessionAccess(c, id, 'assign');
      const updated = await resolveAction(orgId, id, 'approved');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    // See `/:id/approve` for the executor-specific decision policy.
    '/:id/reject',
    apiDoc({
      tag: 'Agents',
      summary: 'Reject a session-level proposed action',
      response: AgentSessionOut,
      description: `Legacy session-level rejection shortcut: reject the session's **latest** \`proposed\` action and move the session to \`canceled\` (stamping \`endedAt\`), returning the updated {@link AgentSessionOut}. The session must be \`awaiting_approval\` (else 409 \`Session is not awaiting approval\`) with a proposed action present (else 409 \`No proposed action awaiting approval\`); a missing/cross-tenant id 404. The body is an empty object.

Athena requires its authenticated owner; registered-agent work requires \`assign\`. Prefer the activity-scoped \`/activity/:activityId/reject\` for richer audit data and scope control. Related: \`POST /:id/approve\`.`,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadSessionAccess(c, id, 'assign');
      const updated = await resolveAction(orgId, id, 'rejected');
      await enqueueSearchUpsert(orgId, 'agent_session', updated.id);
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  );

export default agentSessions;
