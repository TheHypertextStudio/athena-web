/** Finance review routes for discount applications, awards, evidence, and credits. */
import {
  BILLING_DISCOUNT_APPLICATION_STATUSES,
  BILLING_DISCOUNT_AWARD_STATUSES,
  billingCredit,
  billingDiscountApplication,
  billingDiscountApplicationEvent,
  billingDiscountAward,
  billingDiscountEvidence,
  billingDiscountProgram,
  billingProviderSync,
  db,
  organization,
} from '@docket/db';
import { calculateUnusedPeriodCredit } from '@docket/billing/application/discounts';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type {
  CreditNotePreview,
  RecurringInvoiceLine,
  Subscription,
} from '@docket/billing/contracts';
import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { env } from '../env';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc, describeRoute } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';

import { audit } from './admin-serializers';

/** Finance application queue row. */
export const AdminDiscountApplicationOut = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  programKey: z.enum(['student', 'nonprofit']),
  status: z.enum(BILLING_DISCOUNT_APPLICATION_STATUSES),
  evidenceType: z.string().nullable(),
  institutionalEmail: z.string().nullable(),
  ein: z.string().nullable(),
  informationRequest: z.string().nullable(),
  decisionReason: z.string().nullable(),
  submittedAt: z.string(),
});
/** Finance application response value. */
export type AdminDiscountApplicationOut = z.infer<typeof AdminDiscountApplicationOut>;

/** Finance queue response. */
export const AdminDiscountApplicationPage = z.object({
  items: z.array(AdminDiscountApplicationOut),
});
/** Finance queue response value. */
export type AdminDiscountApplicationPage = z.infer<typeof AdminDiscountApplicationPage>;

/** Tax-aware credit preview attached to an approval preview. */
export const AdminCreditPreviewOut = z.object({
  invoiceId: z.string(),
  currency: z.string(),
  baseAmount: z.number().int(),
  taxAmount: z.number().int(),
  totalAmount: z.number().int(),
  prePaymentAmount: z.number().int(),
  postPaymentAmount: z.number().int(),
  servicePeriodStartsAt: z.string(),
  servicePeriodEndsAt: z.string(),
});
/** Finance credit preview response value. */
export type AdminCreditPreviewOut = z.infer<typeof AdminCreditPreviewOut>;

/** Approval effect shown before finance confirms the decision. */
export const AdminDiscountApprovalPreviewOut = z.object({
  applicationId: z.string(),
  organizationId: z.string(),
  percentOff: z.number().int(),
  reviewMonths: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  providerAction: z.enum(['attach_at_checkout', 'apply_to_trial', 'apply_to_subscription']),
  credit: AdminCreditPreviewOut.nullable(),
});
/** Finance approval preview response value. */
export type AdminDiscountApprovalPreviewOut = z.infer<typeof AdminDiscountApprovalPreviewOut>;

/** Award created after provider confirmation. */
export const AdminDiscountAwardOut = z.object({
  id: z.string(),
  organizationId: z.string(),
  applicationId: z.string().nullable(),
  programKey: z.enum(['student', 'nonprofit']).nullable(),
  percentOff: z.number().int(),
  status: z.enum(BILLING_DISCOUNT_AWARD_STATUSES),
  startsAt: z.string(),
  endsAt: z.string(),
  reviewAt: z.string(),
  reason: z.string(),
  providerCouponId: z.string().nullable(),
  providerDiscountId: z.string().nullable(),
});
/** Finance award response value. */
export type AdminDiscountAwardOut = z.infer<typeof AdminDiscountAwardOut>;

/** Confirmed application and award pair. */
export const AdminDiscountApprovalOut = z.object({
  application: AdminDiscountApplicationOut,
  award: AdminDiscountAwardOut,
  credit: AdminCreditPreviewOut.nullable(),
});
/** Finance approval response value. */
export type AdminDiscountApprovalOut = z.infer<typeof AdminDiscountApprovalOut>;

