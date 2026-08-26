/** Read-only launch audit for Docket's durable billing mirror and Stripe ownership. */
import type { BillingGateway } from '@docket/billing/contracts';
import {
  billingProviderSync,
  type Database,
  organization,
  organizationBillingAccount,
  organizationProductEntitlement,
} from '@docket/db';
import { and, eq, inArray, notLike } from 'drizzle-orm';

/** A machine-stable reason that blocks public billing enablement. */
export type BillingLaunchAuditProblemCode =
  | 'billing_account_missing'
  | 'provider_customer_count'
  | 'billing_customer_mismatch'
  | 'current_subscription_count'
  | 'subscription_customer_mismatch'
  | 'subscription_missing'
  | 'entitlement_missing'
  | 'entitlement_subscription_mismatch'
  | 'entitlement_status_mismatch'
  | 'entitlement_period_mismatch'
  | 'entitlement_cancellation_mismatch'
  | 'provider_sync_unresolved'
  | 'provider_query_failed'
  | 'single_subscription_redirect_unverified';

/** One actionable launch-audit finding. */
export interface BillingLaunchAuditProblem {
  /** Stable code for automation and runbook routing. */
  readonly code: BillingLaunchAuditProblemCode;
  /** Operator-facing explanation without provider secrets. */
  readonly message: string;
}

/** Provider and Docket ownership observed for one billed organization. */
export interface BillingLaunchAuditOrganization {
  /** Docket organization id. */
  readonly organizationId: string;
  /** Customer-facing organization name. */
  readonly organizationName: string;
  /** Durable Stripe customer id stored by Docket. */
  readonly billingCustomerId: string | null;
  /** Stripe customers carrying this organization reference. */
  readonly providerCustomerCount: number | null;
  /** Non-canceled Stripe subscriptions carrying this organization reference. */
  readonly currentSubscriptionCount: number | null;
  /** Every condition that must be resolved before Checkout can open. */
  readonly problems: readonly BillingLaunchAuditProblem[];
}

/** Complete machine-readable billing enablement report. */
export interface BillingLaunchAuditReport {
  /** Stable report format version. */
  readonly schemaVersion: 2;
  /** ISO timestamp for the provider and database observations. */
  readonly generatedAt: string;
  /** True only when no organization has an unresolved finding. */
  readonly passed: boolean;
  /** Organizations included in the audit. */
  readonly organizationCount: number;
  /** Total actionable findings. */
  readonly unresolvedCount: number;
  /** Stripe account controls that cannot be read through the provider API. */
  readonly providerControls: {
    /** Dashboard control that redirects an existing subscriber away from a second Checkout. */
    readonly singleSubscriptionRedirect: {
      /** Whether an operator supplied a valid non-future verification timestamp. */
      readonly verified: boolean;
      /** Operator verification timestamp, or null when it is absent or invalid. */
      readonly verifiedAt: string | null;
      /** Blocking audit finding, or null when verified. */
      readonly problem: BillingLaunchAuditProblem | null;
    };
  };
  /** Per-organization evidence and findings. */
  readonly organizations: readonly BillingLaunchAuditOrganization[];
}

/** Operator attestations for Stripe controls that Stripe does not expose through its API. */
export interface BillingLaunchAuditAttestations {
  /** Timestamp recorded after verifying Stripe's existing-subscriber Checkout redirect. */
  readonly singleSubscriptionRedirectVerifiedAt?: string;
}

function sameInstant(providerValue: string, storedValue: Date | null): boolean {
  return storedValue !== null && new Date(providerValue).getTime() === storedValue.getTime();
}

/**
 * Compare every billed organization with Stripe without mutating either system.
 *
 * @param database - Docket database to inspect.
 * @param gateway - Stripe provider boundary used only for customer and subscription reads.
 * @param now - Stable observation timestamp written into the report.
 * @param attestations - Operator evidence for dashboard-only provider controls.
 * @returns A report whose `passed` value can gate billing enablement.
 */
