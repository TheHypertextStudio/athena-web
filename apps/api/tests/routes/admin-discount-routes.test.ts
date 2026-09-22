/**
 * Finance review of discount applications, awards, and private evidence under `/admin`.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { getContainer } from '../../src/container';
import {
  activeSubscription,
  loadAdmin,
  monthsFromNow,
  postJson,
  readJson,
  seedApplication,
  seedAward,
  seedBillingOrg,
  staffApp,
} from '../support/admin-finance';
import { one } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: unknown;

beforeAll(async () => {
  ({ schema, admin } = await loadAdmin());
  db = schema.db;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The parts of a problem response these scenarios branch on. */
interface ProblemBody {
  readonly code: string;
}

/** The parts of an approval preview a later approval needs. */
interface PreviewBody {
  readonly confirmation: string;
  readonly providerAction: string;
  readonly credit: unknown;
}

/** The parts of an award response these scenarios inspect. */
interface AwardBody {
  readonly id: string;
  readonly status: string;
  readonly providerDiscountId: string | null;
  readonly endsAt: string;
}

/** The application status an approval response reports. */
interface ApplicationStatusBody {
  readonly status: string;
}

/** The issued credit total an approval response reports. */
interface CreditBody {
  readonly totalAmount: number;
}

/** The parts of an approval response these scenarios inspect. */
interface ApprovalBody {
  readonly application: ApplicationStatusBody;
  readonly award: AwardBody;
  readonly credit: CreditBody | null;
}

/** Read one award row. */
async function awardRow(id: string): Promise<typeof DbModule.billingDiscountAward.$inferSelect> {
  return one(
    await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.id, id)),
  );
}

/** Set an application's status directly. */
async function setApplicationStatus(
  applicationId: string,
  status: 'needs_information' | 'approved',
): Promise<void> {
  await db
    .update(schema.billingDiscountApplication)
    .set({ status })
    .where(eq(schema.billingDiscountApplication.id, applicationId));
}

/** Report one provider subscription for every organization while a scenario runs. */
function stubSubscription(organizationId: string): void {
  vi.spyOn(getContainer().billing, 'listSubscriptions').mockResolvedValue([
    activeSubscription(organizationId),
  ]);
}

/** Preview an application's approval and return the confirmation finance must echo. */
async function previewApproval(
  app: Awaited<ReturnType<typeof staffApp>>['app'],
  applicationId: string,
): Promise<PreviewBody> {
  const res = await postJson(app, `/discount-applications/${applicationId}/approval-previews`);
  expect(res.status).toBe(200);
  return readJson<PreviewBody>(res);
}

describe('discount application decisions', () => {
  it('returns not found for an unknown application', async () => {
    const { app } = await staffApp(schema, admin, 'support');

    const res = await app.request('/discount-applications/application_missing');

    expect(res.status).toBe(404);
    await expect(readJson<ProblemBody>(res)).resolves.toMatchObject({ code: 'not_found' });
  });

  it('refuses a second information request while the first is outstanding', async () => {
    const { applicationId } = await seedApplication(schema);
    await setApplicationStatus(applicationId, 'needs_information');
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(
      app,
      `/discount-applications/${applicationId}/information-requests`,
      {
        reason: 'Upload a current record.',
      },
    );

    expect(res.status).toBe(409);
  });

  it('refuses to repeat an approval whose award is missing', async () => {
    const { applicationId } = await seedApplication(schema);
    await setApplicationStatus(applicationId, 'approved');
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation: 'any',
      reason: 'Repeat click.',
    });

    expect(res.status).toBe(409);
  });

  it('refuses to approve an application waiting on the customer', async () => {
    const { applicationId } = await seedApplication(schema);
    await setApplicationStatus(applicationId, 'needs_information');
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation: 'any',
      reason: 'Approve anyway.',
    });

    expect(res.status).toBe(409);
    const [award] = await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.applicationId, applicationId));
    expect(award).toBeUndefined();
  });
});

