/** Caller-owned Athena API mounted at `/v1/me/athena`. */
import { agentSession, db, sessionActivity } from '@docket/db';
import {
  AthenaFreshChatBody,
  AthenaMessageBody,
  AthenaOverviewOut,
  AthenaSessionCreateBody,
  AthenaSessionDetailOut,
  AthenaSessionSummaryOut,
  pageOf,
  ProposalEditBody,
  ProposalGroupDecision,
  ProposalGroupOut,
  SessionActivityOut,
} from '@docket/types';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import {
  admitAthenaGeneration,
  asynchronousRunnerEnabled,
  persistWaitingAthenaWake,
  queueWaitingAthenaWake,
  wakeWaitingAthenaGeneration,
} from '../agent/async-runner';
import {
  approveAndResume,
  approveGroupAndResume,
  approveLatestAndResume,
  driveSessionAfterMessage,
  resumeSessionExecution,
} from '../agent/loop';
import { editProposalInput, listProposalGroups } from '../agent/proposals';
import { loadTranscript, saveTranscript } from '../agent/transcript';
import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc, describeRoute } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

import { decideActivity, decideProposalGroup, replyToElicitation } from './agent-session-approval';
import {
  activityParam,
  idParam,
  loadActivity,
  toActivityOut,
  transitionLifecycle,
  type SessionRow,
} from './agent-session-helpers';
import { runSession } from './agent-session-runner';
import { resolveAthenaInvocation } from './me-athena-context';

/** SSE live-tail poll cadence (DB-backed and restart-safe). */
const STREAM_POLL_MS = 750;
/** SSE heartbeat cadence for idle proxy connections. */
const STREAM_HEARTBEAT_MS = 15_000;
/** Route params for proposal-group decisions. */
const groupParam = z.object({ id: z.string(), groupId: z.string() });
/** Optional activity decision scope. */
const activityDecisionBody = z.object({ scope: z.enum(['this', 'all_in_session']).optional() });

/** Return the request-authenticated owner id; bodies never participate in ownership. */
function requestOwner(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError();
  return userId;
}

/** Validate and return an asynchronous mutation acknowledgement. */
function accepted<T extends z.ZodType>(c: Context<AppEnv>, schema: T, data: z.input<T>) {
  return c.json(schema.parse(data), 202);
}

/** Load one personal Athena session by persisted owner, hiding every mismatch. */
async function loadOwnedSession(ownerUserId: string, id: string): Promise<SessionRow> {
  const rows = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.id, id),
        eq(agentSession.executorKind, 'athena'),
        eq(agentSession.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Session not found');
  return rows[0];
}

/** List every caller-owned Athena session, newest first. */
async function listOwnedSessions(ownerUserId: string): Promise<SessionRow[]> {
  return db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.executorKind, 'athena'), eq(agentSession.ownerUserId, ownerUserId)))
    .orderBy(desc(agentSession.createdAt));
}

/** Product queue grouping for durable lifecycle states. */
function queueState(status: SessionRow['status']): 'needs_you' | 'working' | 'finished' {
  if (status === 'awaiting_input' || status === 'awaiting_approval') return 'needs_you';
  if (status === 'pending' || status === 'running') return 'working';
  return 'finished';
}

/** Read the user objective and newest persisted invocation context from activity rows. */
function activityMetadata(activities: readonly (typeof sessionActivity.$inferSelect)[]): {
  readonly objective: string | null;
  readonly context: z.input<typeof AthenaSessionSummaryOut>['context'];
} {
  const objective = activities.find(
    (row) =>
      row.type === 'response' && typeof row.body.text === 'string' && row.body.text.length > 0,
  )?.body.text;
  const context = [...activities].reverse().find((row) => row.body.context)?.body.context ?? null;
  return { objective: objective ?? null, context };
}

