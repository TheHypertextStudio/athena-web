import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { getSubscription, getInvoices, type Subscription, type Invoice } from '@/lib/billing-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import {
  SettingsSection,
  SettingsItemCard,
  SettingsEmptyState,
  SectionError,
} from '@/components/settings/settings-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export async function BillingHistorySection() {
  let subscription: Subscription | null = null;
  let invoices: Invoice[] = [];
  let errorCode: ApiErrorCode | null = null;

  try {
    const [subscriptionResult, invoicesResult] = await Promise.all([
      getSubscription(),
      getInvoices(5),
    ]);
    subscription = subscriptionResult.data;
    invoices = invoicesResult.data.invoices;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode) {
    return (
      <SettingsSection title="Billing History" description="View and download your past invoices.">
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
    <SettingsSection title="Billing History" description="View and download your past invoices.">
      {invoices.length > 0 ? (
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
  );
}
