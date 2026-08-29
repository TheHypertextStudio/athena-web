/**
 * The shared Initiative hierarchy operation used by drag, menus, and explicit pickers.
 *
 * @remarks
 * Gesture code supplies only a dragged Initiative and a target. This module resolves that intent
 * into the one API mutation required, retaining the child id on every branch so optimistic lists
 * and detail invalidation do not have to reconstruct it differently.
 */
import { InitiativeId } from '@docket/types';
import type { QueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { unwrap } from '@/lib/query';
import { queryKeys } from '@/lib/query-keys';

import { type InitiativeDragObject, planReparent, type PlanReparentArgs } from './hierarchy-dnd';

/** One complete Initiative hierarchy write, or a deliberate no-op. */
export type InitiativeHierarchyMutation =
  | { readonly kind: 'noop' }
  | {
      readonly kind: 'create';
      readonly parentInitiativeId: string;
      readonly childInitiativeId: string;
    }
  | {
      readonly kind: 'move';
      readonly linkId: string;
      readonly parentInitiativeId: string;
      readonly childInitiativeId: string;
    }
  | { readonly kind: 'detach'; readonly linkId: string; readonly childInitiativeId: string };

/**
 * Refresh the Initiative hierarchy projected by one route workspace.
 *
 * @param queryClient - The cache that owns the route projection.
 * @param organizationId - The route workspace whose hierarchy changed.
 * @returns A promise that settles after active route queries finish refetching.
 */
export function invalidateInitiativeHierarchyRoute(
  queryClient: QueryClient,
  organizationId: string,
): Promise<void> {
  return queryClient.invalidateQueries(
    { queryKey: queryKeys.initiatives(organizationId) },
    { throwOnError: true },
  );
}

/**
 * Resolve a hierarchy intent into the complete mutation every presentation consumes.
 *
 * @param args - The dragged object, desired parent, and cycle predicate.
 * @returns A complete hierarchy mutation or a no-op for invalid/unchanged relationships.
 */
export function resolveInitiativeHierarchyMutation(
  args: PlanReparentArgs,
): InitiativeHierarchyMutation {
  const plan = planReparent(args);
  if (plan.kind === 'move') {
    return { ...plan, childInitiativeId: args.dragged.id };
  }
  if (plan.kind === 'detach') {
    return { ...plan, childInitiativeId: args.dragged.id };
  }
  return plan;
}

/**
 * Persist one resolved hierarchy mutation through the typed Initiative API.
 *
 * @param organizationId - Workspace that owns both Initiatives.
 * @param mutation - The resolved operation from {@link resolveInitiativeHierarchyMutation}.
 */
export async function writeInitiativeHierarchyMutation(
  organizationId: string,
  mutation: InitiativeHierarchyMutation,
): Promise<void> {
  switch (mutation.kind) {
    case 'noop':
      return;
    case 'create':
      await unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives['hierarchy-links'].$post({
            param: { orgId: organizationId },
            json: {
              parentInitiativeId: InitiativeId.parse(mutation.parentInitiativeId),
              childInitiativeId: InitiativeId.parse(mutation.childInitiativeId),
            },
          }),
        'Could not change this initiative hierarchy.',
      );
      return;
    case 'move':
      await unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives['hierarchy-links'][':linkId'].$patch({
            param: { orgId: organizationId, linkId: mutation.linkId },
            json: { parentInitiativeId: InitiativeId.parse(mutation.parentInitiativeId) },
          }),
        'Could not change this initiative hierarchy.',
      );
      return;
    case 'detach':
      await unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives['hierarchy-links'][':linkId'].$delete({
            param: { orgId: organizationId, linkId: mutation.linkId },
          }),
        'Could not move this initiative to the top level.',
      );
  }
}

/** Project an object reference onto the hierarchy planner's drag vocabulary. */
export function initiativeDragObjectFromRef(object: {
  readonly id: string;
  readonly meta?: Readonly<Record<string, string | number | boolean | null>>;
}): InitiativeDragObject {
  const parentInitiativeId = object.meta?.['parentInitiativeId'];
  const parentLinkId = object.meta?.['parentLinkId'];
  return {
    id: object.id,
    parentInitiativeId: typeof parentInitiativeId === 'string' ? parentInitiativeId : null,
    parentLinkId: typeof parentLinkId === 'string' ? parentLinkId : null,
  };
}
