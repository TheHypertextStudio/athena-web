/**
 * Staff billing diagnostics and revenue actions on one organization under `/admin/orgs`.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { getContainer } from '../../src/container';
import type { AdminOrgBillingStateOut } from '../../src/routes/admin-billing-routes';
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

/** The parts of a partner preview a later grant needs. */
interface PartnerPreviewBody {
  readonly confirmation: string;
  readonly providerAction: string;
  readonly credit: unknown;
}

/** The parts of a partner award response these scenarios inspect. */
interface PartnerAwardBody {
  readonly id: string;
  readonly status: string;
  readonly providerDiscountId: string | null;
}

/** A valid partner award request body. */
interface PartnerInput {
  readonly percentOff: number;
  readonly endsAt: string;
  readonly reason: string;
}

/** A twelve-month partner award at 25% off. */
function partnerInput(): PartnerInput {
  return {
    percentOff: 25,
    endsAt: monthsFromNow(12).toISOString(),
    reason: 'Launch partner agreement.',
  };
}

/** A recurring invoice line whose paid period spans the given day offsets from now. */
function invoiceFor(organizationId: string, startDays: number, endDays: number) {
  const day = 24 * 60 * 60 * 1000;
  return {
    invoiceId: `in_${organizationId}`,
    lineId: `il_${organizationId}`,
    invoiceStatus: 'paid' as const,
    currency: 'usd',
    recurringAmount: 800,
    periodStartsAt: new Date(Date.now() + startDays * day).toISOString(),
    periodEndsAt: new Date(Date.now() + endDays * day).toISOString(),
  };
}

/** The eligibility-check ledger row a complimentary grant writes for one organization. */
async function eligibilitySync(
  organizationId: string,
): Promise<typeof DbModule.billingProviderSync.$inferSelect> {
  return one(
    await db
      .select()
      .from(schema.billingProviderSync)
      .where(
        and(
          eq(schema.billingProviderSync.organizationId, organizationId),
          eq(schema.billingProviderSync.operation, 'verify_complimentary_eligibility'),
        ),
      ),
  );
}

/** Whether an organization holds any billing exemption row. */
async function exemptionCount(organizationId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.billingExemption)
    .where(eq(schema.billingExemption.organizationId, organizationId));
  return rows.length;
}

describe('GET /orgs/:id/billing-state', () => {
  it('shows support an organization with no billing history and no revenue authority', async () => {
    const organizationId = await seedBillingOrg(schema);
    const { app } = await staffApp(schema, admin, 'support');

    const res = await app.request(`/orgs/${organizationId}/billing-state`);

    expect(res.status).toBe(200);
    await expect(readJson<AdminOrgBillingStateOut>(res)).resolves.toEqual({
      permissions: { manageDiscounts: false, manageComplimentary: false },
      customer: null,
      entitlement: null,
      reconciliation: null,
      application: null,
      award: null,
      credit: null,
    });
  });

  it('shows finance the customer, entitlement, reconciliation, discount, and credit', async () => {
    const { applicationId, organizationId } = await seedApplication(schema, 'nonprofit');
    const observedAt = new Date('2026-09-01T00:00:00.000Z');
    await db.insert(schema.organizationBillingAccount).values({
      organizationId,
      stripeCustomerId: `cus_${organizationId}`,
      billingCountry: 'US',
      countryVerifiedAt: observedAt,
      trialConsumedAt: observedAt,
    });
    await db.insert(schema.organizationProductEntitlement).values({
      organizationId,
      productKey: 'docket_pro',
      status: 'past_due',
      source: 'stripe',
      stripeSubscriptionId: `sub_${organizationId}`,
      currentPeriodEnd: observedAt,
      graceEndsAt: observedAt,
      providerObservedAt: observedAt,
    });
    await db.insert(schema.billingProviderSync).values({
      organizationId,
      operation: 'reconcile_billing',
      status: 'failed',
      idempotencyKey: `reconcile:${organizationId}`,
      lastError: 'provider timeout',
    });
    const award = await seedAward(schema, {
      organizationId,
      applicationId,
      programKey: 'nonprofit',
    });
    await db.insert(schema.billingCredit).values({
      organizationId,
      awardId: award.id,
      status: 'issued',
      currency: 'usd',
      baseAmount: 400,
      taxAmount: 0,
      totalAmount: 400,
      servicePeriodStartsAt: observedAt,
      servicePeriodEndsAt: monthsFromNow(1),
      providerInvoiceId: `in_${organizationId}`,
      providerCreditNoteId: `cn_${organizationId}`,
    });
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await app.request(`/orgs/${organizationId}/billing-state`);

    expect(res.status).toBe(200);
    await expect(readJson<AdminOrgBillingStateOut>(res)).resolves.toMatchObject({
      permissions: { manageDiscounts: true, manageComplimentary: false },
      customer: {
        stripeCustomerId: `cus_${organizationId}`,
        billingCountry: 'US',
        countryVerifiedAt: observedAt.toISOString(),
        trialConsumedAt: observedAt.toISOString(),
      },
      entitlement: {
        source: 'stripe',
        status: 'past_due',
        currentPeriodEnd: observedAt.toISOString(),
        graceEndsAt: observedAt.toISOString(),
        providerObservedAt: observedAt.toISOString(),
      },
      reconciliation: { status: 'failed', lastError: 'provider timeout' },
      application: { id: applicationId, programKey: 'nonprofit', status: 'submitted' },
      award: { id: award.id, programKey: 'nonprofit' },
      credit: { status: 'issued', totalAmount: 400, providerCreditNoteId: `cn_${organizationId}` },
    });
  });

  it('shows a superadmin a complimentary grant whose provider dates were never set', async () => {
    const organizationId = await seedBillingOrg(schema);
    await db.insert(schema.organizationBillingAccount).values({ organizationId });
    await db.insert(schema.organizationProductEntitlement).values({
      organizationId,
      productKey: 'docket_pro',
      status: 'active',
      source: 'complimentary',
    });
    const { app } = await staffApp(schema, admin, 'superadmin');

    const res = await app.request(`/orgs/${organizationId}/billing-state`);

    expect(res.status).toBe(200);
    await expect(readJson<AdminOrgBillingStateOut>(res)).resolves.toMatchObject({
      permissions: { manageDiscounts: true, manageComplimentary: true },
      customer: { stripeCustomerId: null, countryVerifiedAt: null, trialConsumedAt: null },
      entitlement: {
        source: 'complimentary',
        currentPeriodEnd: null,
        graceEndsAt: null,
        providerObservedAt: null,
      },
    });
  });
});

