/**
 * `@docket/api` — the Athena entitlement gate.
 *
 * @remarks
 * Athena is a paid-plan feature. The gate reads the org's billing
 * **lifecycle state** — the durable truth the Stripe webhooks maintain — rather than
 * making a live billing call: `trialing` counts as entitled (the trial IS the
 * funnel) alongside `active`; everything else (`past_due`, `export_window`, …)
 * refuses with a typed 402 the web app renders as a targeted upsell — UNLESS the
 * org holds an active {@link billingExemption} grant, a staff-issued permanent
 * bypass that is independent of Stripe entirely (see `POST /admin/orgs/:id/billing-exemption`).
 *
 * Enforced at ONE choke point — the first run of {@link driveSession} — which covers
 * every door: the REST session routes, the `trigger_agent` MCP tool, and the
 * proactive sweep. Resumes of an already-started session are deliberately NOT
 * re-gated, so an approval arriving after a plan lapse still lands the work the
 * user already reviewed.
 */
import { billingExemption, db, organization } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { AgentPlanRequiredError, NotFoundError } from '../error';

/** The lifecycle states entitled to run agent sessions. */
const ENTITLED_STATES = new Set(['trialing', 'active']);

/**
 * Assert the org may start agent sessions, or throw the typed 402.
 *
 * @param orgId - The organization about to run a session.
 * @throws {AgentPlanRequiredError} When the org's lifecycle state is not entitled and it holds no active exemption.
 * @throws {NotFoundError} When the org does not exist.
 */
export async function assertAgentSessionsEntitled(orgId: string): Promise<void> {
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
    .where(eq(organization.id, orgId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Organization not found');
  if (row.exemptionId) return;
  if (!ENTITLED_STATES.has(row.lifecycleState)) {
    throw new AgentPlanRequiredError();
  }
}
