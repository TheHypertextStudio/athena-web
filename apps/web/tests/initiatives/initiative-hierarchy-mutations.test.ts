import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import {
  invalidateInitiativeHierarchyRoute,
  resolveInitiativeHierarchyMutation,
  type InitiativeHierarchyMutation,
} from '../../src/components/initiatives/initiative-hierarchy-mutations';
import { queryKeys } from '../../src/lib/query';

const tree = new Map<string, string | null>([
  ['root', null],
  ['child', 'root'],
  ['grandchild', 'child'],
  ['other', null],
]);

function isSelfOrDescendant(ancestorId: string, descendantId: string): boolean {
  let current: string | null | undefined = descendantId;
  for (let step = 0; current != null && step <= tree.size; step += 1) {
    if (current === ancestorId) return true;
    current = tree.get(current) ?? null;
  }
  return false;
}

describe('resolveInitiativeHierarchyMutation', () => {
  it.each<{
    name: string;
    dragged: { id: string; parentInitiativeId: string | null; parentLinkId: string | null };
    targetId: string | null;
    want: InitiativeHierarchyMutation;
  }>([
    {
      name: 'creates the first parent edge',
      dragged: { id: 'other', parentInitiativeId: null, parentLinkId: null },
      targetId: 'root',
      want: {
        kind: 'create',
        parentInitiativeId: 'root',
        childInitiativeId: 'other',
      },
    },
    {
      name: 'moves an existing edge',
      dragged: { id: 'child', parentInitiativeId: 'root', parentLinkId: 'link-child' },
      targetId: 'other',
      want: {
        kind: 'move',
        linkId: 'link-child',
        parentInitiativeId: 'other',
        childInitiativeId: 'child',
      },
    },
    {
      name: 'detaches to the top level',
      dragged: { id: 'child', parentInitiativeId: 'root', parentLinkId: 'link-child' },
      targetId: null,
      want: { kind: 'detach', linkId: 'link-child', childInitiativeId: 'child' },
    },
    {
      name: 'rejects a move under its descendant',
      dragged: { id: 'root', parentInitiativeId: null, parentLinkId: null },
      targetId: 'grandchild',
      want: { kind: 'noop' },
    },
  ])('$name', ({ dragged, targetId, want }) => {
    expect(resolveInitiativeHierarchyMutation({ dragged, targetId, isSelfOrDescendant })).toEqual(
      want,
    );
  });
});

describe('invalidateInitiativeHierarchyRoute', () => {
  it('invalidates only the Initiative collection for the route workspace', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    await invalidateInitiativeHierarchyRoute(queryClient, 'org-a');

    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: queryKeys.initiatives('org-a') },
      { throwOnError: true },
    );
  });

  it('rejects when an active hierarchy projection cannot be refreshed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = queryKeys.initiatives('org-a');
    let fail = false;
    const queryFn = vi.fn(async () => {
      if (fail) throw new Error('route refresh failed');
      return { items: [] };
    });
    await queryClient.fetchQuery({ queryKey, queryFn });
    const observer = new QueryObserver(queryClient, { queryKey, queryFn, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);
    fail = true;

    await expect(invalidateInitiativeHierarchyRoute(queryClient, 'org-a')).rejects.toThrow(
      'route refresh failed',
    );

    unsubscribe();
  });
});
