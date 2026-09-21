import type { ViewTarget } from '@docket/work/view-contract';
import { describe, expect, it } from 'vitest';

import type { WorkViewRowFor } from '../../src/components/work-views/renderer-types';
import {
  isRouteOwnedDirectWorkViewRow,
  workViewRowInteractionPolicy,
} from '../../src/components/work-views/work-view-object';

const ROUTE_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const FOREIGN_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

describe('work row interaction policy', () => {
  // Only the fields the policy reads; the full projection is irrelevant to what it decides.
  const initiative = {
    target: 'initiative',
    id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
    organizationId: ROUTE_ORGANIZATION_ID,
    isContext: false,
    name: 'Build a safe streets delivery program',
    parent: null,
    parentLinkId: null,
  } as unknown as WorkViewRowFor<ViewTarget>;

  it('lets a contributor write and drag a direct row in the route workspace', () => {
    expect(workViewRowInteractionPolicy(initiative, ROUTE_ORGANIZATION_ID, true)).toMatchObject({
      writable: true,
      dragDisabled: false,
      actionScope: 'all',
    });
  });

  it('leaves a viewer with a reference-only row that cannot be selected, written, or dragged', () => {
    // The release roster spec used to prove this in a browser by demoting the signed-in Owner. The
    // last-owner guard now needs a second account-backed Owner for that, and the product has no
    // way to redeem an invitation from a test, so the decision is pinned here at its source.
    expect(workViewRowInteractionPolicy(initiative, ROUTE_ORGANIZATION_ID, false)).toMatchObject({
      writable: false,
      dragDisabled: true,
      actionScope: 'reference',
    });
  });
});

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
