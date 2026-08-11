'use client';

import { Button, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** One active or historical product record returned by the billing API. */
interface BillingProduct {
  readonly productKey: 'docket_pro';
  readonly name: 'Docket Pro';
  readonly status: 'trialing' | 'active' | 'past_due' | 'canceled';
  readonly source: 'stripe' | 'complimentary';
  readonly trialEndsAt: string | null;
  readonly renewalDate: string | null;
}

/** Organization billing state used by this settings surface. */
interface BillingSummary {
  readonly organizationId: string;
  readonly products: BillingProduct[];
  readonly canManageBilling: boolean;
}

/** Props for {@link BillingSettings}. */
export interface BillingSettingsProps {
  /** The organization whose products are shown and managed. */
  readonly orgId: string;
  /** Whether cancellation returns to free Docket or begins the shared-workspace export window. */
  readonly isPersonal: boolean;
}

/** Format an ISO date for compact customer-facing billing copy. */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

/** Literal label for each provider subscription state. */
function statusLabel(status: BillingProduct['status']): string {
  switch (status) {
    case 'trialing':
      return 'Trialing';
    case 'active':
      return 'Active';
    case 'past_due':
      return 'Payment past due';
    case 'canceled':
      return 'Canceled';
  }
}

/** Organization-product billing settings. */
export function BillingSettings({ orgId, isPersonal }: BillingSettingsProps): JSX.Element {
  const billingQ = useApiQuery<BillingSummary>(
    apiQueryOptions(
      queryKeys.billing(orgId),
      () => api.v1.orgs[':orgId'].billing.$get({ param: { orgId } }),
      'Could not load billing information.',
    ),
  );
  const checkout = useApiMutation<{ url: string }, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].billing.checkout.$post({ param: { orgId }, json: {} }),
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

  if (billingQ.isPending) {
    return <Skeleton className="h-72 max-w-2xl rounded-lg" />;
  }
  if (billingQ.isError) {
    return (
      <p role="alert" className="text-error text-body-medium">
        {userErrorMessage(billingQ.error, 'Could not load billing information.')}
      </p>
    );
  }

  const summary = billingQ.data;
  const product = summary.products[0];
  const ownsPro = product?.status === 'trialing' || product?.status === 'active';
  const canOpenPortal = product?.source === 'stripe' && product.status !== 'canceled';
  const mutation = canOpenPortal ? portal : checkout;
  const mutationError = checkout.error ?? portal.error;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Billing"
        description="Docket is free. Docket Pro is $8 per organization each month."
      />

      <section className="border-outline-variant flex max-w-2xl flex-col gap-4 rounded-lg border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-on-surface text-title-small">Docket</h3>
            <p className="text-on-surface-variant text-body-medium mt-1">Free</p>
          </div>
          <span className="text-on-surface-variant text-label-large">Available</span>
        </div>
        <p className="text-on-surface-variant text-body-medium">
          Personal planning, scheduling, and time tracking remain available without Docket Pro.
        </p>
      </section>

      <section className="border-outline-variant flex max-w-2xl flex-col gap-4 rounded-lg border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-on-surface text-title-small">Docket Pro</h3>
            <p className="text-on-surface-variant text-body-medium mt-1">
              $8 per organization each month
            </p>
          </div>
          <span className="text-on-surface text-label-large">
            {product ? statusLabel(product.status) : 'Not added'}
          </span>
        </div>
        <p className="text-on-surface-variant text-body-medium">
          Shared work, integrations, MCP, and current Athena functionality.
        </p>
        {product?.source === 'complimentary' ? (
          <p className="text-on-surface-variant text-body-medium">Docket Pro is complimentary.</p>
        ) : null}
        {product?.status === 'trialing' && product.trialEndsAt ? (
          <p className="text-on-surface-variant text-body-medium">
            Trial ends {formatDate(product.trialEndsAt)}. Monthly billing begins after the trial.
          </p>
        ) : null}
        {product?.status === 'active' && product.renewalDate ? (
          <p className="text-on-surface-variant text-body-medium">
            Renews {formatDate(product.renewalDate)}.
          </p>
        ) : null}
        {product?.status === 'past_due' ? (
          <p className="text-error text-body-medium">
            Payment is past due. Open billing management to update the payment method.
          </p>
        ) : null}
        <p className="text-on-surface-variant text-body-medium">
          {isPersonal
            ? 'Canceling Docket Pro returns this workspace to free Docket without deleting its data.'
            : 'Canceling Docket Pro starts a 14-day period to export this shared workspace before deletion.'}
        </p>
        {summary.canManageBilling && product?.source !== 'complimentary' ? (
          <div>
            <Button
              type="button"
              onClick={() => {
                mutation.mutate(undefined);
              }}
              disabled={mutation.isPending}
            >
              {canOpenPortal ? 'Manage Docket Pro' : 'Add Docket Pro'}
            </Button>
          </div>
        ) : summary.canManageBilling ? null : (
          <p className="text-on-surface-variant text-body-medium">
            A workspace administrator can manage Docket Pro.
          </p>
        )}
        {mutationError ? (
          <p role="alert" className="text-error text-body-medium">
            {userErrorMessage(mutationError, 'Could not open billing management.')}
          </p>
        ) : null}
        {ownsPro ? null : (
          <p className="text-on-surface-variant text-body-small">
            A new organization receives one 14-day Docket Pro trial. Returning organizations do not
            receive another trial.
          </p>
        )}
      </section>
    </div>
  );
}
