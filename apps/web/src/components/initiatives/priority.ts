import type { InitiativePriority } from '@docket/work/initiative-contract';

/**
 * The human-readable label for each {@link InitiativePriority} level.
 *
 * @remarks
 * A leaf module so a surface that only needs to *name* a priority — a detail masthead painting a
 * navigation snapshot, a print block — can do so without importing the property panel and, through
 * it, every picker that panel mounts.
 *
 * `none` reads as "No priority" so an unset value is explicit rather than blank.
 *
 * These are the bare labels the detail row's chips use, where the row itself names the property.
 * The create composer deliberately keeps its own self-describing set ("Low priority"), because a
 * chip in a composer strip has no row around it to say what it is.
 */
export const INITIATIVE_PRIORITY_LABEL: Record<InitiativePriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * The canonical Initiative priority ordering, least to most pressing.
 *
 * @remarks
 * Drives the order priorities appear in the detail row's picker menu.
 */
export const INITIATIVE_PRIORITY_ORDER: readonly InitiativePriority[] = [
  'none',
  'low',
  'medium',
  'high',
];
