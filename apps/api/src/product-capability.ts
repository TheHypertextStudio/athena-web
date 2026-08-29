/** API delivery mapping for organization-product capability access. */
import { resolveProductCapability } from '@docket/billing/application/entitlement';
import type { ProductCapability } from '@docket/billing/contracts';
import { db, organization, type Database } from '@docket/db';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from './context';
import { BillingGraceExpiredError, NotFoundError, ProductRequiredError } from './error';

/**
 * Assert that an organization owns an active product granting a capability.
 *
 * @param organizationId - Organization requesting access.
 * @param capability - Paid capability required by the action.
 * @param database - Database or transaction that owns the authorization snapshot.
 * @throws {ProductRequiredError} When no active product grants the capability.
 * @throws {NotFoundError} When the organization does not exist.
 */
export async function assertProductCapability(
  organizationId: string,
  capability: ProductCapability,
  database: Database = db,
): Promise<void> {
  const entitlement = await resolveProductCapability(database, organizationId, capability);
  switch (entitlement.kind) {
    case 'entitled':
      return;
    case 'organization-not-found':
      throw new NotFoundError('Organization not found');
    case 'grace-expired':
      throw new BillingGraceExpiredError();
    case 'product-required':
      throw new ProductRequiredError();
    /* v8 ignore start -- @preserve exhaustive: every domain entitlement is handled above */
    default: {
      const exhaustive: never = entitlement;
      return exhaustive;
    }
    /* v8 ignore stop */
  }
}

/**
 * Keep personal baseline work writable and require Docket Pro for shared-work mutations.
 *
 * @param organizationId - Organization whose work would change.
 * @param knownPersonal - Personal status already loaded by the caller, when available.
 * @param database - Database or transaction that owns the authorization snapshot.
 * @throws {ProductRequiredError} When shared work has no active Docket Pro entitlement.
 * @throws {BillingGraceExpiredError} When payment grace has ended.
 * @throws {NotFoundError} When the organization does not exist.
 */
export async function assertSharedWorkWritable(
  organizationId: string,
  knownPersonal?: boolean,
  database: Database = db,
): Promise<void> {
  let isPersonal = knownPersonal;
  if (isPersonal === undefined) {
    const rows = await database
      .select({ isPersonal: organization.isPersonal })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Organization not found');
    isPersonal = rows[0].isPersonal;
  }
  if (isPersonal) return;
  await assertProductCapability(organizationId, 'shared_work', database);
}

/** Guard an organization route with one product capability. */
export function productCapabilityGuard(capability: ProductCapability): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await assertProductCapability(c.get('actorCtx').orgId, capability);
    await next();
  };
}
