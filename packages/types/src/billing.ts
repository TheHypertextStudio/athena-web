/** The paid products an organization can own. */
export const PRODUCT_KEYS = ['docket_pro'] as const;

/** A stable key for a paid organization product. */
export type ProductKey = (typeof PRODUCT_KEYS)[number];

/** Capabilities supplied by paid products rather than baseline Docket. */
export const PRODUCT_CAPABILITIES = [
  'shared_work',
  'integrations',
  'mcp',
  'athena',
  'voice',
] as const;

/** A capability that can be granted by an organization product. */
export type ProductCapability = (typeof PRODUCT_CAPABILITIES)[number];

/** Product ownership states used by billing and access checks. */
export const PRODUCT_ENTITLEMENT_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;

/** The billing state of one organization product. */
export type ProductEntitlementStatus = (typeof PRODUCT_ENTITLEMENT_STATUSES)[number];

/** How an organization received a product. */
export const PRODUCT_ENTITLEMENT_SOURCES = ['stripe', 'complimentary'] as const;

/** The source of one organization product grant. */
export type ProductEntitlementSource = (typeof PRODUCT_ENTITLEMENT_SOURCES)[number];

/** Product-to-capability catalog. Baseline Docket is intentionally absent. */
export const PRODUCT_CAPABILITY_GRANTS: Readonly<Record<ProductKey, readonly ProductCapability[]>> =
  {
    docket_pro: PRODUCT_CAPABILITIES,
  };

/** True when a product includes a capability. */
export function productGrantsCapability(
  productKey: ProductKey,
  capability: ProductCapability,
): boolean {
  return PRODUCT_CAPABILITY_GRANTS[productKey].includes(capability);
}
