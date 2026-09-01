/**
 * `@docket/api` — the MCP server→client notification channel (mcp-notifications.md §2).
 *
 * @remarks
 * Three capabilities depend on this module: `resources/subscribe`, the `list_changed`
 * notifications, and `logging`. All three need the same thing — a way to push a JSON-RPC frame to
 * a client after the request that created the server has ended — and none of them can get it from
 * the request path, which is deliberately stateless so any Cloud Run instance can serve any POST.
 *
 * The split is: the GET/SSE stream is owned here (not by the SDK transport), sessions and
 * subscriptions live in Postgres so any instance can read them, and the write→notify hop rides
 * Postgres `LISTEN/NOTIFY` so an update served by one instance reaches a stream held by another.
 * That last part is the whole reason this exists rather than a `Map`: `apps/api` runs with
 * `--max-instances=10` and no session affinity, so an in-process bus would silently deliver
 * nothing most of the time.
 *
 * Delivery is best-effort by design. A frame lost to a dropped stream is not replayed, and every
 * notification is a hint to re-read rather than the data itself.
 */
import { actor, db, listenToChannel, logLevel, mcpSession, mcpSubscription } from '@docket/db';
import type { McpDetailedTask } from '@docket/integrations/mcp-tasks-contract';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { taskListenerUri } from './task-listener-uri';

/** The Postgres channel every api instance fans MCP notifications over. */
const CHANNEL = 'mcp_notify';

/**
 * RFC 5424 severities, least→most severe.
 *
 * @remarks
 * Read off the `log_level` pgEnum rather than restated, so the order a session's stored level is
 * compared against is the same order the column accepts. Two hand-kept copies of an ordered enum
 * is a silent filtering bug waiting to happen.
 */
const LOG_LEVELS = logLevel.enumValues;

/** One RFC 5424 severity. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** A JSON-RPC notification frame, addressed to one session. */
interface NotifyEnvelope {
  readonly sessionId: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/** A locally held SSE stream, keyed by session id. */
type FrameSink = (frame: string) => void;

const localStreams = new Map<string, FrameSink>();
let listening: Promise<() => Promise<void>> | undefined;

/**
 * Serialize an envelope into the JSON-RPC notification the client expects on the wire.
 *
 * @remarks
 * Written directly rather than routed through `Server.sendResourceUpdated` and friends, because
 * those target the SDK transport's own stream — which does not exist in this design. Emitting the
 * frame ourselves also sidesteps `assertNotificationCapability`, which throws for any capability
 * the per-request server did not declare.
 *
 * @param envelope - The addressed notification.
 * @returns the JSON-RPC text.
 */
function toFrame(envelope: NotifyEnvelope): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: envelope.method,
    ...(envelope.params ? { params: envelope.params } : {}),
  });
}

/**
 * Begin listening for notifications addressed to sessions held by this instance.
 *
 * @remarks
 * Idempotent and lazy — the first stream to open starts the listener, and it stays up for the
 * life of the process. A payload for a session this instance does not hold is ignored, which is
 * the common case when several instances are up.
 */
async function ensureListening(): Promise<void> {
  // The unlisten handle IS the promise's value, so there is no window where the subscription is
  // in flight but its teardown function has not been assigned yet.
  listening ??= listenToChannel(CHANNEL, (payload) => {
    let envelope: NotifyEnvelope;
    try {
      envelope = JSON.parse(payload) as NotifyEnvelope;
    } catch {
      return;
    }
    localStreams.get(envelope.sessionId)?.(toFrame(envelope));
  });
  await listening;
}

/**
 * Claim the notification stream for a session.
 *
 * @remarks
 * Claiming and checking are one call because they are one decision: a session may hold exactly
 * one stream, and a caller that asked whether it could attach would only ever attach next.
 *
 * @param sessionId - The session the stream belongs to.
 * @param sink - Called with each JSON-RPC frame to write.
 * @returns a deregistration function, or null when this session already holds a stream.
 */
export async function attachStream(
  sessionId: string,
  sink: FrameSink,
): Promise<(() => void) | null> {
  if (localStreams.has(sessionId)) return null;
  await ensureListening();
  localStreams.set(sessionId, sink);
  return () => {
    // Only clear the entry if it is still ours; a reconnecting client may have replaced it.
    if (localStreams.get(sessionId) === sink) localStreams.delete(sessionId);
  };
}