describe('discount approval previews', () => {
  it('refuses to stack a program discount on a private partner award', async () => {
    const { applicationId, organizationId } = await seedApplication(schema);
    await seedAward(schema, { organizationId, programKey: null });
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/${applicationId}/approval-previews`);

    expect(res.status).toBe(409);
    await expect(readJson<ProblemBody>(res)).resolves.toMatchObject({
      code: 'discount_award_conflict',
    });
  });

  it('applies an approved discount to a paid subscription', async () => {
    const { applicationId, organizationId } = await seedApplication(schema);
    stubSubscription(organizationId);
    const apply = vi
      .spyOn(getContainer().billing, 'applySubscriptionDiscount')
      .mockResolvedValue({ discountId: 'di_paid_subscription' });
    const { app } = await staffApp(schema, admin, 'finance');

    const preview = await previewApproval(app, applicationId);
    expect(preview.providerAction).toBe('apply_to_subscription');

    const res = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation: preview.confirmation,
      reason: 'Verified.',
    });

    expect(res.status).toBe(200);
    await expect(readJson<ApprovalBody>(res)).resolves.toMatchObject({
      application: { status: 'approved' },
      award: { status: 'active', providerDiscountId: 'di_paid_subscription' },
    });
    expect(apply).toHaveBeenCalledOnce();
  });

  it('previews no credit when the latest paid period has already ended', async () => {
    const { applicationId, organizationId } = await seedApplication(schema);
    const day = 24 * 60 * 60 * 1000;
    vi.spyOn(getContainer().billing, 'getLatestRecurringInvoice').mockResolvedValue({
      invoiceId: `in_${organizationId}`,
      lineId: `il_${organizationId}`,
      invoiceStatus: 'paid',
      currency: 'usd',
      recurringAmount: 800,
      periodStartsAt: new Date(Date.now() - 60 * day).toISOString(),
      periodEndsAt: new Date(Date.now() - 30 * day).toISOString(),
    });
    const previewCredit = vi.spyOn(getContainer().billing, 'previewCreditNote');
    const { app } = await staffApp(schema, admin, 'finance');

    const preview = await previewApproval(app, applicationId);

    expect(preview.credit).toBeNull();
    expect(previewCredit).not.toHaveBeenCalled();
  });

  it('issues the previewed credit when approving a nonprofit discount', async () => {
    const { applicationId, organizationId } = await seedApplication(schema, 'nonprofit');
    const day = 24 * 60 * 60 * 1000;
    vi.spyOn(getContainer().billing, 'getLatestRecurringInvoice').mockResolvedValue({
      invoiceId: `in_${organizationId}`,
      lineId: `il_${organizationId}`,
      invoiceStatus: 'paid',
      currency: 'usd',
      recurringAmount: 800,
      periodStartsAt: new Date(Date.now() - 15 * day).toISOString(),
      periodEndsAt: new Date(Date.now() + 15 * day).toISOString(),
    });
    const { app } = await staffApp(schema, admin, 'finance');

    const preview = await previewApproval(app, applicationId);
    expect(preview.providerAction).toBe('attach_at_checkout');
    expect(preview.credit).not.toBeNull();

    const res = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation: preview.confirmation,
      reason: 'Registry entry verified.',
    });

    expect(res.status).toBe(200);
    const body = await readJson<ApprovalBody>(res);
    expect(body.award.status).toBe('scheduled');
    expect(body.credit?.totalAmount).toBeGreaterThan(0);
    const credits = await db
      .select()
      .from(schema.billingCredit)
      .where(eq(schema.billingCredit.organizationId, organizationId));
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ awardId: body.award.id, status: 'issued' });
  });
});

describe('discount approval provider failures', () => {
  it('reopens the failed award when finance retries the same confirmation', async () => {
    const { applicationId } = await seedApplication(schema);
    vi.spyOn(getContainer().billing, 'createDiscountCoupon').mockRejectedValueOnce(
      new Error('Stripe timeout'),
    );
    const { app } = await staffApp(schema, admin, 'finance');
    const { confirmation } = await previewApproval(app, applicationId);

    const failed = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation,
      reason: 'Verified.',
    });
    expect(failed.status).toBe(409);
    await expect(readJson<ProblemBody>(failed)).resolves.toMatchObject({
      code: 'billing_provider_sync_failed',
    });
    const failedAward = one(
      await db
        .select()
        .from(schema.billingDiscountAward)
        .where(eq(schema.billingDiscountAward.applicationId, applicationId)),
    );
    expect(failedAward.status).toBe('provider_failed');

    const retried = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation,
      reason: 'Verified on retry.',
    });

    expect(retried.status).toBe(200);
    await expect(readJson<ApprovalBody>(retried)).resolves.toMatchObject({
      award: { id: failedAward.id, status: 'scheduled' },
    });
  });

  it('records a failed provider operation when Stripe rejects without an error object', async () => {
    const { applicationId } = await seedApplication(schema);
    vi.spyOn(getContainer().billing, 'createDiscountCoupon').mockRejectedValueOnce('unavailable');
    const { app } = await staffApp(schema, admin, 'finance');
    const { confirmation } = await previewApproval(app, applicationId);

    const res = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation,
      reason: 'Verified.',
    });

    expect(res.status).toBe(409);
    const award = one(
      await db
        .select()
        .from(schema.billingDiscountAward)
        .where(eq(schema.billingDiscountAward.applicationId, applicationId)),
    );
    expect(award.status).toBe('provider_failed');
    const sync = one(
      await db
        .select()
        .from(schema.billingProviderSync)
        .where(eq(schema.billingProviderSync.awardId, award.id)),
    );
    expect(sync.status).toBe('failed');
    expect(sync.lastError).toEqual(expect.any(String));
  });
});

describe('renewal approvals on a paid subscription', () => {
  it('refuses a renewal when the current award never confirmed a Stripe coupon', async () => {
    const { applicationId, organizationId } = await seedApplication(schema);
    await seedAward(schema, { organizationId, programKey: 'student', providerCouponId: null });
    stubSubscription(organizationId);
    const { app } = await staffApp(schema, admin, 'finance');
    const preview = await previewApproval(app, applicationId);
    expect(preview.providerAction).toBe('renew_existing');

    const res = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation: preview.confirmation,
      reason: 'Renewed eligibility.',
    });

    expect(res.status).toBe(409);
    await expect(readJson<ProblemBody>(res)).resolves.toMatchObject({
      code: 'billing_provider_sync_failed',
    });
  });

  it('reattaches the current coupon when Stripe no longer shows the discount', async () => {
    const { applicationId, organizationId } = await seedApplication(schema);
    const award = await seedAward(schema, {
      organizationId,
      programKey: 'student',
      providerCouponId: 'coupon_current',
    });
    stubSubscription(organizationId);
    const apply = vi
      .spyOn(getContainer().billing, 'applySubscriptionDiscount')
      .mockResolvedValue({ discountId: 'di_reattached' });
    const { app } = await staffApp(schema, admin, 'finance');
    const preview = await previewApproval(app, applicationId);

    const res = await postJson(app, `/discount-applications/${applicationId}/approvals`, {
      confirmation: preview.confirmation,
      reason: 'Renewed eligibility.',
    });

    expect(res.status).toBe(200);
    await expect(readJson<ApprovalBody>(res)).resolves.toMatchObject({
      application: { status: 'approved' },
      award: { id: award.id, status: 'active', providerDiscountId: 'di_reattached' },
    });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ referenceId: organizationId, couponId: 'coupon_current' }),
    );
  });
});

describe('award renewals', () => {
  it('refuses to extend a public award without a pending renewal application', async () => {
    const organizationId = await seedBillingOrg(schema, true);
    const award = await seedAward(schema, { organizationId, programKey: 'student' });
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/awards/${award.id}/renewals`, {
      reason: 'Renew.',
    });

    expect(res.status).toBe(409);
    expect((await awardRow(award.id)).endsAt).toEqual(award.endsAt);
  });

  it('extends a public award by its review term and approves the renewal application', async () => {
    const { applicationId, organizationId } = await seedApplication(schema);
    const award = await seedAward(schema, { organizationId, programKey: 'student' });
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/awards/${award.id}/renewals`, {
      reason: 'Renewed eligibility.',
    });

    expect(res.status).toBe(200);
    const body = await readJson<AwardBody>(res);
    expect(body.status).toBe('scheduled');
    expect(new Date(body.endsAt).getTime()).toBeGreaterThan(award.endsAt.getTime());
    const application = one(
      await db
        .select()
        .from(schema.billingDiscountApplication)
        .where(eq(schema.billingDiscountApplication.id, applicationId)),
    );
    expect(application.status).toBe('approved');
  });

  it('reattaches a public award on a paid subscription under its renewal application', async () => {
    const { applicationId, organizationId } = await seedApplication(schema);
    const award = await seedAward(schema, {
      organizationId,
      programKey: 'student',
      providerCouponId: 'coupon_public',
    });
    stubSubscription(organizationId);
    const apply = vi
      .spyOn(getContainer().billing, 'applySubscriptionDiscount')
      .mockResolvedValue({ discountId: 'di_public_renewal' });
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/awards/${award.id}/renewals`, {
      reason: 'Renewed eligibility.',
    });

    expect(res.status).toBe(200);
    await expect(readJson<AwardBody>(res)).resolves.toMatchObject({
      status: 'active',
      providerDiscountId: 'di_public_renewal',
    });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `discount-award:${award.id}:renew:${applicationId}`,
      }),
    );
  });

  it('reattaches a private award on a paid subscription under its new end date', async () => {
    const organizationId = await seedBillingOrg(schema);
    const award = await seedAward(schema, { organizationId, providerCouponId: 'coupon_partner' });
    stubSubscription(organizationId);
    const apply = vi
      .spyOn(getContainer().billing, 'applySubscriptionDiscount')
      .mockResolvedValue({ discountId: 'di_partner_renewal' });
    const endsAt = monthsFromNow(12).toISOString();
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/awards/${award.id}/renewals`, {
      reason: 'Partner agreement renewed.',
      endsAt,
    });

    expect(res.status).toBe(200);
    await expect(readJson<AwardBody>(res)).resolves.toMatchObject({
      status: 'active',
      endsAt,
      providerDiscountId: 'di_partner_renewal',
    });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `discount-award:${award.id}:renew:${endsAt}` }),
    );
  });

  it('refuses to renew a private award on a paid subscription without a confirmed coupon', async () => {
    const organizationId = await seedBillingOrg(schema);
    const award = await seedAward(schema, { organizationId, providerCouponId: null });
    stubSubscription(organizationId);
    const apply = vi.spyOn(getContainer().billing, 'applySubscriptionDiscount');
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/awards/${award.id}/renewals`, {
      reason: 'Partner agreement renewed.',
      endsAt: monthsFromNow(12).toISOString(),
    });

    expect(res.status).toBe(409);
    await expect(readJson<ProblemBody>(res)).resolves.toMatchObject({
      code: 'billing_provider_sync_failed',
    });
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('award revocations', () => {
  it('refuses to revoke an award that already ended', async () => {
    const organizationId = await seedBillingOrg(schema);
    const award = await seedAward(schema, { organizationId, status: 'revoked' });
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/awards/${award.id}/revocations`, {
      reason: 'Revoke again.',
    });

    expect(res.status).toBe(409);
  });

  it('revokes an award that never reached Stripe without calling the provider', async () => {
    const organizationId = await seedBillingOrg(schema);
    const award = await seedAward(schema, { organizationId, status: 'scheduled' });
    const remove = vi.spyOn(getContainer().billing, 'removeSubscriptionDiscount');
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/awards/${award.id}/revocations`, {
      reason: 'Agreement withdrawn.',
    });

    expect(res.status).toBe(200);
    await expect(readJson<AwardBody>(res)).resolves.toMatchObject({
      id: award.id,
      status: 'revoked',
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the award current when Stripe does not confirm the removal', async () => {
    const organizationId = await seedBillingOrg(schema);
    const award = await seedAward(schema, { organizationId, providerCouponId: 'coupon_live' });
    vi.spyOn(getContainer().billing, 'removeSubscriptionDiscount').mockRejectedValue(
      new Error('Stripe unavailable'),
    );
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/discount-applications/awards/${award.id}/revocations`, {
      reason: 'Agreement ended.',
    });

    expect(res.status).toBe(409);
    await expect(readJson<ProblemBody>(res)).resolves.toMatchObject({
      code: 'billing_provider_sync_failed',
    });
    expect((await awardRow(award.id)).status).toBe('active');
  });
});

describe('discount evidence downloads', () => {
  it('returns not found when the evidence file is missing from storage', async () => {
    const { applicationId } = await seedApplication(schema);
    const evidenceId = `evidence_${Math.random().toString(36).slice(2)}`;
    await db.insert(schema.billingDiscountEvidence).values({
      id: evidenceId,
      applicationId,
      evidenceType: 'enrollment_document',
      blobKey: `test-discount-evidence/missing/${evidenceId}`,
      fileName: 'proof.pdf',
      mimeType: 'application/pdf',
      byteSize: 3,
      deleteAfter: monthsFromNow(3),
    });
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await app.request(`/discount-applications/${applicationId}/evidence/${evidenceId}`);

    expect(res.status).toBe(404);
  });

  it('names an unnamed evidence file generically in the download', async () => {
    const { applicationId } = await seedApplication(schema);
    const evidenceId = `evidence_${Math.random().toString(36).slice(2)}`;
    const blobKey = `test-discount-evidence/${evidenceId}`;
    await getContainer().blob.put(blobKey, new Uint8Array([4, 5]), 'image/png');
    await db.insert(schema.billingDiscountEvidence).values({
      id: evidenceId,
      applicationId,
      evidenceType: 'enrollment_document',
      blobKey,
      fileName: null,
      mimeType: 'image/png',
      byteSize: 2,
      deleteAfter: monthsFromNow(3),
    });
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await app.request(`/discount-applications/${applicationId}/evidence/${evidenceId}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="evidence"');
    await expect(res.arrayBuffer()).resolves.toEqual(new Uint8Array([4, 5]).buffer);
  });
});