export async function auditBillingLaunch(
  database: Database,
  gateway: BillingGateway,
  now: Date = new Date(),
  attestations: BillingLaunchAuditAttestations = {},
): Promise<BillingLaunchAuditReport> {
  const redirectVerifiedAt = attestations.singleSubscriptionRedirectVerifiedAt;
  const parsedRedirectVerifiedAt = redirectVerifiedAt ? new Date(redirectVerifiedAt) : null;
  const redirectVerified =
    parsedRedirectVerifiedAt !== null &&
    Number.isFinite(parsedRedirectVerifiedAt.getTime()) &&
    parsedRedirectVerifiedAt <= now;
  const redirectProblem: BillingLaunchAuditProblem | null = redirectVerified
    ? null
    : {
        code: 'single_subscription_redirect_unverified',
        message:
          'Stripe Checkout is not attested to redirect existing subscribers to the customer portal.',
      };
  const [accounts, entitlements, unresolvedSyncs, organizations] = await Promise.all([
    database.select().from(organizationBillingAccount),
    database
      .select()
      .from(organizationProductEntitlement)
      .where(eq(organizationProductEntitlement.source, 'stripe')),
    database
      .select()
      .from(billingProviderSync)
      .where(
        and(
          inArray(billingProviderSync.status, ['pending', 'running', 'failed']),
          notLike(billingProviderSync.operation, 'preview\\_%'),
        ),
      ),
    database.select({ id: organization.id, name: organization.name }).from(organization),
  ]);
  const accountByOrg = new Map(accounts.map((row) => [row.organizationId, row]));
  const entitlementByOrg = new Map(entitlements.map((row) => [row.organizationId, row]));
  const organizationNameById = new Map(organizations.map((row) => [row.id, row.name]));
  const syncsByOrg = new Map<string, typeof unresolvedSyncs>();
  for (const sync of unresolvedSyncs) {
    syncsByOrg.set(sync.organizationId, [...(syncsByOrg.get(sync.organizationId) ?? []), sync]);
  }
  const organizationIds = [
    ...new Set([
      ...accounts.map((row) => row.organizationId),
      ...entitlements.map((row) => row.organizationId),
      ...unresolvedSyncs.map((row) => row.organizationId),
    ]),
  ].sort();

  const rows: BillingLaunchAuditOrganization[] = [];
  for (const organizationId of organizationIds) {
    const account = accountByOrg.get(organizationId);
    const entitlement = entitlementByOrg.get(organizationId);
    const problems: BillingLaunchAuditProblem[] = [];
    let providerCustomerCount: number | null = null;
    let currentSubscriptionCount: number | null = null;

    if (!account) {
      problems.push({
        code: 'billing_account_missing',
        message: 'A Stripe-backed entitlement has no durable organization billing account.',
      });
    }
    for (const sync of syncsByOrg.get(organizationId) ?? []) {
      problems.push({
        code: 'provider_sync_unresolved',
        message: `${sync.operation} is ${sync.status}${sync.lastError ? `: ${sync.lastError}` : '.'}`,
      });
    }

    try {
      const [customers, subscriptions] = await Promise.all([
        gateway.listCustomers(organizationId),
        gateway.listSubscriptions(organizationId),
      ]);
      const current = subscriptions.filter((subscription) => subscription.status !== 'canceled');
      providerCustomerCount = customers.length;
      currentSubscriptionCount = current.length;

      if (customers.length !== 1) {
        problems.push({
          code: 'provider_customer_count',
          message: `Stripe has ${String(customers.length)} customers carrying this organization reference; exactly one is required.`,
        });
      } else if (account && customers[0]?.id !== account.stripeCustomerId) {
        problems.push({
          code: 'billing_customer_mismatch',
          message: 'The durable billing customer does not match the Stripe customer reference.',
        });
      }
      if (current.length > 1) {
        problems.push({
          code: 'current_subscription_count',
          message: `Stripe has ${String(current.length)} current Docket Pro subscriptions; finance must resolve the duplicate.`,
        });
      }
      const subscription = current.length === 1 ? current[0] : undefined;
      if (subscription && account && subscription.customerId !== account.stripeCustomerId) {
        problems.push({
          code: 'subscription_customer_mismatch',
          message: 'The current subscription belongs to a different Stripe customer.',
        });
      }
      if (subscription && !entitlement) {
        problems.push({
          code: 'entitlement_missing',
          message: 'Stripe has a current subscription but Docket has no Stripe entitlement mirror.',
        });
      } else if (!subscription && entitlement && entitlement.status !== 'canceled') {
        problems.push({
          code: 'subscription_missing',
          message: 'Docket grants current Stripe access but Stripe has no current subscription.',
        });
      } else if (subscription && entitlement) {
        if (entitlement.stripeSubscriptionId !== subscription.id) {
          problems.push({
            code: 'entitlement_subscription_mismatch',
            message: 'The Docket entitlement points to a different Stripe subscription.',
          });
        }
        if (entitlement.status !== subscription.status) {
          problems.push({
            code: 'entitlement_status_mismatch',
            message: `Docket records ${entitlement.status} while Stripe records ${subscription.status}.`,
          });
        }
        if (!sameInstant(subscription.currentPeriodEnd, entitlement.currentPeriodEnd)) {
          problems.push({
            code: 'entitlement_period_mismatch',
            message: 'The Docket renewal boundary does not match the Stripe service period.',
          });
        }
        if (entitlement.cancelAtPeriodEnd !== (subscription.cancelAtPeriodEnd ?? false)) {
          problems.push({
            code: 'entitlement_cancellation_mismatch',
            message: 'The Docket cancellation mirror does not match Stripe.',
          });
        }
      }
    } catch (error) {
      problems.push({
        code: 'provider_query_failed',
        message:
          error instanceof Error
            ? `Stripe audit failed: ${error.message}`
            : 'Stripe audit failed with an unknown provider error.',
      });
    }

    rows.push({
      organizationId,
      organizationName: organizationNameById.get(organizationId) ?? 'Unknown organization',
      billingCustomerId: account?.stripeCustomerId ?? null,
      providerCustomerCount,
      currentSubscriptionCount,
      problems,
    });
  }
  const unresolvedCount =
    rows.reduce((count, row) => count + row.problems.length, 0) + (redirectProblem ? 1 : 0);
  return {
    schemaVersion: 2,
    generatedAt: now.toISOString(),
    passed: unresolvedCount === 0,
    organizationCount: rows.length,
    unresolvedCount,
    providerControls: {
      singleSubscriptionRedirect: {
        verified: redirectVerified,
        verifiedAt: redirectVerified ? parsedRedirectVerifiedAt.toISOString() : null,
        problem: redirectProblem,
      },
    },
    organizations: rows,
  };
}
