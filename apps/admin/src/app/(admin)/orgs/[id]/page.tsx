'use client';

import { DatePicker } from '@docket/ui/components';
import { Button, ControlGroup, Input, Stack, Surface, Text } from '@docket/ui/primitives';
import { useParams } from 'next/navigation';
import { type JSX } from 'react';

import { AsyncContent, QueryErrorBanner } from '@/components/admin-feedback';
import { DetailBackLink, DetailSkeleton, Property, PropertyList } from '@/components/admin-detail';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { ConfirmButton } from '@/components/confirm-button';
import { formatTimestamp } from '@/lib/lifecycle';
import { creditLine, money } from '@/lib/money';
import type { AdminOrg, AdminOrgBillingState } from '@/lib/types';
import { type OrgDetailData, type PartnerPreview, useOrgDetail } from './use-org-detail';

/** How far ahead a partner discount may be scheduled to end. */
const PARTNER_DISCOUNT_MAX_MONTHS = 24;

/** The award statuses that can still be renewed or revoked. */
const CHANGEABLE_AWARD_STATUSES = ['scheduled', 'active', 'ending'];

/**
 * The organization detail screen with inline billing actions.
 *
 * @remarks
 * Billing actions are gated by operator tier on the API, and the response's `permissions` block
 * says which the caller holds — so each section renders only where the operator can actually act,
 * rather than offering every control and failing the ones they may not perform.
 *
 * The two irreversible actions on this screen — revoking complimentary Pro, and revoking a live
 * partner discount — go through a confirmation. Both change what an organization is paying and
 * neither has an undo.
 */
export default function OrgDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const detail = useOrgDetail(params.id);

  return (
    <AdminPage width="form">
      <DetailBackLink href="/orgs" label="organizations" />

      {detail.error ? (
        <QueryErrorBanner
          error={detail.error}
          fallback="Could not load this organization."
          onRetry={() => void detail.load()}
        />
      ) : null}

      <AsyncContent
        loading={detail.loading}
        empty={detail.org === undefined}
        skeleton={<DetailSkeleton panels={3} />}
        emptyState={<></>}
      >
        {detail.org ? <OrgDetail org={detail.org} detail={detail} /> : null}
      </AsyncContent>
    </AdminPage>
  );
}

/** Everything the screen shows once the organization has loaded. */
function OrgDetail({
  org,
  detail,
}: {
  readonly org: AdminOrg;
  readonly detail: OrgDetailData;
}): JSX.Element {
  const { billing } = detail;

  return (
    <Stack gap={6}>
      <AdminPageHeader title={org.name} description={org.slug} />

      <AdminSection title="Overview">
        <PropertyList>
          <Property label="Organization ID" value={org.id} identifier />
          <Property label="Type" value={org.isPersonal ? 'Personal' : 'Team'} />
          <Property label="Created" value={formatTimestamp(org.createdAt)} />
        </PropertyList>
      </AdminSection>

      <BillingState billing={billing} />

      <AdminSection title="Billing actions">
        {detail.actionError ? (
          <QueryErrorBanner error={detail.actionError} fallback="Could not complete that action." />
        ) : null}
        <BillingActions org={org} detail={detail} />
      </AdminSection>
    </Stack>
  );
}

/** What the provider currently reports for this organization. */
function BillingState({
  billing,
}: {
  readonly billing: AdminOrgBillingState | undefined;
}): JSX.Element {
  return (
    <AdminSection title="Billing state">
      <PropertyList>
        <Property
          label="Stripe customer"
          value={billing?.customer?.stripeCustomerId ?? 'None'}
          identifier={Boolean(billing?.customer?.stripeCustomerId)}
        />
        <Property
          label="Billing country"
          value={billing?.customer?.billingCountry ?? 'Not verified'}
        />
        <Property label="Subscription" value={billing?.entitlement?.status ?? 'Free'} />
        <Property
          label="Subscription ID"
          value={billing?.entitlement?.stripeSubscriptionId ?? 'None'}
          identifier={Boolean(billing?.entitlement?.stripeSubscriptionId)}
        />
        <Property label="Reconciliation" value={billing?.reconciliation?.status ?? 'Not run'} />
        <Property
          label="Last observed"
          value={formatTimestamp(billing?.entitlement?.providerObservedAt ?? null)}
        />
        <Property label="Discount application" value={applicationSummary(billing)} />
        <Property label="Discount award" value={awardSummary(billing)} />
        <Property label="Issued credit" value={creditSummary(billing)} />
      </PropertyList>

      {billing?.reconciliation?.status === 'failed' ? (
        <Text as="p" token="body-small" tone="error">
          Stripe reconciliation needs attention. Review the protected operator logs before changing
          billing access.
        </Text>
      ) : null}
    </AdminSection>
  );
}

