/**
 * `@docket/api` — activity router (ORG-SCOPED, mounted at `/v1/orgs/:orgId/activity`).
 *
 * @remarks
 * Unlike the other surfaces in this group, the activity feed IS org-scoped: it reads
 * `c.get('actorCtx')` (set by `orgContextMiddleware`) and returns the organization's
 * universal {@link auditEvent} feed, newest first. Also exports {@link writeAudit}, the
 * shared helper entity routers call to append an event (agent actions carry both the
 * agent `actorId` and the human `initiatorId`).
 */
import { auditEvent, db } from '@docket/db';
import { AuditEventOut, pageOf } from '@docket/types';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';

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

/** Activity router: the organization's universal audit feed, newest first. */
const activity = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Activity',
    summary: 'List the organization audit feed',
    response: pageOf(AuditEventOut),
  }),
  async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.organizationId, orgId))
      .orderBy(desc(auditEvent.createdAt));
    return ok(c, pageOf(AuditEventOut), { items: rows.map(toOut) });
  },
);

export default activity;
