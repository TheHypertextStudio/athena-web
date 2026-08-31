/**
 * `@docket/api` — service-admin (operator back-office) router (mounted at `/admin`).
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
import { Hono, type Schema } from 'hono';

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
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { requireStaffRole, staffMiddleware } from '../permissions/staff-guard';

import {
  LIFECYCLE_STATES,
  audit,
  countOf,
  idParam,
  impersonationParam,
  loadActiveExemptOrgIds,
  loadOrg,
  toAuditOut,
  toImpersonationOut,
  toOrgOut,
  toUserOut,
} from './admin-serializers';
import { adminBillingRoutes } from './admin-billing-routes';
import { adminDiscountRoutes } from './admin-discount-routes';
import { adminSettingsRoutes } from './admin-settings-routes';
import { adminStaffRoutes } from './admin-staff-routes';

/** The staff-gated operator back-office router. */
export function createAdminRoutes<
  TNotificationSchema extends Schema,
  TNotificationBasePath extends string,
>(notificationRoutes: Hono<AppEnv, TNotificationSchema, TNotificationBasePath>) {
  return (
    new Hono<AppEnv>()
      .use('*', staffMiddleware)
      // ---- Users --------------------------------------------------------------
      .get(
        '/users',
        apiDoc({
          tag: 'Admin',
          summary: 'List users',
          response: AdminUserPage,
          description: `Returns a paginated, newest-first slice of every Docket end-user account across all organizations — the operator back-office user directory.

**Search & paging.** When \`search\` is supplied it filters case-insensitively on a substring of the user's name OR email; omit it to list everyone. Rows are ordered by \`createdAt\` descending and bounded by offset pagination (\`limit\` 1..100, default 50; \`offset\` default 0). The response carries \`items\` plus \`total\` — the full count of rows matching the (optional) search — so the UI can render pager controls.

**Access.** Mounted under \`/admin\`, which is gated by \`staffMiddleware\`: the caller must be a registered Docket operator (a \`staff_user\` row). A signed-in non-operator gets \`403 forbidden\`; an unauthenticated caller \`401 unauthorized\`. This is a read, so any staff tier (\`support\`, \`finance\`, \`superadmin\`) suffices — there is no \`requireStaffRole\` tier gate.

**Side effects.** None — a pure read; writes no operator audit event.

**Related.** \`GET /admin/users/{id}\` for one user plus their org memberships.`,
        }),
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
        apiDoc({
          tag: 'Admin',
          summary: 'Get a user',
          response: AdminUserDetail,
          description: `Returns one Docket account by id together with every organization it belongs to — the operator user-detail screen.

**Behavior.** Loads the \`user\` row, then joins \`actor → organization\` to enumerate the human memberships (agent/service actors are excluded — only \`kind = 'human'\`). Each membership reports the org's id, name, slug, current data-lifecycle state, the user's \`actorId\` within that org, and its assigned \`roleId\` (\`null\` when the actor holds no role). Returns \`404 not_found\` when no user matches the id.

**Access.** Behind \`staffMiddleware\` (any staff tier). A non-operator session gets \`403\`; an anonymous one \`401\`.

**Side effects.** None — a read; no audit event.

**Related.** \`GET /admin/users\` to find a user; \`POST /admin/impersonations\` to act as one for support.`,
        }),
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
        apiDoc({
          tag: 'Admin',
          summary: 'List organizations',
          response: AdminOrgPage,
          description: `Returns a paginated, newest-first slice of every organization (tenant) in Docket — the operator org directory.

**Search & filter.** \`search\` matches a case-insensitive substring of the org name OR slug. \`lifecycleState\` optionally filters the legacy organization-retention marker. Billing access is reported through \`GET /admin/orgs/{id}/billing-state\` and does not use that marker. Both filters combine with AND. Results use offset pagination and newest-first order.

**Access.** Behind \`staffMiddleware\` (any staff tier — it's a read). Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None — a read; no audit event.

**Related.** \`GET /admin/orgs/{id}\` for one org and \`GET /admin/orgs/{id}/billing-state\` for provider-backed access.`,
        }),
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
          const exemptIds = await loadActiveExemptOrgIds(
            db,
            items.map((i) => i.id),
          );
          return ok(c, AdminOrgPage, {
            items: items.map((i) => toOrgOut(i, exemptIds)),
            total: countOf(totals),
          });
        },
      )
      .get(
        '/orgs/:id',
        apiDoc({
          tag: 'Admin',
          summary: 'Get an organization',
          response: AdminOrgOut,
          description: `Returns one organization by id — the operator org-detail header.

**Behavior.** Loads the \`organization\` row and serializes it, including \`isPersonal\` (a single-member personal workspace, which cannot take invites) and the lifecycle timestamps \`exportReadyAt\`/\`deleteAfterAt\`. Returns \`404 not_found\` when no org matches.

**Access.** Behind \`staffMiddleware\` (any staff tier). Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None — a read; no audit event.

**Related.** \`GET /admin/orgs/{id}/billing-state\`, \`POST /admin/orgs/{id}/reconcile\`, and \`POST /admin/orgs/{id}/extend-trial\` provide safe billing operations.`,
        }),
        zParam(idParam),
        async (c) => {
          const { id } = c.req.valid('param');
          const org = await loadOrg(id);
          const exemptIds = await loadActiveExemptOrgIds(db, [org.id]);
          return ok(c, AdminOrgOut, toOrgOut(org, exemptIds));
        },
      )
      // ---- Lifecycle pipeline board ------------------------------------------
      .get(
        '/lifecycle',
        apiDoc({
          tag: 'Admin',
          summary: 'Get the legacy organization-retention board',
          response: AdminLifecycleBoard,
          description: `Returns every organization grouped by the legacy organization-retention marker for migration diagnostics.

**Behavior.** Loads all orgs (newest first) once, then buckets them by the legacy retention marker. Columns are always present even when empty, so old migration states remain inspectable. This is the same organization data as \`GET /admin/orgs\`, reshaped for compatibility diagnostics.

**Billing boundary.** Billing events never write these columns. Cancellation and payment failure change the Docket Pro entitlement only. Account deletion remains under the confirmed user Danger Zone flow. The Admin navigation no longer links this compatibility board.

**Access.** Behind \`staffMiddleware\` (any staff tier — a read). Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None — a read; no audit event.

**Related.** \`GET /admin/orgs/{id}/billing-state\` reports the current payment and access state.`,
        }),
        async (c) => {
          const rows = await db.select().from(organization).orderBy(desc(organization.createdAt));
          const exemptIds = await loadActiveExemptOrgIds(
            db,
            rows.map((r) => r.id),
          );
          return ok(c, AdminLifecycleBoard, {
            columns: LIFECYCLE_STATES.map((state) => ({
              lifecycleState: state,
              orgs: rows
                .filter((row) => row.lifecycleState === state)
                .map((row) => toOrgOut(row, exemptIds)),
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
          status: 201,
          tag: 'Admin',
          summary: 'Start an impersonation session',
          response: AdminImpersonationOut,
          description: `Opens a time-boxed, audited support-impersonation session so an operator can view the product as a specific end-user while debugging a ticket.

**Behavior.** Validates that \`targetUserId\` resolves to a real account (else \`404 not_found\`), then inserts an \`impersonation_session\` row owned by the calling operator (\`staffUserId\` from \`staffCtx\`) with the supplied \`reason\` and an \`expiresAt = now + ttlMinutes\` (TTL 1..480 min, default 60). The returned record carries \`startedAt\`/\`expiresAt\` and a null \`endedAt\` (still active).

**Side effects.** Creates the impersonation session **and** writes an \`impersonation.started\` operator audit event (subject = the target actor/user) capturing the impersonation id, reason, and TTL. The reason is mandatory precisely so every impersonation is justified in the immutable audit trail.

**Access.** Behind \`staffMiddleware\`. Any staff tier may impersonate (support is the primary user) — there is no \`requireStaffRole\` gate here — but the action is always attributed and audited. Non-operator → \`403\`; anonymous → \`401\`.

**Related.** \`POST /admin/impersonations/{id}/end\` to close the session early; \`GET /admin/audit\` (superadmin) to review impersonation history.`,
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
          return created(c, AdminImpersonationOut, toImpersonationOut(sess));
        },
      )
      .post(
        '/impersonations/:id/end',
        apiDoc({
          tag: 'Admin',
          summary: 'End an impersonation session',
          response: AdminImpersonationOut,
          description: `Closes an active support-impersonation session before its TTL elapses, stamping \`endedAt\`.

**Behavior.** Conditionally updates the session — matched by id AND still un-ended (\`endedAt IS NULL\`) — to set \`endedAt = now\`. Returns the ended record. Returns \`404 not_found\` when the id is unknown OR the session was already ended (the guard makes ending idempotent: a second call no longer matches). Note a naturally expired session (past \`expiresAt\`) may still be ended here to make the closure explicit and audited.

**Side effects.** Writes an \`impersonation.ended\` operator audit event (subject = the target user) referencing the impersonation id, completing the start/end pair in the audit trail.

**Access.** Behind \`staffMiddleware\` (any staff tier). Non-operator → \`403\`; anonymous → \`401\`.

**Related.** \`POST /admin/impersonations\` to start a session.`,
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
        apiDoc({
          tag: 'Admin',
          summary: 'List operator audit events',
          response: AdminAuditPage,
          description: `Returns the immutable operator audit feed — every privileged back-office action (impersonations, lifecycle holds, billing actions, lifecycle-state changes, staff grants/revocations) written by the other admin endpoints.

**Filter & paging.** \`staffUserId\` narrows to one acting operator; \`type\` narrows to one event type (e.g. \`billing.reconciled\`, \`complimentary.granted\`, \`staff.granted\`). Both optional, combined with AND. Newest-first, offset-paginated (\`limit\` 1..200 default 50, \`offset\` default 0). Each event carries the acting \`staffUserId\`, the \`type\`, the \`subjectType\`/\`subjectId\` it acted on, and a free-form \`metadata\` object.

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\` on top of \`staffMiddleware\`. The audit log is the system of record for accountability, so it must not be readable (or tamperable) by the same \`support\`/\`finance\` operators whose actions it records — only \`superadmin\` may review it. \`support\`/\`finance\` callers get \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** None — a read; reading the audit log does not itself produce an audit event.

**Related.** Every mutating \`/admin/*\` route appends to this feed.`,
        }),
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
      // ---- Service controls (sub-router) -------------------------------------
      .route('/service-controls', adminSettingsRoutes)
      // ---- Staff management (sub-router) ------------------------------------
      .route('/staff', adminStaffRoutes)
      .route('/discount-applications', adminDiscountRoutes)
      // ---- Notification announcements + monitoring --------------------------
      .route('/notifications', notificationRoutes)
      // ---- Metrics -----------------------------------------------------------
      .get(
        '/metrics',
        apiDoc({
          tag: 'Admin',
          summary: 'Get admin metrics',
          response: AdminMetricsOut,
          description: `Returns the operator home-dashboard metrics: steady-state totals plus actionable queue-health signals (mvp-plan §8.9 — deliberately aggregate counts only, never session contents).

**Counts.** \`totalUsers\` and \`totalOrgs\` are the full account/tenant totals; \`orgsByLifecycle\` breaks orgs down by data-lifecycle state in the fixed pipeline order (states with no orgs report \`count: 0\`).

**Queues (triage signals).** \`stuckApprovals\` = agent sessions parked in \`awaiting_approval\` (work blocked on a human decision); \`agentErrors\` = sessions in the \`failed\` terminal state; \`agentVolume\` = total agent sessions ever created; \`activeHolds\` = un-released lifecycle holds currently pausing the delete sweep. These are the numbers an operator triages from the home screen.

**Access.** Behind \`staffMiddleware\` (any staff tier — a read). Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None — a read; no audit event.

**Related.** \`GET /admin/lifecycle\` expands the \`orgsByLifecycle\` buckets into the full board; \`GET /admin/audit\` (superadmin) for the action history behind these signals.`,
        }),
        async (c) => {
          const [
            userTotals,
            orgTotals,
            byState,
            holdTotals,
            agentVolume,
            agentErrors,
            stuckApprovals,
          ] = await Promise.all([
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
      )
  );
}
