import type { ViewTarget } from '@docket/work/view-contract';

import { objectKey, type ObjectActionScope, type ObjectRef } from '@/lib/actions';

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
 * @param canContribute - Whether the current route user may mutate direct rows.
 * @returns Identity, write, drag, and context-menu policy for the row.
 */
export function workViewRowInteractionPolicy(
  row: WorkViewRowFor<ViewTarget>,
  routeOrganizationId: string,
  canContribute = true,
): WorkViewRowInteractionPolicy {
  const writable = canContribute && isRouteOwnedDirectWorkViewRow(row, routeOrganizationId);
  return {
    object: row.isContext ? null : objectForWorkViewRow(row),
    writable,
    dragDisabled: !writable,
    actionScope: writable ? 'all' : 'reference',
  };
}

/**
 * Resolve selection identity only for direct rows owned by the route organization.
 *
 * @param row - The rendered work-view row.
 * @param routeOrganizationId - The organization whose roster owns bulk selection.
 * @returns The canonical object for an eligible row, or `null` for context and foreign rows.
 */
export function workViewSelectionObject(
  row: WorkViewRowFor<ViewTarget>,
  routeOrganizationId: string,
): ObjectRef | null {
  return isRouteOwnedDirectWorkViewRow(row, routeOrganizationId) ? objectForWorkViewRow(row) : null;
}

/**
 * Build the visible provider item list without duplicate object identities.
 *
 * @param rows - The direct and grouped rows loaded into the current renderer.
 * @param routeOrganizationId - The organization whose roster owns bulk selection.
 * @returns Route-owned direct objects in their first visible order.
 */
export function workViewSelectionObjects(
  rows: readonly WorkViewRowFor<ViewTarget>[],
  routeOrganizationId: string,
): readonly ObjectRef[] {
  const items = new Map<string, ObjectRef>();
  for (const row of rows) {
    const object = workViewSelectionObject(row, routeOrganizationId);
    if (object !== null) items.set(objectKey(object), object);
  }
  return [...items.values()];
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
