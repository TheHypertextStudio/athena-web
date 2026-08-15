/**
 * API delivery mapping for the Athena session entitlement policy.
 *
 * @remarks
 * The billing domain returns a portable outcome. This adapter is intentionally the
 * only place that turns it into API-owned errors, keeping the same lifecycle rule
 * usable from HTTP, MCP, background work, and a future native delivery surface.
 */
import { resolveAgentSessionEntitlement } from '@docket/billing/application/entitlement';
import { db } from '@docket/db';

import { AgentPlanRequiredError, NotFoundError } from '../error';

/**
 * Assert that an organization may start an Athena session, or throw an API error.
 *
 * @param organizationId - The workspace about to run its first provider turn.
 * @throws {AgentPlanRequiredError} When the workspace needs a paid plan.
 * @throws {NotFoundError} When the workspace does not exist.
 */
export async function assertAgentSessionsEntitled(organizationId: string): Promise<void> {
  const entitlement = await resolveAgentSessionEntitlement(db, organizationId);
  switch (entitlement.kind) {
    case 'entitled':
      return;
    case 'organization-not-found':
      throw new NotFoundError('Organization not found');
    case 'plan-required':
      throw new AgentPlanRequiredError();
    /* v8 ignore start -- @preserve exhaustive: every domain entitlement is handled above */
    default: {
      const _exhaustive: never = entitlement;
      return _exhaustive;
    }
    /* v8 ignore stop */
  }
}
