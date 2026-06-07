/**
 * `@docket/api` — org-context middleware.
 *
 * @remarks
 * Applied via `orgs.use('/:orgId/*', orgContextMiddleware)` before the child route
 * chains. Loads the caller's human Actor for `(session.user.id, :orgId)`; a missing
 * membership 404s (existence-hiding — a non-member must not learn the org exists).
 * Sets `c.var.actorCtx` for downstream handlers + the capability guard (P4.5).
 */
import { actor, db, role } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';

/** Resolve and attach the org-scoped actor context for `/orgs/:orgId/*` routes. */
export const orgContextMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = c.get('session');
  if (!session?.user) throw new AuthError();

  const orgId = c.req.param('orgId');
  if (!orgId) throw new NotFoundError();

  const rows = await db
    .select({ actor, role })
    .from(actor)
    .leftJoin(role, eq(actor.roleId, role.id))
    .where(and(eq(actor.userId, session.user.id), eq(actor.organizationId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError();

  c.set('actorCtx', {
    orgId,
    actorId: row.actor.id,
    roleId: row.actor.roleId,
    capabilities: row.role?.capabilities ?? [],
  });

  await next();
};
