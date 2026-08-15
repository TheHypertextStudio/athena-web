/**
 * `@docket/billing/application/entitlement` — paid-feature eligibility rules.
 *
 * @remarks
 * Billing decides whether an organization may start an Athena session from durable
 * lifecycle state and an active staff-issued exemption. It returns a domain outcome
 * rather than throwing HTTP errors so every delivery surface can present the result
 * in its own language: the API maps it to a 402, while voice can give a helpful
 * spoken response.
 */
import { billingExemption, organization } from '@docket/db';
import type { Database } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

/** Lifecycle states that include Athena access without a staff exemption. */
export const AGENT_SESSION_ENTITLED_LIFECYCLE_STATES = ['trialing', 'active'] as const;

/** One resolved answer to whether an organization may start a new Athena session. */
export type AgentSessionEntitlement =
  | { readonly kind: 'entitled'; readonly source: 'subscription' | 'exemption' }
  | { readonly kind: 'organization-not-found' }
  | { readonly kind: 'plan-required' };

const ENTITLED_STATES = new Set<string>(AGENT_SESSION_ENTITLED_LIFECYCLE_STATES);

/**
 * Resolve whether an organization may start a new Athena session.
 *
 * @remarks
 * The query deliberately reads the Docket lifecycle projection instead of making a
 * live Stripe request. A trial is part of the paid-feature funnel, while `past_due`
 * and every wind-down state require an active billing exemption. Resuming a session
 * is intentionally not decided here; callers apply this policy only before its first
 * provider turn.
 *
 * @param db - The organization and exemption store.
 * @param organizationId - The workspace whose plan is being evaluated.
 * @returns A delivery-neutral entitlement outcome.
 */
export async function resolveAgentSessionEntitlement(
  db: Database,
  organizationId: string,
): Promise<AgentSessionEntitlement> {
  const rows = await db
    .select({
      lifecycleState: organization.lifecycleState,
      exemptionId: billingExemption.id,
    })
    .from(organization)
    .leftJoin(
      billingExemption,
      and(eq(billingExemption.organizationId, organization.id), isNull(billingExemption.revokedAt)),
    )
    .where(eq(organization.id, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return { kind: 'organization-not-found' };
  if (row.exemptionId) return { kind: 'entitled', source: 'exemption' };
  if (ENTITLED_STATES.has(row.lifecycleState)) {
    return { kind: 'entitled', source: 'subscription' };
  }
  return { kind: 'plan-required' };
}
