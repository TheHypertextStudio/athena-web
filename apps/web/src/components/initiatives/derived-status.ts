/**
 * Derived-status presentation for Initiatives.
 *
 * @remarks
 * An Initiative has no manual status field to edit on these screens. The detail read
 * exposes a `derivedStatus` (`completed` iff there is at least one associated child and
 * every associated Project has reached a terminal state, else `active`) that reflects the
 * children's reality rather than a stored column. These helpers map that derived value onto
 * display copy + a badge variant so the list and the detail header agree.
 */
import type { InitiativeStatus } from '@docket/types';

/** Human label for each derived Initiative status. */
export const DERIVED_STATUS_LABEL: Record<InitiativeStatus, string> = {
  active: 'Active',
  completed: 'Completed',
};

/**
 * The badge variant for a derived status: an active theme is the prominent `default`, a
 * completed one is the quieter `secondary`.
 *
 * @param status - The derived initiative status.
 * @returns the {@link import('@docket/ui/primitives').Badge} variant to use.
 */
export function derivedStatusVariant(status: InitiativeStatus): 'default' | 'secondary' {
  return status === 'completed' ? 'secondary' : 'default';
}
