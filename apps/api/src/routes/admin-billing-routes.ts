import { randomUUID } from 'node:crypto';

import {
  billingCredit,
  billingDiscountApplication,
  billingDiscountAward,
  billingExemption,
  billingProviderSync,
  db,
  lifecycleHold,
  organizationProductEntitlement,
  organizationBillingAccount,
} from '@docket/db';
import { calculateUnusedPeriodCredit } from '@docket/billing/application/discounts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { applyBillingEvent } from '@docket/billing/application/lifecycle';
import type { Subscription } from '@docket/billing/contracts';

import {
  AdminBillingExemptionOut,
  AdminHoldOut,
  AdminOrgOut,
  ExtendTrialBody,
  GrantExemptionBody,
  PlaceHoldBody,
} from '../admin-dto';
import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { env } from '../env';
import { ConflictError, NotFoundError, PreconditionFailedError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { hasSqlState } from '../lib/sql-state';
import { zJson, zParam } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';
import { dispatchEssentialBillingNotice } from '../services/billing-notifications';
import { assertSubscriptionDiscountOwnership } from '../services/billing-discount-ownership';
import { reconcileBilling } from '../services/billing-reconciliation';

import {
  audit,
  holdParam,
  idParam,
  loadActiveExemptOrgIds,
  loadOrg,
  toExemptionOut,
  toHoldOut,
  toOrgOut,
} from './admin-serializers';
import { AdminCreditPreviewOut, AdminDiscountAwardOut } from './admin-discount-routes';

/** The Postgres SQLSTATE for a unique-constraint (including unique-index) violation. */
const UNIQUE_VIOLATION_CODE = '23505';

/** Whether a thrown error is a Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return hasSqlState(err, UNIQUE_VIOLATION_CODE);
}

const PartnerDiscountAwardFields = z.object({
  percentOff: z.number().int().min(1).max(90),
  endsAt: z.iso.datetime(),
  reason: z.string().trim().min(1).max(2_000),
});

function validatePartnerAwardDates(value: { endsAt: string }, ctx: z.RefinementCtx): void {
  const now = new Date();
  const endsAt = new Date(value.endsAt);
  const latest = new Date(now);
  latest.setUTCMonth(latest.getUTCMonth() + 24);
  if (endsAt <= now || endsAt > latest) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Partner awards must end within 24 months.',
    });
  }
}

/** Private partner award preview request. */
export const PartnerDiscountPreviewBody =
  PartnerDiscountAwardFields.superRefine(validatePartnerAwardDates);
/** Private partner award request. A free or permanent grant must use complimentary Pro instead. */
export const PartnerDiscountAwardBody = PartnerDiscountAwardFields.extend({
  confirmation: z.string().min(1),
}).superRefine(validatePartnerAwardDates);
/** Private partner award request value. */
export type PartnerDiscountAwardBody = z.infer<typeof PartnerDiscountAwardBody>;

/** Provider and credit effects that finance must confirm for a partner award. */
export const PartnerDiscountPreviewOut = z.object({
  organizationId: z.string(),
  percentOff: z.number().int(),
  endsAt: z.string(),
  providerAction: z.enum(['attach_at_checkout', 'apply_to_trial', 'apply_to_subscription']),
  credit: AdminCreditPreviewOut.nullable(),
  confirmation: z.string(),
});

/** Result of one safe provider reconciliation pass triggered by finance. */
export const AdminBillingReconciliationOut = z.object({
  accounts: z.number().int().nonnegative(),
  repaired: z.number().int().nonnegative(),
  alerts: z.number().int().nonnegative(),
  awardsAdvanced: z.number().int().nonnegative(),
  evidenceDeleted: z.number().int().nonnegative(),
});

const StoredPartnerPreview = z.object({
  organizationId: z.string(),
  input: PartnerDiscountPreviewBody,
  invoice: z
    .object({
      invoiceId: z.string(),
      lineId: z.string(),
      invoiceStatus: z.enum(['open', 'paid']),
      currency: z.string(),
      recurringAmount: z.number().int(),
      periodStartsAt: z.string(),
      periodEndsAt: z.string(),
    })
    .nullable(),
  credit: z
    .object({
      baseAmount: z.number().int(),
      taxAmount: z.number().int(),
      totalAmount: z.number().int(),
      prePaymentAmount: z.number().int(),
      postPaymentAmount: z.number().int(),
    })
    .nullable(),
  subscriptionFingerprint: z.string().nullable(),
  expiresAt: z.string(),
});

/** Staff billing diagnostics for one organization. */
export const AdminOrgBillingStateOut = z.object({
  permissions: z.object({
    manageDiscounts: z.boolean(),
    manageComplimentary: z.boolean(),
  }),
  customer: z
    .object({
      stripeCustomerId: z.string(),
      billingCountry: z.string().nullable(),
      countryVerifiedAt: z.string().nullable(),
      trialConsumedAt: z.string().nullable(),
    })
    .nullable(),
  entitlement: z
    .object({
      source: z.enum(['stripe', 'complimentary']),
      status: z.enum(['trialing', 'active', 'past_due', 'canceled']),
      stripeSubscriptionId: z.string().nullable(),
      currentPeriodEnd: z.string().nullable(),
      graceEndsAt: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      providerObservedAt: z.string().nullable(),
    })
    .nullable(),
  reconciliation: z
    .object({
      status: z.enum(['pending', 'running', 'succeeded', 'failed']),
      lastError: z.string().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
  application: z
    .object({
      id: z.string(),
      programKey: z.enum(['student', 'nonprofit']),
      status: z.string(),
      submittedAt: z.string(),
    })
    .nullable(),
  award: AdminDiscountAwardOut.nullable(),
  credit: z
    .object({
      status: z.string(),
      currency: z.string(),
      totalAmount: z.number().int(),
      providerCreditNoteId: z.string().nullable(),
    })
    .nullable(),
});
/** Staff billing diagnostics response value. */
export type AdminOrgBillingStateOut = z.infer<typeof AdminOrgBillingStateOut>;

/** Resolve the configured Docket Pro price id or lookup key. */
function docketProPriceKey(): string {
  return (
    env.STRIPE_PRICE_DOCKET_PRO ??
    env.DOCKET_PRICE_LOOKUP_DOCKET_PRO ??
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Compatibility for the former Docket Team configuration.
    env.STRIPE_PRICE_TEAM ??
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Compatibility for the former Docket Team configuration.
    env.DOCKET_PRICE_LOOKUP_TEAM ??
    'docket_pro_monthly'
  );
}

/** Convert a partner award into the finance response. */
function partnerAwardOut(
  award: typeof billingDiscountAward.$inferSelect,
): z.input<typeof AdminDiscountAwardOut> {
  return {
    id: award.id,
    organizationId: award.organizationId,
    applicationId: award.applicationId,
    programKey: award.programKey,
    percentOff: award.percentOff,
    status: award.status,
    startsAt: award.startsAt.toISOString(),
    endsAt: award.endsAt.toISOString(),
    reviewAt: award.reviewAt.toISOString(),
    reason: award.reason,
    providerCouponId: award.providerCouponId,
    providerDiscountId: award.providerDiscountId,
  };
}

/** Produce a stable provider snapshot key for partner preview confirmation. */
function subscriptionFingerprint(subscription: Subscription | null): string | null {
  if (!subscription) return null;
  return JSON.stringify({
    id: subscription.id,
    customerId: subscription.customerId ?? null,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialEnd: subscription.trialEnd ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
    discountIds: [...(subscription.discountIds ?? [])].sort(),
    couponIds: [...(subscription.couponIds ?? [])].sort(),
  });
}

/** Find the one award that blocks stacking or represents a retry. */
async function loadCurrentAward(organizationId: string) {
  const [current] = await db
    .select()
    .from(billingDiscountAward)
    .where(
      and(
        eq(billingDiscountAward.organizationId, organizationId),
        inArray(billingDiscountAward.status, [
          'scheduled',
          'applying',
          'active',
          'ending',
          'provider_failed',
        ]),
      ),
    )
    .limit(1);
  return current;
}

/** Refuse a second award while permitting an exact provider-failure retry. */
function assertPartnerAwardAvailable(
  current: typeof billingDiscountAward.$inferSelect | undefined,
  input: z.infer<typeof PartnerDiscountPreviewBody>,
): void {
  const retrying =
    current?.status === 'provider_failed' &&
    current.percentOff === input.percentOff &&
    current.endsAt.getTime() === new Date(input.endsAt).getTime() &&
    current.reason === input.reason;
  if (current && !retrying) {
    throw new ConflictError(
      'This workspace already has a discount award',
      'discount_award_conflict',
    );
  }
}

/** Preview and persist the exact Stripe credit effect that finance will approve. */
async function createPartnerPreview(
  organizationId: string,
  input: z.infer<typeof PartnerDiscountPreviewBody>,
): Promise<z.input<typeof PartnerDiscountPreviewOut>> {
  const currentAward = await loadCurrentAward(organizationId);
  assertPartnerAwardAvailable(currentAward, input);
  const gateway = getContainer().billing;
  const subscription = await gateway.getSubscription(organizationId);
  assertSubscriptionDiscountOwnership(subscription, currentAward);
  const invoice = await gateway.getLatestRecurringInvoice(organizationId);
  let credit = null;
  let publicCredit: z.input<typeof AdminCreditPreviewOut> | null = null;
  if (invoice) {
    const baseAmount = calculateUnusedPeriodCredit({
      recurringAmount: invoice.recurringAmount,
      percentOff: input.percentOff,
      periodStartsAt: new Date(invoice.periodStartsAt),
      periodEndsAt: new Date(invoice.periodEndsAt),
      approvedAt: new Date(),
    });
    if (baseAmount > 0) {
      credit = await gateway.previewCreditNote({
        invoiceId: invoice.invoiceId,
        invoiceLineId: invoice.lineId,
        baseAmount,
      });
      publicCredit = {
        invoiceId: invoice.invoiceId,
        currency: invoice.currency,
        ...credit,
        servicePeriodStartsAt: invoice.periodStartsAt,
        servicePeriodEndsAt: invoice.periodEndsAt,
      };
    }
  }
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const [stored] = await db
    .insert(billingProviderSync)
    .values({
      organizationId,
      operation: 'preview_partner_award',
      status: 'pending',
      idempotencyKey: `partner-award-preview:${randomUUID()}`,
      payload: {
        organizationId,
        input,
        invoice,
        credit,
        subscriptionFingerprint: subscriptionFingerprint(subscription),
        expiresAt: expiresAt.toISOString(),
      },
      nextAttemptAt: expiresAt,
    })
    .returning({ id: billingProviderSync.id });
  if (!stored) throw new Error('Partner award preview insert returned no row');
  return {
    organizationId,
    percentOff: input.percentOff,
    endsAt: input.endsAt,
    providerAction:
      subscription === null
        ? 'attach_at_checkout'
        : subscription.status === 'trialing'
          ? 'apply_to_trial'
          : 'apply_to_subscription',
    credit: publicCredit,
    confirmation: stored.id,
  };
}

/** Load the exact unexpired partner award effect that finance confirmed. */
async function loadPartnerPreview(
  confirmation: string,
  organizationId: string,
  input: z.infer<typeof PartnerDiscountPreviewBody>,
) {
  const [stored] = await db
    .select()
    .from(billingProviderSync)
    .where(
      and(
        eq(billingProviderSync.id, confirmation),
        eq(billingProviderSync.operation, 'preview_partner_award'),
      ),
    )
    .limit(1);
  const parsed = stored ? StoredPartnerPreview.safeParse(stored.payload) : null;
  if (
    !parsed?.success ||
    parsed.data.organizationId !== organizationId ||
    parsed.data.input.percentOff !== input.percentOff ||
    parsed.data.input.endsAt !== input.endsAt ||
    parsed.data.input.reason !== input.reason ||
    new Date(parsed.data.expiresAt) <= new Date()
  ) {
    throw new PreconditionFailedError(
      'The partner discount preview expired or no longer matches this award',
    );
  }
  const subscription = await getContainer().billing.getSubscription(organizationId);
  if (subscriptionFingerprint(subscription) !== parsed.data.subscriptionFingerprint) {
    throw new PreconditionFailedError('The Stripe subscription changed after the preview');
  }
  return parsed.data;
}

/**
 * Sub-router for lifecycle-hold and billing-action routes (mounted at `/orgs`).
 * All routes require staff auth (enforced by the parent admin router's middleware).
 */
export const adminBillingRoutes = new Hono<AppEnv>()
  .get(
    '/:id/billing-state',
    apiDoc({
      tag: 'Admin',
      summary: 'Inspect organization billing state',
      response: AdminOrgBillingStateOut,
      description:
        'Shows the durable Stripe customer, entitlement mirror, reconciliation result, latest discount application, award, and issued credit. Support may inspect this state, but only finance and superadmins may make revenue decisions.',
    }),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { role } = c.get('staffCtx');
      await loadOrg(id);
      const [customers, entitlements, reconciliations, applications, awards, credits] =
        await Promise.all([
          db
            .select()
            .from(organizationBillingAccount)
            .where(eq(organizationBillingAccount.organizationId, id))
            .limit(1),
          db
            .select()
            .from(organizationProductEntitlement)
            .where(
              and(
                eq(organizationProductEntitlement.organizationId, id),
                eq(organizationProductEntitlement.productKey, 'docket_pro'),
              ),
            )
            .limit(1),
          db
            .select()
            .from(billingProviderSync)
            .where(
              and(
                eq(billingProviderSync.organizationId, id),
                eq(billingProviderSync.operation, 'reconcile_billing'),
              ),
            )
            .orderBy(desc(billingProviderSync.updatedAt))
            .limit(1),
          db
            .select()
            .from(billingDiscountApplication)
            .where(eq(billingDiscountApplication.organizationId, id))
            .orderBy(desc(billingDiscountApplication.createdAt))
            .limit(1),
          db
            .select()
            .from(billingDiscountAward)
            .where(eq(billingDiscountAward.organizationId, id))
            .orderBy(desc(billingDiscountAward.createdAt))
            .limit(1),
          db
            .select()
            .from(billingCredit)
            .where(eq(billingCredit.organizationId, id))
            .orderBy(desc(billingCredit.createdAt))
            .limit(1),
        ]);
      const customer = customers[0];
      const entitlement = entitlements[0];
      const reconciliation = reconciliations[0];
      const application = applications[0];
      const award = awards[0];
      const credit = credits[0];
      return ok(c, AdminOrgBillingStateOut, {
        permissions: {
          manageDiscounts: role === 'finance' || role === 'superadmin',
          manageComplimentary: role === 'superadmin',
        },
        customer: customer
          ? {
              stripeCustomerId: customer.stripeCustomerId,
              billingCountry: customer.billingCountry,
              countryVerifiedAt: customer.countryVerifiedAt?.toISOString() ?? null,
              trialConsumedAt: customer.trialConsumedAt?.toISOString() ?? null,
            }
          : null,
        entitlement: entitlement
          ? {
              source: entitlement.source,
              status: entitlement.status,
              stripeSubscriptionId: entitlement.stripeSubscriptionId,
              currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
              graceEndsAt: entitlement.graceEndsAt?.toISOString() ?? null,
              cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
              providerObservedAt: entitlement.providerObservedAt?.toISOString() ?? null,
            }
          : null,
        reconciliation: reconciliation
          ? {
              status: reconciliation.status,
              lastError: reconciliation.lastError,
              updatedAt: reconciliation.updatedAt.toISOString(),
            }
          : null,
        application: application
          ? {
              id: application.id,
              programKey: application.programKey,
              status: application.status,
              submittedAt: application.submittedAt.toISOString(),
            }
          : null,
        award: award ? partnerAwardOut(award) : null,
        credit: credit
          ? {
              status: credit.status,
              currency: credit.currency,
              totalAmount: credit.totalAmount,
              providerCreditNoteId: credit.providerCreditNoteId,
            }
          : null,
      });
    },
  )
  .post(
    '/:id/reconcile',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Reconcile Stripe billing state',
      response: AdminBillingReconciliationOut,
      description:
        'Runs the same safe, idempotent Stripe reconciliation pass as the scheduler, then returns its counts. The organization id is checked before the pass. The worker may repair mirrors, but it never cancels duplicate subscriptions, issues money, or marks an unpaid subscription active without a provider snapshot.',
    }),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { staffUserId } = c.get('staffCtx');
      await loadOrg(id);
      const result = await reconcileBilling(
        db,
        getContainer().billing,
        getContainer().blob,
        new Date(),
      );
      await audit(db, staffUserId, 'billing.reconciled', 'organization', id, { ...result });
      return ok(c, AdminBillingReconciliationOut, result);
    },
  )
  .post(
    '/:id/discount-awards/preview',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Preview a private partner discount',
      response: PartnerDiscountPreviewOut,
      description:
        'Previews and freezes the provider action and tax-aware credit for fifteen minutes. Finance must pass the returned confirmation when granting the award.',
    }),
    zParam(idParam),
    zJson(PartnerDiscountPreviewBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      await loadOrg(id);
      return ok(c, PartnerDiscountPreviewOut, await createPartnerPreview(id, input));
    },
  )
  .post(
    '/:id/discount-awards',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Grant a private partner discount',
      response: AdminDiscountAwardOut,
      description:
        'Grants a private 1–90% partner award that ends within 24 months. The operation uses a product-scoped Stripe coupon, applies it to an existing subscription without proration, issues a tax-aware unused-period credit when needed, and refuses all stacking. A 100% or permanent grant must use the superadmin complimentary entitlement.',
    }),
    zParam(idParam),
    zJson(PartnerDiscountAwardBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      await loadOrg(id);
      const preview = await loadPartnerPreview(input.confirmation, id, input);
      const current = await loadCurrentAward(id);
      const retrying =
        current?.status === 'provider_failed' &&
        current.percentOff === input.percentOff &&
        current.endsAt.getTime() === new Date(input.endsAt).getTime() &&
        current.reason === input.reason;
      assertPartnerAwardAvailable(current, input);

      const now = new Date();
      let award: typeof billingDiscountAward.$inferSelect | undefined = current;
      if (retrying && award) {
        const [updated] = await db
          .update(billingDiscountAward)
          .set({ status: 'applying', providerSyncError: null })
          .where(eq(billingDiscountAward.id, award.id))
          .returning();
        award = updated;
      } else {
        try {
          const inserted = await db
            .insert(billingDiscountAward)
            .values({
              organizationId: id,
              percentOff: input.percentOff,
              status: 'applying',
              startsAt: now,
              endsAt: new Date(input.endsAt),
              reviewAt: new Date(input.endsAt),
              reason: input.reason,
              approvedByStaffId: staffUserId,
            })
            .returning();
          award = inserted[0];
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictError(
              'This workspace already has a discount award',
              'discount_award_conflict',
            );
          }
          throw error;
        }
      }
      if (!award) throw new Error('Partner award insert returned no row');

      const syncKey = `discount-award:${award.id}:apply`;
      await db
        .insert(billingProviderSync)
        .values({
          organizationId: id,
          awardId: award.id,
          operation: 'apply_partner_award',
          status: 'running',
          idempotencyKey: syncKey,
          attempts: 1,
        })
        .onConflictDoUpdate({
          target: billingProviderSync.idempotencyKey,
          set: {
            status: 'running',
            attempts: sql`${billingProviderSync.attempts} + 1`,
            lastError: null,
            completedAt: null,
          },
        });
      const gateway = getContainer().billing;
      try {
        const coupon = await gateway.createDiscountCoupon({
          awardId: award.id,
          name: 'Partner discount',
          percentOff: award.percentOff,
          priceKey: docketProPriceKey(),
          idempotencyKey: `${syncKey}:coupon`,
        });
        const subscription = await gateway.getSubscription(id);
        assertSubscriptionDiscountOwnership(subscription, current);
        const applied = subscription
          ? await gateway.applySubscriptionDiscount({
              referenceId: id,
              couponId: coupon.id,
              idempotencyKey: `${syncKey}:subscription`,
            })
          : null;
        const invoice = preview.invoice;
        if (invoice && preview.credit) {
          const creditPreview = preview.credit;
          const issued = await gateway.issueCreditNote({
            invoiceId: invoice.invoiceId,
            invoiceLineId: invoice.lineId,
            baseAmount: creditPreview.baseAmount,
            creditAmount: creditPreview.postPaymentAmount,
            idempotencyKey: `${syncKey}:credit`,
            memo: `Partner discount effective ${now.toISOString().slice(0, 10)}`,
          });
          await db
            .insert(billingCredit)
            .values({
              organizationId: id,
              awardId: award.id,
              status: 'issued',
              currency: invoice.currency,
              baseAmount: issued.baseAmount,
              taxAmount: issued.taxAmount,
              totalAmount: issued.totalAmount,
              servicePeriodStartsAt: new Date(invoice.periodStartsAt),
              servicePeriodEndsAt: new Date(invoice.periodEndsAt),
              providerInvoiceId: invoice.invoiceId,
              providerCreditNoteId: issued.id,
              providerPreview: { ...creditPreview },
              issuedAt: now,
            })
            .onConflictDoNothing({ target: billingCredit.providerCreditNoteId });
        }
        const [updated] = await db
          .update(billingDiscountAward)
          .set({
            status: subscription ? 'active' : 'scheduled',
            providerCouponId: coupon.id,
            providerDiscountId: applied?.discountId ?? null,
          })
          .where(eq(billingDiscountAward.id, award.id))
          .returning();
        if (!updated) throw new Error('Partner award update returned no row');
        await db
          .update(billingProviderSync)
          .set({ status: 'succeeded', completedAt: now })
          .where(eq(billingProviderSync.idempotencyKey, syncKey));
        await audit(db, staffUserId, 'billing.partner_discount_granted', 'organization', id, {
          awardId: updated.id,
          percentOff: updated.percentOff,
          endsAt: updated.endsAt.toISOString(),
          reason: input.reason,
        });
        return ok(c, AdminDiscountAwardOut, partnerAwardOut(updated));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Provider synchronization failed';
        await Promise.all([
          db
            .update(billingDiscountAward)
            .set({ status: 'provider_failed', providerSyncError: message })
            .where(eq(billingDiscountAward.id, award.id)),
          db
            .update(billingProviderSync)
            .set({ status: 'failed', lastError: message })
            .where(eq(billingProviderSync.idempotencyKey, syncKey)),
        ]);
        throw new ConflictError(
          'Stripe did not confirm the partner discount. Finance can retry.',
          'billing_provider_sync_failed',
        );
      }
    },
  )
  .post(
    '/:id/holds',
    apiDoc({
      status: 201,
      tag: 'Admin',
      summary: 'Place a lifecycle hold on an org',
      response: AdminHoldOut,
      description: `Records a legacy organization lifecycle hold for compatibility with existing operator records.

**Behavior.** Verifies the org exists, then inserts a \`lifecycle_hold\` row with the required reason and acting operator. Billing reconciliation and product access ignore this record. Account deletion remains under the confirmed user Danger Zone flow. The Admin billing page no longer exposes this compatibility action.

**Side effects.** Creates the hold **and** writes a \`lifecycle_hold.placed\` operator audit event (subject = the org) capturing the hold id and reason.

**Access.** Behind \`staffMiddleware\`. Any staff tier may place a hold (it's a protective, reversible brake, not a billing change) — no \`requireStaffRole\` gate. Non-operator → \`403\`; anonymous → \`401\`.

**Related.** \`DELETE /admin/orgs/{id}/holds/{holdId}\` to release; \`GET /admin/metrics\` reports \`activeHolds\`.`,
    }),
    zParam(idParam),
    zJson(PlaceHoldBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      await loadOrg(id);
      const inserted = await db
        .insert(lifecycleHold)
        .values({ organizationId: id, reason, placedBy: staffUserId })
        .returning();
      const hold = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
      if (!hold) throw new NotFoundError('Hold insert returned no row');
      await audit(db, staffUserId, 'lifecycle_hold.placed', 'organization', id, {
        holdId: hold.id,
        reason,
      });
      return created(c, AdminHoldOut, toHoldOut(hold));
    },
  )
  .delete(
    '/:id/holds/:holdId',
    apiDoc({
      tag: 'Admin',
      summary: 'Release a lifecycle hold',
      response: AdminHoldOut,
      description: `Releases a previously placed lifecycle hold, lifting the operator brake so the org can resume its normal retention pipeline.

**Behavior.** Conditionally updates the hold matched by \`holdId\` AND \`organizationId\` AND still un-released (\`releasedAt IS NULL\`), stamping \`releasedAt = now\`. Returns the released record. Returns \`404 not_found\` when no active hold matches those three conditions — including a hold already released (the guard makes release idempotent) or a hold/org-id mismatch. Once the last active hold is released the deletion sweep may again advance the org.

**Side effects.** Writes a \`lifecycle_hold.released\` operator audit event (subject = the org) referencing the hold id.

**Access.** Behind \`staffMiddleware\` (any staff tier). Non-operator → \`403\`; anonymous → \`401\`.

**Related.** \`POST /admin/orgs/{id}/holds\` to place a hold.`,
    }),
    zParam(holdParam),
    async (c) => {
      const { id, holdId } = c.req.valid('param');
      const { staffUserId } = c.get('staffCtx');
      const released = await db
        .update(lifecycleHold)
        .set({ releasedAt: new Date() })
        .where(
          and(
            eq(lifecycleHold.id, holdId),
            eq(lifecycleHold.organizationId, id),
            isNull(lifecycleHold.releasedAt),
          ),
        )
        .returning();
      const hold = released[0];
      if (!hold) throw new NotFoundError('Active hold not found');
      await audit(db, staffUserId, 'lifecycle_hold.released', 'organization', id, { holdId });
      return ok(c, AdminHoldOut, toHoldOut(hold));
    },
  )
  .post(
    '/:id/billing-exemption',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Grant a billing exemption',
      response: AdminBillingExemptionOut,
      description: `Grants an organization permanent, free, Stripe-independent Docket Pro through the shared product capability catalog.

**Behavior.** Verifies the org exists and has no current Stripe subscription, then inserts the audited grant and an active complimentary Docket Pro entitlement. The same catalog grants shared work, integrations, MCP, Athena, and voice. A partial unique index enforces at most one active grant per organization.

**Side effects.** Creates the exemption **and** writes a \`billing.exemption_granted\` operator audit event (subject = the org) capturing the exemption id and reason.

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\` because this is an indefinite revenue concession. \`support\` and \`finance\` receive \`403 forbidden\`.

**Related.** \`DELETE /admin/orgs/{id}/billing-exemption\` to revoke; \`GET /admin/orgs/{id}\` reports \`isBillingExempt\`.`,
    }),
    zParam(idParam),
    zJson(GrantExemptionBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      await loadOrg(id);
      const [paidProduct] = await db
        .select({
          status: organizationProductEntitlement.status,
          source: organizationProductEntitlement.source,
        })
        .from(organizationProductEntitlement)
        .where(
          and(
            eq(organizationProductEntitlement.organizationId, id),
            eq(organizationProductEntitlement.productKey, 'docket_pro'),
          ),
        )
        .limit(1);
      if (
        paidProduct?.source === 'stripe' &&
        ['trialing', 'active', 'past_due'].includes(paidProduct.status)
      ) {
        throw new ConflictError(
          'Resolve the active Stripe subscription before granting complimentary Docket Pro',
        );
      }
      const providerSubscriptions = await getContainer().billing.listSubscriptions(id);
      if (providerSubscriptions.some((subscription) => subscription.status !== 'canceled')) {
        throw new ConflictError(
          'Resolve the active Stripe subscription before granting complimentary Docket Pro',
        );
      }
      let exemption;
      try {
        exemption = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(billingExemption)
            .values({ organizationId: id, reason, grantedBy: staffUserId })
            .returning();
          /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
          if (!inserted) throw new NotFoundError('Exemption insert returned no row');
          await tx
            .insert(organizationProductEntitlement)
            .values({
              organizationId: id,
              productKey: 'docket_pro',
              status: 'active',
              source: 'complimentary',
            })
            .onConflictDoUpdate({
              target: [
                organizationProductEntitlement.organizationId,
                organizationProductEntitlement.productKey,
              ],
              set: {
                status: 'active',
                source: 'complimentary',
                canceledAt: null,
                updatedAt: new Date(),
              },
            });
          await audit(tx, staffUserId, 'billing.exemption_granted', 'organization', id, {
            exemptionId: inserted.id,
            reason,
          });
          return inserted;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            'An active billing exemption already exists for this organization',
          );
        }
        throw err;
      }
      await dispatchEssentialBillingNotice(db, {
        organizationId: id,
        idempotencyKey: `billing:complimentary:${exemption.id}:granted`,
        subject: 'Complimentary Docket Pro was granted',
        text: 'This workspace now has Complimentary Docket Pro. All current and future Pro features are available without a payment method or renewal.',
      }).catch(() => undefined);
      return ok(c, AdminBillingExemptionOut, toExemptionOut(exemption));
    },
  )
  .delete(
    '/:id/billing-exemption',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Revoke a billing exemption',
      response: AdminBillingExemptionOut,
      description: `Revokes an organization's active complimentary Docket Pro grant.

**Behavior.** Atomically updates the exemption row matched by \`organizationId\` AND still active (\`revokedAt IS NULL\`), stamping \`revokedAt = now\` and \`revokedBy = \` the acting operator, in one conditional \`UPDATE\`. Returns \`404 not_found\` when no active exemption matches — including an org with no exemption at all, or one already revoked (the guard makes revoke idempotent-safe: a second call 404s rather than double-firing). Returns the now-revoked record.

**Side effects.** Writes a \`billing.exemption_revoked\` operator audit event (subject = the org) referencing the exemption id.

**Access — superadmin only.** Same tier as granting. \`support\`/\`finance\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Related.** \`POST /admin/orgs/{id}/billing-exemption\` to grant.`,
    }),
    zParam(idParam),
    zJson(GrantExemptionBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const revokedAt = new Date();
      const exemption = await db.transaction(async (tx) => {
        const [revoked] = await tx
          .update(billingExemption)
          .set({ revokedAt, revokedBy: staffUserId })
          .where(and(eq(billingExemption.organizationId, id), isNull(billingExemption.revokedAt)))
          .returning();
        if (!revoked) throw new NotFoundError('Active billing exemption not found');
        await tx
          .update(organizationProductEntitlement)
          .set({ status: 'canceled', canceledAt: revokedAt })
          .where(
            and(
              eq(organizationProductEntitlement.organizationId, id),
              eq(organizationProductEntitlement.productKey, 'docket_pro'),
              eq(organizationProductEntitlement.source, 'complimentary'),
            ),
          );
        await audit(tx, staffUserId, 'billing.exemption_revoked', 'organization', id, {
          exemptionId: revoked.id,
          reason,
        });
        return revoked;
      });
      await dispatchEssentialBillingNotice(db, {
        organizationId: id,
        idempotencyKey: `billing:complimentary:${exemption.id}:revoked`,
        subject: 'Complimentary Docket Pro was revoked',
        text: 'Complimentary Docket Pro ended. Billing settings show the workspace access state and available next action.',
        urgent: true,
      }).catch(() => undefined);
      return ok(c, AdminBillingExemptionOut, toExemptionOut(exemption));
    },
  )
  .post(
    '/:id/extend-trial',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Extend an org trial',
      response: AdminOrgOut,
      description: `Extends an eligible current Stripe trial and reconciles the returned provider snapshot.

**Behavior.** Loads the organization and current Stripe subscription. The action rejects unless Stripe reports a trial with a trial end. Stripe receives the idempotent extension, and Docket applies the returned subscription snapshot through the normal entitlement state machine. The action never writes organization-retention fields or activates an unpaid database row.

**Access — finance+.** Gated by \`requireStaffRole('finance')\` on top of \`staffMiddleware\`: extending a trial is a revenue-affecting billing concession, so it is restricted to \`finance\` (and \`superadmin\`, which outranks it). \`support\` operators get \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** Writes a \`billing.trial_extended\` operator audit event (subject = the org) capturing the requested \`days\` and the previous lifecycle state.

**Related.** \`POST /admin/orgs/{id}/reconcile\` repairs safe provider drift. Customers reactivate paid access through the Stripe portal.`,
    }),
    zParam(idParam),
    zJson(ExtendTrialBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { days } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const org = await loadOrg(id);
      const gateway = getContainer().billing;
      const current = await gateway.getSubscription(id);
      if (current?.status !== 'trialing' || !current.trialEnd) {
        throw new ConflictError('Only an existing Stripe trial can be extended');
      }
      const operationKey = [
        'docket',
        'trial-extension',
        id,
        current.id,
        current.trialEnd,
        String(days),
      ].join(':');
      const updated = await gateway.extendTrial(id, days, operationKey);
      const observedAt = new Date().toISOString();
      await applyBillingEvent(
        db,
        {
          id: operationKey,
          type: 'subscription.updated',
          referenceId: id,
          subscription: updated,
          createdAt: observedAt,
        },
        observedAt,
      );
      await audit(db, staffUserId, 'billing.trial_extended', 'organization', id, {
        days,
        stripeSubscriptionId: current.id,
        previousTrialEnd: current.trialEnd,
        nextTrialEnd: updated.trialEnd,
      });
      const exemptIds = await loadActiveExemptOrgIds(db, [id]);
      return ok(c, AdminOrgOut, toOrgOut(org, exemptIds));
    },
  );
