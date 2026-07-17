/** Caller-owned Athena API mounted at `/v1/me/athena`. */
import { agentSession, db, sessionActivity } from '@docket/db';
import {
  AthenaFreshChatBody,
  AthenaMessageBody,
  AthenaOverviewOut,
  AthenaPulseOut,
  AthenaSessionCreateBody,
  AthenaSessionDetailOut,
  AthenaSessionSummaryOut,
  pageOf,
  ProposalEditBody,
  ProposalGroupDecision,
  ProposalGroupOut,
  SessionActivityOut,
} from '@docket/types';
import type { AthenaInvocationContext } from '@docket/types';
import { and, asc, count, desc, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm';
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
import { zJson, zParam, zQuery } from '../lib/validate';

import { decideActivity, decideProposalGroup, replyToElicitation } from './agent-session-approval';
import {
  activityParam,
  idParam,
  loadActivity,
  transitionLifecycle,
  type SessionRow,
} from './agent-session-helpers';
import { toPersonalActivityOut } from './me-athena-activity';
import { runSession } from './agent-session-runner';
import {
  resolveAthenaDisplay,
  resolveAthenaDisplays,
  resolveAthenaInvocation,
} from './me-athena-context';

/** SSE live-tail poll cadence (DB-backed and restart-safe). */
const STREAM_POLL_MS = 750;
/** SSE heartbeat cadence for idle proxy connections. */
const STREAM_HEARTBEAT_MS = 15_000;
/** Default and maximum number of sessions returned in each independent overview lane. */
const OVERVIEW_LANE_LIMIT = 50;
/** Default and maximum number of visible activities returned in one history window. */
const ACTIVITY_HISTORY_LIMIT = 100;
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

const NEEDS_YOU_STATUSES = ['awaiting_input', 'awaiting_approval'] as const;
const WORKING_STATUSES = ['pending', 'running'] as const;
const FINISHED_STATUSES = ['completed', 'failed', 'canceled'] as const;

type HistoryCursorScope = 'needs_you' | 'working' | 'finished' | 'activity';

interface HistoryCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/** Encode one lane-bound `(createdAt, id)` history position as an opaque token. */
function encodeHistoryCursor(scope: HistoryCursorScope, createdAt: Date, id: string): string {
  return Buffer.from(`${scope}|${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/** Decode only a structurally valid cursor issued for the expected history lane. */
function decodeHistoryCursor(
  token: string | undefined,
  expectedScope: HistoryCursorScope,
): HistoryCursor | null {
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const parts = Buffer.from(token, 'base64url').toString('utf8').split('|');
    if (parts.length !== 3) return null;
    const [scope, rawCreatedAt, id] = parts;
    if (scope !== expectedScope || !rawCreatedAt || !id) return null;
    const createdAt = new Date(rawCreatedAt);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== rawCreatedAt) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Validate that an opaque cursor belongs to the lane where it is being consumed. */
function historyCursorSchema(scope: HistoryCursorScope) {
  return z
    .string()
    .refine((token) => decodeHistoryCursor(token, scope) !== null, 'Invalid pagination cursor');
}

/** Independent cursor inputs for the three bounded overview lanes. */
const overviewQuery = z.object({
  limit: z.coerce.number().int().min(1).max(OVERVIEW_LANE_LIMIT).default(OVERVIEW_LANE_LIMIT),
  needsYouCursor: historyCursorSchema('needs_you').optional(),
  workingCursor: historyCursorSchema('working').optional(),
  finishedCursor: historyCursorSchema('finished').optional(),
});
type OverviewQuery = z.infer<typeof overviewQuery>;

/** Backward-history query shared by detail and the JSON activity endpoint. */
const activityHistoryQuery = z.object({
  cursor: historyCursorSchema('activity').optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_HISTORY_LIMIT).default(ACTIVITY_HISTORY_LIMIT),
});
type ActivityHistoryQuery = z.infer<typeof activityHistoryQuery>;

const DEFAULT_OVERVIEW_QUERY = overviewQuery.parse({});
const DEFAULT_ACTIVITY_QUERY = activityHistoryQuery.parse({});

interface ActivityMetadata {
  readonly objective: string | null;
  readonly context: z.input<typeof AthenaInvocationContext> | null;
}

/** Product queue grouping for durable lifecycle states. */
function queueState(status: SessionRow['status']): 'needs_you' | 'working' | 'finished' {
  if (status === 'awaiting_input' || status === 'awaiting_approval') return 'needs_you';
  if (status === 'pending' || status === 'running') return 'working';
  return 'finished';
}

/** Convert bounded overview metadata to a display-safe summary. */
async function personalSummaryFromMetadata(
  ownerUserId: string,
  session: SessionRow,
  metadata: ActivityMetadata,
  resolvedDisplay?: Awaited<ReturnType<typeof resolveAthenaDisplay>>,
): Promise<z.input<typeof AthenaSessionSummaryOut>> {
  const persistedContext =
    metadata.context ??
    (session.contextOrganizationId ? { workspaceId: session.contextOrganizationId } : null);
  const display = resolvedDisplay ?? (await resolveAthenaDisplay(ownerUserId, persistedContext));
  return {
    id: session.id,
    kind: session.kind,
    status: session.status,
    queueState: queueState(session.status),
    objective: metadata.objective,
    context: display.context,
    workspace: display.workspace,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
  };
}

/** Load only the first response and latest contextual row for every overview session. */
async function metadataBySession(
  sessionIds: readonly string[],
): Promise<ReadonlyMap<string, ActivityMetadata>> {
  if (sessionIds.length === 0) return new Map();
  const [briefs, contexts] = await Promise.all([
    db
      .selectDistinctOn([sessionActivity.sessionId], {
        sessionId: sessionActivity.sessionId,
        body: sessionActivity.body,
      })
      .from(sessionActivity)
      .where(
        and(
          inArray(sessionActivity.sessionId, [...sessionIds]),
          eq(sessionActivity.type, 'response'),
        ),
      )
      .orderBy(sessionActivity.sessionId, asc(sessionActivity.createdAt), asc(sessionActivity.id)),
    db
      .selectDistinctOn([sessionActivity.sessionId], {
        sessionId: sessionActivity.sessionId,
        body: sessionActivity.body,
      })
      .from(sessionActivity)
      .where(
        and(
          inArray(sessionActivity.sessionId, [...sessionIds]),
          sql`${sessionActivity.body} ? 'context'`,
        ),
      )
      .orderBy(
        sessionActivity.sessionId,
        desc(sessionActivity.createdAt),
        desc(sessionActivity.id),
      ),
  ]);
  const grouped = new Map<string, ActivityMetadata>();
  for (const row of briefs) {
    grouped.set(row.sessionId, {
      objective:
        typeof row.body.text === 'string' && row.body.text.length > 0 ? row.body.text : null,
      context: null,
    });
  }
  for (const row of contexts) {
    const current = grouped.get(row.sessionId) ?? { objective: null, context: null };
    grouped.set(row.sessionId, { ...current, context: row.body.context ?? null });
  }
  return grouped;
}

/** Build one display-safe summary without loading the session's unbounded activity history. */
async function personalSummaryForSession(
  ownerUserId: string,
  session: SessionRow,
): Promise<z.input<typeof AthenaSessionSummaryOut>> {
  const metadata = (await metadataBySession([session.id])).get(session.id) ?? {
    objective: null,
    context: null,
  };
  return personalSummaryFromMetadata(ownerUserId, session, metadata);
}

/** Count durable queue states without loading any session or activity body. */
async function pulseCounts(ownerUserId: string): Promise<
  z.input<typeof AthenaPulseOut> & {
    readonly finished: number;
  }
> {
  const rows = await db
    .select({ status: agentSession.status, total: count() })
    .from(agentSession)
    .where(and(eq(agentSession.executorKind, 'athena'), eq(agentSession.ownerUserId, ownerUserId)))
    .groupBy(agentSession.status);
  const total = (statuses: readonly SessionRow['status'][]): number =>
    rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.total, 0);
  return {
    needsYou: total(NEEDS_YOU_STATUSES),
    working: total(WORKING_STATUSES),
    finished: total(FINISHED_STATUSES),
  };
}

interface ActivityHistoryPage {
  readonly activities: readonly (typeof sessionActivity.$inferSelect)[];
  readonly nextCursor?: string;
}

/** Load one newest-first keyset page, returned oldest-first for direct timeline rendering. */
async function sessionActivityHistoryPage(
  sessionId: string,
  query: ActivityHistoryQuery,
): Promise<ActivityHistoryPage> {
  const cursor = decodeHistoryCursor(query.cursor, 'activity');
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        ne(sessionActivity.type, 'thought'),
        cursor
          ? or(
              lt(sessionActivity.createdAt, cursor.createdAt),
              and(
                eq(sessionActivity.createdAt, cursor.createdAt),
                lt(sessionActivity.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(sessionActivity.createdAt), desc(sessionActivity.id))
    .limit(query.limit + 1);
  const hasMore = rows.length > query.limit;
  const newestFirst = hasMore ? rows.slice(0, query.limit) : rows;
  const oldest = newestFirst.at(-1);
  return {
    activities: [...newestFirst].reverse(),
    ...(hasMore && oldest
      ? { nextCursor: encodeHistoryCursor('activity', oldest.createdAt, oldest.id) }
      : {}),
  };
}

interface ActivityCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/** Resolve a persisted SSE event id into its deterministic timestamp/id cursor. */
async function activityCursor(sessionId: string, id: string): Promise<ActivityCursor | null> {
  if (!id) return null;
  const rows = await db
    .select({ createdAt: sessionActivity.createdAt, id: sessionActivity.id })
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** Read only visible activity strictly after a deterministic timestamp/id cursor. */
async function sessionActivitiesAfter(
  sessionId: string,
  cursor: ActivityCursor | null,
): Promise<(typeof sessionActivity.$inferSelect)[]> {
  return db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        ne(sessionActivity.type, 'thought'),
        cursor
          ? or(
              gt(sessionActivity.createdAt, cursor.createdAt),
              and(
                eq(sessionActivity.createdAt, cursor.createdAt),
                gt(sessionActivity.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(sessionActivity.createdAt), asc(sessionActivity.id));
}

/** Build one detail response after a mutation may have settled execution. */
async function personalDetail(
  ownerUserId: string,
  id: string,
  query: ActivityHistoryQuery = DEFAULT_ACTIVITY_QUERY,
): Promise<z.input<typeof AthenaSessionDetailOut>> {
  const session = await loadOwnedSession(ownerUserId, id);
  const [summary, page] = await Promise.all([
    personalSummaryForSession(ownerUserId, session),
    sessionActivityHistoryPage(id, query),
  ]);
  return {
    ...summary,
    activities: page.activities.map(toPersonalActivityOut),
    ...(page.nextCursor ? { activityNextCursor: page.nextCursor } : {}),
  };
}

interface SessionLanePage {
  readonly sessions: readonly SessionRow[];
  readonly nextCursor?: string;
}

/** Load one independently bounded queue lane in stable newest-first order. */
async function sessionLanePage(
  ownerUserId: string,
  statuses: readonly SessionRow['status'][],
  scope: Exclude<HistoryCursorScope, 'activity'>,
  token: string | undefined,
  limit: number,
): Promise<SessionLanePage> {
  const cursor = decodeHistoryCursor(token, scope);
  const rows = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.executorKind, 'athena'),
        eq(agentSession.ownerUserId, ownerUserId),
        inArray(agentSession.status, [...statuses]),
        cursor
          ? or(
              lt(agentSession.createdAt, cursor.createdAt),
              and(eq(agentSession.createdAt, cursor.createdAt), lt(agentSession.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(agentSession.createdAt), desc(agentSession.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const sessions = hasMore ? rows.slice(0, limit) : rows;
  const last = sessions.at(-1);
  return {
    sessions,
    ...(hasMore && last ? { nextCursor: encodeHistoryCursor(scope, last.createdAt, last.id) } : {}),
  };
}

/** Build grouped personal work and counts without exposing registered-agent rows. */
async function overview(
  ownerUserId: string,
  query: OverviewQuery = DEFAULT_OVERVIEW_QUERY,
): Promise<z.input<typeof AthenaOverviewOut>> {
  const [needsYou, working, finished, chats, counts] = await Promise.all([
    sessionLanePage(
      ownerUserId,
      NEEDS_YOU_STATUSES,
      'needs_you',
      query.needsYouCursor,
      query.limit,
    ),
    sessionLanePage(ownerUserId, WORKING_STATUSES, 'working', query.workingCursor, query.limit),
    sessionLanePage(ownerUserId, FINISHED_STATUSES, 'finished', query.finishedCursor, query.limit),
    db
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
      .limit(1),
    pulseCounts(ownerUserId),
  ]);
  const rows = [
    ...new Map(
      [...needsYou.sessions, ...working.sessions, ...finished.sessions, ...chats].map((row) => [
        row.id,
        row,
      ]),
    ).values(),
  ];
  const metadata = await metadataBySession(rows.map((row) => row.id));
  const uniqueContexts = new Map<string, z.input<typeof AthenaInvocationContext> | null>();
  for (const row of rows) {
    const context =
      metadata.get(row.id)?.context ??
      (row.contextOrganizationId ? { workspaceId: row.contextOrganizationId } : null);
    uniqueContexts.set(JSON.stringify(context), context);
  }
  const contextEntries = [...uniqueContexts];
  const resolvedDisplays = await resolveAthenaDisplays(
    ownerUserId,
    contextEntries.map(([, context]) => context),
  );
  const contexts = new Map(
    contextEntries.flatMap(([key], index) => {
      const display = resolvedDisplays[index];
      return display ? [[key, display] as const] : [];
    }),
  );
  const summaries = await Promise.all(
    rows.map((row) => {
      const rowMetadata = metadata.get(row.id) ?? { objective: null, context: null };
      const context =
        rowMetadata.context ??
        (row.contextOrganizationId ? { workspaceId: row.contextOrganizationId } : null);
      return personalSummaryFromMetadata(
        ownerUserId,
        row,
        rowMetadata,
        contexts.get(JSON.stringify(context)),
      );
    }),
  );
  const summariesById = new Map(summaries.map((row) => [row.id, row]));
  const sessions = {
    needsYou: needsYou.sessions.flatMap((row) => {
      const summary = summariesById.get(row.id);
      return summary ? [summary] : [];
    }),
    working: working.sessions.flatMap((row) => {
      const summary = summariesById.get(row.id);
      return summary ? [summary] : [];
    }),
    finished: finished.sessions.flatMap((row) => {
      const summary = summariesById.get(row.id);
      return summary ? [summary] : [];
    }),
  };
  const current = chats[0] ? summariesById.get(chats[0].id) : undefined;
  return {
    counts,
    currentChat: current ?? null,
    sessions,
    nextCursors: {
      ...(needsYou.nextCursor ? { needsYou: needsYou.nextCursor } : {}),
      ...(working.nextCursor ? { working: working.nextCursor } : {}),
      ...(finished.nextCursor ? { finished: finished.nextCursor } : {}),
    },
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
    if (locked.status === 'canceled') {
      throw new ConflictError('Canceled Athena work cannot accept new messages');
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
  const lastEventId = c.req.header('last-event-id');
  const resumedCursor = lastEventId ? await activityCursor(session.id, lastEventId) : null;
  const terminal = new Set(['completed', 'failed', 'canceled']);
  return streamSSE(c, async (stream) => {
    let cursor = resumedCursor;
    const replay = cursor
      ? await sessionActivitiesAfter(session.id, cursor)
      : (await sessionActivityHistoryPage(session.id, DEFAULT_ACTIVITY_QUERY)).activities;
    for (const activity of replay) {
      await stream.writeSSE({
        id: activity.id,
        event: activity.type,
        data: JSON.stringify(toPersonalActivityOut(activity)),
      });
      cursor = { createdAt: activity.createdAt, id: activity.id };
    }
    if (terminal.has(session.status)) return;
    let lastHeartbeat = Date.now();
    for (;;) {
      if (stream.aborted) return;
      const fresh = await sessionActivitiesAfter(session.id, cursor);
      for (const activity of fresh) {
        await stream.writeSSE({
          id: activity.id,
          event: activity.type,
          data: JSON.stringify(toPersonalActivityOut(activity)),
        });
        cursor = { createdAt: activity.createdAt, id: activity.id };
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
        'Return only the authenticated user’s Athena work as independently bounded Needs you, Working, and Finished pages with exact all-history counts, lane-specific continuation cursors, and the current persistent chat.',
    }),
    zQuery(overviewQuery),
    async (c) => ok(c, AthenaOverviewOut, await overview(requestOwner(c), c.req.valid('query'))),
  )
  .get(
    '/pulse',
    apiDoc({
      tag: 'Athena',
      summary: 'Get compact personal Athena counts',
      response: AthenaPulseOut,
      description:
        'Return only Needs you and Working counts for the ambient closed-dock pulse without loading private session history or activity.',
    }),
    async (c) => {
      const counts = await pulseCounts(requestOwner(c));
      return ok(c, AthenaPulseOut, { needsYou: counts.needsYou, working: counts.working });
    },
  )
  .get(
    '/chat',
    apiDoc({
      tag: 'Athena',
      summary: 'Get the current personal chat',
      response: AthenaSessionDetailOut,
      description:
        'Return the caller’s newest persistent Athena chat with a bounded newest activity window ordered oldest-first, lazily creating the first private chat when none exists. Use the activity cursor for older history and the newest activity id as Last-Event-ID for incremental SSE.',
    }),
    zQuery(activityHistoryQuery),
    async (c) => {
      const owner = requestOwner(c);
      return ok(
        c,
        AthenaSessionDetailOut,
        await personalDetail(owner, (await currentChat(owner)).id, c.req.valid('query')),
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
        'List caller-owned Athena sessions as independently paginated product lanes with exact all-history counts; lane-bound cursors cannot be reused across Needs you, Working, and Finished, and registered agents or other users never appear.',
    }),
    zQuery(overviewQuery),
    async (c) => ok(c, AthenaOverviewOut, await overview(requestOwner(c), c.req.valid('query'))),
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
        'Return one caller-owned Athena session and a bounded newest application-visible work-log window ordered oldest-first. Follow activityNextCursor for older windows, then use the newest loaded activity id as Last-Event-ID for incremental SSE; ownership mismatches are hidden as not found.',
    }),
    zParam(idParam),
    zQuery(activityHistoryQuery),
    async (c) =>
      ok(
        c,
        AthenaSessionDetailOut,
        await personalDetail(requestOwner(c), c.req.valid('param').id, c.req.valid('query')),
      ),
  )
  .post(
    '/sessions/:id/messages',
    apiDoc({
      tag: 'Athena',
      summary: 'Steer personal Athena work',
      response: AthenaSessionDetailOut,
      description:
        'Append an owner-authored steering message, resume eligible work through the durable transcript, and return the freshly settled private detail. Canceled work rejects with an application-owned conflict before activity or transcript mutation.',
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
        'Return a bounded newest JSON work-log window for one caller-owned Athena session, ordered oldest-first within the page. Follow nextCursor backward for older windows, then pass the newest loaded activity id as Last-Event-ID to the sibling stream route for incremental live delivery.',
    }),
    zParam(idParam),
    zQuery(activityHistoryQuery),
    async (c) => {
      const owner = requestOwner(c);
      const id = c.req.valid('param').id;
      await loadOwnedSession(owner, id);
      const page = await sessionActivityHistoryPage(id, c.req.valid('query'));
      return ok(c, pageOf(SessionActivityOut), {
        items: page.activities.map(toPersonalActivityOut),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      });
    },
  )
  .get(
    '/sessions/:id/stream',
    describeRoute({
      tags: ['Athena'],
      summary: 'Stream personal Athena activity (SSE)',
      description:
        'Replay and live-tail only the caller-owned session activity as Server-Sent Events. A new client without Last-Event-ID receives only the newest 100 visible activities and should use the newest received id on reconnect; older history remains available through the paginated JSON activity route. A recognized Last-Event-ID resumes strictly after that persisted activity.',
      parameters: [
        {
          name: 'Last-Event-ID',
          in: 'header',
          required: false,
          description:
            'Resume strictly after this previously received activity id. Omit only for the bounded newest-100 initial replay.',
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
        toPersonalActivityOut(
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
        return accepted(
          c,
          SessionActivityOut,
          toPersonalActivityOut(await loadActivity(id, activityId)),
        );
      }
      await approveAndResume(session.contextOrganizationId ?? '', null, id, activityId, decision);
      return ok(c, SessionActivityOut, toPersonalActivityOut(await loadActivity(id, activityId)));
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
        return accepted(
          c,
          SessionActivityOut,
          toPersonalActivityOut(await loadActivity(id, activityId)),
        );
      }
      await approveAndResume(session.contextOrganizationId ?? '', null, id, activityId, decision);
      return ok(c, SessionActivityOut, toPersonalActivityOut(await loadActivity(id, activityId)));
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
        return accepted(c, SessionActivityOut, toPersonalActivityOut(created));
      }
      await resumeSessionExecution(workspaceId, id);
      return ok(c, SessionActivityOut, toPersonalActivityOut(created));
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
      return ok(c, AthenaSessionSummaryOut, await personalSummaryForSession(owner, updated));
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
          await personalSummaryForSession(owner, current),
        );
      }
      const updated = await resumeSessionExecution(session.contextOrganizationId ?? '', session.id);
      return ok(c, AthenaSessionSummaryOut, await personalSummaryForSession(owner, updated));
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
          await personalSummaryForSession(owner, updated),
        );
      }
      return ok(c, AthenaSessionSummaryOut, await personalSummaryForSession(owner, updated));
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
          await personalSummaryForSession(owner, current),
        );
      }
      const updated = await approveLatestAndResume(
        session.contextOrganizationId ?? '',
        null,
        session.id,
      );
      return ok(c, AthenaSessionSummaryOut, await personalSummaryForSession(owner, updated));
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
          await personalSummaryForSession(owner, updated),
        );
      }
      return ok(c, AthenaSessionSummaryOut, await personalSummaryForSession(owner, updated));
    },
  );

export default meAthena;
