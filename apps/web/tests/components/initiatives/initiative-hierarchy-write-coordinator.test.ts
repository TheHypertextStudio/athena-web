import { describe, expect, it } from 'vitest';

import { InitiativeHierarchyWriteCoordinator } from '@/components/initiatives/initiative-hierarchy-write-coordinator';

describe('InitiativeHierarchyWriteCoordinator', () => {
  it('holds one child lock through write and required refresh states', () => {
    const coordinator = new InitiativeHierarchyWriteCoordinator();
    const first = coordinator.claim({
      organizationId: 'org-a',
      childInitiativeId: 'child-a',
      ownerId: 'picker-a',
      mutation: {
        kind: 'create',
        parentInitiativeId: 'parent-a',
        childInitiativeId: 'child-a',
      },
    });
    expect(first).not.toBeNull();
    expect(
      coordinator.claim({
        organizationId: 'org-a',
        childInitiativeId: 'child-a',
        ownerId: 'picker-b',
        mutation: {
          kind: 'create',
          parentInitiativeId: 'parent-b',
          childInitiativeId: 'child-a',
        },
      }),
    ).toBeNull();

    const secondChild = coordinator.claim({
      organizationId: 'org-a',
      childInitiativeId: 'child-b',
      ownerId: 'picker-b',
      mutation: {
        kind: 'create',
        parentInitiativeId: 'parent-a',
        childInitiativeId: 'child-b',
      },
    });
    expect(secondChild).not.toBeNull();

    if (first === null) throw new Error('first hierarchy lock was not claimed');
    coordinator.transition(first, 'refreshing');
    expect(coordinator.isBusy('org-a', 'child-a')).toBe(true);
    coordinator.transition(first, 'refresh_failed');
    expect(coordinator.isBusy('org-a', 'child-a')).toBe(true);

    coordinator.release(first);
    expect(coordinator.isBusy('org-a', 'child-a')).toBe(false);
    expect(coordinator.isBusy('org-a', 'child-b')).toBe(true);
    expect(
      coordinator.claim({
        organizationId: 'org-a',
        childInitiativeId: 'child-a',
        ownerId: 'picker-c',
        mutation: {
          kind: 'create',
          parentInitiativeId: 'parent-c',
          childInitiativeId: 'child-a',
        },
      }),
    ).not.toBeNull();
  });
});