/**
 * The `pg_notify` projection every publish selects.
 *
 * @remarks
 * Every notification is set-based — addressed by a query rather than a known session id — so the
 * envelope is built in SQL, and built here once. Spelled out per call site, adding a field to
 * {@link NotifyEnvelope} would leave the old shape emitted from wherever the author did not look.
 *
 * @param sessionIdExpr - SQL naming the session column to address.
 * @param method - The JSON-RPC method.
 * @param paramsExpr - SQL producing the `params` object, or null when the method takes none.
 * @returns the `pg_notify(...)` expression.
 */
function envelopeSql(sessionIdExpr: SQL, method: string, paramsExpr?: SQL): SQL {
  const params = paramsExpr ?? sql`null`;
  // Every scalar parameter is cast explicitly: inside `json_build_object` Postgres has no column
  // to infer a placeholder's type from, and an uncast one is a 42P18 at parse time.
  return sql`pg_notify(
    ${CHANNEL}::text,
    json_build_object(
      'sessionId', ${sessionIdExpr},
      'method', ${method}::text,
      'params', ${params}
    )::text
  )`;
}

/**
 * Notify every session subscribed to a resource that it changed.
 *
 * @remarks
 * Lookup and publish are one statement on purpose. This runs on **every** entity write in the
 * product — some forty call sites reach it through the search write-through — so the cost when
 * nobody is subscribed is the thing to optimize, and that cost is now a single indexed probe of
 * `mcp_subscription.uri` that emits nothing. Selecting first and then publishing per row would
 * pay a round trip per subscriber on top of it.
 *
 * Failures are swallowed by the caller: a missed notification must never fail the write that
 * triggered it.
 *
 * @param uri - The `docket://` URI that changed.
 */
export async function notifyResourceUpdated(uri: string): Promise<void> {
  await db.execute(sql`
    select ${envelopeSql(
      sql`${mcpSubscription.sessionId}`,
      'notifications/resources/updated',
      sql`json_build_object('uri', ${uri}::text)`,
    )}
    from ${mcpSubscription}
    where ${eq(mcpSubscription.uri, uri)}
  `);
}

/**
 * Notify one principal's subscribed sessions that a caller-scoped Hub resource changed.
 *
 * @remarks
 * Hub URIs (`docket://hub/...`) are the same string for every caller and resolve against the
 * reader's own Hub, so the per-entity fan-out ({@link notifyResourceUpdated}) would wake every
 * subscriber in the system for one person's change — each re-reading their own unchanged
 * directive. The join to `mcp_session.principal_key` addresses only the affected person's live
 * sessions, which is what keeps the posture sweep's publish per-Hub rather than global.
 *
 * @param principalKey - The affected principal ({@link import('./principal').principalKey} —
 *   the user id for human principals, which is the only kind that has a Hub).
 * @param uri - The caller-scoped `docket://hub/...` URI that changed.
 */
export async function notifyHubResourceUpdated(principalKey: string, uri: string): Promise<void> {
  await db.execute(sql`
    select ${envelopeSql(
      sql`sub.session_id`,
      'notifications/resources/updated',
      sql`json_build_object('uri', ${uri}::text)`,
    )}
    from ${mcpSubscription} sub
    join ${mcpSession} s on s.id = sub.session_id
    where sub.uri = ${uri}
      and s.principal_key = ${principalKey}
      and s.ended_at is null
  `);
}

/**
 * Tell the live sessions of everyone a grant change affects that their tool list moved.
 *
 * @remarks
 * The tool catalog is otherwise fixed for the life of a deploy, so this is the one thing that can
 * change it mid-session: the surface is principal- and org-aware, and a revoked capability
 * silently removes tools a connected client is still offering.
 *
 * Takes the grant's subject rather than a principal because that is what the write path knows.
 * The join reproduces `principalKey`: a human Actor is addressed by its user id, an agent Actor
 * by its own id, which is exactly `coalesce(user_id, id)`.
 *
 * @param orgId - The organization the grant lives in.
 * @param subjectKind - Whether the grant targets an actor or a role.
 * @param subjectId - The targeted actor or role id.
 */
