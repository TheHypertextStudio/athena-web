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
    description: `Return the organization's universal audit feed — every domain action over Docket's *own* entities (tasks, projects, agents, sessions, integrations, memberships, …), newest-first, as a page of {@link AuditEventOut}. This is the internal accountability ledger: who did what to which subject, written by the entity routers as side effects of their mutations. It is deliberately distinct from the **observation stream** (\`GET /v1/orgs/:orgId/stream\`), which records activity in *external* tools where the source of truth lives elsewhere.

A key property for governed automation: an agent action carries BOTH an \`actorId\` (the agent's Actor — who acted) and an \`initiatorId\` (the human who triggered or authorized it — who is accountable); a direct human action carries just \`actorId\`. So approval-gate decisions land here as \`approved\`/\`rejected\` events with \`subjectType='agent_session'\`, attributing the agent while recording the human approver. Read-only over the API and org-scoped; org membership suffices. Related: \`GET /v1/orgs/:orgId/stream\` (external observations), and the session activity routes that generate the \`approved\`/\`rejected\` entries.`,
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
