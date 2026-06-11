import type { lifecycleHold, impersonationSession, staffUser, user } from '@docket/db';
import { type Database, db, operatorAuditEvent, organization } from '@docket/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AdminHoldOut, AdminImpersonationOut, AdminOrgOut, AdminStaffOut } from '../admin-dto';
import { LifecycleState } from '../admin-dto';
import { NotFoundError } from '../error';

export type UserRow = typeof user.$inferSelect;
export type OrgRow = typeof organization.$inferSelect;
export type HoldRow = typeof lifecycleHold.$inferSelect;
export type ImpersonationRow = typeof impersonationSession.$inferSelect;
export type StaffRow = typeof staffUser.$inferSelect;

/** The lifecycle states, in pipeline order, used to build the board + metrics. */
export const LIFECYCLE_STATES = LifecycleState.options;

export const idParam = z.object({ id: z.string() });
export const holdParam = z.object({ id: z.string(), holdId: z.string() });
export const impersonationParam = z.object({ id: z.string() });
export const staffParam = z.object({ id: z.string() });

/** Serialize a user row into the admin user DTO shape. */
export function toUserOut(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Serialize an org row into the admin org DTO shape. */
export function toOrgOut(o: OrgRow): z.input<typeof AdminOrgOut> {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    isPersonal: o.isPersonal,
    lifecycleState: o.lifecycleState,
    exportReadyAt: o.exportReadyAt?.toISOString() ?? null,
    deleteAfterAt: o.deleteAfterAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

/** Serialize a lifecycle-hold row into its DTO shape. */
export function toHoldOut(h: HoldRow): z.input<typeof AdminHoldOut> {
  return {
    id: h.id,
    organizationId: h.organizationId,
    reason: h.reason,
    placedBy: h.placedBy,
    createdAt: h.createdAt.toISOString(),
    releasedAt: h.releasedAt?.toISOString() ?? null,
  };
}

/** Serialize an impersonation-session row into its DTO shape. */
export function toImpersonationOut(s: ImpersonationRow): z.input<typeof AdminImpersonationOut> {
  return {
    id: s.id,
    staffUserId: s.staffUserId,
    targetUserId: s.targetUserId,
    reason: s.reason,
    startedAt: s.startedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
  };
}

/** Serialize an operator-audit-event row into its DTO shape. */
export function toAuditOut(a: typeof operatorAuditEvent.$inferSelect) {
  return {
    id: a.id,
    staffUserId: a.staffUserId,
    type: a.type,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    metadata: a.metadata,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Serialize a staff-user row (joined with its global user) into its DTO shape. */
export function toStaffOut(
  s: StaffRow,
  u: Pick<UserRow, 'name' | 'email'>,
): z.input<typeof AdminStaffOut> {
  return {
    id: s.id,
    userId: s.userId,
    role: s.role,
    userName: u.name,
    userEmail: u.email,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Extract the scalar from a single-row `count()` query result. */
export function countOf(rows: readonly { n: number }[]): number {
  /* v8 ignore next -- @preserve a `count()` aggregate always returns exactly one row */
  return rows[0]?.n ?? 0;
}

/** Record an operator audit event for an actioned mutation. */
export async function audit(
  database: Database,
  staffUserId: string,
  type: string,
  subjectType: string,
  subjectId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await database
    .insert(operatorAuditEvent)
    .values({ staffUserId, type, subjectType, subjectId, metadata });
}

/** Load an org by id or throw {@link NotFoundError}. */
export async function loadOrg(id: string): Promise<OrgRow> {
  const rows = await db.select().from(organization).where(eq(organization.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Organization not found');
  return row;
}
