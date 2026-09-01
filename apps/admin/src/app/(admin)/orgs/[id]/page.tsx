'use client';

import { DatePicker } from '@docket/ui/components';
import { Button, ControlGroup, Input, Row, Stack, Surface, Text } from '@docket/ui/primitives';
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
    <AdminPage width="form" outline>
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
  const permissions = detail.billing?.permissions;
  const billing = permissions?.manageDiscounts ?? false;
  const complimentary = permissions?.manageComplimentary ?? false;

  return (
    <>
      <AdminPageHeader title={org.name} description={org.slug} />

      <AdminSection title="Overview">
        <PropertyList>
          <Property label="Organization ID" value={org.id} identifier />
          <Property label="Type" value={org.isPersonal ? 'Personal' : 'Team'} />
          <Property label="Created" value={formatTimestamp(org.createdAt)} />
        </PropertyList>
      </AdminSection>

      {detail.actionError ? (
        <QueryErrorBanner error={detail.actionError} fallback="Could not complete that action." />
      ) : null}

      <SubscriptionSection detail={detail} canManage={billing} />
      <StripeCustomerSection detail={detail} canManage={billing} />
      <ComplimentarySection org={org} detail={detail} canManage={complimentary} />
      <DiscountSection detail={detail} canManage={billing} />

      {billing || complimentary ? null : <TierNote />}
    </>
  );
}

/**
 * What this operator's tier may not do here.
 *
 * @remarks
 * Shown only when the operator can change nothing on this screen, so a finance or superadmin
 * operator is never told about permissions they already hold.
 */
function TierNote(): JSX.Element {
  return (
    <AdminSection title="Billing actions">
      <Text as="p" token="body-small" tone="muted">
        Finance manages trials and discounts. A superadmin manages complimentary Pro.
      </Text>
    </AdminSection>
  );
}

/**
 * What the organization currently has access to, and the one control that extends it.
 *
 * @remarks
 * The trial control lives here rather than in a section of its own. Every one of these screens used
 * to read as a wall of facts followed, much further down, by a separate stack of forms — so the
 * status you were looking at and the button that changes it were never on screen together, and
 * neither one explained the other. A group states one thing and carries what acts on it.
 */
function SubscriptionSection({
  detail,
  canManage,
}: {
  readonly detail: OrgDetailData;
  readonly canManage: boolean;
}): JSX.Element {
  const entitlement = detail.billing?.entitlement;

  return (
    <AdminSection title="Subscription">
      <PropertyList>
        <Property label="Status" value={entitlement?.status ?? 'Free'} />
        <Property
          label="Subscription ID"
          value={entitlement?.stripeSubscriptionId ?? 'None'}
          identifier={Boolean(entitlement?.stripeSubscriptionId)}
        />
        <Property
          label="Last observed"
          value={formatTimestamp(entitlement?.providerObservedAt ?? null)}
        />
      </PropertyList>

      {canManage ? (
        <Row gap={2} align="end" className="flex-wrap">
          <Input
            type="number"
            min={1}
            max={365}
            value={detail.trialDays}
            onChange={(event) => {
              detail.setTrialDays(event.target.value);
            }}
            aria-label="Trial days to add"
            className="w-28"
          />
          <Button
            variant="secondary"
            disabled={detail.pending !== null}
            onClick={detail.extendTrial}
          >
            {detail.pending === 'extend-trial' ? 'Extending…' : 'Extend trial'}
          </Button>
        </Row>
      ) : null}
    </AdminSection>
  );
}

/** What Stripe reports for this organization, and the refresh that re-reads it. */
function StripeCustomerSection({
  detail,
  canManage,
}: {
  readonly detail: OrgDetailData;
  readonly canManage: boolean;
}): JSX.Element {
  const billing = detail.billing;
  const failed = billing?.reconciliation?.status === 'failed';

  return (
    <AdminSection
      title="Stripe customer"
      description={
        failed
          ? 'Reconciliation failed. Review the operator logs before changing access.'
          : undefined
      }
      action={
        canManage ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={detail.pending !== null}
            onClick={detail.reconcileStripe}
          >
            {detail.pending === 'reconcile-stripe' ? 'Reconciling…' : 'Reconcile'}
          </Button>
        ) : undefined
      }
    >
      <PropertyList>
        <Property
          label="Customer ID"
          value={billing?.customer?.stripeCustomerId ?? 'None'}
          identifier={Boolean(billing?.customer?.stripeCustomerId)}
        />
        <Property
          label="Billing country"
          value={billing?.customer?.billingCountry ?? 'Not verified'}
        />
        <Property label="Reconciliation" value={billing?.reconciliation?.status ?? 'Not run'} />
      </PropertyList>
    </AdminSection>
  );
}

