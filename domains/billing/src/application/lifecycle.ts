/**
 * Persist provider subscription observations as Docket Pro access.
 *
 * @remarks
 * Billing never mutates organization deletion or retention fields. The provider subscription is
 * authoritative for paid access. Checkout completion is only a binding signal, and callers must
 * retrieve the current subscription before they grant access.
 */
import {
  billingExemption,
  type Database,
  organizationBillingAccount,
  organizationProductEntitlement,
} from '@docket/db';
import type { organization } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { BillingEvent } from '../contracts';

/** The independent organization-retention state union. */
export type OrgLifecycleState = (typeof organization.$inferSelect)['lifecycleState'];

/** Organization states that represent a live workspace rather than account deletion. */
export const OPERATING_LIFECYCLE_STATES: readonly OrgLifecycleState[] = [
  'trialing',
  'active',
  'past_due',
];

/** Number of days Docket Pro remains available after the first failed payment. */
export const PAYMENT_GRACE_DAYS = 7;

/** A billing event's observable effect on Docket Pro access. */
export type BillingAccessEffect =
  'trialing' | 'active' | 'past_due' | 'canceled' | 'stale' | 'none';

/** Persist one authoritative provider subscription snapshot as Docket Pro ownership. */
async function syncDocketProEntitlement(
  db: Database,
  event: BillingEvent,
  now: string,
): Promise<BillingAccessEffect> {
  const status = event.subscription?.status ?? null;
  if (!status) return 'none';

  const providerEventAt = new Date(event.createdAt);
  const observedAt = new Date(now);
  const existingRows = await db
    .select({
      status: organizationProductEntitlement.status,
      source: organizationProductEntitlement.source,
      graceEndsAt: organizationProductEntitlement.graceEndsAt,
      providerObservedAt: organizationProductEntitlement.providerObservedAt,
    })
    .from(organizationProductEntitlement)
    .where(
      and(
        eq(organizationProductEntitlement.organizationId, event.referenceId),
        eq(organizationProductEntitlement.productKey, 'docket_pro'),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  const [activeExemption] = await db
    .select({ id: billingExemption.id })
    .from(billingExemption)
    .where(
      and(
        eq(billingExemption.organizationId, event.referenceId),
        isNull(billingExemption.revokedAt),
      ),
    )
    .limit(1);
  if (activeExemption || (existing?.source === 'complimentary' && existing.status === 'active')) {
    return 'none';
  }
  if (existing?.providerObservedAt && existing.providerObservedAt > observedAt) return 'stale';

  const canceledAt = status === 'canceled' ? new Date(now) : null;
  const graceEndsAt =
    status === 'past_due'
      ? existing?.status === 'past_due' && existing.graceEndsAt
        ? existing.graceEndsAt
        : new Date(providerEventAt.getTime() + PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000)
      : null;
  const subscriptionId = event.subscription?.id ?? event.subscriptionId;
  await db
    .insert(organizationProductEntitlement)
    .values({
      organizationId: event.referenceId,
      productKey: 'docket_pro',
      status,
      source: 'stripe',
      stripeSubscriptionId: subscriptionId,
      trialEndsAt: event.subscription?.trialEnd ? new Date(event.subscription.trialEnd) : null,
      currentPeriodEnd: event.subscription?.currentPeriodEnd
        ? new Date(event.subscription.currentPeriodEnd)
        : null,
      cancelAtPeriodEnd: event.subscription?.cancelAtPeriodEnd ?? false,
      graceEndsAt,
      providerObservedAt: observedAt,
      canceledAt,
    })
    .onConflictDoUpdate({
      target: [
        organizationProductEntitlement.organizationId,
        organizationProductEntitlement.productKey,
      ],
      set: {
        status,
        source: 'stripe',
        stripeSubscriptionId: subscriptionId,
        trialEndsAt: event.subscription?.trialEnd ? new Date(event.subscription.trialEnd) : null,
        currentPeriodEnd: event.subscription?.currentPeriodEnd
          ? new Date(event.subscription.currentPeriodEnd)
          : null,
        cancelAtPeriodEnd: event.subscription?.cancelAtPeriodEnd ?? false,
        graceEndsAt,
        providerObservedAt: observedAt,
        canceledAt,
        updatedAt: new Date(now),
      },
    });

  if (status === 'trialing' || status === 'active') {
    await db
      .update(organizationBillingAccount)
      .set({
        trialConsumedAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(
        and(
          eq(organizationBillingAccount.organizationId, event.referenceId),
          isNull(organizationBillingAccount.trialConsumedAt),
        ),
      );
  }
  return status;
}

/**
 * Fold a normalized billing event into Docket Pro access.
 *
 * @param db - The Drizzle database client.
 * @param event - The normalized provider event.
 * @param now - The access and audit timestamp.
 * @returns the access effect that Docket applied.
 */
export async function applyBillingEvent(
  db: Database,
  event: BillingEvent,
  now: string,
): Promise<BillingAccessEffect> {
  if (event.type === 'checkout.completed') return 'none';
  return syncDocketProEntitlement(db, event, now);
}
