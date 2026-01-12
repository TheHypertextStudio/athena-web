'use client';

import { useTransition } from 'react';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import {
  useEntitlements,
  getRequiredPlanTier,
  getPlanDisplayName,
  getEntitlementDisplayName,
  type Entitlement,
} from '@/hooks/use-entitlements';
import { createCheckoutSession } from '@/lib/billing-actions';
import type { PlanTier } from '@/lib/api-client';

export interface UpgradeModalProps {
  /**
   * Whether the modal is open.
   */
  open: boolean;
  /**
   * Callback when the modal open state changes.
   */
  onOpenChange: (open: boolean) => void;
  /**
   * The entitlement required for this feature.
   */
  entitlement: Entitlement;
  /**
   * Custom feature name for display.
   * Defaults to the entitlement's display name.
   */
  featureName?: string;
  /**
   * Custom feature description.
   */
  featureDescription?: string;
}

/**
 * Plan features for display in the upgrade modal.
 */
const PLAN_FEATURES: Record<PlanTier, string[]> = {
  free: ['Up to 100 tasks', 'Basic projects', 'Calendar view', 'Activity feed'],
  pro: [
    'Unlimited tasks & projects',
    'Time tracking',
    'External integrations',
    'AI features',
    'Data export',
    'Priority support',
  ],
  team: [
    'Everything in Pro',
    'Team workspaces',
    'Collaboration tools',
    'Admin controls',
    'SSO authentication',
  ],
};

/**
 * Modal prompting user to upgrade their plan.
 *
 * Use this when business logic determines an upgrade is needed.
 * Trigger via the entitlement error context or manage state directly.
 */
export function UpgradeModal({
  open,
  onOpenChange,
  entitlement,
  featureName,
  featureDescription,
}: UpgradeModalProps) {
  const [isPending, startTransition] = useTransition();
  const { planTier } = useEntitlements();

  const requiredPlan = getRequiredPlanTier(entitlement);
  const requiredPlanName = getPlanDisplayName(requiredPlan);
  const displayFeatureName = featureName ?? getEntitlementDisplayName(entitlement);

  const handleUpgrade = () => {
    startTransition(async () => {
      try {
        const { checkoutUrl } = await createCheckoutSession({
          planTier: requiredPlan === 'free' ? 'pro' : requiredPlan,
          billingInterval: 'month',
          successUrl: `${window.location.origin}/settings/billing?success=true`,
          cancelUrl: window.location.href,
        });
        window.location.href = checkoutUrl;
      } catch (error) {
        console.error('Failed to create checkout session:', error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
            <AutoAwesomeIcon className="text-primary" />
          </div>
          <DialogTitle className="text-center">Upgrade to {requiredPlanName}</DialogTitle>
          <DialogDescription className="text-center">
            {featureDescription ?? (
              <>
                <span className="font-medium">{displayFeatureName}</span> is available on the{' '}
                {requiredPlanName} plan.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-surface-container my-4 rounded-lg p-4">
          <h4 className="text-on-surface mb-2 text-sm font-medium">{requiredPlanName} includes:</h4>
          <ul className="text-on-surface-variant space-y-1.5 text-sm">
            {PLAN_FEATURES[requiredPlan].map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={handleUpgrade} disabled={isPending} className="w-full">
            {isPending ? 'Redirecting...' : `Upgrade to ${requiredPlanName}`}
          </Button>
          <Button
            variant="text"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isPending}
            className="w-full"
          >
            Maybe later
          </Button>
        </DialogFooter>

        {planTier !== 'free' && (
          <p className="text-on-surface-variant mt-2 text-center text-xs">
            You&apos;re currently on the {getPlanDisplayName(planTier)} plan.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