/** Convert one owned session and its activities into the personal response contract. */
function personalSummary(
  session: SessionRow,
  activities: readonly (typeof sessionActivity.$inferSelect)[],
): z.input<typeof AthenaSessionSummaryOut> {
  const metadata = activityMetadata(activities);
  return {
    id: session.id,
    kind: session.kind,
    status: session.status,
    queueState: queueState(session.status),
    objective: metadata.objective,
    context:
      metadata.context ??
      (session.contextOrganizationId ? { workspaceId: session.contextOrganizationId } : null),
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
  };
}

/** Load ordered activities for one personal session. */
async function sessionActivities(id: string): Promise<(typeof sessionActivity.$inferSelect)[]> {
  return db
    .select()
    .from(sessionActivity)
    .where(eq(sessionActivity.sessionId, id))
    .orderBy(asc(sessionActivity.createdAt), asc(sessionActivity.id));
}

/** Personal surfaces never expose provider reasoning rows. */
function visibleActivities(
  activities: readonly (typeof sessionActivity.$inferSelect)[],
): (typeof sessionActivity.$inferSelect)[] {
  return activities.filter((activity) => activity.type !== 'thought');
}

/** Resume after an exact persisted event id without assuming same-millisecond ULID randomness. */
function activitiesAfter(
  activities: readonly (typeof sessionActivity.$inferSelect)[],
  lastSeen: string,
): (typeof sessionActivity.$inferSelect)[] {
  if (!lastSeen) return [...activities];
  const index = activities.findIndex((activity) => activity.id === lastSeen);
  return index >= 0
    ? activities.slice(index + 1)
    : activities.filter((activity) => activity.id > lastSeen);
}

/** Build one detail response after a mutation may have settled execution. */
async function personalDetail(
  ownerUserId: string,
  id: string,
): Promise<z.input<typeof AthenaSessionDetailOut>> {
  const session = await loadOwnedSession(ownerUserId, id);
  const activities = await sessionActivities(id);
  return {
    ...personalSummary(session, activities),
    activities: visibleActivities(activities).map(toActivityOut),
  };
}

/** Build grouped personal work and counts without exposing registered-agent rows. */
async function overview(ownerUserId: string): Promise<z.input<typeof AthenaOverviewOut>> {
  const rows = await listOwnedSessions(ownerUserId);
  const summaries = await Promise.all(
    rows.map(async (row) => personalSummary(row, await sessionActivities(row.id))),
  );
  const sessions = {
    needsYou: summaries.filter((row) => row.queueState === 'needs_you'),
    working: summaries.filter((row) => row.queueState === 'working'),
    finished: summaries.filter((row) => row.queueState === 'finished'),
  };
  const current = summaries.find((row) => rows.find((item) => item.id === row.id)?.kind === 'chat');
  return {
    counts: {
      needsYou: sessions.needsYou.length,
      working: sessions.working.length,
      finished: sessions.finished.length,
    },
    currentChat: current ?? null,
    sessions,
  };
}

/** Create a private chat row, optionally carrying validated workspace focus. */
async function createChat(
  ownerUserId: string,
  context?: z.input<typeof AthenaFreshChatBody>['context'],
): Promise<SessionRow> {
  const invocation = await resolveAthenaInvocation(ownerUserId, context);
  const [created] = await db
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      contextOrganizationId: invocation.context?.workspaceId ?? null,
      kind: 'chat',
      trigger: 'delegation',
      status: 'pending',
      initiatorId: invocation.actorId,
    })
    .returning();
  if (!created) throw new Error('chat session insert returned no row');
  return created;
}

/** Load the newest personal chat, creating the first one lazily. */
async function currentChat(ownerUserId: string): Promise<SessionRow> {
  const rows = await db
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
  return rows[0] ?? createChat(ownerUserId);
}

