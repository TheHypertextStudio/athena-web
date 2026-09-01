'use client';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useApiQuery } from '@/lib/query';

/** One operator tier, as `GET /admin/session` reports it. */
type StaffTier = 'support' | 'finance' | 'superadmin';

/** Human-readable names for each tier, used wherever the console states who you are. */
const TIER_LABEL: Readonly<Record<StaffTier, string>> = {
  support: 'Support',
  finance: 'Finance',
  superadmin: 'Superadmin',
};

/** The calling operator's identity. */
export interface Operator {
  /** The tier's display name, or `null` while the read has not resolved. */
  readonly tierLabel: string | null;
}

/** The calling operator's staff record. */
const operatorDef = apiQueryOptions(
  queryKeys.session(),
  () => api.admin.session.$get(),
  'Could not confirm your operator access.',
  { staleTime: STALE.static },
);

/**
 * Read the signed-in operator's staff tier.
 *
 * @remarks
 * Every `/admin` route is gated on tier, and the console previously had no way to know the caller's
 * — so an operator learned what they were allowed to do only when an action failed. The shell now
 * states it in the identity footer.
 *
 * Only the label is exposed. A client-side rank predicate was written alongside it and never
 * called: every tier-gated screen reads the `permissions` block the API already returns with the
 * record it is about, which is the better answer because it accounts for that record's own state
 * as well as the caller's tier.
 *
 * @returns the operator's tier label.
 */
export function useOperator(): Operator {
  const { data } = useApiQuery(operatorDef);
  const tier = data?.role ?? null;

  return { tierLabel: tier ? TIER_LABEL[tier] : null };
}
