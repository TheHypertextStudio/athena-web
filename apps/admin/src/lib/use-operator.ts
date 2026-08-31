'use client';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useApiQuery } from '@/lib/query';

/** The operator tiers, in ascending privilege. The index is the rank. */
export const STAFF_TIERS = ['support', 'finance', 'superadmin'] as const;

/** One operator tier. */
export type StaffTier = (typeof STAFF_TIERS)[number];

/** Human-readable names for each tier, used wherever the console states who you are. */
const TIER_LABEL: Readonly<Record<StaffTier, string>> = {
  support: 'Support',
  finance: 'Finance',
  superadmin: 'Superadmin',
};

/** The calling operator's identity, or nulls while the read is still resolving. */
export interface Operator {
  /** The operator's tier, or `null` before the read resolves or when it failed. */
  readonly tier: StaffTier | null;
  /** The tier's display name, or `null` when the tier is unknown. */
  readonly tierLabel: string | null;
  /** Whether the operator holds at least the given tier. `false` while the tier is unknown. */
  readonly atLeast: (minimum: StaffTier) => boolean;
  /** Whether the read is still in flight. */
  readonly loading: boolean;
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
 * Every `/admin` route is gated on tier, so a console that does not know the caller's tier can
 * only offer every action and let the unauthorized ones fail. Reading it once here lets the shell
 * state who you are and lets screens disable what you cannot do.
 *
 * {@link Operator.atLeast} returns `false` while the tier is unknown, which is the safe direction:
 * an action stays disabled until the console has positively established the caller may perform it,
 * rather than being briefly offered and then rejected.
 *
 * @returns the operator's tier and a rank predicate.
 */
export function useOperator(): Operator {
  const { data, isPending } = useApiQuery(operatorDef);
  const tier = data?.role ?? null;

  return {
    tier,
    tierLabel: tier ? TIER_LABEL[tier] : null,
    atLeast: (minimum) =>
      tier !== null && STAFF_TIERS.indexOf(tier) >= STAFF_TIERS.indexOf(minimum),
    loading: isPending,
  };
}
