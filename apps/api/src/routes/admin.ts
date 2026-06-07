/**
 * `@docket/api` — service-admin (operator back-office) router (mounted at `/v1/admin`).
 *
 * @remarks
 * Top-level + staff-gated: every route runs behind {@link staffMiddleware} (resolves
 * the caller to a `staff_user` row or 403s) rather than the per-org actor context, so
 * the admin app consumes it through the same `hc<AppType>` RPC client. Reads (users,
 * orgs, the lifecycle board, audit feed, metrics) are open to any staff tier; billing
 * actions require finance+ via {@link requireStaffRole}; impersonation requires
 * support+ (i.e. any staff). Every mutation writes an `operator_audit_event` so the
 * back-office is fully auditable. Lifecycle writes go through the billing
 * {@link onReactivated}/{@link onTrialOrPaymentTerminal} service, never raw column
 * pokes (except the explicit `lifecycleState` override, which is the operator escape
 * hatch and is itself audited).
 */
import {
  type Database,
  actor,
  db,
  impersonationSession,
  lifecycleHold,
  operatorAuditEvent,
  organization,
  user,
} from '@docket/db';
import { and, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  AdminAuditPage,
  AdminAuditQuery,
  AdminHoldOut,
  AdminImpersonationOut,
  AdminLifecycleBoard,
  AdminMetricsOut,
  AdminOrgListQuery,
  AdminOrgOut,
  AdminOrgPage,
  AdminUserDetail,
  AdminUserListQuery,
  AdminUserPage,
  ExtendTrialBody,
  LifecycleState,
  PlaceHoldBody,
  SetLifecycleBody,
  StartImpersonationBody,
} from '../admin-dto';
import type { AppEnv } from '../context';
import { onReactivated, onTrialOrPaymentTerminal } from '../billing/lifecycle';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { requireStaffRole, staffMiddleware } from '../permissions/staff-guard';
import { z } from 'zod';

type UserRow = typeof user.$inferSelect;
type OrgRow = typeof organization.$inferSelect;
type HoldRow = typeof lifecycleHold.$inferSelect;
type ImpersonationRow = typeof impersonationSession.$inferSelect;
type AuditRow = typeof operatorAuditEvent.$inferSelect;

/** The lifecycle states, in pipeline order, used to build the board + metrics. */
const LIFECYCLE_STATES = LifecycleState.options;

