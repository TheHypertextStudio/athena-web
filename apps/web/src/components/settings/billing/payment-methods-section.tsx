import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import {
  getSubscription,
  getPaymentMethods,
  type Subscription,
  type PaymentMethod,
} from '@/lib/billing-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import {
  SettingsSection,
  SettingsItemCard,
  SettingsEmptyState,
  SectionError,
} from '@/components/settings/settings-section';
import { Badge } from '@/components/ui/badge';
import { PaymentMethodsActions } from './payment-methods-actions';

export async function PaymentMethodsSection() {
  let subscription: Subscription | null = null;
  let paymentMethods: PaymentMethod[] = [];
  let errorCode: ApiErrorCode | null = null;

  try {
    const [subscriptionResult, paymentMethodsResult] = await Promise.all([
      getSubscription(),
      getPaymentMethods(),
    ]);
    subscription = subscriptionResult.data;
    paymentMethods = paymentMethodsResult.data.paymentMethods;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode) {
    return (
      <SettingsSection title="Payment Methods" description="Manage your payment methods.">
        <SectionError code={errorCode} />
      </SettingsSection>
    );
  }

  const isPaidPlan = subscription?.planTier !== 'free';

  // Only show for paid plans
  if (!isPaidPlan) {
    return null;
  }

  return (
    <SettingsSection title="Payment Methods" description="Manage your payment methods.">
      {paymentMethods.length > 0 ? (
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
          <PaymentMethodsActions />
        </div>
      ) : (
        <SettingsEmptyState message="No payment methods on file." />
      )}
    </SettingsSection>
  );
}
