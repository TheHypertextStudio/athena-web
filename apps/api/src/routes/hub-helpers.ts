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
import type { WorkStatusCategory } from '@docket/types';
import { loadStatusSets } from '../lib/work-status';

/** TaskRow is the selected database row shape consumed by these API route serializers. */
export type TaskRow = typeof task.$inferSelect;
/** ProjectRow is the selected database row shape consumed by these API route serializers. */
export type ProjectRow = typeof project.$inferSelect;
/** ProgramRow is the selected database row shape consumed by these API route serializers. */
export type ProgramRow = typeof program.$inferSelect;
/** MilestoneRow is the selected database row shape consumed by these API route serializers. */
export type MilestoneRow = typeof milestone.$inferSelect;
/** OrgRow is the selected database row shape consumed by these API route serializers. */
export type OrgRow = typeof organization.$inferSelect;
/** NotificationRow is the selected database row shape consumed by these API route serializers. */
export type NotificationRow = typeof notification.$inferSelect;
/** AuditEventRow is the selected database row shape consumed by these API route serializers. */
export type AuditEventRow = typeof auditEvent.$inferSelect;

/** IN_FLIGHT_PROJECT_STATES lists the statuses treated specially by this API route helper. */
export const IN_FLIGHT_PROJECT_STATES = ['planned', 'active'] as const;

/**
 * Resolve the status category of tasks drawn from several workspaces at once.
 *
 * @remarks
 * The Hub fans out across every workspace the reader belongs to, so a single status set cannot
 * answer for all of it. This groups the rows by workspace, resolves each workspace's task
 * statuses once — honouring any team that keeps its own — and returns a lookup the serializer can
 * use per row. The alternative, resolving per row, would be a query per task on a page that is
 * already a fan-out.
 *
 * @param rows - The task rows about to be serialized.
 * @returns the status category for each task id that resolves.
 */
export async function taskCategoriesFor(
  rows: readonly TaskRow[],
): Promise<ReadonlyMap<string, WorkStatusCategory>> {
  const byOrg = new Map<string, TaskRow[]>();
  for (const row of rows) {
    const bucket = byOrg.get(row.organizationId);
    if (bucket === undefined) byOrg.set(row.organizationId, [row]);
    else bucket.push(row);
  }
  const resolved = new Map<string, WorkStatusCategory>();
  await Promise.all(
    [...byOrg].map(async ([orgId, orgRows]) => {
      const sets = await loadStatusSets(orgId, {
        entityTypes: ['task'],
        teamIds: orgRows.map((row) => row.teamId),
      });
      for (const row of orgRows) {
        const category = sets.categoryOf(row.statusId);
        if (category !== undefined) resolved.set(row.id, category);
      }
    }),
  );
  return resolved;
}

/**
 * toTaskItem converts internal API route data into the public API response shape.
 *
 * @remarks
 * The Hub gathers work from every workspace the reader belongs to, each naming its own statuses,
 * so the status *category* travels with the row. A reader of a Hub item has no single workspace
 * whose statuses it could look the key up in.
 *
 * @param t - The task row.
 * @param stateType - The category of the task's status, resolved by the caller in bulk.
 * @returns the serialized Hub task item.
 */
export function toTaskItem(t: TaskRow, stateType: WorkStatusCategory): z.input<typeof HubTaskItem> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    state: t.state,
    stateType,
    priority: t.priority,
    assigneeId: t.assigneeId,
    projectId: t.projectId,
    dueDate: t.dueDate?.toISOString() ?? null,
  };
}

/** toNotificationOut converts internal API route data into the public API response shape. */
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

/** toAuditEventOut converts internal API route data into the public API response shape. */
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

/** toOrgChip converts internal API route data into the public API response shape. */
export function toOrgChip(o: OrgRow): z.input<typeof OrgChip> {
  return { id: o.id, name: o.name, slug: o.slug, avatar: o.avatar };
}

/** toMilestoneItem converts internal API route data into the public API response shape. */
export function toMilestoneItem(m: MilestoneRow): z.input<typeof HubMilestoneItem> {
  return {
    id: m.id,
    name: m.name,
    targetDate: m.targetDate?.toISOString() ?? null,
  };
}

/** toSearchHit converts internal API route data into the public API response shape. */
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
