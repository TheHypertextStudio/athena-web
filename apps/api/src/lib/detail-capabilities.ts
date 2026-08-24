/** Capability projection for local-first aggregate detail responses. */
import { type Capability, satisfies } from '@docket/authz';
import type { DetailCapabilities } from '@docket/types';

/**
 * Project an actor's org capability bundle into the controls a detail view may render.
 *
 * @param held - The actor context's granted org capabilities.
 * @returns Flags for the visible aggregate-detail controls.
 */
export function detailCapabilities(held: readonly string[]): DetailCapabilities {
  const can = (required: Capability): boolean =>
    held.some((capability) => satisfies(capability as Capability, required));
  return {
    comment: can('comment'),
    contribute: can('contribute'),
    assign: can('assign'),
    manage: can('manage'),
  };
}
