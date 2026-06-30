import { db, staffUser, user } from '@docket/db';
import { count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { AdminStaffListQuery, AdminStaffOut, AdminStaffPage, CreateStaffBody } from '../admin-dto';
import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';

import { audit, countOf, staffParam, toStaffOut } from './admin-serializers';

/**
 * Sub-router for staff-management routes (mounted at `/staff`).
 * All routes require superadmin role + staff auth from the parent router's middleware.
 */
export const adminStaffRoutes = new Hono<AppEnv>()
  .get(
    '/',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'List staff members',
      response: AdminStaffPage,
      description: `Returns the roster of Docket operators — every \`staff_user\` joined to its underlying global account — for the staff-management screen.

**Behavior.** Joins \`staff_user → user\` so each row reports the staff id, the underlying \`userId\`, the operator \`role\` tier (\`support\`, \`finance\`, \`superadmin\`), and the person's name/email. Newest-first, offset-paginated (\`limit\` 1..100 default 50, \`offset\` default 0); \`total\` carries the full staff count.

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\` on top of \`staffMiddleware\`. Who holds operator privilege (and at what tier) is itself privileged information, so only \`superadmin\` may enumerate the roster. \`support\`/\`finance\` callers get \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** None — a read; no audit event.

**Related.** \`POST /admin/staff\` to grant; \`DELETE /admin/staff/{id}\` to revoke.`,
    }),
    zQuery(AdminStaffListQuery),
    async (c) => {
      const { limit, offset } = c.req.valid('query');
      const [items, totals] = await Promise.all([
        db
          .select({ staff: staffUser, name: user.name, email: user.email })
          .from(staffUser)
          .innerJoin(user, eq(staffUser.userId, user.id))
          .orderBy(desc(staffUser.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(staffUser),
      ]);
      return ok(c, AdminStaffPage, {
        items: items.map((r) => toStaffOut(r.staff, { name: r.name, email: r.email })),
        total: countOf(totals),
      });
    },
  )
  .post(
    '/',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Grant staff access',
      response: AdminStaffOut,
      description: `Promotes an existing Docket account to an operator at a chosen tier — the only API path that creates a \`staff_user\` (outside the dev-only \`STAFF_BOOTSTRAP_EMAILS\` auto-grant).

**Behavior.** Resolves \`userId\` to a real account (else \`404 not_found\`), rejects a user who is already staff (\`409 conflict\` — re-granting/changing a tier is not done by re-inserting), then inserts a \`staff_user\` with the requested \`role\` (\`support\` < \`finance\` < \`superadmin\`). Returns the new staff record joined with the user's name/email.

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\`: minting operators (especially other superadmins) is the highest-trust action in the back-office and must never be available to \`support\`/\`finance\`. They get \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** Creates the operator **and** writes a \`staff.granted\` operator audit event (subject = the new \`staff_user\`) capturing the target user id and granted role.

**Related.** \`DELETE /admin/staff/{id}\` to revoke; \`GET /admin/staff\` for the roster.`,
    }),
    zJson(CreateStaffBody),
    async (c) => {
      const { userId, role } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const userRows = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      const u = userRows[0];
      if (!u) throw new NotFoundError('User not found');
      const existing = await db
        .select({ id: staffUser.id })
        .from(staffUser)
        .where(eq(staffUser.userId, userId))
        .limit(1);
      if (existing[0]) throw new ConflictError('User is already a staff member');
      const inserted = await db.insert(staffUser).values({ userId, role }).returning();
      const staff = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
      if (!staff) throw new NotFoundError('Staff insert returned no row');
      await audit(db, staffUserId, 'staff.granted', 'staff_user', staff.id, {
        targetUserId: userId,
        role,
      });
      return ok(c, AdminStaffOut, toStaffOut(staff, u));
    },
  )
  .delete(
    '/:id',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Revoke staff access',
      response: AdminStaffOut,
      description: `Removes an operator, deleting their \`staff_user\` row so they revert to an ordinary signed-in account.

**Behavior.** Refuses to revoke the caller's own staff id (\`409 conflict\` — an operator cannot lock themselves out, which also prevents removing the last superadmin by self-deletion), then deletes the \`staff_user\` by id. Returns \`404 not_found\` when the id is unknown. The returned record echoes the deleted row's role and target user id (name/email are blanked since the join is no longer fetched).

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\`: revoking operators is as sensitive as granting them and is restricted to \`superadmin\`. \`support\`/\`finance\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** Deletes the operator **and** writes a \`staff.revoked\` operator audit event (subject = the removed \`staff_user\`) capturing the target user id and the role that was held.

**Related.** \`POST /admin/staff\` to grant; \`GET /admin/staff\` for the roster.`,
    }),
    zParam(staffParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { staffUserId } = c.get('staffCtx');
      if (id === staffUserId) throw new ConflictError('Cannot revoke your own staff access');
      const deleted = await db.delete(staffUser).where(eq(staffUser.id, id)).returning();
      const staff = deleted[0];
      if (!staff) throw new NotFoundError('Staff member not found');
      await audit(db, staffUserId, 'staff.revoked', 'staff_user', staff.id, {
        targetUserId: staff.userId,
        role: staff.role,
      });
      return ok(c, AdminStaffOut, toStaffOut(staff, { name: '', email: '' }));
    },
  );
