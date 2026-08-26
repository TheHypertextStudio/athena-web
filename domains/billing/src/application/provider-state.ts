/** Durable billing-provider identity and delivery idempotency. */
import {
  billingCheckoutAttempt,
  billingProviderEvent,
  organizationBillingAccount,
  type Database,
} from '@docket/db';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';

import type { BillingEvent, BillingGateway } from '../contracts';

/** The result of atomically acquiring an organization-product Checkout attempt. */
export type CheckoutAttemptLease =
  | { readonly kind: 'acquired'; readonly id: string }
  | { readonly kind: 'reusable'; readonly url: string }
  | { readonly kind: 'pending' };

/** The provider identity Docket persisted for one organization. */
export interface OrganizationBillingAccount {
  /** Docket organization id. */
  readonly organizationId: string;
  /** Stripe customer id used by Checkout and the customer portal, once provider billing begins. */
  readonly stripeCustomerId: string | null;
  /** The first instant this organization consumed product access, when present. */
  readonly trialConsumedAt: Date | null;
  /** ISO country last verified from the provider customer. */
  readonly billingCountry: string | null;
  /** When Docket verified the provider billing country. */
  readonly countryVerifiedAt: Date | null;
  /** Whether this account must pass the US launch-country check before access reconciliation. */
  readonly countryVerificationRequired: boolean;
}

/** A billing account whose Stripe customer identity is ready for provider operations. */
export interface ResolvedOrganizationBillingAccount extends OrganizationBillingAccount {
  /** Stripe customer id verified or created for this organization. */
  readonly stripeCustomerId: string;
}