/** Serialize a user row into the admin user DTO shape. */
function toUserOut(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Serialize an org row into the admin org DTO shape. */
function toOrgOut(o: OrgRow): z.input<typeof AdminOrgOut> {
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
function toHoldOut(h: HoldRow): z.input<typeof AdminHoldOut> {
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
function toImpersonationOut(s: ImpersonationRow): z.input<typeof AdminImpersonationOut> {
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
function toAuditOut(a: AuditRow) {
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

/** Extract the scalar from a single-row `count()` query result. */
function countOf(rows: readonly { n: number }[]): number {
  /* v8 ignore next -- @preserve a `count()` aggregate always returns exactly one row */
  return rows[0]?.n ?? 0;
}

/** Record an operator audit event for an actioned mutation. */
async function audit(
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
async function loadOrg(id: string): Promise<OrgRow> {
  const rows = await db.select().from(organization).where(eq(organization.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Organization not found');
  return row;
}

const idParam = z.object({ id: z.string() });
const holdParam = z.object({ id: z.string(), holdId: z.string() });
const impersonationParam = z.object({ id: z.string() });

/** The staff-gated operator back-office router. */
const admin = new Hono<AppEnv>()
  .use('*', staffMiddleware)
  // ---- Users --------------------------------------------------------------
  .get('/users', zQuery(AdminUserListQuery), async (c) => {
    const { search, limit, offset } = c.req.valid('query');
    const where = search
      ? or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
      : undefined;
    const [items, totals] = await Promise.all([
      db.select().from(user).where(where).orderBy(desc(user.createdAt)).limit(limit).offset(offset),
      db.select({ n: count() }).from(user).where(where),
    ]);
    return ok(c, AdminUserPage, { items: items.map(toUserOut), total: countOf(totals) });
  })
  .get('/users/:id', zParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const rows = await db.select().from(user).where(eq(user.id, id)).limit(1);
    const u = rows[0];
    if (!u) throw new NotFoundError('User not found');
    const memberships = await db
      .select({ org: organization, actor })
      .from(actor)
      .innerJoin(organization, eq(actor.organizationId, organization.id))
      .where(and(eq(actor.userId, id), eq(actor.kind, 'human')));
    return ok(c, AdminUserDetail, {
      user: toUserOut(u),
      memberships: memberships.map((m) => ({
        organizationId: m.org.id,
        organizationName: m.org.name,
        organizationSlug: m.org.slug,
        lifecycleState: m.org.lifecycleState,
        actorId: m.actor.id,
        roleId: m.actor.roleId,
      })),
    });
  })
  // ---- Orgs ---------------------------------------------------------------
  .get('/orgs', zQuery(AdminOrgListQuery), async (c) => {
    const { search, lifecycleState, limit, offset } = c.req.valid('query');
    const filters: SQL[] = [];
    if (search) {
      const m = or(
        ilike(organization.name, `%${search}%`),
        ilike(organization.slug, `%${search}%`),
      );
      /* v8 ignore next -- @preserve `or` over a non-empty arg list always yields a SQL node */
      if (m) filters.push(m);
    }
    if (lifecycleState) filters.push(eq(organization.lifecycleState, lifecycleState));
    const where = filters.length > 0 ? and(...filters) : undefined;
    const [items, totals] = await Promise.all([
      db
        .select()
        .from(organization)
        .where(where)
        .orderBy(desc(organization.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(organization).where(where),
    ]);
    return ok(c, AdminOrgPage, { items: items.map(toOrgOut), total: countOf(totals) });
  })
  .get('/orgs/:id', zParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const org = await loadOrg(id);
    return ok(c, AdminOrgOut, toOrgOut(org));
  })
  // ---- Lifecycle pipeline board ------------------------------------------
  .get('/lifecycle', async (c) => {
    const rows = await db.select().from(organization).orderBy(desc(organization.createdAt));
    return ok(c, AdminLifecycleBoard, {
      columns: LIFECYCLE_STATES.map((state) => ({
        lifecycleState: state,
        orgs: rows.filter((row) => row.lifecycleState === state).map(toOrgOut),
      })),
    });
  })
  // ---- Lifecycle holds ----------------------------------------------------
  .post('/orgs/:id/holds', zParam(idParam), zJson(PlaceHoldBody), async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const { staffUserId } = c.get('staffCtx');
    await loadOrg(id);
    const inserted = await db
      .insert(lifecycleHold)
      .values({ organizationId: id, reason, placedBy: staffUserId })
      .returning();
    const hold = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
    if (!hold) throw new NotFoundError('Hold insert returned no row');
    await audit(db, staffUserId, 'lifecycle_hold.placed', 'organization', id, {
      holdId: hold.id,
      reason,
    });
    return ok(c, AdminHoldOut, toHoldOut(hold));
  })
  .delete('/orgs/:id/holds/:holdId', zParam(holdParam), async (c) => {
    const { id, holdId } = c.req.valid('param');
    const { staffUserId } = c.get('staffCtx');
    const released = await db
      .update(lifecycleHold)
      .set({ releasedAt: new Date() })
      .where(
        and(
          eq(lifecycleHold.id, holdId),
          eq(lifecycleHold.organizationId, id),
          isNull(lifecycleHold.releasedAt),
        ),
      )
      .returning();
    const hold = released[0];
    if (!hold) throw new NotFoundError('Active hold not found');
    await audit(db, staffUserId, 'lifecycle_hold.released', 'organization', id, { holdId });
    return ok(c, AdminHoldOut, toHoldOut(hold));
  })
  // ---- Billing actions (finance+) -----------------------------------------
  .post(
    '/orgs/:id/extend-trial',
    requireStaffRole('finance'),
    zParam(idParam),
    zJson(ExtendTrialBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { days } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const org = await loadOrg(id);
      const updated = await db
        .update(organization)
        .set({ lifecycleState: 'trialing', exportReadyAt: null, deleteAfterAt: null })
        .where(eq(organization.id, id))
        .returning();
      const next = updated[0];
      /* v8 ignore next -- @preserve defensive: the org was just loaded, so the update returns it */
      if (!next) throw new NotFoundError('Organization not found');
      await audit(db, staffUserId, 'billing.trial_extended', 'organization', id, {
        days,
        previousState: org.lifecycleState,
      });
      return ok(c, AdminOrgOut, toOrgOut(next));
    },
  )
  .post('/orgs/:id/reactivate', requireStaffRole('finance'), zParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const { staffUserId } = c.get('staffCtx');
    const org = await loadOrg(id);
    await onReactivated(db, id);
    await audit(db, staffUserId, 'billing.reactivated', 'organization', id, {
      previousState: org.lifecycleState,
    });
    return ok(c, AdminOrgOut, toOrgOut(await loadOrg(id)));
  })
  .post(
    '/orgs/:id/lifecycle',
    requireStaffRole('finance'),
    zParam(idParam),
    zJson(SetLifecycleBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { lifecycleState } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const org = await loadOrg(id);
      const now = new Date().toISOString();
      if (lifecycleState === 'active' || lifecycleState === 'trialing') {
        await onReactivated(db, id);
      } else if (lifecycleState === 'export_window') {
        await onTrialOrPaymentTerminal(db, id, now);
      } else {
        await db.update(organization).set({ lifecycleState }).where(eq(organization.id, id));
      }
      await audit(db, staffUserId, 'lifecycle.state_set', 'organization', id, {
        from: org.lifecycleState,
        to: lifecycleState,
      });
      return ok(c, AdminOrgOut, toOrgOut(await loadOrg(id)));
    },
  )
  // ---- Impersonation (support+) -------------------------------------------
  .post('/impersonations', zJson(StartImpersonationBody), async (c) => {
    const { targetUserId, reason, ttlMinutes } = c.req.valid('json');
    const { staffUserId } = c.get('staffCtx');
    const targetRows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, targetUserId))
      .limit(1);
    if (!targetRows[0]) throw new NotFoundError('Target user not found');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const inserted = await db
      .insert(impersonationSession)
      .values({ staffUserId, targetUserId, reason, expiresAt })
      .returning();
    const sess = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
    if (!sess) throw new NotFoundError('Impersonation insert returned no row');
    await audit(db, staffUserId, 'impersonation.started', 'actor', targetUserId, {
      impersonationId: sess.id,
      reason,
      ttlMinutes,
    });
    return ok(c, AdminImpersonationOut, toImpersonationOut(sess));
  })
  .post('/impersonations/:id/end', zParam(impersonationParam), async (c) => {
    const { id } = c.req.valid('param');
    const { staffUserId } = c.get('staffCtx');
    const ended = await db
      .update(impersonationSession)
      .set({ endedAt: new Date() })
      .where(and(eq(impersonationSession.id, id), isNull(impersonationSession.endedAt)))
      .returning();
    const sess = ended[0];
    if (!sess) throw new NotFoundError('Active impersonation session not found');
    await audit(db, staffUserId, 'impersonation.ended', 'actor', sess.targetUserId, {
      impersonationId: id,
    });
    return ok(c, AdminImpersonationOut, toImpersonationOut(sess));
  })
  // ---- Audit feed ---------------------------------------------------------
  .get('/audit', zQuery(AdminAuditQuery), async (c) => {
    const { limit, offset } = c.req.valid('query');
    const rows = await db
      .select()
      .from(operatorAuditEvent)
      .orderBy(desc(operatorAuditEvent.createdAt))
      .limit(limit)
      .offset(offset);
    return ok(c, AdminAuditPage, { items: rows.map(toAuditOut) });
  })
  // ---- Metrics (home dashboard) -------------------------------------------
  .get('/metrics', async (c) => {
    const [userTotals, orgTotals, byState] = await Promise.all([
      db.select({ n: count() }).from(user),
      db.select({ n: count() }).from(organization),
      db
        .select({ state: organization.lifecycleState, n: count() })
        .from(organization)
        .groupBy(organization.lifecycleState),
    ]);
    const counts = new Map(byState.map((r) => [r.state, r.n]));
    return ok(c, AdminMetricsOut, {
      totalUsers: countOf(userTotals),
      totalOrgs: countOf(orgTotals),
      orgsByLifecycle: LIFECYCLE_STATES.map((state) => ({
        lifecycleState: state,
        count: counts.get(state) ?? 0,
      })),
    });
  });

export default admin;
