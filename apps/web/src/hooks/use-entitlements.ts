'use client';

import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/lib/api-client';
import type { Subscription, PlanTier } from '@/lib/api-client';

/**
 * Available entitlements matching the backend definitions.
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
 * Entitlements available for each plan tier.
 * Mirrors backend configuration in billing/config.ts.
 */
const PLAN_ENTITLEMENTS: Record<PlanTier, Entitlement[]> = {
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

/**
 * Get human-readable plan name.
 */
export function getPlanDisplayName(tier: PlanTier): string {
  switch (tier) {
    case 'free':
      return 'Free';
    case 'pro':
      return 'Pro';
    case 'team':
      return 'Team';
  }
}

/**
 * Get human-readable entitlement name.
 */
export function getEntitlementDisplayName(entitlement: Entitlement): string {
  const names: Record<Entitlement, string> = {
    basic_tasks: 'Basic Tasks',
    basic_projects: 'Basic Projects',
    basic_calendar: 'Calendar',
    basic_activities: 'Activity Feed',
    unlimited_tasks: 'Unlimited Tasks',
    unlimited_projects: 'Unlimited Projects',
    time_tracking: 'Time Tracking',
    integrations: 'Integrations',
    export_data: 'Data Export',
    priority_support: 'Priority Support',
    team_workspaces: 'Team Workspaces',
    team_collaboration: 'Team Collaboration',
    admin_controls: 'Admin Controls',
    sso: 'Single Sign-On',
    ai_features: 'AI Features',
  };
  return names[entitlement];
}

const defaultSubscription: Subscription = {
  planTier: 'free',
  status: 'active',
  entitlements: [],
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

/**
 * Account limits per provider by plan tier.
 * null means unlimited.
 */
const ACCOUNT_LIMITS_BY_PLAN: Record<PlanTier, number | null> = {
  free: 2,
  pro: null,
  team: null,
};

/**
 * Hook for checking user entitlements.
 *
 * Uses the subscription data to determine what features the user can access.
 * Provides helper functions for checking entitlements and displaying upgrade prompts.
 */
export function useEntitlements() {
  const subscriptionQuery = useQuery<Awaited<ReturnType<typeof billingApi.getSubscription>>>({
    queryKey: ['billing', 'subscription'],
    queryFn: () => billingApi.getSubscription(),
    staleTime: 1000 * 60 * 5, // 5 minutes - entitlements don't change often
  });

  const subscription = subscriptionQuery.data?.data ?? defaultSubscription;
  const entitlements = subscription.entitlements as Entitlement[];
  const planTier = subscription.planTier;

  /**
   * Check if the user has a specific entitlement.
   */
  function hasEntitlement(entitlement: Entitlement): boolean {
    return entitlements.includes(entitlement);
  }

  /**
   * Check if the user's subscription is active (can use features).
   */
  function isSubscriptionActive(): boolean {
    return subscription.status === 'active' || subscription.status === 'trialing';
  }

  /**
   * Get info about a missing entitlement for upgrade prompts.
   */
  function getMissingEntitlementInfo(entitlement: Entitlement): {
    requiredPlan: PlanTier;
    requiredPlanName: string;
    featureName: string;
  } | null {
    if (hasEntitlement(entitlement)) {
      return null;
    }
    const requiredPlan = getRequiredPlanTier(entitlement);
    return {
      requiredPlan,
      requiredPlanName: getPlanDisplayName(requiredPlan),
      featureName: getEntitlementDisplayName(entitlement),
    };
  }

  /**
   * Get the maximum number of accounts allowed per integration provider.
   * Returns null if unlimited.
   */
  function getAccountLimit(): number | null {
    return ACCOUNT_LIMITS_BY_PLAN[planTier];
  }

  /**
   * Check if user has reached their account limit for a provider.
   */
  function hasReachedAccountLimit(currentAccountCount: number): boolean {
    const limit = getAccountLimit();
    return limit !== null && currentAccountCount >= limit;
  }

  return {
    /** Current plan tier */
    planTier,
    /** Current subscription status */
    status: subscription.status,
    /** Whether subscription is active or trialing */
    isActive: isSubscriptionActive(),
    /** List of entitlements the user has */
    entitlements,
    /** Whether entitlements are still loading */
    isLoading: subscriptionQuery.isLoading,
    /** Check if user has a specific entitlement */
    hasEntitlement,
    /** Get info about a missing entitlement for upgrade prompts */
    getMissingEntitlementInfo,
    /** Get account limit per provider (null = unlimited) */
    getAccountLimit,
    /** Check if user has reached account limit for a provider */
    hasReachedAccountLimit,
  };
}
