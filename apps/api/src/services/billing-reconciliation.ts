/** Scheduled Stripe mirror repair, award expiry, and private-evidence retention. */
import type { BillingGateway, Subscription } from '@docket/billing/contracts';
import { applyBillingEvent } from '@docket/billing/application/lifecycle';
import type { BlobStore } from '@docket/blob-store';
import {
  billingDiscountAward,
  billingDiscountApplication,
  billingDiscountApplicationEvent,
  billingDiscountEvidence,
  billingProviderSync,
  type Database,
  organizationBillingAccount,
  organizationProductEntitlement,
} from '@docket/db';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';

import { dispatchEssentialBillingNotice } from './billing-notifications';

/** Counts returned by one billing reconciliation pass. */
export interface BillingReconciliationResult {
  /** Billing accounts inspected. */
  readonly accounts: number;
  /** Entitlement mirrors safely refreshed from one canonical Stripe subscription. */
  readonly repaired: number;
  /** Organizations that require operator attention. */
  readonly alerts: number;
  /** Awards moved into their ending or expired state. */
  readonly awardsAdvanced: number;
  /** Private evidence objects deleted after their retention deadline. */
  readonly evidenceDeleted: number;
}

/** Store the latest reconciliation outcome for one organization. */
async function recordReconciliation(
  database: Database,
  organizationId: string,
  now: Date,
  status: 'succeeded' | 'failed',
  payload: Record<string, unknown>,
  lastError: string | null,
): Promise<void> {
  await database
    .insert(billingProviderSync)
    .values({
      organizationId,
      operation: 'reconcile_billing',
      status,
      idempotencyKey: `billing-reconcile:${organizationId}`,
      attempts: 1,
      payload,
      lastError,
      completedAt: status === 'succeeded' ? now : null,
      nextAttemptAt: status === 'failed' ? new Date(now.getTime() + 15 * 60 * 1000) : null,
    })
    .onConflictDoUpdate({
      target: billingProviderSync.idempotencyKey,
      set: {
        status,
        attempts: 1,
        payload,
        lastError,
        completedAt: status === 'succeeded' ? now : null,
        nextAttemptAt: status === 'failed' ? new Date(now.getTime() + 15 * 60 * 1000) : null,
        updatedAt: now,
      },
    });
}

/** Convert a provider snapshot into the authoritative event applied by reconciliation. */
function reconciliationEvent(organizationId: string, subscription: Subscription, now: Date) {
  return {
    id: `reconcile:${organizationId}:${now.toISOString()}`,
    type: 'subscription.updated' as const,
    referenceId: organizationId,
    subscription,
    createdAt: now.toISOString(),
  };
}

/** Delete private evidence whose post-decision retention period has ended. */
async function purgeExpiredEvidence(
  database: Database,
  blob: BlobStore,
  now: Date,
): Promise<number> {
  const due = await database
    .select()
    .from(billingDiscountEvidence)
    .where(
      and(isNull(billingDiscountEvidence.deletedAt), lte(billingDiscountEvidence.deleteAfter, now)),
    );
  let deleted = 0;
  for (const evidence of due) {
    try {
      await blob.delete(evidence.blobKey);
      await database
        .update(billingDiscountEvidence)
        .set({ deletedAt: now })
        .where(eq(billingDiscountEvidence.id, evidence.id));
      deleted += 1;
    } catch {
      // The row remains due. The next scheduled pass retries the object deletion.
    }
  }
  return deleted;
}

/** Close applications whose customer review window ended and start evidence retention. */
async function expireApplications(database: Database, now: Date): Promise<void> {
  const expired = await database
    .update(billingDiscountApplication)
    .set({
      status: 'expired',
      decisionReason: 'The 90-day application review window ended.',
      decidedAt: now,
    })
    .where(
      and(
        inArray(billingDiscountApplication.status, ['submitted', 'needs_information']),
        lte(billingDiscountApplication.expiresAt, now),
      ),
    )
    .returning({
      id: billingDiscountApplication.id,
      organizationId: billingDiscountApplication.organizationId,
    });
  for (const application of expired) {
    await Promise.all([
      database.insert(billingDiscountApplicationEvent).values({
        applicationId: application.id,
        type: 'expired',
        reason: 'The 90-day application review window ended.',
      }),
      database
        .update(billingDiscountEvidence)
        .set({ deleteAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) })
        .where(eq(billingDiscountEvidence.applicationId, application.id)),
      dispatchEssentialBillingNotice(database, {
        organizationId: application.organizationId,
        idempotencyKey: `billing:discount-application:${application.id}:expired`,
        subject: 'Your discount application expired',
        text: 'The 90-day review window ended. You can submit a new application from Billing settings.',
      }).catch(() => undefined),
    ]);
  }
}

