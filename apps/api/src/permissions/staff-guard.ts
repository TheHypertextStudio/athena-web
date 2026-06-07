/**
 * `@docket/api` — the service-admin staff guard.
 *
 * @remarks
 * The operator back-office (`/v1/admin/*`) is gated by {@link staffMiddleware}: it
 * resolves the caller's session → global user → `staff_user` row and 403s anyone who
 * is not a registered Docket operator (existence is not hidden here — a logged-in
 * non-staff user simply lacks the privilege). On success it sets `c.var.staffCtx`.
 * {@link requireStaffRole} layers a tier check (support &lt; finance &lt; superadmin)
 * on top, for finance/superadmin-only mutations like billing actions.
 */
import { db, staffUser } from '@docket/db';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv, StaffRole } from '../context';
import { AuthError, CapabilityError } from '../error';

/** The staff tiers in ascending privilege rank (index = rank). */
const STAFF_RANK: readonly StaffRole[] = ['support', 'finance', 'superadmin'];

/** Numeric rank of a staff role (higher = more privileged). */
function rankOf(role: StaffRole): number {
  return STAFF_RANK.indexOf(role);
}

/**
 * Resolve and attach the service-operator staff context for `/admin/*` routes.
 *
 * @remarks
 * A null session 401s; an authenticated user without a `staff_user` row 403s. On
 * success `c.var.staffCtx` carries the staff record id, the underlying user id, and
 * the operator tier for downstream handlers + {@link requireStaffRole}.
 */
export const staffMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = c.get('session');
  if (!session?.user) throw new AuthError();

  const rows = await db
    .select({ id: staffUser.id, role: staffUser.role })
    .from(staffUser)
    .where(eq(staffUser.userId, session.user.id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new CapabilityError('Staff access required');

  c.set('staffCtx', { staffUserId: row.id, userId: session.user.id, role: row.role });

  await next();
};

/**
 * Build a guard requiring at least the `min` staff tier (rank cascade).
 *
 * @remarks
 * Runs AFTER {@link staffMiddleware} (which loads `staffCtx.role`). A `finance`
 * operator satisfies `requireStaffRole('finance')`; a `support` operator does not and
 * 403s. `superadmin` satisfies every tier.
 *
 * @param min - The minimum staff tier the route requires.
 * @returns a Hono middleware enforcing the tier.
 */
export function requireStaffRole(min: StaffRole): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { role } = c.get('staffCtx');
    if (rankOf(role) < rankOf(min)) throw new CapabilityError('Insufficient staff role');
    await next();
  };
}
