import '@testing-library/jest-dom/vitest';

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRegisterInitiativeActions } from '../../../src/components/initiatives/initiative-actions';
import { InteractionProvider } from '../../../src/lib/actions/interaction-provider';
import type { ObjectRef } from '../../../src/lib/actions/object';
import { createActionRegistry } from '../../../src/lib/actions/registry';
import * as initiativeMutations from '../../../src/components/initiatives/initiative-hierarchy-mutations';
import { makeQueryWrapper, okResponse } from '../../support/query';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { invalidateWorkTargetQueries, patchInitiative } = vi.hoisted(() => ({
  invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
  patchInitiative: vi.fn(),
}));

vi.mock('../../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));
vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          initiatives: { ':id': { $patch: patchInitiative } },
        },
      },
    },
  },
}));

const open = vi.fn();
vi.mock('../../../src/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open }),
}));

vi.mock('../../../src/components/initiatives/initiative-hierarchy-mutations', async () => {
  const actual = await vi.importActual<typeof initiativeMutations>(
    '../../../src/components/initiatives/initiative-hierarchy-mutations',
  );
  return { ...actual, writeInitiativeHierarchyMutation: vi.fn().mockResolvedValue(undefined) };
});

function Registration(): null {
  useRegisterInitiativeActions();
  return null;
}

function setup() {
  const registry = createActionRegistry();
  const { client } = makeQueryWrapper();
  render(
    <QueryClientProvider client={client}>
      <InteractionProvider registry={registry}>
        <Registration />
      </InteractionProvider>
    </QueryClientProvider>,
  );
  return registry;
}

