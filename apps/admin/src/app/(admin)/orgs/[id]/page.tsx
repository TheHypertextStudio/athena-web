'use client';

import { DatePicker } from '@docket/ui/components';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type JSX } from 'react';

import { ErrorBanner, PageHeader, SignInAction } from '@/components/ui-bits';
import { formatTimestamp } from '@/lib/lifecycle';
import { DetailSkeleton, Field } from './org-detail-ui';
import { useOrgDetail } from './use-org-detail';

/**
 * The organization detail screen with inline billing actions.
 *
 * @remarks
 * A Client Component. Reads `GET /admin/orgs/:id` at runtime. Billing actions (finance+
 * on the API) may extend an eligible Stripe trial. Superadmins may grant or revoke the
 * complimentary Docket Pro entitlement with an audit reason. Finance can run the same safe
 * Stripe reconciliation worker as the scheduler. A 403 (insufficient tier or non-staff)
 * surfaces inline on each action.
 */
export default function OrgDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const partnerDiscountMinDate = new Date().toISOString().slice(0, 10);
  const partnerDiscountMaxDateValue = new Date();
  partnerDiscountMaxDateValue.setUTCMonth(partnerDiscountMaxDateValue.getUTCMonth() + 24);
  const partnerDiscountMaxDate = partnerDiscountMaxDateValue.toISOString().slice(0, 10);
  const {
    org,
    billing,
    loading,
    error,
    authFailed,
    actionError,
    pending,
    trialDays,
    setTrialDays,
    complimentaryReason,
    setComplimentaryReason,
    partnerPercent,
    setPartnerPercent,
    partnerEndsAt,
    setPartnerEndsAt,
    partnerReason,
    setPartnerReason,
    partnerPreview,
    extendTrial,
    reconcileStripe,
    grantComplimentary,
    revokeComplimentary,
    grantPartnerDiscount,
    previewPartnerDiscount,
    renewPartnerDiscount,
    revokeDiscount,
  } = useOrgDetail(params.id);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <Link
        href="/orgs"
        className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring text-body-medium w-fit rounded-sm underline-offset-4 transition-colors hover:underline focus-visible:ring-1 focus-visible:outline-none"
      >
        ← Back to organizations
      </Link>

      {loading ? (
        <DetailSkeleton />
      ) : org ? (
        <>
          <PageHeader title={org.name} description={org.slug} />
          <ErrorBanner message={error} />

          <Card>
            <CardHeader>
              <CardTitle className="text-body-medium">Overview</CardTitle>
            </CardHeader>
            <CardContent className="text-body-medium grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Organization ID" value={org.id} mono />
              <Field label="Type" value={org.isPersonal ? 'Personal' : 'Team'} />
              <Field label="Created" value={formatTimestamp(org.createdAt)} />
            </CardContent>
          </Card>

          <ErrorBanner message={actionError} />

          <Card>
            <CardHeader>
              <CardTitle className="text-body-medium">Billing state</CardTitle>
            </CardHeader>
            <CardContent className="text-body-medium grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Stripe customer"
                value={billing?.customer?.stripeCustomerId ?? 'None'}
                mono
              />
              <Field
                label="Billing country"
                value={billing?.customer?.billingCountry ?? 'Not verified'}
              />
              <Field label="Subscription" value={billing?.entitlement?.status ?? 'Free'} />
              <Field
                label="Subscription ID"
                value={billing?.entitlement?.stripeSubscriptionId ?? 'None'}
                mono
              />
              <Field label="Reconciliation" value={billing?.reconciliation?.status ?? 'Not run'} />
              <Field
                label="Last observed"
                value={formatTimestamp(billing?.entitlement?.providerObservedAt ?? null)}
              />
              <Field
                label="Discount application"
                value={
                  billing?.application
                    ? `${billing.application.programKey} · ${billing.application.status}`
                    : 'None'
                }
              />
              <Field
                label="Discount award"
                value={
                  billing?.award ? `${billing.award.percentOff}% · ${billing.award.status}` : 'None'
                }
              />
              <Field
                label="Issued credit"
                value={
                  billing?.credit
                    ? `${(billing.credit.totalAmount / 100).toLocaleString(undefined, { style: 'currency', currency: billing.credit.currency.toUpperCase() })} · ${billing.credit.status}`
                    : 'None'
                }
              />
              {billing?.reconciliation?.status === 'failed' ? (
                <p className="text-error text-body-small sm:col-span-2 lg:col-span-3">
                  Stripe reconciliation needs attention. Review the protected operator logs before
                  changing billing access.
                </p>
              ) : null}
              {billing?.permissions.manageDiscounts ? (
                <div className="flex flex-col items-start gap-2 sm:col-span-2 lg:col-span-3">
                  <Button variant="outline" disabled={pending !== null} onClick={reconcileStripe}>
                    {pending === 'reconcile-stripe' ? 'Reconciling…' : 'Reconcile Stripe'}
                  </Button>
                  <p className="text-on-surface-variant text-body-small">
                    This refreshes provider mirrors. It cannot activate an unpaid subscription or
                    resolve duplicate subscriptions.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-body-medium">Billing actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {billing?.permissions.manageDiscounts ? (
                <div className="flex flex-col gap-2">
                  <label htmlFor="trial-days" className="text-on-surface-variant text-label-medium">
                    Extend trial
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="trial-days"
                      type="number"
                      min={1}
                      max={365}
                      value={trialDays}
                      onChange={(e) => {
                        setTrialDays(e.target.value);
                      }}
                      className="w-28"
                    />
                    <Button variant="outline" disabled={pending !== null} onClick={extendTrial}>
                      {pending === 'extend-trial' ? 'Extending…' : 'Extend trial'}
                    </Button>
                  </div>
                </div>
              ) : null}

              {billing?.permissions.manageComplimentary ? (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="complimentary-reason"
                    className="text-on-surface-variant text-label-medium"
                  >
                    Complimentary Docket Pro
                  </label>
                  <p className="text-on-surface-variant text-body-small">
                    This grants every current and future Pro capability without Stripe. The API
                    rejects a grant while a paid subscription is current.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="complimentary-reason"
                      value={complimentaryReason}
                      onChange={(event) => {
                        setComplimentaryReason(event.target.value);
                      }}
                      placeholder="Reason for the complimentary grant"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      disabled={pending !== null || complimentaryReason.trim().length === 0}
                      onClick={org.isBillingExempt ? revokeComplimentary : grantComplimentary}
                    >
                      {org.isBillingExempt
                        ? pending === 'revoke-complimentary'
                          ? 'Revoking…'
                          : 'Revoke complimentary Pro'
                        : pending === 'grant-complimentary'
                          ? 'Granting…'
                          : 'Grant complimentary Pro'}
                    </Button>
                  </div>
                </div>
              ) : null}

              {billing?.permissions.manageDiscounts ? (
                <div className="flex flex-col gap-2">
                  <p className="text-on-surface-variant text-xs font-medium">
                    Private partner discount
                  </p>
                  <p className="text-on-surface-variant text-xs">
                    Finance can grant one 1–90% award for no more than 24 months. Provider failures
                    keep the same award and retry key.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-[7rem_11rem_minmax(0,1fr)_auto_auto]">
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      value={partnerPercent}
                      onChange={(event) => {
                        setPartnerPercent(event.target.value);
                      }}
                      aria-label="Partner discount percent"
                    />
                    <DatePicker
                      value={partnerEndsAt}
                      onChange={(value) => {
                        setPartnerEndsAt(value ?? '');
                      }}
                      placeholder="Choose end date"
                      ariaLabel="Partner discount end date"
                      triggerVariant="outline"
                      triggerClassName="w-full justify-start"
                      min={partnerDiscountMinDate}
                      max={partnerDiscountMaxDate}
                    />
                    <Input
                      value={partnerReason}
                      onChange={(event) => {
                        setPartnerReason(event.target.value);
                      }}
                      placeholder="Required finance reason"
                      aria-label="Partner discount reason"
                    />
                    <Button
                      variant="outline"
                      disabled={
                        pending !== null ||
                        partnerReason.trim().length === 0 ||
                        partnerEndsAt.length === 0
                      }
                      onClick={previewPartnerDiscount}
                    >
                      {pending === 'preview-partner-discount' ? 'Previewing…' : 'Preview'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        pending !== null ||
                        !partnerPreview ||
                        partnerReason.trim().length === 0 ||
                        partnerEndsAt.length === 0
                      }
                      onClick={grantPartnerDiscount}
                    >
                      {pending === 'grant-partner-discount' ? 'Applying…' : 'Grant discount'}
                    </Button>
                  </div>
                  {partnerPreview ? (
                    <div className="bg-surface-container-low flex flex-col gap-1 rounded-md p-3">
                      <p className="text-label-large">
                        {partnerPreview.percentOff}% through{' '}
                        {new Date(partnerPreview.endsAt).toLocaleDateString()}
                      </p>
                      <p className="text-body-small">
                        Provider action: {partnerPreview.providerAction.replaceAll('_', ' ')}
                      </p>
                      <p className="text-body-small">
                        {partnerPreview.credit
                          ? `Credit preview: ${(partnerPreview.credit.totalAmount / 100).toLocaleString(undefined, { style: 'currency', currency: partnerPreview.credit.currency.toUpperCase() })}`
                          : 'No current-invoice credit is required.'}
                      </p>
                    </div>
                  ) : null}
                  {billing.award &&
                  ['scheduled', 'active', 'ending'].includes(billing.award.status) ? (
                    <div className="flex flex-nowrap gap-2 overflow-x-auto">
                      {billing.award.programKey === null ? (
                        <Button
                          variant="outline"
                          disabled={pending !== null || partnerReason.trim().length === 0}
                          onClick={renewPartnerDiscount}
                        >
                          {pending === 'renew-discount' ? 'Renewing…' : 'Renew current award'}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        disabled={pending !== null || partnerReason.trim().length === 0}
                        onClick={revokeDiscount}
                      >
                        {pending === 'revoke-discount' ? 'Revoking…' : 'Revoke current award'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!billing?.permissions.manageDiscounts &&
              !billing?.permissions.manageComplimentary ? (
                <p className="text-on-surface-variant text-body-small">
                  Support can inspect billing state. Finance manages trials and discounts. A
                  superadmin manages complimentary Pro.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : (
        <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />
      )}
    </div>
  );
}
