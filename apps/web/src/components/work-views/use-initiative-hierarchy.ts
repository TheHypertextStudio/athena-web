'use client';

import type { InitiativeViewRow } from '@docket/types';

import {
  type InitiativeDragObject,
  selfOrDescendantPredicate,
} from '@/components/initiatives/hierarchy-dnd';
import {
  type InitiativeHierarchyMutation,
  resolveInitiativeHierarchyMutation,
  writeInitiativeHierarchyMutation,
} from '@/components/initiatives/initiative-hierarchy-mutations';
import { useApiMutation } from '@/lib/query';

/** One hierarchy gesture resolved against the Initiative rows visible to the viewer. */
export interface InitiativeHierarchyInput {
  readonly dragged: InitiativeDragObject;
  readonly targetId: string | null;
  readonly rows: readonly InitiativeViewRow[];
}

/** Persist Initiative hierarchy gestures and refresh every typed Initiative roster. */
export function useInitiativeHierarchy(organizationId: string) {
  return useApiMutation<InitiativeHierarchyMutation, InitiativeHierarchyInput>({
    mutationFn: async ({ dragged, targetId, rows }) => {
      const parentById = new Map(rows.map((row) => [row.id, row.parent]));
      const mutation = resolveInitiativeHierarchyMutation({
        dragged,
        targetId,
        isSelfOrDescendant: selfOrDescendantPredicate(parentById),
      });
      await writeInitiativeHierarchyMutation(organizationId, mutation);
      return mutation;
    },
    invalidateKeys: [['org', organizationId, 'work-view', 'initiative']],
  });
}
