import type { ViewTarget } from '@docket/work/view-contract';

import type { ObjectActionScope, ObjectRef } from '@/lib/actions';

import { type WorkViewRowFor, workViewRowTitle } from './renderer-types';

/**
 * Check whether a row belongs to the route's directly editable roster.
 *
 * @param row - The row whose owner and context status control route-local writes.
 * @param routeOrganizationId - The organization whose roster is being rendered.
 * @returns `true` only for a direct row owned by the route organization.
 */
export function isRouteOwnedDirectWorkViewRow(
  row: { readonly organizationId: string; readonly isContext: boolean },
  routeOrganizationId: string,
): boolean {
  return row.organizationId === routeOrganizationId && !row.isContext;
}

/** Interaction capabilities for one work-view row in its current route. */
export interface WorkViewRowInteractionPolicy {
  /** Canonical identity for Open and Copy, or `null` for a context-only row. */
  readonly object: ObjectRef | null;
  /** Whether this route may write, move, relate, or select the row. */
  readonly writable: boolean;
  /** Whether the row's object surface must suppress whole-object dragging. */
  readonly dragDisabled: boolean;
  /** Which context-menu actions the row surface may expose. */
  readonly actionScope: ObjectActionScope;
}

/**
 * Resolve one work-view row's interaction capabilities against the route owner.
 *
 * @param row - The rendered work-view row.
 * @param routeOrganizationId - The organization that owns route-local writes.
 * @returns Identity, write, drag, and context-menu policy for the row.
 */
export function workViewRowInteractionPolicy(
  row: WorkViewRowFor<ViewTarget>,
  routeOrganizationId: string,
): WorkViewRowInteractionPolicy {
  const writable = isRouteOwnedDirectWorkViewRow(row, routeOrganizationId);
  return {
    object: row.isContext ? null : objectForWorkViewRow(row),
    writable,
    dragDisabled: !writable,
    actionScope: writable ? 'all' : 'reference',
  };
}

/** Project a server work-view row onto the canonical interaction identity. */
export function objectForWorkViewRow(row: WorkViewRowFor<ViewTarget>): ObjectRef {
  return {
    kind: row.target,
    id: row.id,
    organizationId: row.organizationId,
    title: workViewRowTitle(row),
    ...(row.target === 'initiative'
      ? {
          meta: {
            parentInitiativeId: row.parent,
            parentLinkId: row.parentLinkId,
          },
        }
      : {}),
  };
}
