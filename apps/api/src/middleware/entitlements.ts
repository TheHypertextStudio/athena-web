/**
 * Entitlement middleware for premium feature access control.
 *
 * Only blocks mutating operations (POST/PUT/PATCH/DELETE).
 * GET requests always pass through (read access is sacred).
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema/index.js';
import {
  type Entitlement,
  type PlanTier,
  DEFAULT_PLAN_TIER,
  PLAN_ENTITLEMENTS,
  isPlanTier,
  getRequiredPlanTier,
} from '../services/billing/config.js';

/**
 * HTTP methods that are considered read-only.
 * These always pass through regardless of entitlements.
 */
const READ_ONLY_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Error response structure for entitlement failures.
 */
interface EntitlementErrorResponse {
  error: 'entitlement_required';
  message: string;
  required_entitlement: Entitlement;
  required_plan: PlanTier;
  current_plan: PlanTier;
  upgrade_url: string;
}

/**
 * Create entitlement error response.
 */
function createEntitlementError(
  entitlement: Entitlement,
  currentPlan: PlanTier,
): EntitlementErrorResponse {
  const requiredPlan = getRequiredPlanTier(entitlement);
  return {
    error: 'entitlement_required',
    message: `This feature requires a ${requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)} subscription`,
    required_entitlement: entitlement,
    required_plan: requiredPlan,
    current_plan: currentPlan,
    upgrade_url: '/settings/billing',
  };
}

/**
 * Get user's current plan tier from database.
 * Returns 'free' if no subscription exists.
 */
async function getUserPlanTier(userId: string): Promise<PlanTier> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  if (!subscription) {
    return DEFAULT_PLAN_TIER;
  }

  if (!isPlanTier(subscription.planTier)) {
    return DEFAULT_PLAN_TIER;
  }

  return subscription.planTier;
}

/**
 * Check if user has a specific entitlement.
 */
async function checkEntitlement(userId: string, entitlement: Entitlement): Promise<boolean> {
  const planTier = await getUserPlanTier(userId);
  return PLAN_ENTITLEMENTS[planTier].includes(entitlement);
}

/**
 * Middleware factory that requires a specific entitlement for mutating operations.
 *
 * @param entitlement - The entitlement required to access this route
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * // Require 'integrations' entitlement for POST/PUT/DELETE
 * router.use('*', requireEntitlement('integrations'));
 * ```
 */
export function requireEntitlement(entitlement: Entitlement) {
  return async function entitlementMiddleware(c: Context, next: Next): Promise<void> {
    // Read-only methods always pass through (read access is sacred)
    if (READ_ONLY_METHODS.includes(c.req.method)) {
      await next();
      return;
    }

    // Get user ID from context (set by requireAuth middleware)
    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }

    // Check entitlement
    const hasAccess = await checkEntitlement(userId, entitlement);
    if (!hasAccess) {
      const planTier = await getUserPlanTier(userId);
      const errorResponse = createEntitlementError(entitlement, planTier);

      throw new HTTPException(403, {
        message: errorResponse.message,
        res: new Response(JSON.stringify(errorResponse), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      });
    }

    await next();
  };
}

/**
 * Middleware factory that requires one of multiple entitlements.
 *
 * @param entitlements - Array of entitlements, user needs at least one
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * // Require either 'integrations' or 'export_data' entitlement
 * router.use('*', requireAnyEntitlement(['integrations', 'export_data']));
 * ```
 */
export function requireAnyEntitlement(entitlements: Entitlement[]) {
  return async function anyEntitlementMiddleware(c: Context, next: Next): Promise<void> {
    // Read-only methods always pass through
    if (READ_ONLY_METHODS.includes(c.req.method)) {
      await next();
      return;
    }

    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }

    const planTier = await getUserPlanTier(userId);
    const userEntitlements = PLAN_ENTITLEMENTS[planTier];
    const hasAnyAccess = entitlements.some((e) => userEntitlements.includes(e));

    if (!hasAnyAccess) {
      // Use the first entitlement for error message
      const firstEntitlement = entitlements[0];
      if (!firstEntitlement) {
        throw new HTTPException(500, { message: 'Invalid entitlement configuration' });
      }
      const errorResponse = createEntitlementError(firstEntitlement, planTier);
      throw new HTTPException(403, {
        message: errorResponse.message,
        res: new Response(JSON.stringify(errorResponse), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      });
    }

    await next();
  };
}

/**
 * Middleware factory that requires a specific plan tier.
 *
 * @param requiredTier - Minimum plan tier required
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * // Require team tier for workspace routes
 * router.use('*', requirePlanTier('team'));
 * ```
 */
export function requirePlanTier(requiredTier: PlanTier) {
  const tierOrder: Record<PlanTier, number> = { free: 0, pro: 1, team: 2 };

  return async function planTierMiddleware(c: Context, next: Next): Promise<void> {
    // Read-only methods always pass through
    if (READ_ONLY_METHODS.includes(c.req.method)) {
      await next();
      return;
    }

    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }

    const userTier = await getUserPlanTier(userId);
    if (tierOrder[userTier] < tierOrder[requiredTier]) {
      throw new HTTPException(403, {
        message: `This feature requires a ${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} subscription`,
        res: new Response(
          JSON.stringify({
            error: 'plan_tier_required',
            message: `This feature requires a ${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} subscription`,
            required_plan: requiredTier,
            current_plan: userTier,
            upgrade_url: '/settings/billing',
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      });
    }

    await next();
  };
}

// Re-export types and helpers for convenience
export type { Entitlement, PlanTier };
export { getRequiredPlanTier, getUserPlanTier, checkEntitlement };
