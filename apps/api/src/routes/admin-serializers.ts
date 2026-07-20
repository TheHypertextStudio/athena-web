import type { lifecycleHold, impersonationSession, staffUser, user } from '@docket/db';
import { type Database, billingExemption, db, operatorAuditEvent, organization } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type {
  AdminBillingExemptionOut,
  AdminHoldOut,
  AdminImpersonationOut,
  AdminOrgOut,
  AdminStaffOut,
} from '../admin-dto';
import { LifecycleState } from '../admin-dto';
import { NotFoundError } from '../error';

/** UserRow is the selected database row shape consumed by these API route serializers. */
export type UserRow = typeof user.$inferSelect;
/** OrgRow is the selected database row shape consumed by these API route serializers. */
export type OrgRow = typeof organization.$inferSelect;
/** HoldRow is the selected database row shape consumed by these API route serializers. */
export type HoldRow = typeof lifecycleHold.$inferSelect;
/** ExemptionRow is the selected database row shape consumed by these API route serializers. */
export type ExemptionRow = typeof billingExemption.$inferSelect;
/** ImpersonationRow is the selected database row shape consumed by these API route serializers. */
export type ImpersonationRow = typeof impersonationSession.$inferSelect;
/** StaffRow is the selected database row shape consumed by these API route serializers. */
export type StaffRow = typeof staffUser.$inferSelect;

/** The lifecycle states, in pipeline order, used to build the board + metrics. */
export const LIFECYCLE_STATES = LifecycleState.options;

/** idParam is the reusable OpenAPI parameter schema for this API route route. */
export const idParam = z.object({ id: z.string() });
/** holdParam is the reusable OpenAPI parameter schema for this API route route. */
export const holdParam = z.object({ id: z.string(), holdId: z.string() });
/** impersonationParam is the reusable OpenAPI parameter schema for this API route route. */
export const impersonationParam = z.object({ id: z.string() });
/** staffParam is the reusable OpenAPI parameter schema for this API route route. */
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

/**
 * Serialize an org row into the admin org DTO shape.
 *
 * @param exemptOrgIds - Org ids with a currently active billing exemption (see
 *   {@link loadActiveExemptOrgIds}); defaults to empty when the caller has no exemption context.
 */
export function toOrgOut(
  o: OrgRow,
  exemptOrgIds: ReadonlySet<string> = new Set(),
): z.input<typeof AdminOrgOut> {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    isPersonal: o.isPersonal,
    lifecycleState: o.lifecycleState,
    exportReadyAt: o.exportReadyAt?.toISOString() ?? null,
    deleteAfterAt: o.deleteAfterAt?.toISOString() ?? null,
    isBillingExempt: exemptOrgIds.has(o.id),
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

/** Load the set of org ids among `orgIds` that currently hold an active billing exemption. */
export async function loadActiveExemptOrgIds(
  database: Database,
  orgIds: readonly string[],
): Promise<Set<string>> {
  if (orgIds.length === 0) return new Set();
  const rows = await database
    .select({ organizationId: billingExemption.organizationId })
    .from(billingExemption)
    .where(
      and(inArray(billingExemption.organizationId, orgIds), isNull(billingExemption.revokedAt)),
    );
  return new Set(rows.map((r) => r.organizationId));
}

/** Serialize a billing-exemption row into its DTO shape. */
export function toExemptionOut(e: ExemptionRow): z.input<typeof AdminBillingExemptionOut> {
  return {
    id: e.id,
    organizationId: e.organizationId,
    reason: e.reason,
    grantedBy: e.grantedBy,
    createdAt: e.createdAt.toISOString(),
    revokedBy: e.revokedBy,
    revokedAt: e.revokedAt?.toISOString() ?? null,
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
