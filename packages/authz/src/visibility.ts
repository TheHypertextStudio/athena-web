/**
 * `@docket/authz` — visibility helpers.
 *
 * @remarks
 * Default visibility is role-dependent: org *members* see public resources by
 * default, while *guests* are grant-only (they see nothing without an explicit grant).
 */
import type { Visibility } from '@docket/types';

/**
 * Whether a viewer is granted baseline view of a resource by its visibility alone.
 *
 * @param visibility - The resource's effective visibility.
 * @param isGuest - Whether the viewer's role is a guest (grant-only).
 * @returns true when a non-guest views a public resource.
 */
export function visibilityGrantsView(visibility: Visibility, isGuest: boolean): boolean {
  if (isGuest) return false;
  return visibility === 'public';
}

/**
 * Resolve the effective visibility from the nearest override down the chain.
 *
 * @param overrides - Visibility overrides from most-specific to least-specific.
 * @param ownVisibility - The resource's own visibility.
 * @returns the first defined override, else the resource's own visibility.
 */
export function effectiveVisibility(
  overrides: readonly (Visibility | null | undefined)[],
  ownVisibility: Visibility,
): Visibility {
  for (const v of overrides) {
    if (v) return v;
  }
  return ownVisibility;
}
