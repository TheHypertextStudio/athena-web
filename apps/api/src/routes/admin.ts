/**
 * `@docket/api` — service-admin (operator back-office) router (mounted at `/v1/admin`).
 *
 * @remarks
 * Top-level + staff-gated: every route runs behind {@link staffMiddleware}. Reads are open
 * to any staff tier; billing actions require `finance+`; impersonation requires `support+`.
 * Every mutation writes an `operator_audit_event` for full auditability.
 */
import {
  actor,
  agentSession,
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
  AdminImpersonationOut,
  AdminLifecycleBoard,
  AdminMetricsOut,
  AdminOrgListQuery,
  AdminOrgOut,
  AdminOrgPage,
  AdminUserDetail,
  AdminUserListQuery,
  AdminUserPage,
  StartImpersonationBody,
} from '../admin-dto';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { requireStaffRole, staffMiddleware } from '../permissions/staff-guard';

import {
  LIFECYCLE_STATES,
  audit,
  countOf,
  idParam,
  impersonationParam,
  loadOrg,
  toAuditOut,
  toImpersonationOut,
  toOrgOut,
  toUserOut,
} from './admin-serializers';
import { adminBillingRoutes } from './admin-billing-routes';
import { adminStaffRoutes } from './admin-staff-routes';

/** The staff-gated operator back-office router. */
const admin = new Hono<AppEnv>()
  .use('*', staffMiddleware)
  // ---- Users --------------------------------------------------------------
  .get(
    '/users',
    apiDoc({ tag: 'Admin', summary: 'List users', response: AdminUserPage }),
    zQuery(AdminUserListQuery),
    async (c) => {
      const { search, limit, offset } = c.req.valid('query');
      const where = search
        ? or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
        : undefined;
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(user)
          .where(where)
          .orderBy(desc(user.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(user).where(where),
      ]);
      return ok(c, AdminUserPage, { items: items.map(toUserOut), total: countOf(totals) });
    },
  )
  .get(
    '/users/:id',
    apiDoc({ tag: 'Admin', summary: 'Get a user', response: AdminUserDetail }),
    zParam(idParam),
    async (c) => {
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
    },
  )
  // ---- Orgs ---------------------------------------------------------------
  .get(
    '/orgs',
    apiDoc({ tag: 'Admin', summary: 'List organizations', response: AdminOrgPage }),
    zQuery(AdminOrgListQuery),
    async (c) => {
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
    },
  )
  .get(
    '/orgs/:id',
    apiDoc({ tag: 'Admin', summary: 'Get an organization', response: AdminOrgOut }),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const org = await loadOrg(id);
      return ok(c, AdminOrgOut, toOrgOut(org));
    },
  )
  // ---- Lifecycle pipeline board ------------------------------------------
  .get(
    '/lifecycle',
    apiDoc({
      tag: 'Admin',
      summary: 'Get the lifecycle pipeline board',
      response: AdminLifecycleBoard,
    }),
    async (c) => {
      const rows = await db.select().from(organization).orderBy(desc(organization.createdAt));
      return ok(c, AdminLifecycleBoard, {
        columns: LIFECYCLE_STATES.map((state) => ({
          lifecycleState: state,
          orgs: rows.filter((row) => row.lifecycleState === state).map(toOrgOut),
        })),
      });
    },
  )
  // ---- Lifecycle holds + billing actions (sub-router) --------------------
  .route('/orgs', adminBillingRoutes)
  // ---- Impersonation (any staff) -----------------------------------------
  .post(
    '/impersonations',
    apiDoc({
      tag: 'Admin',
      summary: 'Start an impersonation session',
      response: AdminImpersonationOut,
    }),
    zJson(StartImpersonationBody),
    async (c) => {
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
    },
  )
  .post(
    '/impersonations/:id/end',
    apiDoc({
      tag: 'Admin',
      summary: 'End an impersonation session',
      response: AdminImpersonationOut,
    }),
    zParam(impersonationParam),
    async (c) => {
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
    },
  )
  // ---- Audit feed (superadmin-only) ---------------------------------------
  .get(
    '/audit',
    requireStaffRole('superadmin'),
    apiDoc({ tag: 'Admin', summary: 'List operator audit events', response: AdminAuditPage }),
    zQuery(AdminAuditQuery),
    async (c) => {
      const { staffUserId, type, limit, offset } = c.req.valid('query');
      const filters: SQL[] = [];
      if (staffUserId) filters.push(eq(operatorAuditEvent.staffUserId, staffUserId));
      if (type) filters.push(eq(operatorAuditEvent.type, type));
      const where = filters.length > 0 ? and(...filters) : undefined;
      const rows = await db
        .select()
        .from(operatorAuditEvent)
        .where(where)
        .orderBy(desc(operatorAuditEvent.createdAt))
        .limit(limit)
        .offset(offset);
      return ok(c, AdminAuditPage, { items: rows.map(toAuditOut) });
    },
  )
  // ---- Staff management (sub-router) ------------------------------------
  .route('/staff', adminStaffRoutes)
  // ---- Metrics -----------------------------------------------------------
  .get(
    '/metrics',
    apiDoc({ tag: 'Admin', summary: 'Get admin metrics', response: AdminMetricsOut }),
    async (c) => {
      const [userTotals, orgTotals, byState, holdTotals, agentVolume, agentErrors, stuckApprovals] =
        await Promise.all([
          db.select({ n: count() }).from(user),
          db.select({ n: count() }).from(organization),
          db
            .select({ state: organization.lifecycleState, n: count() })
            .from(organization)
            .groupBy(organization.lifecycleState),
          db.select({ n: count() }).from(lifecycleHold).where(isNull(lifecycleHold.releasedAt)),
          db.select({ n: count() }).from(agentSession),
          db.select({ n: count() }).from(agentSession).where(eq(agentSession.status, 'failed')),
          db
            .select({ n: count() })
            .from(agentSession)
            .where(eq(agentSession.status, 'awaiting_approval')),
        ]);
      const counts = new Map(byState.map((r) => [r.state, r.n]));
      return ok(c, AdminMetricsOut, {
        totalUsers: countOf(userTotals),
        totalOrgs: countOf(orgTotals),
        orgsByLifecycle: LIFECYCLE_STATES.map((state) => ({
          lifecycleState: state,
          count: counts.get(state) ?? 0,
        })),
        queues: {
          stuckApprovals: countOf(stuckApprovals),
          agentErrors: countOf(agentErrors),
          agentVolume: countOf(agentVolume),
          activeHolds: countOf(holdTotals),
        },
      });
    },
  );

export default admin;
