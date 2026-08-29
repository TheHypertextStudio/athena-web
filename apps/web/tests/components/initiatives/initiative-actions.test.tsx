import '@testing-library/jest-dom/vitest';

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRegisterInitiativeActions } from '../../../src/components/initiatives/initiative-actions';
import {
  InitiativeHierarchyWriteCoordinator,
  InitiativeHierarchyWriteCoordinatorProvider,
} from '../../../src/components/initiatives/initiative-hierarchy-write-coordinator';
import { InteractionProvider } from '../../../src/lib/actions/interaction-provider';
import type { ObjectRef } from '../../../src/lib/actions/object';
import { createActionRegistry } from '../../../src/lib/actions/registry';
import * as initiativeMutations from '../../../src/components/initiatives/initiative-hierarchy-mutations';
import { queryKeys } from '../../../src/lib/query';
import { makeQueryWrapper, okResponse } from '../../support/query';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { invalidateWorkTargetQueries, overviewGet, patchInitiative } = vi.hoisted(() => ({
  invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
  overviewGet: vi.fn(),
  patchInitiative: vi.fn(),
}));

vi.mock('../../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));
vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          initiatives: {
            overview: { $get: overviewGet },
            ':id': { $patch: patchInitiative },
          },
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

function renderRegistration() {
  const registry = createActionRegistry();
  const { client } = makeQueryWrapper();
  const coordinator = new InitiativeHierarchyWriteCoordinator();
  render(
    <QueryClientProvider client={client}>
      <InitiativeHierarchyWriteCoordinatorProvider coordinator={coordinator}>
        <InteractionProvider registry={registry}>
          <Registration />
        </InteractionProvider>
      </InitiativeHierarchyWriteCoordinatorProvider>
    </QueryClientProvider>,
  );
  return { client, coordinator, registry };
}

function setup() {
  return renderRegistration().registry;
}

const child: ObjectRef = {
  kind: 'initiative',
  id: 'child',
  organizationId: 'org-1',
  title: 'Membership portal',
  meta: { parentInitiativeId: 'root', parentLinkId: 'link-child' },
};

beforeEach(() => {
  overviewGet.mockResolvedValue(okResponse({ items: [], attention: [] }));
});

afterEach(() => {
  vi.clearAllMocks();
  invalidateWorkTargetQueries.mockReset().mockResolvedValue(undefined);
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
    const { client, registry } = renderRegistration();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    await registry.invoke('initiative.changeParent', () => ({
      objects: [child],
      target: {
        kind: 'initiative',
        id: 'new-parent',
        organizationId: 'org-1',
        title: 'New parent',
      },
      source: 'drag',
      actionScope: 'all',
      organizationId: 'org-1',
    }));

    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith('org-1', {
      kind: 'move',
      linkId: 'link-child',
      parentInitiativeId: 'new-parent',
      childInitiativeId: 'child',
    });
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: queryKeys.initiatives('org-1') },
      { throwOnError: true },
    );
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps a direct hierarchy action pending until route reconciliation finishes', async () => {
    const { client, registry } = renderRegistration();
    let finishRefresh: (() => void) | undefined;
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(refresh);
    let settled = false;

    const invocation = registry
      .invoke('initiative.changeParent', () => ({
        objects: [child],
        target: {
          kind: 'initiative',
          id: 'new-parent',
          organizationId: 'org-1',
          title: 'New parent',
        },
        source: 'drag',
        actionScope: 'all',
        organizationId: 'org-1',
      }))
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.waitFor(() => {
      expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    finishRefresh?.();
    await expect(invocation).resolves.toMatchObject({ status: 'ran' });
  });

  it('retains a failed-refresh lock and repairs it before another hierarchy write', async () => {
    overviewGet.mockResolvedValue(
      okResponse({
        items: [
          {
            id: child.id,
            parentInitiativeId: 'new-parent',
            parentLinkId: 'link-child',
          },
        ],
        attention: [],
      }),
    );
    const { client, coordinator, registry } = renderRegistration();
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockResolvedValue(undefined);
    const context = () => ({
      objects: [child],
      target: {
        kind: 'initiative' as const,
        id: 'new-parent',
        organizationId: 'org-1',
        title: 'New parent',
      },
      source: 'drag' as const,
      actionScope: 'all' as const,
      organizationId: 'org-1',
    });

    await expect(registry.invoke('initiative.changeParent', context)).resolves.toMatchObject({
      status: 'failed',
    });
    expect(coordinator.operationForChild('org-1', child.id)?.phase).toBe('refresh_failed');
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();

    await expect(registry.invoke('initiative.changeParent', context)).resolves.toMatchObject({
      status: 'ran',
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();
    expect(coordinator.operationForChild('org-1', child.id)).toBeNull();
  });

  it('retries a failed write after authoritative recovery proves it was not applied', async () => {
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation)
      .mockRejectedValueOnce(new Error('write rejected'))
      .mockResolvedValueOnce(undefined);
    overviewGet.mockResolvedValue(
      okResponse({
        items: [
          {
            id: child.id,
            parentInitiativeId: 'root',
            parentLinkId: 'link-child',
          },
        ],
        attention: [],
      }),
    );
    const { client, coordinator, registry } = renderRegistration();
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockResolvedValue(undefined);
    const context = () => ({
      objects: [child],
      target: {
        kind: 'initiative' as const,
        id: 'new-parent',
        organizationId: 'org-1',
        title: 'New parent',
      },
      source: 'drag' as const,
      actionScope: 'all' as const,
      organizationId: 'org-1',
    });

    await expect(registry.invoke('initiative.changeParent', context)).resolves.toMatchObject({
      status: 'failed',
    });
    expect(coordinator.operationForChild('org-1', child.id)?.phase).toBe('refresh_failed');

    await expect(registry.invoke('initiative.changeParent', context)).resolves.toMatchObject({
      status: 'ran',
    });

    expect(overviewGet).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledTimes(2);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenNthCalledWith(
      2,
      'org-1',
      {
        kind: 'move',
        linkId: 'link-child',
        parentInitiativeId: 'new-parent',
        childInitiativeId: 'child',
      },
    );
    expect(coordinator.operationForChild('org-1', child.id)).toBeNull();
  });

  it('re-resolves a new parent intent after recovery adds the authoritative hierarchy edge', async () => {
    const detachedChild: ObjectRef = {
      ...child,
      meta: { parentInitiativeId: null, parentLinkId: null },
    };
    overviewGet.mockResolvedValue(
      okResponse({
        items: [
          {
            id: detachedChild.id,
            parentInitiativeId: 'first-parent',
            parentLinkId: 'server-link',
          },
        ],
        attention: [],
      }),
    );
    const { client, coordinator, registry } = renderRegistration();
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockResolvedValue(undefined);
    const contextForParent = (parentId: string) => ({
      objects: [detachedChild],
      target: {
        kind: 'initiative' as const,
        id: parentId,
        organizationId: 'org-1',
        title: parentId,
      },
      source: 'drag' as const,
      actionScope: 'all' as const,
      organizationId: 'org-1',
    });

    await expect(
      registry.invoke('initiative.changeParent', () => contextForParent('first-parent')),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(coordinator.operationForChild('org-1', detachedChild.id)?.phase).toBe('refresh_failed');

    await expect(
      registry.invoke('initiative.changeParent', () => contextForParent('second-parent')),
    ).resolves.toMatchObject({ status: 'ran' });

    expect(overviewGet).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledTimes(2);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenNthCalledWith(
      1,
      'org-1',
      {
        kind: 'create',
        parentInitiativeId: 'first-parent',
        childInitiativeId: 'child',
      },
    );
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenNthCalledWith(
      2,
      'org-1',
      {
        kind: 'move',
        linkId: 'server-link',
        parentInitiativeId: 'second-parent',
        childInitiativeId: 'child',
      },
    );
    expect(coordinator.operationForChild('org-1', detachedChild.id)).toBeNull();
  });

  it('repairs a failed refresh before applying a different parent intent', async () => {
    overviewGet.mockResolvedValue(
      okResponse({
        items: [
          {
            id: child.id,
            parentInitiativeId: 'first-parent',
            parentLinkId: 'link-child',
          },
        ],
        attention: [],
      }),
    );
    const { client, coordinator, registry } = renderRegistration();
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockResolvedValue(undefined);
    const contextForParent = (parentId: string) => ({
      objects: [child],
      target: {
        kind: 'initiative' as const,
        id: parentId,
        organizationId: 'org-1',
        title: parentId,
      },
      source: 'drag' as const,
      actionScope: 'all' as const,
      organizationId: 'org-1',
    });

    await expect(
      registry.invoke('initiative.changeParent', () => contextForParent('first-parent')),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(coordinator.operationForChild('org-1', child.id)?.phase).toBe('refresh_failed');

    await expect(
      registry.invoke('initiative.changeParent', () => contextForParent('second-parent')),
    ).resolves.toMatchObject({ status: 'ran' });

    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledTimes(2);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenNthCalledWith(
      2,
      'org-1',
      {
        kind: 'move',
        linkId: 'link-child',
        parentInitiativeId: 'second-parent',
        childInitiativeId: 'child',
      },
    );
    expect(coordinator.operationForChild('org-1', child.id)).toBeNull();
  });

  it('repairs a failed parent refresh before applying a top-level intent', async () => {
    overviewGet.mockResolvedValue(
      okResponse({
        items: [
          {
            id: child.id,
            parentInitiativeId: 'new-parent',
            parentLinkId: 'link-child',
          },
        ],
        attention: [],
      }),
    );
    const { client, coordinator, registry } = renderRegistration();
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockResolvedValue(undefined);

    await expect(
      registry.invoke('initiative.changeParent', () => ({
        objects: [child],
        target: {
          kind: 'initiative' as const,
          id: 'new-parent',
          organizationId: 'org-1',
          title: 'New parent',
        },
        source: 'drag' as const,
        actionScope: 'all' as const,
        organizationId: 'org-1',
      })),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(coordinator.operationForChild('org-1', child.id)?.phase).toBe('refresh_failed');

    await expect(
      registry.invoke('initiative.moveToTopLevel', () => ({
        objects: [child],
        source: 'context-menu',
        actionScope: 'all',
        organizationId: 'org-1',
      })),
    ).resolves.toMatchObject({ status: 'ran' });

    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledTimes(2);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenNthCalledWith(
      2,
      'org-1',
      {
        kind: 'detach',
        linkId: 'link-child',
        childInitiativeId: 'child',
      },
    );
    expect(coordinator.operationForChild('org-1', child.id)).toBeNull();
  });

  it('does not let a top-level action overlap a same-child parent write', async () => {
    let finishWrite: (() => void) | undefined;
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { client, registry } = renderRegistration();
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);

    const parentWrite = registry.invoke('initiative.changeParent', () => ({
      objects: [child],
      target: {
        kind: 'initiative',
        id: 'new-parent',
        organizationId: 'org-1',
        title: 'New parent',
      },
      source: 'drag',
      actionScope: 'all',
      organizationId: 'org-1',
    }));
    await vi.waitFor(() => {
      expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();
    });

    const topLevelWrite = registry.invoke('initiative.moveToTopLevel', () => ({
      objects: [child],
      source: 'context-menu',
      actionScope: 'all',
      organizationId: 'org-1',
    }));
    await topLevelWrite;
    finishWrite?.();
    await parentWrite;

    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();
  });

  it('does not let a direct action overlap a picker-owned lock for the same route and child', async () => {
    const { coordinator, registry } = renderRegistration();
    const pickerToken = coordinator.claim({
      organizationId: 'org-1',
      childInitiativeId: child.id,
      ownerId: 'picker-owner',
      mutation: {
        kind: 'move',
        linkId: 'link-child',
        parentInitiativeId: 'new-parent',
        childInitiativeId: child.id,
      },
    });

    const result = await registry.invoke('initiative.moveToTopLevel', () => ({
      objects: [child],
      source: 'context-menu',
      actionScope: 'all',
      organizationId: 'org-1',
    }));

    expect(result).toEqual({
      status: 'skipped',
      reason: 'disabled',
      detail: 'This initiative hierarchy is already being updated.',
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).not.toHaveBeenCalled();
    expect(pickerToken).not.toBeNull();
    if (pickerToken !== null) coordinator.release(pickerToken);
  });

  it('allows concurrent direct writes for different Initiative children', async () => {
    let finishFirstWrite: (() => void) | undefined;
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstWrite = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { client, registry } = renderRegistration();
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    const otherChild: ObjectRef = {
      ...child,
      id: 'other-child',
      title: 'Other initiative',
      meta: { parentInitiativeId: 'other-root', parentLinkId: 'other-link' },
    };

    const firstWrite = registry.invoke('initiative.changeParent', () => ({
      objects: [child],
      target: {
        kind: 'initiative',
        id: 'new-parent',
        organizationId: 'org-1',
        title: 'New parent',
      },
      source: 'drag',
      actionScope: 'all',
      organizationId: 'org-1',
    }));
    await vi.waitFor(() => {
      expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();
    });

    await registry.invoke('initiative.moveToTopLevel', () => ({
      objects: [otherChild],
      source: 'context-menu',
      actionScope: 'all',
      organizationId: 'org-1',
    }));

    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenNthCalledWith(
      2,
      'org-1',
      {
        kind: 'detach',
        linkId: 'other-link',
        childInitiativeId: 'other-child',
      },
    );
    finishFirstWrite?.();
    await firstWrite;
  });

  it('keeps foreign Initiative hierarchy writes in the route context', async () => {
    const { client, registry } = renderRegistration();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
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
      actionScope: 'all',
      organizationId: 'org-a',
    }));

    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith('org-a', {
      kind: 'move',
      linkId: 'link-child',
      parentInitiativeId: 'new-parent',
      childInitiativeId: 'child',
    });
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: queryKeys.initiatives('org-a') },
      { throwOnError: true },
    );
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
  });

  it('repairs the route hierarchy when a parent write has an indeterminate failure', async () => {
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockRejectedValueOnce(
      new Error('response lost after commit'),
    );
    const { client, registry } = renderRegistration();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);

    const result = await registry.invoke('initiative.changeParent', () => ({
      objects: [child],
      target: {
        kind: 'initiative',
        id: 'new-parent',
        organizationId: 'org-1',
        title: 'New parent',
      },
      source: 'drag',
      actionScope: 'all',
      organizationId: 'org-1',
    }));

    expect(result.status).toBe('failed');
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: queryKeys.initiatives('org-1') },
      { throwOnError: true },
    );
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
  });

  it('does not refresh the hierarchy when the requested parent is unchanged', async () => {
    const { client, registry } = renderRegistration();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);

    const result = await registry.invoke('initiative.changeParent', () => ({
      objects: [child],
      target: {
        kind: 'initiative',
        id: 'root',
        organizationId: 'org-1',
        title: 'Current parent',
      },
      source: 'drag',
      actionScope: 'all',
      organizationId: 'org-1',
    }));

    expect(result.status).toBe('ran');
    expect(initiativeMutations.writeInitiativeHierarchyMutation).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
  });

  it('repairs the route hierarchy when a detach has an indeterminate failure', async () => {
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockRejectedValueOnce(
      new Error('response lost after detach'),
    );
    const { client, registry } = renderRegistration();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);

    const result = await registry.invoke('initiative.moveToTopLevel', () => ({
      objects: [child],
      source: 'context-menu',
      actionScope: 'all',
      organizationId: 'org-1',
    }));

    expect(result.status).toBe('failed');
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: queryKeys.initiatives('org-1') },
      { throwOnError: true },
    );
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
  });

  it('opens an Initiative from a hub context without a route organization', async () => {
    const registry = setup();

    await registry.invoke('initiative.open', () => ({
      objects: [{ ...child, organizationId: 'org-b' }],
      source: 'context-menu',
      actionScope: 'all',
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
      actionScope: 'all',
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
      actionScope: 'all',
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

  it('does not report an Initiative property change complete until its repair finishes', async () => {
    patchInitiative.mockResolvedValue(okResponse({}));
    let finishRepair: (() => void) | undefined;
    const repair = new Promise<void>((resolve) => {
      finishRepair = resolve;
    });
    invalidateWorkTargetQueries.mockReturnValue(repair);
    const registry = setup();
    let settled = false;

    const invocation = registry
      .invoke('initiative.setOwner', () => ({
        objects: [{ ...child, organizationId: 'org-b' }],
        target: {
          kind: 'actor',
          id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
          organizationId: 'org-b',
          title: 'New owner',
        },
        source: 'drag',
        actionScope: 'all',
        organizationId: 'org-b',
      }))
      .then((result) => {
        settled = true;
        return result;
      });

    await vi.waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    });
    expect(settled).toBe(false);
    finishRepair?.();
    await expect(invocation).resolves.toMatchObject({ status: 'ran' });
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
      actionScope: 'all',
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
      actionScope: 'all',
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
      actionScope: 'all' as const,
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
      actionScope: 'all',
      organizationId: 'org-1',
    }));
    const root = registry.resolve(() => ({
      objects: [{ ...child, meta: { parentInitiativeId: null, parentLinkId: null } }],
      source: 'context-menu',
      actionScope: 'all',
      organizationId: 'org-1',
    }));

    expect(nested.map((action) => action.id)).toContain('initiative.moveToTopLevel');
    expect(root.map((action) => action.id)).not.toContain('initiative.moveToTopLevel');
  });
});