const child: ObjectRef = {
  kind: 'initiative',
  id: 'child',
  organizationId: 'org-1',
  title: 'Membership portal',
  meta: { parentInitiativeId: 'root', parentLinkId: 'link-child' },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('Initiative actions', () => {
  it('registers one Initiative action set for navigation and hierarchy editing', () => {
    const registry = setup();
    expect(registry.snapshot().ids).toEqual([
      'initiative.addLabel',
      'initiative.addSubinitiative',
      'initiative.changeParent',
      'initiative.copy',
      'initiative.moveToTopLevel',
      'initiative.open',
      'initiative.setLeadTeam',
      'initiative.setOwner',
    ]);
    expect(registry.getByRelation('initiative.parent')?.id).toBe('initiative.changeParent');
  });

  it('routes a dropped parent through the Initiative-owned command port', async () => {
    const registry = setup();
    await registry.invoke('initiative.changeParent', () => ({
      objects: [child],
      target: {
        kind: 'initiative',
        id: 'new-parent',
        organizationId: 'org-1',
        title: 'New parent',
      },
      source: 'drag',
      organizationId: 'org-1',
    }));

    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith('org-1', {
      kind: 'move',
      linkId: 'link-child',
      parentInitiativeId: 'new-parent',
      childInitiativeId: 'child',
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'initiative',
      ownerOrganizationId: 'org-1',
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps foreign Initiative hierarchy writes in the route context', async () => {
    const registry = setup();
    const foreignChild: ObjectRef = {
      ...child,
      organizationId: 'org-b',
    };

    await registry.invoke('initiative.changeParent', () => ({
      objects: [foreignChild],
      target: {
        kind: 'initiative',
        id: 'new-parent',
        organizationId: 'org-a',
        title: 'New parent',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith('org-a', {
      kind: 'move',
      linkId: 'link-child',
      parentInitiativeId: 'new-parent',
      childInitiativeId: 'child',
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'initiative',
      ownerOrganizationId: 'org-a',
    });
  });

  it('opens an Initiative from a hub context without a route organization', async () => {
    const registry = setup();

    await registry.invoke('initiative.open', () => ({
      objects: [{ ...child, organizationId: 'org-b' }],
      source: 'context-menu',
      organizationId: null,
    }));

    expect(push).toHaveBeenCalledWith('/orgs/org-b/initiatives/child');
  });

  it('rejects an Initiative property target from another organization', async () => {
    const registry = setup();

    await registry.invoke('initiative.setOwner', () => ({
      objects: [{ ...child, organizationId: 'org-b' }],
      target: {
        kind: 'actor',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
        organizationId: 'org-a',
        title: 'New owner',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(patchInitiative).not.toHaveBeenCalled();
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
  });

  it('writes and invalidates same-owner Initiative properties through the subject owner', async () => {
    patchInitiative.mockResolvedValue(okResponse({}));
    const registry = setup();

    await registry.invoke('initiative.setOwner', () => ({
      objects: [{ ...child, organizationId: 'org-b' }],
      target: {
        kind: 'actor',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
        organizationId: 'org-b',
        title: 'New owner',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(patchInitiative).toHaveBeenCalledWith({
      param: { orgId: 'org-b', id: 'child' },
      json: { ownerId: '01ARZ3NDEKTSV4RRFFQ69G5FAY' },
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'initiative',
      ownerOrganizationId: 'org-b',
    });
  });

  it('refreshes the eligible Initiative owner when a later property write fails', async () => {
    patchInitiative
      .mockResolvedValueOnce(okResponse({}))
      .mockRejectedValueOnce(new Error('second Initiative write failed'));
    const registry = setup();

    const result = await registry.invoke('initiative.setOwner', () => ({
      objects: [
        { ...child, id: 'first', organizationId: 'org-b' },
        { ...child, id: 'second', organizationId: 'org-b' },
      ],
      target: {
        kind: 'actor',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
        organizationId: 'org-b',
        title: 'New owner',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(result.status).toBe('failed');
    expect(patchInitiative).toHaveBeenCalledTimes(2);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(1);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'initiative',
      ownerOrganizationId: 'org-b',
    });
  });

  it('refreshes only the target owner for mixed-owner Initiative properties', async () => {
    patchInitiative.mockResolvedValue(okResponse({}));
    const registry = setup();

    const result = await registry.invoke('initiative.setOwner', () => ({
      objects: [
        { ...child, id: 'eligible', organizationId: 'org-b' },
        { ...child, id: 'foreign', organizationId: 'org-c' },
      ],
      target: {
        kind: 'actor',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
        organizationId: 'org-b',
        title: 'New owner',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(result.status).toBe('ran');
    expect(patchInitiative).toHaveBeenCalledTimes(1);
    expect(patchInitiative).toHaveBeenCalledWith({
      param: { orgId: 'org-b', id: 'eligible' },
      json: { ownerId: '01ARZ3NDEKTSV4RRFFQ69G5FAY' },
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(1);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'initiative',
      ownerOrganizationId: 'org-b',
    });
  });

  it('opens the same hierarchy picker for parent and child operations', async () => {
    const registry = setup();
    const context = {
      objects: [child],
      source: 'context-menu' as const,
      organizationId: 'org-1',
    };

    await registry.invoke('initiative.changeParent', () => context);
    expect(open).toHaveBeenLastCalledWith({
      kind: 'initiative-hierarchy',
      mode: 'parent',
      organizationId: 'org-1',
      subject: child,
    });

    await registry.invoke('initiative.addSubinitiative', () => context);
    expect(open).toHaveBeenLastCalledWith({
      kind: 'initiative-hierarchy',
      mode: 'child',
      organizationId: 'org-1',
      subject: child,
    });
  });

  it('only offers move to top level when the Initiative has a parent edge', () => {
    const registry = setup();
    const nested = registry.resolve(() => ({
      objects: [child],
      source: 'context-menu',
      organizationId: 'org-1',
    }));
    const root = registry.resolve(() => ({
      objects: [{ ...child, meta: { parentInitiativeId: null, parentLinkId: null } }],
      source: 'context-menu',
      organizationId: 'org-1',
    }));

    expect(nested.map((action) => action.id)).toContain('initiative.moveToTopLevel');
    expect(root.map((action) => action.id)).not.toContain('initiative.moveToTopLevel');
  });
});
