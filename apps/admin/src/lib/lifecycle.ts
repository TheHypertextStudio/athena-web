import type { BadgeProps } from '@docket/ui/primitives';

/**
 * The org data-lifecycle states, in pipeline order.
 *
 * @remarks
 * Mirrors `LifecycleState` from the admin API DTOs (`@docket/api`'s `admin-dto`). The order
 * is the operational pipeline: a trialing org converts to `active`, lapses to `past_due`,
 * enters its read-only `export_window`, is scheduled for `pending_deletion`, and finally
 * becomes `deleted`. Used to lay out the lifecycle board columns and the metrics buckets.
 */
export const LIFECYCLE_STATES = [
  'trialing',
  'active',
  'past_due',
  'export_window',
  'pending_deletion',
  'deleted',
] as const;

/** One org data-lifecycle state. */
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Human-readable labels for each lifecycle state. */
const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  export_window: 'Export window',
  pending_deletion: 'Pending deletion',
  deleted: 'Deleted',
};

/** Badge variants per lifecycle state, mapping severity to the design-token palette. */
const LIFECYCLE_BADGE_VARIANTS: Record<LifecycleState, NonNullable<BadgeProps['variant']>> = {
  trialing: 'secondary',
  active: 'default',
  past_due: 'destructive',
  export_window: 'outline',
  pending_deletion: 'destructive',
  deleted: 'outline',
};

/**
 * The human-readable label for a lifecycle state.
 *
 * @param state - The lifecycle state value.
 * @returns a title-cased display label (e.g. `'export_window'` → `'Export window'`).
 */
export function lifecycleLabel(state: LifecycleState): string {
  return LIFECYCLE_LABELS[state];
}

/**
 * The {@link BadgeProps.variant | Badge variant} for a lifecycle state.
 *
 * @param state - The lifecycle state value.
 * @returns the design-system badge variant conveying the state's operational severity.
 */
export function lifecycleBadgeVariant(state: LifecycleState): NonNullable<BadgeProps['variant']> {
  return LIFECYCLE_BADGE_VARIANTS[state];
}

/**
 * Format an ISO timestamp string for compact operator display.
 *
 * @remarks
 * Returns an em-dash for `null`/missing values so empty cells stay visually quiet. Uses the
 * runtime locale's medium date + short time. Invalid strings fall back to the raw value.
 *
 * @param iso - An ISO-8601 timestamp string, or `null`.
 * @returns a locale-formatted date-time, or `'—'` when absent.
 */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
