import { describe, expect, it } from 'vitest';

import {
  isProductKey,
  PRODUCT_CAPABILITIES,
  PRODUCT_CAPABILITY_GRANTS,
  PRODUCT_ENTITLEMENT_SOURCES,
  PRODUCT_ENTITLEMENT_STATUSES,
  PRODUCT_KEYS,
  productGrantsCapability,
} from '../src/contracts';

describe('product contract', () => {
  it('defines Docket Pro as the paid product and grants its declared capabilities', () => {
    expect(PRODUCT_KEYS).toEqual(['docket_pro']);
    expect(PRODUCT_CAPABILITY_GRANTS.docket_pro).toEqual(PRODUCT_CAPABILITIES);

    for (const capability of PRODUCT_CAPABILITIES) {
      expect(productGrantsCapability('docket_pro', capability)).toBe(true);
    }
  });

  it('recognizes product keys and exposes entitlement lifecycle values', () => {
    expect(isProductKey('docket_pro')).toBe(true);
    expect(isProductKey('future_product')).toBe(false);
    expect(PRODUCT_ENTITLEMENT_STATUSES).toEqual(['trialing', 'active', 'past_due', 'canceled']);
    expect(PRODUCT_ENTITLEMENT_SOURCES).toEqual(['stripe', 'complimentary']);
  });
});
