import { actor, db } from '@docket/db';
import type {
  auditEvent,
  milestone,
  notification,
  organization,
  program,
  project,
  task,
} from '@docket/db';
import type {
  AuditEventOut,
  HubMilestoneItem,
  HubSearchHit,
  HubTaskItem,
  NotificationOut,
  OrgChip,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

export type TaskRow = typeof task.$inferSelect;
export type ProjectRow = typeof project.$inferSelect;
export type ProgramRow = typeof program.$inferSelect;
export type MilestoneRow = typeof milestone.$inferSelect;
export type OrgRow = typeof organization.$inferSelect;
export type NotificationRow = typeof notification.$inferSelect;
export type AuditEventRow = typeof auditEvent.$inferSelect;

export const IN_FLIGHT_PROJECT_STATES = ['planned', 'active'] as const;

export function toTaskItem(t: TaskRow): z.input<typeof HubTaskItem> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    projectId: t.projectId,
    dueDate: t.dueDate?.toISOString() ?? null,
  };
}

export function toNotificationOut(n: NotificationRow): z.input<typeof NotificationOut> {
  return {
    id: n.id,
    userId: n.userId,
    organizationId: n.organizationId,
    type: n.type,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export function toAuditEventOut(e: AuditEventRow): z.input<typeof AuditEventOut> {
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

export function toOrgChip(o: OrgRow): z.input<typeof OrgChip> {
  return { id: o.id, name: o.name, slug: o.slug, avatar: o.avatar };
}

export function toMilestoneItem(m: MilestoneRow): z.input<typeof HubMilestoneItem> {
  return {
    id: m.id,
    name: m.name,
    targetDate: m.targetDate?.toISOString() ?? null,
  };
}

export function toSearchHit(
  organizationId: string,
  type: z.input<typeof HubSearchHit>['type'],
  id: string,
  title: string,
): z.input<typeof HubSearchHit> {
  return { organizationId, type, id, title };
}

/** The org ids the user is an active human Actor in (their cross-org scope). */
export async function callerOrgIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(and(eq(actor.userId, userId), eq(actor.kind, 'human'), eq(actor.status, 'active')));
  return [...new Set(rows.map((r) => r.organizationId))];
}

/** The caller's active human Actor ids (one per org), for "assigned to me" filters. */
export async function callerActorIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(and(eq(actor.userId, userId), eq(actor.kind, 'human'), eq(actor.status, 'active')));
  return rows.map((r) => r.id);
}

/** Whether an ISO timestamp string falls on the given `YYYY-MM-DD` UTC date. */
export function sameDay(iso: string | null | undefined, date: string): boolean {
  if (!iso) return false;
  return iso.slice(0, 10) === date;
}

/** Group rows by a derived key into a Map preserving insertion order. */
export function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}