/** Grant or revoke the complimentary Docket Pro entitlement. */
function ComplimentarySection({
  org,
  detail,
  canManage,
}: {
  readonly org: AdminOrg;
  readonly detail: OrgDetailData;
  readonly canManage: boolean;
}): JSX.Element | null {
  const busy = detail.pending !== null;
  const noReason = detail.complimentaryReason.trim().length === 0;

  // Nothing to say to an operator who can neither see a grant nor make one.
  if (!canManage && !org.isBillingExempt) return null;

  return (
    <AdminSection
      title="Complimentary Docket Pro"
      description={org.isBillingExempt ? 'Granted. Pro is active without Stripe.' : undefined}
    >
      {!canManage ? null : (
        <div className="flex flex-col gap-2 @lg:flex-row">
          <Input
            value={detail.complimentaryReason}
            onChange={(event) => {
              detail.setComplimentaryReason(event.target.value);
            }}
            placeholder="Reason for the complimentary grant"
            aria-label="Reason for the complimentary grant"
            className="flex-1"
          />
          <ComplimentaryAction
            granted={org.isBillingExempt}
            orgName={org.name}
            pending={detail.pending}
            disabled={busy || noReason}
            onGrant={detail.grantComplimentary}
            onRevoke={detail.revokeComplimentary}
          />
        </div>
      )}
    </AdminSection>
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
        title="Revoke complimentary Pro?"
        description={`${orgName} loses every Pro capability immediately, and nothing restores it automatically. The reason you entered is recorded in the audit log.`}
        confirmLabel="Revoke complimentary Pro"
        onConfirm={onRevoke}
      />
    );
  }

  return (
    <Button variant="secondary" disabled={disabled} onClick={onGrant}>
      {pending === 'grant-complimentary' ? 'Granting…' : 'Grant complimentary Pro'}
    </Button>
  );
}

/**
 * What this organization is being charged less, and every control that changes it.
 *
 * @remarks
 * The award used to be reported in one group and granted in another, so revoking the discount you
 * were reading about meant scrolling to a second section that repeated none of its state.
 */
function DiscountSection({
  detail,
  canManage,
}: {
  readonly detail: OrgDetailData;
  readonly canManage: boolean;
}): JSX.Element {
  const busy = detail.pending !== null;
  const noReason = detail.partnerReason.trim().length === 0;
  const noEndDate = detail.partnerEndsAt.length === 0;

  const today = new Date();
  const latest = new Date();
  latest.setUTCMonth(latest.getUTCMonth() + PARTNER_DISCOUNT_MAX_MONTHS);

  return (
    <AdminSection
      title="Discounts and credit"
      description={
        canManage
          ? `One 1–90% award, for up to ${String(PARTNER_DISCOUNT_MAX_MONTHS)} months.`
          : undefined
      }
    >
      <PropertyList>
        <Property label="Application" value={applicationSummary(detail.billing)} />
        <Property label="Award" value={awardSummary(detail.billing)} />
        <Property label="Issued credit" value={creditSummary(detail.billing)} />
      </PropertyList>

      {!canManage ? null : (
        <>
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
              variant="secondary"
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
        </>
      )}
    </AdminSection>
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
    <Surface tone="well" shape="small" pad="comfortable">
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
    <ControlGroup wrap>
      {award.programKey === null ? (
        <Button variant="secondary" disabled={disabled} onClick={detail.renewPartnerDiscount}>
          {detail.pending === 'renew-discount' ? 'Renewing…' : 'Renew current award'}
        </Button>
      ) : null}
      <ConfirmButton
        label={detail.pending === 'revoke-discount' ? 'Revoking…' : 'Revoke current award'}
        disabled={disabled}
        title="Revoke the current discount?"
        description="Ends the award at Stripe. Full price resumes on the next invoice."
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