/** The actions this operator's tier permits, or a note explaining what each tier may do. */
function BillingActions({
  org,
  detail,
}: {
  readonly org: AdminOrg;
  readonly detail: OrgDetailData;
}): JSX.Element {
  const permissions = detail.billing?.permissions;

  if (!permissions?.manageDiscounts && !permissions?.manageComplimentary) {
    return (
      <Text as="p" token="body-small" tone="muted">
        Support can inspect billing state. Finance manages trials and discounts. A superadmin
        manages complimentary Pro.
      </Text>
    );
  }

  return (
    <Stack gap={6}>
      {permissions.manageDiscounts ? <ReconcileStripe detail={detail} /> : null}
      {permissions.manageDiscounts ? <ExtendTrial detail={detail} /> : null}
      {permissions.manageComplimentary ? <ComplimentaryPro org={org} detail={detail} /> : null}
      {permissions.manageDiscounts ? <PartnerDiscount detail={detail} /> : null}
    </Stack>
  );
}

/** Refresh the provider mirrors for this organization. */
function ReconcileStripe({ detail }: { readonly detail: OrgDetailData }): JSX.Element {
  return (
    <Stack gap={2}>
      <ControlGroup controlSize="md">
        <Button
          variant="outline"
          disabled={detail.pending !== null}
          onClick={detail.reconcileStripe}
        >
          {detail.pending === 'reconcile-stripe' ? 'Reconciling…' : 'Reconcile Stripe'}
        </Button>
      </ControlGroup>
      <Text as="p" token="body-small" tone="muted">
        This refreshes provider mirrors. It cannot activate an unpaid subscription or resolve
        duplicate subscriptions.
      </Text>
    </Stack>
  );
}

/** Extend an eligible Stripe trial by a number of days. */
function ExtendTrial({ detail }: { readonly detail: OrgDetailData }): JSX.Element {
  return (
    <Stack gap={2}>
      <Text as="label" token="label-medium" tone="muted" htmlFor="trial-days">
        Extend trial
      </Text>
      <ControlGroup controlSize="md">
        <Input
          id="trial-days"
          type="number"
          min={1}
          max={365}
          value={detail.trialDays}
          onChange={(event) => {
            detail.setTrialDays(event.target.value);
          }}
          className="w-28"
        />
        <Button variant="outline" disabled={detail.pending !== null} onClick={detail.extendTrial}>
          {detail.pending === 'extend-trial' ? 'Extending…' : 'Extend trial'}
        </Button>
      </ControlGroup>
    </Stack>
  );
}

/** Grant or revoke the complimentary Docket Pro entitlement. */
function ComplimentaryPro({
  org,
  detail,
}: {
  readonly org: AdminOrg;
  readonly detail: OrgDetailData;
}): JSX.Element {
  const busy = detail.pending !== null;
  const noReason = detail.complimentaryReason.trim().length === 0;

  return (
    <Stack gap={2}>
      <Text as="label" token="label-medium" tone="muted" htmlFor="complimentary-reason">
        Complimentary Docket Pro
      </Text>
      <Text as="p" token="body-small" tone="muted">
        This grants every current and future Pro capability without Stripe. The API rejects a grant
        while a paid subscription is current.
      </Text>
      <div className="flex flex-col gap-2 @lg:flex-row">
        <Input
          id="complimentary-reason"
          value={detail.complimentaryReason}
          onChange={(event) => {
            detail.setComplimentaryReason(event.target.value);
          }}
          placeholder="Reason for the complimentary grant"
          className="flex-1"
        />
        <ControlGroup controlSize="md">
          <ComplimentaryAction
            granted={org.isBillingExempt}
            orgName={org.name}
            pending={detail.pending}
            disabled={busy || noReason}
            onGrant={detail.grantComplimentary}
            onRevoke={detail.revokeComplimentary}
          />
        </ControlGroup>
      </div>
    </Stack>
  );
}

/** The grant or revoke control, whichever this organization's current state calls for. */
function ComplimentaryAction({
  granted,
  orgName,
  pending,
  disabled,
  onGrant,
  onRevoke,
}: {
  readonly granted: boolean;
  readonly orgName: string;
  readonly pending: string | null;
  readonly disabled: boolean;
  readonly onGrant: () => void;
  readonly onRevoke: () => void;
}): JSX.Element {
  if (granted) {
    return (
      <ConfirmButton
        label={pending === 'revoke-complimentary' ? 'Revoking…' : 'Revoke complimentary Pro'}
        disabled={disabled}
        pending={pending === 'revoke-complimentary'}
        title="Revoke complimentary Pro?"
        description={`${orgName} loses every Pro capability immediately, and nothing restores it automatically. The reason you entered is recorded in the audit log.`}
        confirmLabel="Revoke complimentary Pro"
        onConfirm={onRevoke}
      />
    );
  }

  return (
    <Button variant="outline" disabled={disabled} onClick={onGrant}>
      {pending === 'grant-complimentary' ? 'Granting…' : 'Grant complimentary Pro'}
    </Button>
  );
}