/** Append a human message to activity and the durable provider transcript. */
async function appendMessage(
  session: SessionRow,
  body: z.input<typeof AthenaMessageBody>,
  ownerUserId: string,
): Promise<SessionRow> {
  const invocation = await resolveAthenaInvocation(ownerUserId, body.context);
  const context = invocation.context;
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, session.id))
      .for('update');
    if (locked?.ownerUserId !== ownerUserId || locked.executorKind !== 'athena') {
      throw new NotFoundError('Session not found');
    }
    let current = locked;
    if (context?.workspaceId && context.workspaceId !== locked.contextOrganizationId) {
      const [focused] = await tx
        .update(agentSession)
        .set({ contextOrganizationId: context.workspaceId, initiatorId: invocation.actorId })
        .where(eq(agentSession.id, session.id))
        .returning();
      if (!focused) throw new Error('session focus update returned no row');
      current = focused;
    }
    await tx.insert(sessionActivity).values({
      sessionId: session.id,
      organizationId: null,
      type: 'response',
      body: {
        text: body.body,
        author: 'user',
        ...(context ? { context } : {}),
      },
    });
    const messages = await loadTranscript(tx, session.id);
    await saveTranscript(
      tx,
      session.id,
      null,
      [...messages, { role: 'user', content: [{ type: 'text', text: body.body }] }],
      ownerUserId,
    );
    if (asynchronousRunnerEnabled() && current.status === 'awaiting_input') {
      await persistWaitingAthenaWake(tx, current.id);
    }
    return current;
  });
}

/** Load the latest still-proposed action in deterministic activity order. */
async function latestProposedAction(
  sessionId: string,
): Promise<typeof sessionActivity.$inferSelect> {
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'action'),
        eq(sessionActivity.approvalStatus, 'proposed'),
      ),
    )
    .orderBy(desc(sessionActivity.createdAt), desc(sessionActivity.id))
    .limit(1);
  if (!rows[0]) throw new ConflictError('No proposed action awaiting approval');
  return rows[0];
}

/** Reopen eligible work after a steering message through the configured execution path. */
async function driveAfterMessage(session: SessionRow): Promise<'sync' | 'async' | 'parked'> {
  if (session.status === 'awaiting_approval' || session.status === 'canceled') return 'parked';
  if (asynchronousRunnerEnabled()) {
    if (session.status === 'awaiting_input') {
      await wakeWaitingAthenaGeneration(session.id);
    } else {
      await admitAthenaGeneration(session, {
        runnableStatuses: ['pending', 'running', 'completed', 'failed'],
        clearEndedAt: true,
      });
    }
    return 'async';
  }
  await driveSessionAfterMessage(session.contextOrganizationId ?? '', session.id);
  return 'sync';
}

/** Stream replay plus a DB-polled live tail until terminal state. */
async function streamOwnedActivity(c: Context<AppEnv>, session: SessionRow) {
  const existing = visibleActivities(await sessionActivities(session.id));
  const lastEventId = c.req.header('last-event-id');
  const terminal = new Set(['completed', 'failed', 'canceled']);
  return streamSSE(c, async (stream) => {
    let lastSeen = lastEventId ?? '';
    const replay = activitiesAfter(existing, lastSeen);
    for (const activity of replay) {
      await stream.writeSSE({
        id: activity.id,
        event: activity.type,
        data: JSON.stringify(toActivityOut(activity)),
      });
      lastSeen = activity.id;
    }
    if (terminal.has(session.status)) return;
    let lastHeartbeat = Date.now();
    for (;;) {
      if (stream.aborted) return;
      const fresh = activitiesAfter(
        visibleActivities(await sessionActivities(session.id)),
        lastSeen,
      );
      for (const activity of fresh) {
        await stream.writeSSE({
          id: activity.id,
          event: activity.type,
          data: JSON.stringify(toActivityOut(activity)),
        });
        lastSeen = activity.id;
      }
      const [state] = await db
        .select({ status: agentSession.status })
        .from(agentSession)
        .where(eq(agentSession.id, session.id))
        .limit(1);
      if (!state || terminal.has(state.status)) return;
      if (Date.now() - lastHeartbeat >= STREAM_HEARTBEAT_MS) {
        await stream.write(': heartbeat\n\n');
        lastHeartbeat = Date.now();
      }
      await stream.sleep(STREAM_POLL_MS);
    }
  });
}

