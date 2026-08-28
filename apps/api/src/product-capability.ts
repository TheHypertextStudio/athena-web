/** API delivery mapping for organization-product capability access. */
import { resolveProductCapability } from '@docket/billing/application/entitlement';
import type { ProductCapability } from '@docket/billing/contracts';
import { db } from '@docket/db';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from './context';
import { BillingGraceExpiredError, NotFoundError, ProductRequiredError } from './error';

/**
 * Assert that an organization owns an active product granting a capability.
 *
 * @param organizationId - Organization requesting access.
 * @param capability - Paid capability required by the action.
 * @throws {ProductRequiredError} When no active product grants the capability.
 * @throws {NotFoundError} When the organization does not exist.
 */
export async function assertProductCapability(
  organizationId: string,
  capability: ProductCapability,
): Promise<void> {
  const entitlement = await resolveProductCapability(db, organizationId, capability);
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

/** Guard an organization route with one product capability. */
export function productCapabilityGuard(capability: ProductCapability): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await assertProductCapability(c.get('actorCtx').orgId, capability);
    await next();
  };
}