/** End unrenewed awards before their next standard-price renewal. */
async function advanceAwards(
  database: Database,
  gateway: BillingGateway,
  now: Date,
): Promise<{ advanced: number; alerts: number }> {
  let advanced = 0;
  let alerts = 0;
  const removalThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const dueForReview = await database
    .select()
    .from(billingDiscountAward)
    .where(
      and(
        eq(billingDiscountAward.status, 'active'),
        lte(billingDiscountAward.reviewAt, removalThreshold),
      ),
    );
  for (const award of dueForReview) {
    await database
      .update(billingDiscountAward)
      .set({ status: 'ending' })
      .where(eq(billingDiscountAward.id, award.id));
    advanced += 1;
  }
  const expiredAwards = await database
    .select()
    .from(billingDiscountAward)
    .where(and(eq(billingDiscountAward.status, 'ending'), lte(billingDiscountAward.endsAt, now)));
  for (const award of expiredAwards) {
    try {
      await gateway.removeSubscriptionDiscount(
        award.organizationId,
        `discount-award:${award.id}:end`,
      );
      await database
        .update(billingDiscountAward)
        .set({ status: 'expired', providerDiscountId: null, providerSyncError: null })
        .where(eq(billingDiscountAward.id, award.id));
      await dispatchEssentialBillingNotice(database, {
        organizationId: award.organizationId,
        idempotencyKey: `billing:discount-award:${award.id}:expired`,
        subject: 'Your Docket Pro discount ended',
        text: 'The approved discount term ended. Standard Docket Pro pricing applies at the next renewal.',
      }).catch(() => undefined);
      advanced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider discount removal failed';
      await recordReconciliation(
        database,
        award.organizationId,
        now,
        'failed',
        { awardId: award.id, operation: 'end_discount_award' },
        message,
      );
      alerts += 1;
    }
  }
  return { advanced, alerts };
}

