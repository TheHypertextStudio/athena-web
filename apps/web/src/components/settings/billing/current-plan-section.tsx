import { getSubscription, type Subscription } from '@/lib/billing-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SectionError } from '@/components/settings/settings-section';
import { Badge } from '@/components/ui/badge';
import { CurrentPlanActions } from './current-plan-actions';

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
};

const STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  trialing: 'secondary',
  past_due: 'destructive',
  canceled: 'outline',
  paused: 'outline',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString();
}

export async function CurrentPlanSection() {
  let subscription: Subscription | null = null;
  let errorCode: ApiErrorCode | null = null;

  try {
    const result = await getSubscription();
    subscription = result.data;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode || !subscription) {
    return (
      <SettingsSection title="Current Plan" description="Manage your subscription and billing.">
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  const isPaidPlan = subscription.planTier !== 'free';
  const isCanceled = subscription.cancelAtPeriodEnd;

  return (
    <SettingsSection title="Current Plan" description="Manage your subscription and billing.">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-on-surface text-xl font-semibold">
                {PLAN_DISPLAY_NAMES[subscription.planTier]}
              </span>
              <Badge variant={STATUS_COLORS[subscription.status]}>{subscription.status}</Badge>
              {isCanceled && <Badge variant="outline">Cancels at period end</Badge>}
            </div>
            {isPaidPlan && subscription.currentPeriodEnd && (
              <p className="text-on-surface-variant text-sm">
                {isCanceled ? 'Access until' : 'Renews'}:{' '}
                {formatDate(subscription.currentPeriodEnd)}
              </p>
            )}
          </div>
          <CurrentPlanActions isPaidPlan={isPaidPlan} isCanceled={isCanceled} />
        </div>
      </div>
    </SettingsSection>
  );
}
