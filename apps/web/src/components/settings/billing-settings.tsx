'use client';

import { Button, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { BillingDiscountsSection } from '@/components/settings/billing-discounts-section';
import { safeSameOriginPath } from '@/components/app-shell-utils';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** One product record returned by the organization billing API. */
interface BillingProduct {
  readonly productKey: 'docket_pro';
  readonly name: 'Docket Pro';
  readonly status: 'trialing' | 'active' | 'past_due' | 'canceled';
  readonly source: 'stripe' | 'complimentary';
  readonly trialEndsAt: string | null;
  readonly renewalDate: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancellationDate: string | null;
  readonly graceEndsAt: string | null;
  readonly providerObservedAt: string | null;
}

/** Organization billing state used by this settings surface. */
interface BillingSummary {
  readonly organizationId: string;
  readonly checkoutEnabled: boolean;
  readonly listPrice: {
    readonly amount: 800;
    readonly currency: 'usd';
    readonly interval: 'month';
  };
  readonly accessMode: 'writable' | 'read_only';
  readonly products: BillingProduct[];
  readonly canManageBilling: boolean;
  readonly effectiveDiscount: {
    readonly percentOff: number;
    readonly status: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly reviewAt: string;
  } | null;
  readonly applicationStatus: string | null;
  readonly issuedCredit: {
    readonly currency: string;
    readonly amount: number;
    readonly issuedAt: string;
  } | null;
}

/** Props for {@link BillingSettings}. */
export interface BillingSettingsProps {
  /** The organization whose products are shown and managed. */
  readonly orgId: string;
  /** Whether baseline Docket remains writable after Pro ends. */
  readonly isPersonal: boolean;
}

/** Format an ISO date for customer-facing billing copy. */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

/** Format a currency-minor-unit price without exposing provider formatting. */
function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

/** Preserve a product action across Billing and hosted Checkout without accepting another origin. */
function checkoutReturnPath(): string {
  const requested = new URLSearchParams(window.location.search).get('returnTo');
  return safeSameOriginPath(requested) ?? `${window.location.pathname}${window.location.search}`;
}

/** Literal label for the customer's current billing state. */
function statusLabel(
  product: BillingProduct | undefined,
  accessMode: BillingSummary['accessMode'],
) {
  if (!product) return accessMode === 'read_only' ? 'Read-only' : 'Free';
  if (product.source === 'complimentary' && product.status === 'active') return 'Complimentary';
  if (product.cancelAtPeriodEnd) return 'Cancellation scheduled';
  switch (product.status) {
    case 'trialing':
      return 'Trialing';
    case 'active':
      return 'Active';
    case 'past_due':
      return accessMode === 'read_only' ? 'Read-only' : 'Payment past due';
    case 'canceled':
      return 'Read-only';
  }
}

/** Organization-product billing settings. */
export function BillingSettings({ orgId, isPersonal }: BillingSettingsProps): JSX.Element {
  const billingQ = useApiQuery(
    apiQueryOptions(
      queryKeys.billing(orgId),
      () => api.v1.orgs[':orgId'].billing.$get({ param: { orgId } }),
      'Could not load billing information.',
    ),
  );
  const checkout = useApiMutation<{ url: string }, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].billing.checkout.$post({
            param: { orgId },
            json: { returnTo: checkoutReturnPath() },
          }),
        'Could not open Docket Pro checkout.',
      ),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });
  const portal = useApiMutation<{ url: string }, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].billing.portal.$post({ param: { orgId } }),
        'Could not open billing management.',
      ),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  if (billingQ.isPending) return <Skeleton className="h-72 max-w-2xl rounded-lg" />;
  if (billingQ.isError) {
    return (
      <p role="alert" className="text-error text-body-medium">
        {userErrorMessage(billingQ.error, 'Could not load billing information.')}
      </p>
    );
  }

  const summary = billingQ.data;
  const [product] = summary.products;
  const complimentary = product?.source === 'complimentary' && product.status === 'active';
  const canOpenPortal = product?.source === 'stripe' && product.status !== 'canceled';
  const mutation = canOpenPortal ? portal : checkout;
  const mutationError = checkout.error ?? portal.error;
  const displayedPrice = `${formatPrice(summary.listPrice.amount, summary.listPrice.currency)} USD per organization each month, plus tax where required`;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Billing"
        description="See your current access, upcoming billing dates, and the action that Docket needs next."
      />

      <section className="border-outline-variant flex max-w-2xl flex-col gap-5 rounded-lg border p-5">
        <div className="flex flex-nowrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-on-surface text-title-medium">
              {complimentary ? 'Complimentary Docket Pro' : product ? 'Docket Pro' : 'Docket'}
            </h3>
            {!complimentary ? (
              <p className="text-on-surface-variant text-body-medium mt-1">
                {product ? displayedPrice : 'Free'}
              </p>
            ) : null}
          </div>
          <span className="text-on-surface text-label-large shrink-0">
            {statusLabel(product, summary.accessMode)}
          </span>
        </div>

        <p className="text-on-surface-variant text-body-medium">
          {product
            ? 'Docket Pro includes shared work, integrations, MCP, Athena, and voice.'
            : isPersonal
              ? 'Personal planning, scheduling, and time tracking remain writable on free Docket.'
              : 'Shared work is read-only until an administrator adds Docket Pro.'}
        </p>

        {complimentary ? (
          <p className="text-on-surface-variant text-body-medium">
            All current and future Docket Pro features are included. No payment method or renewal is
            required.
          </p>
        ) : null}
        {product?.status === 'trialing' && product.trialEndsAt ? (
          <p className="text-on-surface-variant text-body-medium">
            Your trial ends {formatDate(product.trialEndsAt)}.
            {!product.cancelAtPeriodEnd ? ' Your first monthly charge follows on that date.' : null}
          </p>
        ) : null}
        {product?.status === 'active' && !product.cancelAtPeriodEnd && product.renewalDate ? (
          <p className="text-on-surface-variant text-body-medium">
            Your next renewal is {formatDate(product.renewalDate)}.
          </p>
        ) : null}
        {product?.cancelAtPeriodEnd && product.cancellationDate ? (
          <p className="text-on-surface-variant text-body-medium">
            Your Pro features remain available through {formatDate(product.cancellationDate)}. After
            that, shared work becomes read-only. You can export or reactivate at any time. Docket
            does not delete workspace data when Pro ends.
          </p>
        ) : null}
        {product?.status === 'past_due' ? (
          <p className="text-error text-body-medium" role="status">
            We could not collect this payment. Update the payment method
            {product.graceEndsAt ? ` by ${formatDate(product.graceEndsAt)}` : ''} to keep editing
            shared work.
          </p>
        ) : null}
        {product?.status === 'canceled' ? (
          <p className="text-on-surface-variant text-body-medium">
            Shared work is read-only. Docket keeps it available for viewing and export, and an
            administrator can reactivate Pro at any time.
          </p>
        ) : null}

        {summary.effectiveDiscount ? (
          <p className="text-on-surface-variant text-body-medium">
            Your {summary.effectiveDiscount.percentOff}% discount is active through{' '}
            {formatDate(summary.effectiveDiscount.endsAt)}. Docket will review eligibility on{' '}
            {formatDate(summary.effectiveDiscount.reviewAt)}.
          </p>
        ) : null}

        {summary.canManageBilling &&
        !complimentary &&
        (canOpenPortal || summary.checkoutEnabled) ? (
          <div className="flex flex-nowrap items-center gap-2 overflow-hidden">
            <Button
              type="button"
              onClick={() => {
                mutation.mutate(undefined);
              }}
              disabled={mutation.isPending}
            >
              {canOpenPortal
                ? product.status === 'past_due'
                  ? 'Update payment method'
                  : 'Manage billing'
                : product
                  ? 'Reactivate Docket Pro'
                  : 'Start Docket Pro trial'}
            </Button>
          </div>
        ) : summary.canManageBilling && !complimentary ? (
          <p className="text-on-surface-variant text-body-medium">
            Docket Pro checkout is not open yet. Existing subscriptions and billing management stay
            available.
          </p>
        ) : summary.canManageBilling ? null : (
          <p className="text-on-surface-variant text-body-medium">
            A workspace administrator can change billing. You can still see the plan and dates.
          </p>
        )}
        {mutationError ? (
          <p role="alert" className="text-error text-body-medium">
            {userErrorMessage(mutationError, 'Could not open billing management.')}
          </p>
        ) : null}
      </section>

      {!complimentary ? (
        <BillingDiscountsSection
          orgId={orgId}
          isPersonal={isPersonal}
          canManageBilling={summary.canManageBilling}
        />
      ) : null}
    </div>
  );
}
