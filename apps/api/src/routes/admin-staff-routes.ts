import { db, staffUser, user } from '@docket/db';
import { count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { AdminStaffListQuery, AdminStaffOut, AdminStaffPage, CreateStaffBody } from '../admin-dto';
import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';

import { audit, countOf, staffParam, toStaffOut } from './admin-serializers';

/**
 * Sub-router for staff-management routes (mounted at `/staff`).
 * All routes require superadmin role + staff auth from the parent router's middleware.
 */
export const adminStaffRoutes = new Hono<AppEnv>()
  .get('/', requireStaffRole('superadmin'), zQuery(AdminStaffListQuery), async (c) => {
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
  })
  .post('/', requireStaffRole('superadmin'), zJson(CreateStaffBody), async (c) => {
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
  })
  .delete('/:id', requireStaffRole('superadmin'), zParam(staffParam), async (c) => {
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
  });
