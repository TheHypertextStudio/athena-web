/**
 * `@docket/api` — activity router (ORG-SCOPED, mounted at `/v1/orgs/:orgId/activity`).
 *
 * @remarks
 * Unlike the other surfaces in this group, the activity feed IS org-scoped: it reads
 * `c.get('actorCtx')` (set by `orgContextMiddleware`) and returns the organization's
 * task-visible {@link auditEvent} feed, newest first. Also exports {@link writeAudit}, the
 * shared helper entity routers call to append an event (agent actions carry both the
 * agent `actorId` and the human `initiatorId`).
 */
import { auditEvent, db } from '@docket/db';
import { AuditEventOut } from '@docket/connections/activity-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { encodeListCursor, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zQuery } from '../lib/validate';

import { buildTaskBearingEventVisibility, collectVisibilityFilteredPage } from './stream-helpers';

type AuditEventRow = typeof auditEvent.$inferSelect;

function toOut(e: AuditEventRow): z.input<typeof AuditEventOut> {
  return {
    id: e.id,
    organizationId: e.organizationId,
    actorId: e.actorId,
    initiatorId: e.initiatorId,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    type: e.type,
    metadata: e.metadata,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * Append one event to an organization's audit feed.
 *
 * @remarks
 * The shared write-path entity routers call to record a domain action. For agent
 * actions, pass the agent's Actor as `actorId` and the triggering human as
 * `initiatorId`; for direct human actions, `actorId` is the human and `initiatorId`
 * is omitted.
 *
 * @param values - The audit-event insert values (sans generated id/timestamp).
 */
export async function writeAudit(values: typeof auditEvent.$inferInsert): Promise<void> {
  await db.insert(auditEvent).values(values);
}

/** Activity router: the organization's task-visible audit feed, newest first. */
const activity = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Activity',
    summary: 'List the organization audit feed',
    response: pageOf(AuditEventOut),
    description: `Return the organization's audit events from newest to oldest as a page of {@link AuditEventOut}. Events describe who acted, what changed, and which Docket resource changed. Task events and task-comment events appear only when the caller can currently view the task. Other events require active organization membership.

This collection covers changes to Docket resources. Use \`GET /v1/orgs/:orgId/stream\` for observations from connected external tools.

Results use \`createdAt DESC, id DESC\`, default to 50 visible items, accept at most 100, and omit \`nextCursor\` at exhaustion. Task visibility is applied before pagination. A key property for governed automation is that agent events carry both the acting agent and accountable initiator. Read-only and org-scoped.`,
  }),
  zQuery(CursorQuery),
  async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { cursor, limit } = c.req.valid('query');
    const visibility = await buildTaskBearingEventVisibility([{ organizationId: orgId, actorId }]);
    const page = await collectVisibilityFilteredPage({
      initialCursor: cursor,
      limit,
      fetch: (scanCursor, batchSize) =>
        db
          .select()
          .from(auditEvent)
          .where(
            and(
              eq(auditEvent.organizationId, orgId),
              seekAfter(auditEvent.createdAt, auditEvent.id, scanCursor ?? undefined),
            ),
          )
          .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
          .limit(batchSize),
      filter: (rows) => visibility.filterAuditEvents(rows),
      cursorOf: (row) => encodeListCursor(row.createdAt, row.id),
    });
    const last = page.items[page.items.length - 1];
    return ok(c, pageOf(AuditEventOut), {
      items: page.items.map(toOut),
      ...(page.hasMore && last ? { nextCursor: encodeListCursor(last.createdAt, last.id) } : {}),
    });
  },
);

export default activity;
