/**
 * `@docket/db` — MCP session island (mcp-notifications.md §3).
 *
 * @remarks
 * Backs the server→client notification channel. A client that wants
 * `notifications/resources/updated`, `notifications/message`, or a `list_changed` frame holds an
 * SSE stream open and identifies itself with an `Mcp-Session-Id`; these two tables are what let
 * ANY api instance answer "who is subscribed to this URI" when a write lands on it, and what let
 * the one instance holding the stream push the frame.
 *
 * This is operational state, not domain data, so it deliberately sits outside the work tables and
 * carries no `organization_id` — an MCP session is per-principal and may span orgs.
 */
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { logLevel } from '../enums';

/**
 * One live MCP session, keyed by the `Mcp-Session-Id` handed to the client on `initialize`.
 *
 * @remarks
 * `principalKey` is the security-critical column. The stateless request path rebuilds a fresh,
 * identity-bound server per request, which is what stops authorization crossing identities. A
 * session id travelling in a header does not carry that guarantee on its own, so every request
 * presenting one re-resolves its own principal and must match this value; a mismatch is a 404,
 * not a 403, so a guessed id cannot confirm a session exists.
 */
export const mcpSession = pgTable(
  'mcp_session',
  {
    id: text('id').primaryKey(),
    principalKey: text('principal_key').notNull(),
    protocolVersion: text('protocol_version'),
    logLevel: logLevel('log_level').notNull().default('info'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    endedAt: timestamp('ended_at'),
  },
  (t) => [
    index('mcp_session_principal_idx').on(t.principalKey),
    // Drives the reaper, which runs off the cron sweep rather than a timer — Cloud Run throttles
    // CPU between requests, so nothing timer-driven runs reliably.
    index('mcp_session_last_seen_idx').on(t.lastSeenAt),
  ],
);

/** One `resources/subscribe` registration: this session wants updates for this `docket://` URI. */
export const mcpSubscription = pgTable(
  'mcp_subscription',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => mcpSession.id, { onDelete: 'cascade' }),
    uri: text('uri').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mcp_subscription_session_uri_uq').on(t.sessionId, t.uri),
    // The write path's lookup is URI-first ("who is subscribed to this?"), so this index is the
    // one that keeps the notify hop off a sequential scan.
    index('mcp_subscription_uri_idx').on(t.uri),
  ],
);
