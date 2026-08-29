import { describe, expect, it } from 'vitest';

import { isRouteOwnedDirectWorkViewRow } from '../../src/components/work-views/work-view-object';

const ROUTE_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const FOREIGN_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

describe('route-owned work rows', () => {
  it('allows only a direct row owned by the route organization', () => {
    expect(
      isRouteOwnedDirectWorkViewRow(
        { organizationId: ROUTE_ORGANIZATION_ID, isContext: false },
        ROUTE_ORGANIZATION_ID,
      ),
    ).toBe(true);
    expect(
      isRouteOwnedDirectWorkViewRow(
        { organizationId: FOREIGN_ORGANIZATION_ID, isContext: false },
        ROUTE_ORGANIZATION_ID,
      ),
    ).toBe(false);
    expect(
      isRouteOwnedDirectWorkViewRow(
        { organizationId: ROUTE_ORGANIZATION_ID, isContext: true },
        ROUTE_ORGANIZATION_ID,
      ),
    ).toBe(false);
  });
});