/** Load the persisted provider customer for an organization. */
export async function getBillingCustomer(
  db: Database,
  organizationId: string,
): Promise<OrganizationBillingAccount | null> {
  const rows = await db
    .select({
      organizationId: organizationBillingAccount.organizationId,
      stripeCustomerId: organizationBillingAccount.stripeCustomerId,
      trialConsumedAt: organizationBillingAccount.trialConsumedAt,
      billingCountry: organizationBillingAccount.billingCountry,
      countryVerifiedAt: organizationBillingAccount.countryVerifiedAt,
      countryVerificationRequired: organizationBillingAccount.countryVerificationRequired,
    })
    .from(organizationBillingAccount)
    .where(eq(organizationBillingAccount.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/** Create and persist an organization's Stripe customer, or reuse its existing identity. */
export async function ensureBillingCustomer(
  db: Database,
  gateway: BillingGateway,
  organizationId: string,
  email?: string,
): Promise<ResolvedOrganizationBillingAccount> {
  const existing = await getBillingCustomer(db, organizationId);
  if (existing?.stripeCustomerId) {
    return { ...existing, stripeCustomerId: existing.stripeCustomerId };
  }

  const [subscriptions, customers] = await Promise.all([
    gateway.listSubscriptions(organizationId),
    gateway.listCustomers(organizationId),
  ]);
  const subscriptionCustomerIds = [
    ...new Set(
      subscriptions
        .map((subscription) => subscription.customerId)
        .filter((customerId): customerId is string => Boolean(customerId)),
    ),
  ];
  const providerCustomerIds = [...new Set(customers.map((customer) => customer.id))];
  if (
    (subscriptions.length > 0 && subscriptionCustomerIds.length !== 1) ||
    providerCustomerIds.length > 1 ||
    (subscriptionCustomerIds[0] !== undefined &&
      providerCustomerIds[0] !== undefined &&
      subscriptionCustomerIds[0] !== providerCustomerIds[0])
  ) {
    throw new Error(
      'Existing Stripe customers and subscriptions do not resolve to one billing customer.',
    );
  }

  const stripeCustomerId =
    subscriptionCustomerIds[0] ??
    providerCustomerIds[0] ??
    (await gateway.createCustomer(organizationId, email)).id;
  const persisted = existing
    ? await db
        .update(organizationBillingAccount)
        .set({
          stripeCustomerId,
          countryVerificationRequired: subscriptionCustomerIds.length === 0,
        })
        .where(
          and(
            eq(organizationBillingAccount.organizationId, organizationId),
            isNull(organizationBillingAccount.stripeCustomerId),
          ),
        )
        .returning({
          organizationId: organizationBillingAccount.organizationId,
          stripeCustomerId: organizationBillingAccount.stripeCustomerId,
          trialConsumedAt: organizationBillingAccount.trialConsumedAt,
          billingCountry: organizationBillingAccount.billingCountry,
          countryVerifiedAt: organizationBillingAccount.countryVerifiedAt,
          countryVerificationRequired: organizationBillingAccount.countryVerificationRequired,
        })
    : await db
        .insert(organizationBillingAccount)
        .values({
          organizationId,
          stripeCustomerId,
          countryVerificationRequired: subscriptionCustomerIds.length === 0,
        })
        .onConflictDoNothing({ target: organizationBillingAccount.organizationId })
        .returning({
          organizationId: organizationBillingAccount.organizationId,
          stripeCustomerId: organizationBillingAccount.stripeCustomerId,
          trialConsumedAt: organizationBillingAccount.trialConsumedAt,
          billingCountry: organizationBillingAccount.billingCountry,
          countryVerifiedAt: organizationBillingAccount.countryVerifiedAt,
          countryVerificationRequired: organizationBillingAccount.countryVerificationRequired,
        });
  const account = persisted[0] ?? (await getBillingCustomer(db, organizationId));
  if (!account?.stripeCustomerId) throw new Error('Billing customer could not be persisted.');
  return { ...account, stripeCustomerId: account.stripeCustomerId };
}

/** Expire stale attempts and acquire the one open Checkout lease for an organization product. */
export async function acquireCheckoutAttempt(
  db: Database,
  organizationId: string,
  productKey: string,
  now: Date,
  expiresAt: Date,
): Promise<CheckoutAttemptLease> {
  await db
    .update(billingCheckoutAttempt)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        eq(billingCheckoutAttempt.organizationId, organizationId),
        eq(billingCheckoutAttempt.productKey, productKey),
        inArray(billingCheckoutAttempt.status, ['creating', 'open']),
        lte(billingCheckoutAttempt.expiresAt, now),
      ),
    );

  const inserted = await db
    .insert(billingCheckoutAttempt)
    .values({ organizationId, productKey, status: 'creating', expiresAt })
    .onConflictDoNothing()
    .returning({ id: billingCheckoutAttempt.id });
  const created = inserted[0];
  if (created) return { kind: 'acquired', id: created.id };

  const rows = await db
    .select({ status: billingCheckoutAttempt.status, url: billingCheckoutAttempt.checkoutUrl })
    .from(billingCheckoutAttempt)
    .where(
      and(
        eq(billingCheckoutAttempt.organizationId, organizationId),
        eq(billingCheckoutAttempt.productKey, productKey),
        inArray(billingCheckoutAttempt.status, ['creating', 'open']),
      ),
    )
    .limit(1);
  const attempt = rows[0];
  if (attempt?.status === 'open' && attempt.url) return { kind: 'reusable', url: attempt.url };
  return { kind: 'pending' };
}

/** Attach the hosted provider session to an acquired Checkout attempt. */
export async function completeCheckoutAttempt(
  db: Database,
  attemptId: string,
  sessionId: string,
  checkoutUrl: string,
  now: Date,
): Promise<void> {
  await db
    .update(billingCheckoutAttempt)
    .set({ status: 'open', stripeSessionId: sessionId, checkoutUrl, updatedAt: now })
    .where(eq(billingCheckoutAttempt.id, attemptId));
}

/** Release a failed Checkout lease so the customer can retry. */
export async function failCheckoutAttempt(
  db: Database,
  attemptId: string,
  now: Date,
): Promise<void> {
  await db
    .update(billingCheckoutAttempt)
    .set({ status: 'failed', updatedAt: now })
    .where(eq(billingCheckoutAttempt.id, attemptId));
}

/** Claim a provider event once. Duplicate deliveries return false without changing state. */
export async function claimProviderEvent(db: Database, event: BillingEvent): Promise<boolean> {
  const inserted = await db
    .insert(billingProviderEvent)
    .values({
      providerEventId: event.id,
      type: event.type,
      organizationId: event.referenceId || null,
      providerCreatedAt: new Date(event.createdAt),
    })
    .onConflictDoNothing({ target: billingProviderEvent.providerEventId })
    .returning({ id: billingProviderEvent.providerEventId });
  return inserted.length === 1;
}

/** Mark a claimed provider event as processed. */
export async function completeProviderEvent(
  db: Database,
  providerEventId: string,
  processedAt: Date,
): Promise<void> {
  await db
    .update(billingProviderEvent)
    .set({ processedAt, processingError: null })
    .where(eq(billingProviderEvent.providerEventId, providerEventId));
}
