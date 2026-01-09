'use client';

import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useBilling } from '@/hooks/use-billing';
import {
  SettingsSection,
  SettingsItemCard,
  SettingsEmptyState,
} from '@/components/settings/settings-section';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

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

export default function BillingSettingsPage() {
  const {
    subscription,
    isLoadingSubscription,
    invoices,
    isLoadingInvoices,
    paymentMethods,
    isLoadingPaymentMethods,
    openPortal,
    isOpeningPortal,
    cancelSubscription,
    isCanceling,
    resumeSubscription,
    isResuming,
  } = useBilling();

  const handleManageSubscription = async () => {
    try {
      const result = await openPortal(window.location.href);
      window.location.href = result.data.portalUrl;
    } catch (error) {
      console.error('Failed to open billing portal:', error);
    }
  };

  const handleCancelSubscription = () => {
    if (
      confirm(
        'Are you sure you want to cancel your subscription? You will retain access until the end of your billing period.',
      )
    ) {
      cancelSubscription();
    }
  };

  const handleResumeSubscription = () => {
    resumeSubscription();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  if (isLoadingSubscription) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[150px] w-full" />
      </div>
    );
  }

  const isPaidPlan = subscription.planTier !== 'free';
  const isCanceled = subscription.cancelAtPeriodEnd;

  return (
    <div className="space-y-6">
      {/* Current Plan */}
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
            <div className="flex gap-2">
              {isPaidPlan && !isCanceled && (
                <Button
                  variant="outline"
                  onClick={() => {
                    handleCancelSubscription();
                  }}
                  disabled={isCanceling}
                >
                  Cancel
                </Button>
              )}
              {isCanceled && (
                <Button
                  variant="outline"
                  onClick={() => {
                    handleResumeSubscription();
                  }}
                  disabled={isResuming}
                >
                  Resume
                </Button>
              )}
              <Button
                onClick={() => {
                  void handleManageSubscription();
                }}
                disabled={isOpeningPortal}
              >
                {isPaidPlan ? 'Manage Subscription' : 'Upgrade'}
                <OpenInNewOutlinedIcon sx={{ fontSize: 16 }} className="ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* Payment Methods */}
      {isPaidPlan && (
        <SettingsSection title="Payment Methods" description="Manage your payment methods.">
          {isLoadingPaymentMethods ? (
            <Skeleton className="h-[60px] w-full" />
          ) : paymentMethods.length > 0 ? (
            <div className="space-y-3">
              {paymentMethods.map((method) => (
                <SettingsItemCard
                  key={method.id}
                  icon={<CreditCardOutlinedIcon sx={{ fontSize: 20 }} />}
                  title={`${method.card?.brand ?? 'Card'} •••• ${method.card?.last4 ?? '----'}`}
                  description={`Expires ${String(method.card?.expMonth ?? '--')}/${String(method.card?.expYear ?? '--')}`}
                  badge={method.isDefault ? <Badge variant="secondary">Default</Badge> : undefined}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleManageSubscription();
                }}
                disabled={isOpeningPortal}
              >
                Manage payment methods
              </Button>
            </div>
          ) : (
            <SettingsEmptyState message="No payment methods on file." />
          )}
        </SettingsSection>
      )}

      {/* Billing History */}
      {isPaidPlan && (
        <SettingsSection
          title="Billing History"
          description="View and download your past invoices."
        >
          {isLoadingInvoices ? (
            <Skeleton className="h-[100px] w-full" />
          ) : invoices.length > 0 ? (
            <div className="space-y-3">
              {invoices.map((invoice) => (
                <SettingsItemCard
                  key={invoice.id}
                  icon={
                    <span className="text-on-surface text-sm font-medium">
                      {formatCurrency(invoice.amountPaid, invoice.currency)}
                    </span>
                  }
                  title={formatDate(invoice.createdAt)}
                  badge={
                    <Badge variant={invoice.status === 'paid' ? 'default' : 'outline'}>
                      {invoice.status}
                    </Badge>
                  }
                  action={
                    invoice.invoicePdfUrl && (
                      <Button variant="ghost" size="icon" asChild>
                        <a href={invoice.invoicePdfUrl} target="_blank" rel="noopener noreferrer">
                          <FileDownloadOutlinedIcon sx={{ fontSize: 18 }} />
                        </a>
                      </Button>
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <SettingsEmptyState message="No invoices yet." />
          )}
        </SettingsSection>
      )}
    </div>
  );
}