/** Preview, grant, renew, and revoke the private partner discount. */
function PartnerDiscount({ detail }: { readonly detail: OrgDetailData }): JSX.Element {
  const busy = detail.pending !== null;
  const noReason = detail.partnerReason.trim().length === 0;
  const noEndDate = detail.partnerEndsAt.length === 0;

  const today = new Date();
  const latest = new Date();
  latest.setUTCMonth(latest.getUTCMonth() + PARTNER_DISCOUNT_MAX_MONTHS);

  return (
    <Stack gap={2}>
      <Text as="p" token="label-medium" tone="muted">
        Private partner discount
      </Text>
      <Text as="p" token="body-small" tone="muted">
        Finance can grant one 1–90% award for no more than {PARTNER_DISCOUNT_MAX_MONTHS} months.
        Provider failures keep the same award and retry key.
      </Text>

      <div className="grid gap-2 @2xl:grid-cols-[7rem_11rem_minmax(0,1fr)_auto_auto]">
        <Input
          type="number"
          min={1}
          max={90}
          value={detail.partnerPercent}
          onChange={(event) => {
            detail.setPartnerPercent(event.target.value);
          }}
          aria-label="Partner discount percent"
        />
        <DatePicker
          value={detail.partnerEndsAt}
          onChange={(value) => {
            detail.setPartnerEndsAt(value ?? '');
          }}
          placeholder="Choose end date"
          ariaLabel="Partner discount end date"
          triggerVariant="outline"
          triggerClassName="w-full justify-start"
          min={today.toISOString().slice(0, 10)}
          max={latest.toISOString().slice(0, 10)}
        />
        <Input
          value={detail.partnerReason}
          onChange={(event) => {
            detail.setPartnerReason(event.target.value);
          }}
          placeholder="Required finance reason"
          aria-label="Partner discount reason"
        />
        <Button
          variant="outline"
          disabled={busy || noReason || noEndDate}
          onClick={detail.previewPartnerDiscount}
        >
          {detail.pending === 'preview-partner-discount' ? 'Previewing…' : 'Preview'}
        </Button>
        <Button
          disabled={busy || !detail.partnerPreview || noReason || noEndDate}
          onClick={detail.grantPartnerDiscount}
        >
          {detail.pending === 'grant-partner-discount' ? 'Applying…' : 'Grant discount'}
        </Button>
      </div>

      <DiscountPreview preview={detail.partnerPreview} />
      <CurrentAward detail={detail} />
    </Stack>
  );
}

/** What granting the previewed discount would do at the provider. */
function DiscountPreview({
  preview,
}: {
  readonly preview: PartnerPreview | null;
}): JSX.Element | null {
  if (!preview) return null;

  return (
    <Surface tone="card" shape="small" pad="comfortable">
      <Stack gap={1}>
        <Text as="p" token="label-large">
          {preview.percentOff}% through {new Date(preview.endsAt).toLocaleDateString()}
        </Text>
        <Text as="p" token="body-small" tone="muted">
          Provider action: {preview.providerAction.replaceAll('_', ' ')}
        </Text>
        <Text as="p" token="body-small" tone="muted">
          {creditLine(preview.credit)}
        </Text>
      </Stack>
    </Surface>
  );
}

/** Renew or revoke the award that is currently in force, when there is one. */
function CurrentAward({ detail }: { readonly detail: OrgDetailData }): JSX.Element | null {
  const award = detail.billing?.award;
  if (!award || !CHANGEABLE_AWARD_STATUSES.includes(award.status)) return null;

  const disabled = detail.pending !== null || detail.partnerReason.trim().length === 0;

  return (
    <ControlGroup controlSize="md" wrap>
      {award.programKey === null ? (
        <Button variant="outline" disabled={disabled} onClick={detail.renewPartnerDiscount}>
          {detail.pending === 'renew-discount' ? 'Renewing…' : 'Renew current award'}
        </Button>
      ) : null}
      <ConfirmButton
        label={detail.pending === 'revoke-discount' ? 'Revoking…' : 'Revoke current award'}
        disabled={disabled}
        pending={detail.pending === 'revoke-discount'}
        title="Revoke the current discount?"
        description="The award ends at the provider and the organization returns to full price on its next invoice. The reason you entered is recorded in the audit log."
        confirmLabel="Revoke award"
        onConfirm={detail.revokeDiscount}
      />
    </ControlGroup>
  );
}

/** The discount application's program and status, or that there is none. */
function applicationSummary(billing: AdminOrgBillingState | undefined): string {
  const application = billing?.application;
  if (!application) return 'None';
  return `${application.programKey} · ${application.status}`;
}

/** The current award's size and status, or that there is none. */
function awardSummary(billing: AdminOrgBillingState | undefined): string {
  const award = billing?.award;
  if (!award) return 'None';
  return `${award.percentOff}% · ${award.status}`;
}

/** The credit issued against this organization, or that none was. */
function creditSummary(billing: AdminOrgBillingState | undefined): string {
  const credit = billing?.credit;
  if (!credit) return 'None';
  return `${money(credit.totalAmount, credit.currency)} · ${credit.status}`;
}