/** Personal Athena routes; every handler derives ownership from the request session. */
const meAthena = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Athena',
      summary: 'Get the personal Athena overview',
      response: AthenaOverviewOut,
      description:
        'Return only the authenticated user’s Athena work, grouped into Needs you, Working, and Finished with matching counts and the current persistent chat.',
    }),
    async (c) => ok(c, AthenaOverviewOut, await overview(requestOwner(c))),
  )
  .get(
    '/chat',
    apiDoc({
      tag: 'Athena',
      summary: 'Get the current personal chat',
      response: AthenaSessionDetailOut,
      description:
        'Return the caller’s newest persistent Athena chat with ordered work-log activity, lazily creating the first private chat when none exists.',
    }),
    async (c) => {
      const owner = requestOwner(c);
      return ok(
        c,
        AthenaSessionDetailOut,
        await personalDetail(owner, (await currentChat(owner)).id),
      );
    },
  )
  .post(
    '/chat/new',
    apiDoc({
      tag: 'Athena',
      summary: 'Start a fresh personal chat',
      response: AthenaSessionDetailOut,
      description:
        'Create a fresh current Athena chat while preserving every older private chat and its history for owner-only session reads.',
    }),
    zJson(AthenaFreshChatBody),
    async (c) => {
      const owner = requestOwner(c);
      const created = await createChat(owner, c.req.valid('json').context);
      return ok(c, AthenaSessionDetailOut, await personalDetail(owner, created.id));
    },
  )
  .post(
    '/chat/messages',
    apiDoc({
      tag: 'Athena',
      summary: 'Message the current personal chat',
      response: AthenaSessionDetailOut,
      description:
        'Append a private user message to the current chat, validate optional invocation focus, and synchronously drive the existing in-process Athena runner.',
    }),
    zJson(AthenaMessageBody),
    async (c) => {
      const owner = requestOwner(c);
      const session = await currentChat(owner);
      const current = await appendMessage(session, c.req.valid('json'), owner);
      const mode = await driveAfterMessage(current);
      const detail = await personalDetail(owner, session.id);
      return mode === 'async'
        ? accepted(c, AthenaSessionDetailOut, detail)
        : ok(c, AthenaSessionDetailOut, detail);
    },
  )
  .get(
    '/sessions',
    apiDoc({
      tag: 'Athena',
      summary: 'List grouped personal Athena work',
      response: AthenaOverviewOut,
      description:
        'List every caller-owned Athena session as product-ready grouped summaries and counts; registered agents and other users never appear.',
    }),
    async (c) => ok(c, AthenaOverviewOut, await overview(requestOwner(c))),
  )
  .post(
    '/sessions',
    apiDoc({
      tag: 'Athena',
      summary: 'Create personal Athena work',
      response: AthenaSessionDetailOut,
      description:
        'Validate optional workspace/source invocation context, create caller-owned episodic work, and settle it through the existing synchronous runner.',
    }),
    zJson(AthenaSessionCreateBody),
    async (c) => {
      const owner = requestOwner(c);
      const body = c.req.valid('json');
      const invocation = await resolveAthenaInvocation(owner, body.context);
      const [created] = await db
        .insert(agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: owner,
          contextOrganizationId: invocation.context?.workspaceId ?? null,
          kind: 'job',
          trigger: 'delegation',
          status: 'pending',
          initiatorId: invocation.actorId,
        })
        .returning();
      if (!created) throw new Error('session insert returned no row');
      await db.insert(sessionActivity).values({
        sessionId: created.id,
        organizationId: null,
        type: 'response',
        body: {
          text: body.prompt,
          author: 'user',
          ...(invocation.context ? { context: invocation.context } : {}),
        },
      });
      const admission = await admitAthenaGeneration(created, { runnableStatuses: ['pending'] });
      if (admission.mode === 'sync') {
        await runSession(invocation.context?.workspaceId ?? '', created.id);
      }
      const detail = await personalDetail(owner, created.id);
      return admission.mode === 'async'
        ? accepted(c, AthenaSessionDetailOut, detail)
        : ok(c, AthenaSessionDetailOut, detail);
    },
  )
  .get(
    '/sessions/:id',
    apiDoc({
      tag: 'Athena',
      summary: 'Get personal Athena work',
      response: AthenaSessionDetailOut,
      description:
        'Return one caller-owned Athena session and its ordered application-visible work log; ownership mismatches are hidden as not found.',
    }),
    zParam(idParam),
    async (c) =>
      ok(c, AthenaSessionDetailOut, await personalDetail(requestOwner(c), c.req.valid('param').id)),
  )
  .post(
    '/sessions/:id/messages',
    apiDoc({
      tag: 'Athena',
      summary: 'Steer personal Athena work',
      response: AthenaSessionDetailOut,
      description:
        'Append an owner-authored steering message, resume eligible work through the durable transcript, and return the freshly settled private detail.',
    }),
    zParam(idParam),
    zJson(AthenaMessageBody),
    async (c) => {
      const owner = requestOwner(c);
      const session = await loadOwnedSession(owner, c.req.valid('param').id);
      const current = await appendMessage(session, c.req.valid('json'), owner);
      const mode = await driveAfterMessage(current);
      const detail = await personalDetail(owner, session.id);
      return mode === 'async'
        ? accepted(c, AthenaSessionDetailOut, detail)
        : ok(c, AthenaSessionDetailOut, detail);
    },
  )
  .post(
    '/sessions/:id/run',
    apiDoc({
      tag: 'Athena',
      summary: 'Run personal Athena work',
      response: AthenaSessionDetailOut,
      description:
        'Synchronously drive caller-owned pending or running Athena work through the current in-process runner and return its freshly settled detail.',
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const owner = requestOwner(c);
      const session = await loadOwnedSession(owner, c.req.valid('param').id);
      const admission = await admitAthenaGeneration(session, {
        runnableStatuses: ['pending', 'running'],
      });
      if (admission.mode === 'sync') {
        await runSession(session.contextOrganizationId ?? '', session.id);
      }
      const detail = await personalDetail(owner, session.id);
      return admission.mode === 'async'
        ? accepted(c, AthenaSessionDetailOut, detail)
        : ok(c, AthenaSessionDetailOut, detail);
    },
  )
  .get(
    '/sessions/:id/activity',
    apiDoc({
      tag: 'Athena',
      summary: 'List personal Athena activity',
      response: pageOf(SessionActivityOut),
      description:
        'Return the ordered JSON work log for one caller-owned Athena session; use the sibling stream route for replayable live delivery.',
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const id = c.req.valid('param').id;
      await loadOwnedSession(owner, id);
      return ok(c, pageOf(SessionActivityOut), {
        items: visibleActivities(await sessionActivities(id)).map(toActivityOut),
      });
    },
  )
  .get(
    '/sessions/:id/stream',
    describeRoute({
      tags: ['Athena'],
      summary: 'Stream personal Athena activity (SSE)',
      description:
        'Replay and live-tail only the caller-owned session activity as Server-Sent Events, resuming strictly after the standard Last-Event-ID header.',
      parameters: [
        {
          name: 'Last-Event-ID',
          in: 'header',
          required: false,
          description: 'Resume strictly after this previously received activity id.',
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: {
          description: 'Replay and live-tail activity as Server-Sent Events.',
          content: { 'text/event-stream': { schema: { type: 'string' } } },
        },
      },
    }),
    zParam(idParam),
    async (c) =>
      streamOwnedActivity(c, await loadOwnedSession(requestOwner(c), c.req.valid('param').id)),
  )
  .get(
    '/sessions/:id/proposals',
    apiDoc({
      tag: 'Athena',
      summary: 'List personal Athena proposals',
      response: pageOf(ProposalGroupOut),
      description:
        'List still-pending proposal groups for one caller-owned Athena session without exposing another user’s private review queue.',
    }),
    zParam(idParam),
    async (c) => {
      const id = c.req.valid('param').id;
      await loadOwnedSession(requestOwner(c), id);
      return ok(c, pageOf(ProposalGroupOut), { items: await listProposalGroups(id) });
    },
  )
  .patch(
    '/sessions/:id/activity/:activityId/proposal',
    apiDoc({
      tag: 'Athena',
      summary: 'Edit a personal Athena proposal',
      response: SessionActivityOut,
      description:
        'Replace the stored input of one caller-owned still-pending proposal; approval later executes exactly the edited tool input.',
    }),
    zParam(activityParam),
    zJson(ProposalEditBody),
    async (c) => {
      const owner = requestOwner(c);
      const { id, activityId } = c.req.valid('param');
      await loadOwnedSession(owner, id);
      return ok(
        c,
        SessionActivityOut,
        toActivityOut(
          await editProposalInput(id, activityId, c.req.valid('json').input, {
            athenaOwnerUserId: owner,
          }),
        ),
      );
    },
  )
  .post(
    '/sessions/:id/activity/:activityId/approve',
    apiDoc({
      tag: 'Athena',
      summary: 'Approve a personal Athena action',
      response: SessionActivityOut,
      description:
        'Let the authenticated owner clear the approval policy gate without assign capability; the stored tool still reauthorizes the owner before applying.',
    }),
    zParam(activityParam),
    zJson(activityDecisionBody.optional()),
    async (c) => {
      const owner = requestOwner(c);
      const { id, activityId } = c.req.valid('param');
      const session = await loadOwnedSession(owner, id);
      const body = c.req.valid('json');
      const decision = {
        decision: 'approve' as const,
        ...(body?.scope ? { scope: body.scope } : {}),
      };
      if (asynchronousRunnerEnabled()) {
        await decideActivity(session.contextOrganizationId ?? '', null, id, activityId, decision, {
          queueWake: true,
        });
        await wakeWaitingAthenaGeneration(id);
        return accepted(c, SessionActivityOut, toActivityOut(await loadActivity(id, activityId)));
      }
      await approveAndResume(session.contextOrganizationId ?? '', null, id, activityId, decision);
      return ok(c, SessionActivityOut, toActivityOut(await loadActivity(id, activityId)));
    },
  )
  .post(
    '/sessions/:id/activity/:activityId/reject',
    apiDoc({
      tag: 'Athena',
      summary: 'Reject a personal Athena action',
      response: SessionActivityOut,
      description:
        'Let only the authenticated owner reject one or every proposed action in the private session without applying the stored mutation.',
    }),
    zParam(activityParam),
    zJson(activityDecisionBody.optional()),
    async (c) => {
      const owner = requestOwner(c);
      const { id, activityId } = c.req.valid('param');
      const session = await loadOwnedSession(owner, id);
      const body = c.req.valid('json');
      const decision = {
        decision: 'reject' as const,
        ...(body?.scope ? { scope: body.scope } : {}),
      };
      if (asynchronousRunnerEnabled()) {
        await decideActivity(session.contextOrganizationId ?? '', null, id, activityId, decision, {
          queueWake: true,
        });
        await wakeWaitingAthenaGeneration(id);
        return accepted(c, SessionActivityOut, toActivityOut(await loadActivity(id, activityId)));
      }
      await approveAndResume(session.contextOrganizationId ?? '', null, id, activityId, decision);
      return ok(c, SessionActivityOut, toActivityOut(await loadActivity(id, activityId)));
    },
  )
  .post(
    '/sessions/:id/activity/:activityId/reply',
    apiDoc({
      tag: 'Athena',
      summary: 'Reply to a personal Athena question',
      response: SessionActivityOut,
      description:
        'Append the owner’s answer to one elicitation, resume durable execution when possible, and return the new application-visible response activity.',
    }),
    zParam(activityParam),
    zJson(AthenaMessageBody),
    async (c) => {
      const owner = requestOwner(c);
      const { id, activityId } = c.req.valid('param');
      const session = await loadOwnedSession(owner, id);
      const workspaceId = session.contextOrganizationId ?? '';
      const created = await replyToElicitation(
        workspaceId,
        id,
        activityId,
        c.req.valid('json').body,
        asynchronousRunnerEnabled() ? { queueWake: true } : {},
      );
      if (asynchronousRunnerEnabled()) {
        await wakeWaitingAthenaGeneration(id);
        return accepted(c, SessionActivityOut, toActivityOut(created));
      }
      await resumeSessionExecution(workspaceId, id);
      return ok(c, SessionActivityOut, toActivityOut(created));
    },
  )
  .post(
    '/sessions/:id/proposals/:groupId/approve',
    apiDoc({
      tag: 'Athena',
      summary: 'Approve a personal proposal group',
      response: AthenaSessionDetailOut,
      description:
        'Approve all or selected pending actions in one caller-owned proposal group, reauthorize each tool, and return freshly settled work.',
    }),
    zParam(groupParam),
    zJson(ProposalGroupDecision),
    async (c) => {
      const owner = requestOwner(c);
      const { id, groupId } = c.req.valid('param');
      const session = await loadOwnedSession(owner, id);
      if (asynchronousRunnerEnabled()) {
        await decideProposalGroup(
          session.contextOrganizationId ?? '',
          null,
          id,
          groupId,
          'approve',
          c.req.valid('json').activityIds,
          { queueWake: true },
        );
        await wakeWaitingAthenaGeneration(id);
        return accepted(c, AthenaSessionDetailOut, await personalDetail(owner, id));
      }
      await approveGroupAndResume(
        session.contextOrganizationId ?? '',
        null,
        id,
        groupId,
        'approve',
        c.req.valid('json').activityIds,
      );
      return ok(c, AthenaSessionDetailOut, await personalDetail(owner, id));
    },
  )
  .post(
    '/sessions/:id/proposals/:groupId/reject',
    apiDoc({
      tag: 'Athena',
      summary: 'Reject a personal proposal group',
      response: AthenaSessionDetailOut,
      description:
        'Reject all or selected pending actions in one caller-owned proposal group and return the private work after durable reconciliation.',
    }),
    zParam(groupParam),
    zJson(ProposalGroupDecision),
    async (c) => {
      const owner = requestOwner(c);
      const { id, groupId } = c.req.valid('param');
      const session = await loadOwnedSession(owner, id);
      if (asynchronousRunnerEnabled()) {
        await decideProposalGroup(
          session.contextOrganizationId ?? '',
          null,
          id,
          groupId,
          'reject',
          c.req.valid('json').activityIds,
          { queueWake: true },
        );
        await wakeWaitingAthenaGeneration(id);
        return accepted(c, AthenaSessionDetailOut, await personalDetail(owner, id));
      }
      await approveGroupAndResume(
        session.contextOrganizationId ?? '',
        null,
        id,
        groupId,
        'reject',
        c.req.valid('json').activityIds,
      );
      return ok(c, AthenaSessionDetailOut, await personalDetail(owner, id));
    },
  )
  .post(
    '/sessions/:id/pause',
    apiDoc({
      tag: 'Athena',
      summary: 'Pause personal Athena work',
      response: AthenaSessionSummaryOut,
      description:
        'Pause only caller-owned running Athena work into an awaiting-input state and return the updated private summary.',
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const updated = await transitionLifecycle(
        await loadOwnedSession(owner, c.req.valid('param').id),
        'pause',
      );
      return ok(
        c,
        AthenaSessionSummaryOut,
        personalSummary(updated, await sessionActivities(updated.id)),
      );
    },
  )
  .post(
    '/sessions/:id/resume',
    apiDoc({
      tag: 'Athena',
      summary: 'Resume personal Athena work',
      response: AthenaSessionSummaryOut,
      description:
        'Resume only caller-owned Athena work that is awaiting input and return its updated private product summary.',
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const session = await loadOwnedSession(owner, c.req.valid('param').id);
      if (asynchronousRunnerEnabled()) {
        await queueWaitingAthenaWake(session.id);
        await wakeWaitingAthenaGeneration(session.id);
        const current = await loadOwnedSession(owner, session.id);
        return accepted(
          c,
          AthenaSessionSummaryOut,
          personalSummary(current, await sessionActivities(current.id)),
        );
      }
      const updated = await resumeSessionExecution(session.contextOrganizationId ?? '', session.id);
      return ok(
        c,
        AthenaSessionSummaryOut,
        personalSummary(updated, await sessionActivities(updated.id)),
      );
    },
  )
  .post(
    '/sessions/:id/cancel',
    apiDoc({
      tag: 'Athena',
      summary: 'Cancel personal Athena work',
      response: AthenaSessionSummaryOut,
      description:
        'Cancel only caller-owned non-terminal Athena work, stamp its terminal time, and return the updated private summary.',
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const session = await loadOwnedSession(owner, c.req.valid('param').id);
      const shouldWake =
        asynchronousRunnerEnabled() &&
        (session.status === 'awaiting_input' || session.status === 'awaiting_approval');
      const updated = await transitionLifecycle(
        session,
        'cancel',
        shouldWake ? { queueWake: true } : {},
      );
      if (shouldWake) {
        await wakeWaitingAthenaGeneration(session.id);
        return accepted(
          c,
          AthenaSessionSummaryOut,
          personalSummary(updated, await sessionActivities(updated.id)),
        );
      }
      return ok(
        c,
        AthenaSessionSummaryOut,
        personalSummary(updated, await sessionActivities(updated.id)),
      );
    },
  )
  .post(
    '/sessions/:id/approve',
    apiDoc({
      tag: 'Athena',
      summary: 'Approve the latest personal action',
      response: AthenaSessionSummaryOut,
      description:
        'Compatibility shortcut that lets only the owner approve the latest pending action while the underlying tool remains independently authorized.',
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const owner = requestOwner(c);
      const session = await loadOwnedSession(owner, c.req.valid('param').id);
      if (asynchronousRunnerEnabled()) {
        const action = await latestProposedAction(session.id);
        await decideActivity(
          session.contextOrganizationId ?? '',
          null,
          session.id,
          action.id,
          { decision: 'approve' },
          { queueWake: true },
        );
        await wakeWaitingAthenaGeneration(session.id);
        const current = await loadOwnedSession(owner, session.id);
        return accepted(
          c,
          AthenaSessionSummaryOut,
          personalSummary(current, await sessionActivities(current.id)),
        );
      }
      const updated = await approveLatestAndResume(
        session.contextOrganizationId ?? '',
        null,
        session.id,
      );
      return ok(
        c,
        AthenaSessionSummaryOut,
        personalSummary(updated, await sessionActivities(updated.id)),
      );
    },
  )
  .post(
    '/sessions/:id/reject',
    apiDoc({
      tag: 'Athena',
      summary: 'Reject the latest personal action',
      response: AthenaSessionSummaryOut,
      description:
        'Compatibility shortcut that lets only the owner reject the latest pending action and cancel the private session.',
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const owner = requestOwner(c);
      const session = await loadOwnedSession(owner, c.req.valid('param').id);
      const action = await latestProposedAction(session.id);
      const asynchronous = asynchronousRunnerEnabled();
      await decideActivity(
        session.contextOrganizationId ?? '',
        null,
        session.id,
        action.id,
        { decision: 'reject' },
        asynchronous ? { queueWake: true, cancelSession: true } : {},
      );
      const updated = asynchronous
        ? await loadOwnedSession(owner, session.id)
        : await transitionLifecycle(session, 'cancel');
      if (asynchronous) {
        await wakeWaitingAthenaGeneration(session.id);
        return accepted(
          c,
          AthenaSessionSummaryOut,
          personalSummary(updated, await sessionActivities(updated.id)),
        );
      }
      return ok(
        c,
        AthenaSessionSummaryOut,
        personalSummary(updated, await sessionActivities(updated.id)),
      );
    },
  );

export default meAthena;
