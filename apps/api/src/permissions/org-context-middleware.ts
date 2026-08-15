/**
 * `@docket/api` — org-context middleware.
 *
 * @remarks
 * Applied via `orgs.use('/:orgId/*', orgContextMiddleware)` before the child route
 * chains. Loads the caller's active, unarchived human Actor for `(session.user.id, :orgId)`;
 * a missing membership 404s (existence-hiding — a non-member must not learn the org exists).
 * Sets `c.var.actorCtx` for downstream handlers + the capability guard (P4.5).
 */
import { actor, db, organization, role } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';

/** Resolve and attach the org-scoped actor context for `/orgs/:orgId/*` routes. */
export const orgContextMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = c.get('session');
  if (!session?.user) throw new AuthError();

  const orgId = c.req.param('orgId');
  if (!orgId) throw new NotFoundError();

  // The role join is scoped by org (not just `actor.roleId = role.id`): `actor.roleId →
  // role.id` is a bare global FK with no org constraint, so a stray cross-org roleId must
  // NOT confer that other org's capabilities here. Pairing the join with
  // `role.organizationId = orgId` means an out-of-org role resolves to no row → empty
  // capabilities, defense-in-depth behind the members PATCH in-org role validation.
  const rows = await db
    .select({ actor, role, isPersonal: organization.isPersonal })
    .from(actor)
    .innerJoin(organization, eq(actor.organizationId, organization.id))
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(role.organizationId, orgId)))
    // An actor context is an authorization grant, not merely an identity lookup. Keep inactive,
    // non-human, and archived records out so downstream handlers never receive usable context.
    .where(
      and(
        eq(actor.userId, session.user.id),
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError();

  c.set('actorCtx', {
    orgId,
    actorId: row.actor.id,
    roleId: row.actor.roleId,
    capabilities: row.role?.capabilities ?? [],
    isPersonal: row.isPersonal,
  });

  await next();
};
