import { describe, expect, it } from 'vitest';

import {
  PRODUCT_CAPABILITIES,
  PRODUCT_CAPABILITY_GRANTS,
  PRODUCT_ENTITLEMENT_SOURCES,
  PRODUCT_ENTITLEMENT_STATUSES,
  PRODUCT_KEYS,
  productGrantsCapability,
} from '../../src/billing';

describe('product billing contract', () => {
  it('defines Docket Pro as the product granting every current paid capability', () => {
    expect(PRODUCT_KEYS).toEqual(['docket_pro']);
    expect(PRODUCT_CAPABILITY_GRANTS.docket_pro).toEqual(PRODUCT_CAPABILITIES);

    for (const capability of PRODUCT_CAPABILITIES) {
      expect(productGrantsCapability('docket_pro', capability)).toBe(true);
    }
  });

  it('keeps entitlement lifecycle and source values stable', () => {
    expect(PRODUCT_ENTITLEMENT_STATUSES).toEqual(['trialing', 'active', 'past_due', 'canceled']);
    expect(PRODUCT_ENTITLEMENT_SOURCES).toEqual(['stripe', 'complimentary']);
  });
});
