import {
  billingCredit,
  billingDiscountAward,
  billingExemption,
  billingProviderSync,
  db,
  lifecycleHold,
  organizationProductEntitlement,
} from '@docket/db';
import { calculateUnusedPeriodCredit } from '@docket/billing/application/discounts';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { applyBillingEvent } from '@docket/billing/application/lifecycle';

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
import { ConflictError, NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { hasSqlState } from '../lib/sql-state';
import { zJson, zParam } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';

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
import { AdminDiscountAwardOut } from './admin-discount-routes';

/** The Postgres SQLSTATE for a unique-constraint (including unique-index) violation. */
const UNIQUE_VIOLATION_CODE = '23505';

/** Whether a thrown error is a Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return hasSqlState(err, UNIQUE_VIOLATION_CODE);
}

/** Private partner award request. A free or permanent grant must use complimentary Pro instead. */
export const PartnerDiscountAwardBody = z
  .object({
    percentOff: z.number().int().min(1).max(90),
    endsAt: z.iso.datetime(),
    reason: z.string().trim().min(1).max(2_000),
  })
  .superRefine((value, ctx) => {
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
  });
/** Private partner award request value. */
export type PartnerDiscountAwardBody = z.infer<typeof PartnerDiscountAwardBody>;

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

/**
 * Sub-router for lifecycle-hold and billing-action routes (mounted at `/orgs`).
 * All routes require staff auth (enforced by the parent admin router's middleware).
 */
export const adminBillingRoutes = new Hono<AppEnv>()
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
      const [current] = await db
        .select({ id: billingDiscountAward.id })
        .from(billingDiscountAward)
        .where(
          and(
            eq(billingDiscountAward.organizationId, id),
            inArray(billingDiscountAward.status, ['scheduled', 'applying', 'active', 'ending']),
          ),
        )
        .limit(1);
      if (current) {
        throw new ConflictError(
          'This workspace already has a discount award',
          'discount_award_conflict',
        );
      }

      const now = new Date();
      let award: typeof billingDiscountAward.$inferSelect | undefined;
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
      if (!award) throw new Error('Partner award insert returned no row');

      const syncKey = `discount-award:${award.id}:apply`;
      await db.insert(billingProviderSync).values({
        organizationId: id,
        awardId: award.id,
        operation: 'apply_partner_award',
        status: 'running',
        idempotencyKey: syncKey,
        attempts: 1,
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
        const applied = subscription
          ? await gateway.applySubscriptionDiscount({
              referenceId: id,
              couponId: coupon.id,
              idempotencyKey: `${syncKey}:subscription`,
            })
          : null;
        const invoice = await gateway.getLatestRecurringInvoice(id);
        if (invoice) {
          const baseAmount = calculateUnusedPeriodCredit({
            recurringAmount: invoice.recurringAmount,
            percentOff: award.percentOff,
            periodStartsAt: new Date(invoice.periodStartsAt),
            periodEndsAt: new Date(invoice.periodEndsAt),
            approvedAt: now,
          });
          if (baseAmount > 0) {
            const preview = await gateway.previewCreditNote({
              invoiceId: invoice.invoiceId,
              invoiceLineId: invoice.lineId,
              baseAmount,
            });
            const issued = await gateway.issueCreditNote({
              invoiceId: invoice.invoiceId,
              invoiceLineId: invoice.lineId,
              baseAmount,
              creditAmount: preview.postPaymentAmount,
              idempotencyKey: `${syncKey}:credit`,
              memo: `Partner discount effective ${now.toISOString().slice(0, 10)}`,
            });
            await db.insert(billingCredit).values({
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
              providerPreview: { ...preview },
              issuedAt: now,
            });
          }
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
      description: `Places a named lifecycle hold on an organization — an operator's "do not delete" brake on the data-retention pipeline.

**Behavior.** Verifies the org exists (else \`404 not_found\`), then inserts a \`lifecycle_hold\` row with the required free-text \`reason\` and \`placedBy = \` the acting operator. While any un-released hold exists, the org counts toward \`activeHolds\` in metrics and the deletion sweep is expected to skip it, so it cannot silently advance \`export_window → pending_deletion → deleted\` while under investigation, dispute, or legal hold. The returned record has a null \`releasedAt\` (active).

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
      description: `Grants an organization a permanent, free, Stripe-independent bypass of the agent-session entitlement gate — the operator mechanism for comping internal or gifted accounts.

**Behavior.** Verifies the org exists (else \`404 not_found\`), then inserts a \`billing_exemption\` row with the required free-text \`reason\` and \`grantedBy = \` the acting operator. A partial unique index enforces at most one active (\`revokedAt IS NULL\`) grant per org; attempting a second concurrent grant returns \`409 conflict\`. Once granted, \`assertAgentSessionsEntitled\` treats the org as entitled regardless of \`lifecycleState\`, indefinitely, until revoked.

**Side effects.** Creates the exemption **and** writes a \`billing.exemption_granted\` operator audit event (subject = the org) capturing the exemption id and reason.

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\`: unlike the time-boxed \`finance\` actions (extend-trial, reactivate), this is an indefinite, full bypass of the revenue gate — the highest-blast-radius billing action, restricted to the top tier. \`support\`/\`finance\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

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
      let inserted;
      try {
        inserted = await db
          .insert(billingExemption)
          .values({ organizationId: id, reason, grantedBy: staffUserId })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            'An active billing exemption already exists for this organization',
          );
        }
        throw err;
      }
      const exemption = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
      if (!exemption) throw new NotFoundError('Exemption insert returned no row');
      await db
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
      await audit(db, staffUserId, 'billing.exemption_granted', 'organization', id, {
        exemptionId: exemption.id,
        reason,
      });
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
      description: `Revokes an organization's active billing exemption, reverting it to the normal Stripe-driven entitlement gate.

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
      const revoked = await db
        .update(billingExemption)
        .set({ revokedAt: new Date(), revokedBy: staffUserId })
        .where(and(eq(billingExemption.organizationId, id), isNull(billingExemption.revokedAt)))
        .returning();
      const exemption = revoked[0];
      if (!exemption) throw new NotFoundError('Active billing exemption not found');
      await db
        .update(organizationProductEntitlement)
        .set({ status: 'canceled', canceledAt: new Date() })
        .where(
          and(
            eq(organizationProductEntitlement.organizationId, id),
            eq(organizationProductEntitlement.productKey, 'docket_pro'),
            eq(organizationProductEntitlement.source, 'complimentary'),
          ),
        );
      await audit(db, staffUserId, 'billing.exemption_revoked', 'organization', id, {
        exemptionId: exemption.id,
        reason,
      });
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
      description: `Returns an organization to a clean \`trialing\` state — the operator goodwill/sales lever for extending a trial.

**Behavior.** Loads the org (else \`404 not_found\`), then sets \`lifecycleState = 'trialing'\` and clears both \`exportReadyAt\` and \`deleteAfterAt\`, which cancels any pending export window or scheduled deletion and removes the org from the delete sweep's path. The \`days\` body value (1..365) is recorded in the audit metadata as the operator's intent; the state reset itself is what re-opens the trial. Returns the updated org.

**Access — finance+.** Gated by \`requireStaffRole('finance')\` on top of \`staffMiddleware\`: extending a trial is a revenue-affecting billing concession, so it is restricted to \`finance\` (and \`superadmin\`, which outranks it). \`support\` operators get \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** Writes a \`billing.trial_extended\` operator audit event (subject = the org) capturing the requested \`days\` and the previous lifecycle state.

**Related.** \`POST /admin/orgs/{id}/reactivate\` (recover a lapsed paid org); \`POST /admin/orgs/{id}/lifecycle\` (force any state directly).`,
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