/** Send idempotent 30-day and 7-day eligibility review reminders. */
async function sendAwardReviewReminders(database: Database, now: Date): Promise<void> {
  const awards = await database
    .select()
    .from(billingDiscountAward)
    .where(eq(billingDiscountAward.status, 'active'));
  for (const award of awards) {
    const days = Math.ceil((award.reviewAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const threshold = days <= 7 ? 7 : days <= 30 ? 30 : null;
    if (!threshold || days <= 0) continue;
    await dispatchEssentialBillingNotice(database, {
      organizationId: award.organizationId,
      idempotencyKey: `billing:discount-award:${award.id}:review-${String(threshold)}`,
      subject: `Your Docket Pro discount review is due in ${String(threshold)} days`,
      text: `Submit renewal evidence in Billing settings. Without an approved renewal, the current discount stays through this paid period and standard pricing begins at the next renewal.`,
      ...(threshold === 7 ? { urgent: true } : {}),
    }).catch(() => undefined);
  }
}

/**
 * Reconcile provider subscriptions without making financial decisions.
 *
 * @remarks
 * One canonical subscription may repair Docket's access mirror. Multiple current subscriptions
 * create an operator alert and remain untouched. This worker never cancels a duplicate, issues
 * money, or changes a finance decision.
 *
 * @param database - Docket database.
 * @param gateway - Stripe provider boundary.
 * @param blob - Private object-storage boundary.
 * @param now - Stable timestamp for this pass.
 * @returns reconciliation counts for monitoring.
 */
export async function reconcileBilling(
  database: Database,
  gateway: BillingGateway,
  blob: BlobStore,
  now: Date,
): Promise<BillingReconciliationResult> {
  const legacyEntitlements = await database
    .select({ organizationId: organizationProductEntitlement.organizationId })
    .from(organizationProductEntitlement)
    .leftJoin(
      organizationBillingAccount,
      eq(organizationBillingAccount.organizationId, organizationProductEntitlement.organizationId),
    )
    .where(
      and(
        eq(organizationProductEntitlement.source, 'stripe'),
        isNull(organizationBillingAccount.organizationId),
      ),
    );
  let repaired = 0;
  let alerts = 0;
  for (const legacy of legacyEntitlements) {
    try {
      const subscriptions = await gateway.listSubscriptions(legacy.organizationId);
      const customerIds = [
        ...new Set(
          subscriptions
            .map((subscription) => subscription.customerId)
            .filter((customerId): customerId is string => Boolean(customerId)),
        ),
      ];
      const [customerId] = customerIds;
      if (subscriptions.length === 0 || customerIds.length !== 1 || !customerId) {
        await recordReconciliation(
          database,
          legacy.organizationId,
          now,
          'failed',
          { subscriptionCount: subscriptions.length },
          'Existing Stripe entitlement does not resolve to one billing customer.',
        );
        alerts += 1;
        continue;
      }
      await database
        .insert(organizationBillingAccount)
        .values({
          organizationId: legacy.organizationId,
          stripeCustomerId: customerId,
          countryVerificationRequired: false,
        })
        .onConflictDoNothing({ target: organizationBillingAccount.organizationId });
    } catch (error) {
      await recordReconciliation(
        database,
        legacy.organizationId,
        now,
        'failed',
        {},
        error instanceof Error ? error.message : 'Legacy billing customer backfill failed',
      );
      alerts += 1;
    }
  }
  const accounts = await database.select().from(organizationBillingAccount);
  for (const account of accounts) {
    try {
      let discountMismatch: string | null = null;
      const subscriptions = await gateway.listSubscriptions(account.organizationId);
      const current = subscriptions.filter((subscription) => subscription.status !== 'canceled');
      if (current.length > 1) {
        await recordReconciliation(
          database,
          account.organizationId,
          now,
          'failed',
          { subscriptionCount: current.length },
          'Multiple current Stripe subscriptions require finance review.',
        );
        alerts += 1;
        continue;
      }
      const subscription = current[0];
      if (subscription) {
        if (subscription.customerId && subscription.customerId !== account.stripeCustomerId) {
          await recordReconciliation(
            database,
            account.organizationId,
            now,
            'failed',
            { subscriptionId: subscription.id },
            'Stripe subscription customer does not match the durable billing account.',
          );
          alerts += 1;
          continue;
        }
        if (account.countryVerificationRequired) {
          const country = await gateway.getCustomerBillingCountry(account.stripeCustomerId);
          if (!country) {
            await recordReconciliation(
              database,
              account.organizationId,
              now,
              'failed',
              { subscriptionId: subscription.id },
              'Stripe billing country is not available yet.',
            );
            alerts += 1;
            continue;
          }
          if (country !== 'US') {
            await gateway.cancelSubscriptionById(
              subscription.id,
              `billing-country:reconcile:${account.organizationId}:${subscription.id}:cancel`,
              subscription.status !== 'trialing',
            );
            await recordReconciliation(
              database,
              account.organizationId,
              now,
              'failed',
              { subscriptionId: subscription.id, billingCountry: country },
              'The launch accepts US billing addresses only.',
            );
            alerts += 1;
            continue;
          }
          await database
            .update(organizationBillingAccount)
            .set({ billingCountry: country, countryVerifiedAt: now })
            .where(eq(organizationBillingAccount.organizationId, account.organizationId));
        }
        const [previous] = await database
          .select({ status: organizationProductEntitlement.status })
          .from(organizationProductEntitlement)
          .where(
            and(
              eq(organizationProductEntitlement.organizationId, account.organizationId),
              eq(organizationProductEntitlement.productKey, 'docket_pro'),
            ),
          )
          .limit(1);
        await applyBillingEvent(
          database,
          reconciliationEvent(account.organizationId, subscription, now),
          now.toISOString(),
        );
        const [award] = await database
          .select()
          .from(billingDiscountAward)
          .where(
            and(
              eq(billingDiscountAward.organizationId, account.organizationId),
              inArray(billingDiscountAward.status, ['scheduled', 'active', 'ending']),
            ),
          )
          .limit(1);
        const providerDiscountIds = subscription.discountIds ?? [];
        const providerCouponIds = subscription.couponIds ?? [];
        if (award) {
          const publicAwardIsTrialing =
            award.programKey !== null && subscription.status === 'trialing';
          const discountMatches =
            (award.providerDiscountId !== null &&
              providerDiscountIds.includes(award.providerDiscountId)) ||
            (award.providerCouponId !== null && providerCouponIds.includes(award.providerCouponId));
          const hasOneProviderDiscount =
            providerDiscountIds.length === 1 && providerCouponIds.length === 1;
          if (!discountMatches || !hasOneProviderDiscount) {
            discountMismatch =
              'Stripe subscription discounts do not exactly match the current Docket award.';
          } else if (
            publicAwardIsTrialing ||
            award.status === 'scheduled' ||
            award.providerDiscountId === null
          ) {
            await database
              .update(billingDiscountAward)
              .set({
                status: publicAwardIsTrialing ? 'scheduled' : 'active',
                providerDiscountId: providerDiscountIds[0] ?? award.providerDiscountId,
                providerSyncError: null,
              })
              .where(eq(billingDiscountAward.id, award.id));
          }
        } else if (providerDiscountIds.length > 0 || providerCouponIds.length > 0) {
          discountMismatch = 'Stripe has a subscription discount without a current Docket award.';
        }
        if (previous?.status && previous.status !== subscription.status) {
          await dispatchEssentialBillingNotice(database, {
            organizationId: account.organizationId,
            idempotencyKey: `billing:reconcile:${account.organizationId}:${subscription.id}:${subscription.status}:${subscription.currentPeriodEnd}`,
            subject: 'Docket Pro access changed',
            text: `Stripe reconciliation changed Docket Pro from ${previous.status} to ${subscription.status}. Billing settings show the current access state and next action.`,
            ...(subscription.status === 'past_due' || subscription.status === 'canceled'
              ? { urgent: true }
              : {}),
          }).catch(() => undefined);
        }
        repaired += 1;
      } else {
        const [entitlement] = await database
          .select()
          .from(organizationProductEntitlement)
          .where(
            and(
              eq(organizationProductEntitlement.organizationId, account.organizationId),
              eq(organizationProductEntitlement.productKey, 'docket_pro'),
              eq(organizationProductEntitlement.source, 'stripe'),
              inArray(organizationProductEntitlement.status, ['trialing', 'active', 'past_due']),
            ),
          )
          .limit(1);
        if (entitlement) {
          await applyBillingEvent(
            database,
            reconciliationEvent(
              account.organizationId,
              {
                id: entitlement.stripeSubscriptionId ?? 'provider_subscription_missing',
                referenceId: account.organizationId,
                status: 'canceled',
                currentPeriodEnd: now.toISOString(),
              },
              now,
            ),
            now.toISOString(),
          );
          repaired += 1;
        }
      }
      const invoice = subscription
        ? await gateway.getLatestRecurringInvoice(account.organizationId)
        : null;
      await recordReconciliation(
        database,
        account.organizationId,
        now,
        discountMismatch ? 'failed' : 'succeeded',
        {
          customerId: account.stripeCustomerId,
          subscriptionCount: current.length,
          subscriptionStatus: subscription?.status ?? null,
          invoiceStatus: invoice?.invoiceStatus ?? null,
          discountIds: subscription?.discountIds ?? [],
          couponIds: subscription?.couponIds ?? [],
        },
        discountMismatch,
      );
      if (discountMismatch) alerts += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Billing reconciliation failed';
      await recordReconciliation(database, account.organizationId, now, 'failed', {}, message);
      alerts += 1;
    }
  }
  await sendAwardReviewReminders(database, now);
  const awards = await advanceAwards(database, gateway, now);
  await expireApplications(database, now);
  const evidenceDeleted = await purgeExpiredEvidence(database, blob, now);
  return {
    accounts: accounts.length,
    repaired,
    alerts: alerts + awards.alerts,
    awardsAdvanced: awards.advanced,
    evidenceDeleted,
  };
}