describe('private partner award previews and grants', () => {
  it('grants a partner award on a paid subscription and issues the previewed credit', async () => {
    const organizationId = await seedBillingOrg(schema);
    vi.spyOn(getContainer().billing, 'listSubscriptions').mockResolvedValue([
      activeSubscription(organizationId),
    ]);
    vi.spyOn(getContainer().billing, 'getLatestRecurringInvoice').mockResolvedValue(
      invoiceFor(organizationId, -15, 15),
    );
    const apply = vi
      .spyOn(getContainer().billing, 'applySubscriptionDiscount')
      .mockResolvedValue({ discountId: 'di_partner' });
    const { app } = await staffApp(schema, admin, 'finance');
    const input = partnerInput();

    const previewRes = await postJson(
      app,
      `/orgs/${organizationId}/discount-awards/preview`,
      input,
    );
    expect(previewRes.status).toBe(200);
    const preview = await readJson<PartnerPreviewBody>(previewRes);
    expect(preview.providerAction).toBe('apply_to_subscription');
    expect(preview.credit).not.toBeNull();

    const res = await postJson(app, `/orgs/${organizationId}/discount-awards`, {
      ...input,
      confirmation: preview.confirmation,
    });

    expect(res.status).toBe(200);
    const award = await readJson<PartnerAwardBody>(res);
    expect(award).toMatchObject({ status: 'active', providerDiscountId: 'di_partner' });
    expect(apply).toHaveBeenCalledOnce();
    const credits = await db
      .select()
      .from(schema.billingCredit)
      .where(eq(schema.billingCredit.awardId, award.id));
    expect(credits).toHaveLength(1);
    expect(credits[0]?.status).toBe('issued');
  });

  it('previews no credit when the latest paid period has already ended', async () => {
    const organizationId = await seedBillingOrg(schema);
    vi.spyOn(getContainer().billing, 'getLatestRecurringInvoice').mockResolvedValue(
      invoiceFor(organizationId, -60, -30),
    );
    const previewCredit = vi.spyOn(getContainer().billing, 'previewCreditNote');
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(
      app,
      `/orgs/${organizationId}/discount-awards/preview`,
      partnerInput(),
    );

    expect(res.status).toBe(200);
    await expect(readJson<PartnerPreviewBody>(res)).resolves.toMatchObject({
      providerAction: 'attach_at_checkout',
      credit: null,
    });
    expect(previewCredit).not.toHaveBeenCalled();
  });

  it('refuses a grant whose confirmation does not name a stored preview', async () => {
    const organizationId = await seedBillingOrg(schema);
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/orgs/${organizationId}/discount-awards`, {
      ...partnerInput(),
      confirmation: 'preview_missing',
    });

    expect(res.status).toBe(412);
    await expect(readJson<ProblemBody>(res)).resolves.toMatchObject({
      code: 'precondition_failed',
    });
    const awards = await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.organizationId, organizationId));
    expect(awards).toHaveLength(0);
  });

  it('records a retryable failure when Stripe rejects without an error object', async () => {
    const organizationId = await seedBillingOrg(schema);
    vi.spyOn(getContainer().billing, 'createDiscountCoupon').mockRejectedValueOnce('unavailable');
    const { app } = await staffApp(schema, admin, 'finance');
    const input = partnerInput();
    const preview = await readJson<PartnerPreviewBody>(
      await postJson(app, `/orgs/${organizationId}/discount-awards/preview`, input),
    );

    const res = await postJson(app, `/orgs/${organizationId}/discount-awards`, {
      ...input,
      confirmation: preview.confirmation,
    });

    expect(res.status).toBe(409);
    await expect(readJson<ProblemBody>(res)).resolves.toMatchObject({
      code: 'billing_provider_sync_failed',
    });
    const award = one(
      await db
        .select()
        .from(schema.billingDiscountAward)
        .where(eq(schema.billingDiscountAward.organizationId, organizationId)),
    );
    expect(award.status).toBe('provider_failed');
    expect(award.providerSyncError).toEqual(expect.any(String));
  });
});

describe('POST /orgs/:id/billing-exemption provider checks', () => {
  it('refuses complimentary access while Stripe reports a subscription Docket has not mirrored', async () => {
    const organizationId = await seedBillingOrg(schema);
    vi.spyOn(getContainer().billing, 'listSubscriptions').mockResolvedValue([
      activeSubscription(organizationId),
    ]);
    const { app } = await staffApp(schema, admin, 'superadmin');

    const res = await postJson(app, `/orgs/${organizationId}/billing-exemption`, {
      reason: 'Founder access',
    });

    expect(res.status).toBe(409);
    expect((await eligibilitySync(organizationId)).status).toBe('succeeded');
    expect(await exemptionCount(organizationId)).toBe(0);
  });

  it('records a failed eligibility check when Stripe reports two current subscriptions', async () => {
    const organizationId = await seedBillingOrg(schema);
    vi.spyOn(getContainer().billing, 'listSubscriptions').mockResolvedValue([
      activeSubscription(organizationId, { id: 'sub_first' }),
      activeSubscription(organizationId, { id: 'sub_second' }),
    ]);
    const { app } = await staffApp(schema, admin, 'superadmin');

    const res = await postJson(app, `/orgs/${organizationId}/billing-exemption`, {
      reason: 'Founder access',
    });

    expect(res.status).toBe(409);
    await expect(readJson<ProblemBody>(res)).resolves.toMatchObject({
      code: 'billing_provider_sync_failed',
    });
    const sync = await eligibilitySync(organizationId);
    expect(sync.status).toBe('failed');
    expect(sync.lastError).toEqual(expect.any(String));
    expect(await exemptionCount(organizationId)).toBe(0);
  });

  it('records a failed eligibility check when Stripe rejects without an error object', async () => {
    const organizationId = await seedBillingOrg(schema);
    vi.spyOn(getContainer().billing, 'listSubscriptions').mockRejectedValueOnce('unavailable');
    const { app } = await staffApp(schema, admin, 'superadmin');

    const res = await postJson(app, `/orgs/${organizationId}/billing-exemption`, {
      reason: 'Founder access',
    });

    expect(res.status).toBe(409);
    const sync = await eligibilitySync(organizationId);
    expect(sync.status).toBe('failed');
    expect(sync.lastError).toEqual(expect.any(String));
    expect(await exemptionCount(organizationId)).toBe(0);
  });
});

describe('POST /orgs/:id/extend-trial', () => {
  it('refuses to extend a paid subscription that is not in trial', async () => {
    const organizationId = await seedBillingOrg(schema);
    vi.spyOn(getContainer().billing, 'listSubscriptions').mockResolvedValue([
      activeSubscription(organizationId),
    ]);
    const extend = vi.spyOn(getContainer().billing, 'extendTrial');
    const { app } = await staffApp(schema, admin, 'finance');

    const res = await postJson(app, `/orgs/${organizationId}/extend-trial`, { days: 7 });

    expect(res.status).toBe(409);
    expect(extend).not.toHaveBeenCalled();
  });
});
