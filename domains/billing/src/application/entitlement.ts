/** `@docket/billing/application/entitlement` — paid product capability resolution. */
import { organization, organizationProductEntitlement } from '@docket/db';
import type { Database } from '@docket/db';
import {
  isProductKey,
  productGrantsCapability,
  type ProductCapability,
  type ProductEntitlementSource,
  type ProductEntitlementStatus,
  type ProductKey,
} from '../contracts';
import { eq } from 'drizzle-orm';

/** Product states that grant their catalogued capabilities. */
const ACCESS_STATUSES = new Set<ProductEntitlementStatus>(['trialing', 'active']);

/** A delivery-neutral product capability decision. */
export type ProductCapabilityEntitlement =
  | {
      readonly kind: 'entitled';
      readonly productKey: ProductKey;
      readonly source: ProductEntitlementSource;
    }
  | { readonly kind: 'organization-not-found' }
  | { readonly kind: 'grace-expired' }
  | { readonly kind: 'product-required' };

/** Provider-neutral entitlement columns required to decide product capability access. */
export interface ProductCapabilitySnapshotRow {
  readonly productKey: string | null;
  readonly status: ProductEntitlementStatus | null;
  readonly source: ProductEntitlementSource | null;
  readonly graceEndsAt: Date | null;
}

/**
 * Resolve one capability from entitlement rows loaded in the caller's database snapshot.
 *
 * @param rows - Entitlement rows for one existing organization.
 * @param capability - Paid capability required by the action.
 * @param now - Boundary used for payment-grace evaluation.
 * @returns The access decision without an organization-existence result.
 */
export function resolveProductCapabilitySnapshot(
  rows: readonly ProductCapabilitySnapshotRow[],
  capability: ProductCapability,
  now: Date = new Date(),
): Exclude<ProductCapabilityEntitlement, { readonly kind: 'organization-not-found' }> {
  let graceExpired = false;
  for (const row of rows) {
    const productKey = row.productKey && isProductKey(row.productKey) ? row.productKey : null;
    const productGrantsRequestedCapability =
      productKey !== null && productGrantsCapability(productKey, capability);
    if (
      productGrantsRequestedCapability &&
      row.status === 'past_due' &&
      row.graceEndsAt !== null &&
      row.graceEndsAt <= now
    ) {
      graceExpired = true;
    }
    if (
      productGrantsRequestedCapability &&
      row.status &&
      row.source &&
      (ACCESS_STATUSES.has(row.status) ||
        (row.status === 'past_due' && row.graceEndsAt !== null && row.graceEndsAt > now))
    ) {
      return { kind: 'entitled', productKey, source: row.source };
    }
  }
  return graceExpired ? { kind: 'grace-expired' } : { kind: 'product-required' };
}

/**
 * Resolve whether an organization owns an active product granting a capability.
 *
 * @remarks
 * Baseline Docket has no entitlement row. Organization lifecycle state is deliberately absent
 * from this decision: data retention and paid-product ownership are independent facts.
 *
 * @param db - Product-entitlement store.
 * @param organizationId - Organization requesting access.
 * @param capability - Paid capability required by the action.
 * @returns A delivery-neutral access outcome.
 */
export async function resolveProductCapability(
  db: Database,
  organizationId: string,
  capability: ProductCapability,
  now: Date = new Date(),
): Promise<ProductCapabilityEntitlement> {
  const rows = await db
    .select({
      organizationId: organization.id,
      productKey: organizationProductEntitlement.productKey,
      status: organizationProductEntitlement.status,
      source: organizationProductEntitlement.source,
      graceEndsAt: organizationProductEntitlement.graceEndsAt,
    })
    .from(organization)
    .leftJoin(
      organizationProductEntitlement,
      eq(organizationProductEntitlement.organizationId, organization.id),
    )
    .where(eq(organization.id, organizationId));

  if (rows.length === 0) return { kind: 'organization-not-found' };
  return resolveProductCapabilitySnapshot(rows, capability, now);
}
