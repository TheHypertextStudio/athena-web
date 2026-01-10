/**
 * Billing configuration and entitlements.
 *
 * Single source of truth for plan tiers and feature entitlements.
 *
 * @packageDocumentation
 */

/**
 * Available plan tiers.
 */
export type PlanTier = 'free' | 'pro' | 'team';

/**
 * All available entitlements.
 */
export type Entitlement =
  | 'basic_tasks'
  | 'basic_projects'
  | 'basic_calendar'
  | 'basic_activities'
  | 'unlimited_tasks'
  | 'unlimited_projects'
  | 'time_tracking'
  | 'integrations'
  | 'export_data'
  | 'priority_support'
  | 'team_workspaces'
  | 'team_collaboration'
  | 'admin_controls'
  | 'sso'
  | 'ai_features';

/**
 * Feature entitlements by plan tier.
 */
export const PLAN_ENTITLEMENTS: Record<PlanTier, Entitlement[]> = {
  free: ['basic_tasks', 'basic_projects', 'basic_calendar', 'basic_activities'],
  pro: [
    'basic_tasks',
    'basic_projects',
    'basic_calendar',
    'basic_activities',
    'unlimited_tasks',
    'unlimited_projects',
    'time_tracking',
    'integrations',
    'export_data',
    'priority_support',
    'ai_features',
  ],
  team: [
    'basic_tasks',
    'basic_projects',
    'basic_calendar',
    'basic_activities',
    'unlimited_tasks',
    'unlimited_projects',
    'time_tracking',
    'integrations',
    'export_data',
    'priority_support',
    'ai_features',
    'team_workspaces',
    'team_collaboration',
    'admin_controls',
    'sso',
  ],
};

/**
 * Plan tier values for validation.
 */
export const PLAN_TIER_VALUES: readonly PlanTier[] = ['free', 'pro', 'team'] as const;

/**
 * Default plan tier for users without a subscription.
 */
export const DEFAULT_PLAN_TIER: PlanTier = 'free';

/**
 * Check if a value is a valid plan tier.
 */
export function isPlanTier(value: string): value is PlanTier {
  return PLAN_TIER_VALUES.includes(value as PlanTier);
}

/**
 * Get entitlements for a plan tier.
 */
export function getEntitlements(planTier: PlanTier): Entitlement[] {
  return PLAN_ENTITLEMENTS[planTier];
}

/**
 * Check if a plan tier has a specific entitlement.
 */
export function hasEntitlement(planTier: PlanTier, entitlement: Entitlement): boolean {
  return PLAN_ENTITLEMENTS[planTier].includes(entitlement);
}

/**
 * Get the minimum plan tier required for an entitlement.
 */
export function getRequiredPlanTier(entitlement: Entitlement): PlanTier {
  if (PLAN_ENTITLEMENTS.free.includes(entitlement)) {
    return 'free';
  }
  if (PLAN_ENTITLEMENTS.pro.includes(entitlement)) {
    return 'pro';
  }
  return 'team';
}