export async function notifyGrantsChanged(
  orgId: string,
  subjectKind: string,
  subjectId: string,
): Promise<void> {
  await db.execute(sql`
    select ${envelopeSql(sql`s.id`, 'notifications/tools/list_changed')}
    from ${mcpSession} s
    join ${actor} a on s.principal_key = coalesce(a.user_id, a.id)
    where a.organization_id = ${orgId}
      and s.ended_at is null
      and (
        (${subjectKind} = 'actor' and a.id = ${subjectId})
        or (${subjectKind} = 'role' and a.role_id = ${subjectId})
      )
  `);
}

/**
 * Emit a structured log message to a session, honoring the level it asked for.
 *
 * @remarks
 * Filtering here rather than at the call site keeps `logging/setLevel` meaningful without every
 * emitter having to read the session first.
 *
 * @param sessionId - The session to notify.
 * @param level - The RFC 5424 severity.
 * @param data - The structured payload. Never credentials, tokens, or another principal's data.
 */
export async function notifyLog(
  sessionId: string,
  level: LogLevel,
  data: Record<string, unknown>,
): Promise<void> {
  // The level predicate lives in the WHERE, so a session that does not want this severity
  // produces zero rows and no frame — one round trip instead of read-then-publish.
  const wanted = LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1);
  await db.execute(sql`
    select ${envelopeSql(
      sql`${mcpSession.id}`,
      'notifications/message',
      sql`json_build_object('level', ${level}::text, 'logger', 'docket', 'data', ${JSON.stringify(data)}::json)`,
    )}
    from ${mcpSession}
    where ${and(
      eq(mcpSession.id, sessionId),
      isNull(mcpSession.endedAt),
      inArray(mcpSession.logLevel, wanted),
    )}
  `);
}

/**
 * Push `notifications/tasks` to every session that asked to hear about one task via
 * `subscriptions/listen` (`apps/api/src/mcp/task-protocol.ts`).
 *
 * @remarks
 * Listener registrations live in `mcp_subscription` under {@link taskListenerUri} — the exact
 * same "who wants to hear about this" table `notifications/resources/updated` already uses,
 * rather than a second table, since
 * both are "a session subscribed to an addressable thing" with identical session-cascade cleanup.
 *
 * @param taskId - The task whose status changed.
 * @param task - The full detailed task, sent inline per the extension's own notification shape.
 */
export async function notifyTaskStatus(taskId: string, task: McpDetailedTask): Promise<void> {
  await db.execute(sql`
    select ${envelopeSql(
      sql`${mcpSubscription.sessionId}`,
      'notifications/tasks',
      sql`${JSON.stringify(task)}::jsonb`,
    )}
    from ${mcpSubscription}
    where ${eq(mcpSubscription.uri, taskListenerUri(taskId))}
  `);
}

/**
 * Push `notifications/subscriptions/acknowledged` to the session that just sent
 * `subscriptions/listen` (`apps/api/src/mcp/task-protocol.ts`), naming the task ids it accepted.
 *
 * @remarks
 * Addressed directly by session id rather than through `mcp_subscription`, unlike
 * {@link notifyTaskStatus}: this is the one-time reply to the request that created those rows, not
 * a fan-out to everyone listening for something.
 *
 * @param sessionId - The session that sent `subscriptions/listen`.
 * @param taskIds - The task ids the server actually registered a listener for.
 */
export async function notifySubscriptionsAcknowledged(
  sessionId: string,
  taskIds: readonly string[],
): Promise<void> {
  await db.execute(sql`
    select ${envelopeSql(
      sql`${mcpSession.id}`,
      'notifications/subscriptions/acknowledged',
      sql`json_build_object('notifications', json_build_object('taskIds', ${JSON.stringify([...taskIds])}::jsonb))`,
    )}
    from ${mcpSession}
    where ${eq(mcpSession.id, sessionId)}
  `);
}

/**
 * Stop listening and forget every local stream.
 *
 * @remarks
 * For test teardown; a production process holds the listener for its lifetime.
 */
export async function resetNotifications(): Promise<void> {
  localStreams.clear();
  const pending = listening;
  listening = undefined;
  if (pending) await (await pending)();
}
