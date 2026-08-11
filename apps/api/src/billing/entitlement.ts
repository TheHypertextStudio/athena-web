/** `@docket/api` — product capability access for paid organization products. */
import { db, organization, organizationProductEntitlement } from '@docket/db';
import {
  productGrantsCapability,
  type ProductCapability,
  type ProductEntitlementStatus,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';

import { NotFoundError, ProductRequiredError } from '../error';

/** Product states that confer access. */
const ACCESS_STATUSES = new Set<ProductEntitlementStatus>(['trialing', 'active']);

/**
 * Assert that an organization owns an active product granting a capability.
 *
 * @param orgId - Organization requesting access.
 * @param capability - Paid capability required by the action.
 * @throws {ProductRequiredError} When no active owned product grants the capability.
 * @throws {NotFoundError} When the organization does not exist.
 */
export async function assertProductCapability(
  orgId: string,
  capability: ProductCapability,
): Promise<void> {
  const rows = await db
    .select({
      organizationId: organization.id,
      productKey: organizationProductEntitlement.productKey,
      status: organizationProductEntitlement.status,
    })
    .from(organization)
    .leftJoin(
      organizationProductEntitlement,
      and(
        eq(organizationProductEntitlement.organizationId, organization.id),
        eq(organizationProductEntitlement.productKey, 'docket_pro'),
      ),
    )
    .where(eq(organization.id, orgId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError('Organization not found');
  if (
    row.productKey &&
    row.status &&
    ACCESS_STATUSES.has(row.status) &&
    productGrantsCapability(row.productKey, capability)
  ) {
    return;
  }

  throw new ProductRequiredError();
}