/** Required rationale for every finance decision. */
export const DiscountDecisionBody = z
  .object({ reason: z.string().trim().min(1).max(2_000) })
  .strict();
/** Finance decision request value. */
export type DiscountDecisionBody = z.infer<typeof DiscountDecisionBody>;

/** Application path parameter. */
const applicationParam = z.object({ applicationId: z.string() });
/** Evidence path parameter. */
const evidenceParam = z.object({ applicationId: z.string(), evidenceId: z.string() });
/** Award path parameter. */
const awardParam = z.object({ awardId: z.string() });

/** Internal approval preview with the provider objects needed for confirmation. */
interface ApprovalPreview {
  /** Public preview. */
  readonly output: z.input<typeof AdminDiscountApprovalPreviewOut>;
  /** Current provider subscription, if one exists. */
  readonly subscription: Subscription | null;
  /** Invoice line used to calculate the credit. */
  readonly invoice: RecurringInvoiceLine | null;
  /** Provider-calculated credit values. */
  readonly credit: CreditNotePreview | null;
}

/** Add calendar months without turning a 12-month review into a fixed-day approximation. */
function addUtcMonths(value: Date, months: number): Date {
  const result = new Date(value);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** Convert an application joined to its organization into the finance response. */
function applicationOut(
  application: typeof billingDiscountApplication.$inferSelect,
  org: Pick<typeof organization.$inferSelect, 'name'>,
): z.input<typeof AdminDiscountApplicationOut> {
  return {
    id: application.id,
    organizationId: application.organizationId,
    organizationName: org.name,
    programKey: application.programKey,
    status: application.status,
    evidenceType: application.evidenceType,
    institutionalEmail: application.institutionalEmail,
    ein: application.ein,
    informationRequest: application.informationRequest,
    decisionReason: application.decisionReason,
    submittedAt: application.submittedAt.toISOString(),
  };
}

/** Convert an award into the finance response. */
function awardOut(
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

/** Load one application and its tenant without leaking cross-tenant evidence. */
async function loadApplication(applicationId: string): Promise<{
  application: typeof billingDiscountApplication.$inferSelect;
  org: typeof organization.$inferSelect;
}> {
  const [row] = await db
    .select({ application: billingDiscountApplication, org: organization })
    .from(billingDiscountApplication)
    .innerJoin(organization, eq(organization.id, billingDiscountApplication.organizationId))
    .where(eq(billingDiscountApplication.id, applicationId))
    .limit(1);
  if (!row) throw new NotFoundError('Discount application not found');
  return row;
}

/** Build the provider and credit effects that finance must inspect before approval. */
async function previewApproval(
  application: typeof billingDiscountApplication.$inferSelect,
  now = new Date(),
): Promise<ApprovalPreview> {
  const [program] = await db
    .select()
    .from(billingDiscountProgram)
    .where(eq(billingDiscountProgram.key, application.programKey))
    .limit(1);
  if (!program?.active) throw new ConflictError('This discount program is not active');
  const gateway = getContainer().billing;
  const subscription = await gateway.getSubscription(application.organizationId);
  const startsAt =
    subscription?.status === 'trialing' && subscription.trialEnd
      ? new Date(subscription.trialEnd)
      : now;
  const endsAt = addUtcMonths(startsAt, program.reviewMonths);
  const invoice = await gateway.getLatestRecurringInvoice(application.organizationId);
  let credit: CreditNotePreview | null = null;
  let publicCredit: z.input<typeof AdminCreditPreviewOut> | null = null;
  if (invoice) {
    const baseAmount = calculateUnusedPeriodCredit({
      recurringAmount: invoice.recurringAmount,
      percentOff: program.percentOff,
      periodStartsAt: new Date(invoice.periodStartsAt),
      periodEndsAt: new Date(invoice.periodEndsAt),
      approvedAt: now,
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
  return {
    subscription,
    invoice,
    credit,
    output: {
      applicationId: application.id,
      organizationId: application.organizationId,
      percentOff: program.percentOff,
      reviewMonths: program.reviewMonths,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      providerAction:
        subscription === null
          ? 'attach_at_checkout'
          : subscription.status === 'trialing'
            ? 'apply_to_trial'
            : 'apply_to_subscription',
      credit: publicCredit,
    },
  };
}

/** Mark private evidence for deletion 30 days after a final decision. */
async function scheduleEvidenceDeletion(applicationId: string, decidedAt: Date): Promise<void> {
  await db
    .update(billingDiscountEvidence)
    .set({ deleteAfter: new Date(decidedAt.getTime() + 30 * 24 * 60 * 60 * 1000) })
    .where(eq(billingDiscountEvidence.applicationId, applicationId));
}

/** Finance discount router, mounted at `/v1/admin/discount-applications`. */
export const adminDiscountRoutes = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Admin',
      summary: 'List discount applications',
      response: AdminDiscountApplicationPage,
      description:
        'Lists submitted and needs-information applications for support visibility and finance review. This read does not grant revenue authority.',
    }),
    async (c) => {
      const rows = await db
        .select({ application: billingDiscountApplication, org: organization })
        .from(billingDiscountApplication)
        .innerJoin(organization, eq(organization.id, billingDiscountApplication.organizationId))
        .where(inArray(billingDiscountApplication.status, ['submitted', 'needs_information']))
        .orderBy(billingDiscountApplication.submittedAt);
      return ok(c, AdminDiscountApplicationPage, {
        items: rows.map((row) => applicationOut(row.application, row.org)),
      });
    },
  )
  .post(
    '/:applicationId/request-information',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Request discount information',
      response: AdminDiscountApplicationOut,
      description:
        'Returns an application to the customer with a required reason. Finance and superadmins may decide; support remains read-only.',
    }),
    zParam(applicationParam),
    zJson(DiscountDecisionBody),
    async (c) => {
      const { applicationId } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const { application, org } = await loadApplication(applicationId);
      if (application.status !== 'submitted') {
        throw new ConflictError('Only a submitted application can request more information');
      }
      const now = new Date();
      const [updated] = await db
        .update(billingDiscountApplication)
        .set({
          status: 'needs_information',
          informationRequest: reason,
          informationRequestedAt: now,
        })
        .where(eq(billingDiscountApplication.id, application.id))
        .returning();
      if (!updated) throw new NotFoundError('Discount application not found');
      await db.insert(billingDiscountApplicationEvent).values({
        applicationId: application.id,
        type: 'information_requested',
        reason,
        staffUserId,
      });
      await audit(
        db,
        staffUserId,
        'billing.discount_information_requested',
        'discount_application',
        application.id,
        { reason },
      );
      return ok(c, AdminDiscountApplicationOut, applicationOut(updated, org));
    },
  )
  .post(
    '/:applicationId/preview-approval',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Preview discount approval',
      response: AdminDiscountApprovalPreviewOut,
      description:
        'Previews the award dates and any tax-aware Stripe credit-note effect without changing the application, subscription, invoice, or entitlement.',
    }),
    zParam(applicationParam),
    async (c) => {
      const { applicationId } = c.req.valid('param');
      const { application } = await loadApplication(applicationId);
      if (application.status !== 'submitted') {
        throw new ConflictError('Only a submitted application can be approved');
      }
      const preview = await previewApproval(application);
      return ok(c, AdminDiscountApprovalPreviewOut, preview.output);
    },
  )
  .post(
    '/:applicationId/approve',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Approve and apply a discount',
      response: AdminDiscountApprovalOut,
      description:
        'Creates a retryable provider operation, confirms the Stripe coupon and existing-subscription discount, issues the previously previewed credit when needed, and only then marks the customer application approved.',
    }),
    zParam(applicationParam),
    zJson(DiscountDecisionBody),
    async (c) => {
      const { applicationId } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const { application, org } = await loadApplication(applicationId);
      if (application.status === 'approved') {
        const [existing] = await db
          .select()
          .from(billingDiscountAward)
          .where(eq(billingDiscountAward.applicationId, application.id))
          .orderBy(desc(billingDiscountAward.createdAt))
          .limit(1);
        if (!existing) throw new ConflictError('Approved application has no award');
        return ok(c, AdminDiscountApprovalOut, {
          application: applicationOut(application, org),
          award: awardOut(existing),
          credit: null,
        });
      }
      if (application.status !== 'submitted') {
        throw new ConflictError('Only a submitted application can be approved');
      }
      const now = new Date();
      const preview = await previewApproval(application, now);
      const [failedAward] = await db
        .select()
        .from(billingDiscountAward)
        .where(eq(billingDiscountAward.applicationId, application.id))
        .orderBy(desc(billingDiscountAward.createdAt))
        .limit(1);
      let award = failedAward;
      if (award) {
        const [reopened] = await db
          .update(billingDiscountAward)
          .set({ status: 'applying', providerSyncError: null, reason })
          .where(eq(billingDiscountAward.id, award.id))
          .returning();
        award = reopened;
      } else {
        const [inserted] = await db
          .insert(billingDiscountAward)
          .values({
            organizationId: application.organizationId,
            applicationId: application.id,
            programKey: application.programKey,
            percentOff: preview.output.percentOff,
            status: 'applying',
            startsAt: new Date(preview.output.startsAt),
            endsAt: new Date(preview.output.endsAt),
            reviewAt: new Date(preview.output.endsAt),
            reason,
            approvedByStaffId: staffUserId,
          })
          .returning();
        award = inserted;
      }
      if (!award) throw new Error('Discount award insert returned no row');

      const syncKey = `discount-award:${award.id}:apply`;
      await db
        .insert(billingProviderSync)
        .values({
          organizationId: application.organizationId,
          awardId: award.id,
          operation: 'apply_discount_award',
          status: 'running',
          idempotencyKey: syncKey,
          attempts: 1,
        })
        .onConflictDoUpdate({
          target: billingProviderSync.idempotencyKey,
          set: { status: 'running', attempts: 1, lastError: null, updatedAt: now },
        });

      const gateway = getContainer().billing;
      try {
        const coupon = await gateway.createDiscountCoupon({
          awardId: award.id,
          name: `${application.programKey === 'student' ? 'Student' : 'Nonprofit'} discount`,
          percentOff: award.percentOff,
          priceKey:
            env.STRIPE_PRICE_DOCKET_PRO ??
            env.DOCKET_PRICE_LOOKUP_DOCKET_PRO ??
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- Compatibility for the former Docket Team configuration.
            env.STRIPE_PRICE_TEAM ??
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- Compatibility for the former Docket Team configuration.
            env.DOCKET_PRICE_LOOKUP_TEAM ??
            'docket_pro_monthly',
          idempotencyKey: `${syncKey}:coupon`,
        });
        const applied = preview.subscription
          ? await gateway.applySubscriptionDiscount({
              referenceId: application.organizationId,
              couponId: coupon.id,
              idempotencyKey: `${syncKey}:subscription`,
            })
          : null;
        let creditOut: z.input<typeof AdminCreditPreviewOut> | null = preview.output.credit;
        if (preview.credit && preview.invoice) {
          const issued = await gateway.issueCreditNote({
            invoiceId: preview.invoice.invoiceId,
            invoiceLineId: preview.invoice.lineId,
            baseAmount: preview.credit.baseAmount,
            creditAmount: preview.credit.postPaymentAmount,
            idempotencyKey: `${syncKey}:credit`,
            memo: `${application.programKey === 'student' ? 'Student' : 'Nonprofit'} discount effective ${now.toISOString().slice(0, 10)}`,
          });
          await db.insert(billingCredit).values({
            organizationId: application.organizationId,
            awardId: award.id,
            status: 'issued',
            currency: preview.invoice.currency,
            baseAmount: issued.baseAmount,
            taxAmount: issued.taxAmount,
            totalAmount: issued.totalAmount,
            servicePeriodStartsAt: new Date(preview.invoice.periodStartsAt),
            servicePeriodEndsAt: new Date(preview.invoice.periodEndsAt),
            providerInvoiceId: preview.invoice.invoiceId,
            providerCreditNoteId: issued.id,
            providerPreview: { ...preview.credit },
            issuedAt: now,
          });
          creditOut = {
            invoiceId: preview.invoice.invoiceId,
            currency: preview.invoice.currency,
            ...issued,
            servicePeriodStartsAt: preview.invoice.periodStartsAt,
            servicePeriodEndsAt: preview.invoice.periodEndsAt,
          };
        }

        const result = await db.transaction(async (tx) => {
          const [updatedAward] = await tx
            .update(billingDiscountAward)
            .set({
              status: preview.subscription ? 'active' : 'scheduled',
              providerCouponId: coupon.id,
              providerDiscountId: applied?.discountId ?? null,
              providerSyncError: null,
            })
            .where(eq(billingDiscountAward.id, award.id))
            .returning();
          const [updatedApplication] = await tx
            .update(billingDiscountApplication)
            .set({ status: 'approved', decisionReason: reason, decidedAt: now })
            .where(eq(billingDiscountApplication.id, application.id))
            .returning();
          if (!updatedAward || !updatedApplication) {
            throw new Error('Discount approval update returned no row');
          }
          await tx.insert(billingDiscountApplicationEvent).values({
            applicationId: application.id,
            type: 'approved',
            reason,
            staffUserId,
          });
          await tx
            .update(billingProviderSync)
            .set({ status: 'succeeded', completedAt: now })
            .where(eq(billingProviderSync.idempotencyKey, syncKey));
          return { updatedAward, updatedApplication };
        });
        await scheduleEvidenceDeletion(application.id, now);
        await audit(
          db,
          staffUserId,
          'billing.discount_approved',
          'discount_application',
          application.id,
          { reason, awardId: result.updatedAward.id },
        );
        return ok(c, AdminDiscountApprovalOut, {
          application: applicationOut(result.updatedApplication, org),
          award: awardOut(result.updatedAward),
          credit: creditOut,
        });
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
          'Stripe did not confirm the discount. Finance can retry this approval.',
          'billing_provider_sync_failed',
        );
      }
    },
  )
  .post(
    '/:applicationId/reject',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Reject a discount application',
      response: AdminDiscountApplicationOut,
      description:
        'Rejects a submitted application with a required finance reason, records customer-visible history and operator audit, and schedules private evidence deletion in 30 days.',
    }),
    zParam(applicationParam),
    zJson(DiscountDecisionBody),
    async (c) => {
      const { applicationId } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const { application, org } = await loadApplication(applicationId);
      if (!['submitted', 'needs_information'].includes(application.status)) {
        throw new ConflictError('This application already has a final decision');
      }
      const now = new Date();
      const [updated] = await db
        .update(billingDiscountApplication)
        .set({ status: 'rejected', decisionReason: reason, decidedAt: now })
        .where(eq(billingDiscountApplication.id, application.id))
        .returning();
      if (!updated) throw new NotFoundError('Discount application not found');
      await db.insert(billingDiscountApplicationEvent).values({
        applicationId: application.id,
        type: 'rejected',
        reason,
        staffUserId,
      });
      await scheduleEvidenceDeletion(application.id, now);
      await audit(
        db,
        staffUserId,
        'billing.discount_rejected',
        'discount_application',
        application.id,
        { reason },
      );
      return ok(c, AdminDiscountApplicationOut, applicationOut(updated, org));
    },
  )
  .post(
    '/awards/:awardId/renew',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Renew a discount award',
      response: AdminDiscountAwardOut,
      description:
        'Extends a current public-program award by its configured review term. The current Stripe coupon remains attached, so the customer sees no billing interruption.',
    }),
    zParam(awardParam),
    zJson(DiscountDecisionBody),
    async (c) => {
      const { awardId } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const [current] = await db
        .select({ award: billingDiscountAward, program: billingDiscountProgram })
        .from(billingDiscountAward)
        .leftJoin(
          billingDiscountProgram,
          eq(billingDiscountProgram.key, billingDiscountAward.programKey),
        )
        .where(eq(billingDiscountAward.id, awardId))
        .limit(1);
      if (!current || !['active', 'ending'].includes(current.award.status)) {
        throw new ConflictError('Only a current award can be renewed');
      }
      const endsAt = addUtcMonths(current.award.endsAt, current.program?.reviewMonths ?? 12);
      const [updated] = await db
        .update(billingDiscountAward)
        .set({ status: 'active', endsAt, reviewAt: endsAt, reason })
        .where(eq(billingDiscountAward.id, awardId))
        .returning();
      if (!updated) throw new NotFoundError('Discount award not found');
      await audit(db, staffUserId, 'billing.discount_renewed', 'discount_award', awardId, {
        reason,
        endsAt: endsAt.toISOString(),
      });
      return ok(c, AdminDiscountAwardOut, awardOut(updated));
    },
  )
  .post(
    '/awards/:awardId/revoke',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Revoke a discount award',
      response: AdminDiscountAwardOut,
      description:
        'Removes the Stripe subscription discount first, then marks the local award revoked. A provider failure leaves the award active and returns a stable synchronization error.',
    }),
    zParam(awardParam),
    zJson(DiscountDecisionBody),
    async (c) => {
      const { awardId } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const [award] = await db
        .select()
        .from(billingDiscountAward)
        .where(eq(billingDiscountAward.id, awardId))
        .limit(1);
      if (!award || !['scheduled', 'active', 'ending'].includes(award.status)) {
        throw new ConflictError('Only a current award can be revoked');
      }
      if (award.providerDiscountId) {
        try {
          await getContainer().billing.removeSubscriptionDiscount(
            award.organizationId,
            `discount-award:${award.id}:revoke`,
          );
        } catch {
          throw new ConflictError(
            'Stripe did not confirm discount removal. Finance can retry this revocation.',
            'billing_provider_sync_failed',
          );
        }
      }
      const [updated] = await db
        .update(billingDiscountAward)
        .set({ status: 'revoked', reason })
        .where(eq(billingDiscountAward.id, award.id))
        .returning();
      if (!updated) throw new NotFoundError('Discount award not found');
      await audit(db, staffUserId, 'billing.discount_revoked', 'discount_award', award.id, {
        reason,
      });
      return ok(c, AdminDiscountAwardOut, awardOut(updated));
    },
  )
  .get(
    '/:applicationId/evidence/:evidenceId',
    describeRoute({
      tags: ['Admin'],
      summary: 'Download private discount evidence',
      description:
        'Streams private evidence only through the authenticated staff surface. The object-store key and URL remain server-only, and the response forbids browser caching.',
    }),
    zParam(evidenceParam),
    async (c) => {
      const { applicationId, evidenceId } = c.req.valid('param');
      const [evidence] = await db
        .select()
        .from(billingDiscountEvidence)
        .where(
          and(
            eq(billingDiscountEvidence.id, evidenceId),
            eq(billingDiscountEvidence.applicationId, applicationId),
          ),
        )
        .limit(1);
      if (!evidence || evidence.deletedAt) throw new NotFoundError('Evidence not found');
      const bytes = await getContainer().blob.get(evidence.blobKey);
      if (!bytes) throw new NotFoundError('Evidence file not found');
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': evidence.mimeType,
          'Content-Disposition': `attachment; filename="${evidence.fileName ?? 'evidence'}"`,
          'Cache-Control': 'private, no-store, max-age=0',
        },
      });
    },
  );
