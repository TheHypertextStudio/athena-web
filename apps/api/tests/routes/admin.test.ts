import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithSession, clearDocketPro, fakeSession, getDb } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';
import { getContainer } from '../../src/container';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/app')).adminRouter;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let counter = 0;
/** A unique suffix per call (keeps emails/slugs distinct across the shared PGlite db). */
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}

/** Insert a user; returns its id. */
async function makeUser(name = 'User'): Promise<string> {
  const u = uniq();
  const rows = await db
    .insert(schema.user)
    .values({ name: `${name} ${u}`, email: `${name.toLowerCase()}-${u}@example.com` })
    .returning({ id: schema.user.id });
  return assertDefined(rows[0]).id;
}

/** Insert a staff_user keyed to a fresh user; returns { userId, staffUserId }. */
async function makeStaff(
  role: 'support' | 'finance' | 'superadmin',
): Promise<{ userId: string; staffUserId: string }> {
  const userId = await makeUser('Staff');
  const rows = await db
    .insert(schema.staffUser)
    .values({ userId, role })
    .returning({ id: schema.staffUser.id });
  return { userId, staffUserId: assertDefined(rows[0]).id };
}

/** A lifecycle state literal accepted by {@link makeOrg}. */
type LifecycleStateLiteral =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'export_window'
  | 'pending_deletion'
  | 'deleted';

/** Insert an org in the given lifecycle state; returns its id. */
async function makeOrg(
  state: LifecycleStateLiteral = 'active',
  extra: Partial<typeof schema.organization.$inferInsert> = {},
): Promise<string> {
  const u = uniq();
  const rows = await db
    .insert(schema.organization)
    .values({ name: `Org ${u}`, slug: `org-${u}`, lifecycleState: state, ...extra })
    .returning({ id: schema.organization.id });
  return assertDefined(rows[0]).id;
}

/** Create the provider trial required by the finance trial-extension action. */
async function startProviderTrial(orgId: string): Promise<void> {
  await clearDocketPro(db, schema, orgId);
  await getContainer().billing.createCheckoutSession({
    referenceId: orgId,
    customerId: `cus_${orgId}`,
    priceKey: 'docket_pro_monthly',
    successUrl: 'https://app.example/ok',
    cancelUrl: 'https://app.example/cancel',
    trialDays: 14,
  });
}

/** Read an org's lifecycle state. */
async function stateOf(id: string): Promise<string> {
  const rows = await db
    .select({ s: schema.organization.lifecycleState })
    .from(schema.organization)
    .where(eq(schema.organization.id, id))
    .limit(1);
  return assertDefined(rows[0]).s;
}

/** Count audit events of a given type for a subject id. */
async function auditCount(type: string, subjectId: string): Promise<number> {
  const rows = await db.select().from(schema.operatorAuditEvent);
  return rows.filter((r) => r.type === type && r.subjectId === subjectId).length;
}

describe('staff guard', () => {
  it('401s when there is no session', async () => {
    const app = appWithSession(admin, null);
    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('403s an authenticated non-staff user', async () => {
    const userId = await makeUser('Civilian');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(403);
  });

  it('admits a staff user', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('403s a support user on a finance-only billing action', async () => {
    const { userId } = await makeStaff('support');
    const orgId = await makeOrg('export_window');
    await startProviderTrial(orgId);
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/extend-trial`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 7 }),
    });
    expect(res.status).toBe(403);
  });

  it('admits a finance user on a finance-only action, and superadmin too', async () => {
    const orgA = await makeOrg('export_window');
    const orgB = await makeOrg('export_window');
    await startProviderTrial(orgA);
    await startProviderTrial(orgB);
    const fin = await makeStaff('finance');
    const sup = await makeStaff('superadmin');
    expect(
      (
        await appWithSession(admin, fakeSession(fin.userId)).request(`/orgs/${orgA}/extend-trial`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ days: 7 }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await appWithSession(admin, fakeSession(sup.userId)).request(`/orgs/${orgB}/extend-trial`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ days: 7 }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('discount application review', () => {
  async function makeApplication(programKey: 'student' | 'nonprofit' = 'student') {
    const applicantUserId = await makeUser('Applicant');
    const organizationId = await makeOrg('active', { isPersonal: programKey === 'student' });
    const [application] = await db
      .insert(schema.billingDiscountApplication)
      .values({
        organizationId,
        programKey,
        applicantUserId,
        status: 'submitted',
        evidenceType: programKey === 'student' ? 'institutional_email' : 'irs_registry',
        institutionalEmail: programKey === 'student' ? 'applicant@unlv.edu' : null,
        ein: programKey === 'nonprofit' ? '12-3456789' : null,
      })
      .returning();
    const row = assertDefined(application);
    await db.insert(schema.billingDiscountApplicationEvent).values({
      applicationId: row.id,
      type: 'submitted',
      actorUserId: applicantUserId,
    });
    return { applicationId: row.id, organizationId };
  }

  it('lets support inspect the queue but reserves decisions for finance', async () => {
    const { applicationId } = await makeApplication();
    const support = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(support.userId));

    const queue = await app.request('/discount-applications');
    expect(queue.status).toBe(200);
    await expect(queue.json()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: applicationId })]),
    });

    const decision = await app.request(
      `/discount-applications/${applicationId}/information-requests`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Upload a current enrollment record.' }),
      },
    );
    expect(decision.status).toBe(403);
  });

  it('records an information request and its required audit reason', async () => {
    const { applicationId } = await makeApplication();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));

    const response = await app.request(
      `/discount-applications/${applicationId}/information-requests`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Upload a current enrollment record.' }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'needs_information',
      informationRequest: 'Upload a current enrollment record.',
    });
    expect(await auditCount('billing.discount_information_requested', applicationId)).toBe(1);
  });

  it('previews then confirms a scheduled award without claiming provider success early', async () => {
    const { applicationId, organizationId } = await makeApplication();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));

    const preview = await app.request(`/discount-applications/${applicationId}/approval-previews`, {
      method: 'POST',
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { confirmation: string };
    expect(previewBody).toMatchObject({
      percentOff: 50,
      reviewMonths: 12,
      credit: null,
    });

    const approved = await app.request(`/discount-applications/${applicationId}/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Institutional email is current.',
        confirmation: previewBody.confirmation,
      }),
    });
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({
      application: { status: 'approved' },
      award: { organizationId, percentOff: 50, status: 'scheduled' },
    });
    const [award] = await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.applicationId, applicationId));
    expect(award?.providerCouponId).toMatch(/^coupon_/);
    expect(await auditCount('billing.discount_approved', applicationId)).toBe(1);
  });

  it('rejects approval when the Stripe subscription changes after preview', async () => {
    const { applicationId, organizationId } = await makeApplication();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const preview = await app.request(`/discount-applications/${applicationId}/approval-previews`, {
      method: 'POST',
    });
    const { confirmation } = await json<{ confirmation: string }>(preview);
    await startProviderTrial(organizationId);

    const approved = await app.request(`/discount-applications/${applicationId}/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Verified.', confirmation }),
    });

    expect(approved.status).toBe(412);
    await expect(approved.json()).resolves.toMatchObject({ code: 'precondition_failed' });
  });

  it('refuses to preview a public award over an unknown Stripe discount', async () => {
    const { applicationId, organizationId } = await makeApplication();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const getSubscription = vi.spyOn(getContainer().billing, 'getSubscription').mockResolvedValue({
      id: 'sub_external_discount',
      customerId: `cus_${organizationId}`,
      referenceId: organizationId,
      status: 'active',
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      discountIds: ['di_external'],
      couponIds: ['coupon_external'],
    });
    const applyDiscount = vi.spyOn(getContainer().billing, 'applySubscriptionDiscount');

    const preview = await app.request(`/discount-applications/${applicationId}/approval-previews`, {
      method: 'POST',
    });

    expect(preview.status).toBe(409);
    await expect(preview.json()).resolves.toMatchObject({ code: 'discount_award_conflict' });
    expect(applyDiscount).not.toHaveBeenCalled();
    getSubscription.mockRestore();
    applyDiscount.mockRestore();
  });
});

describe('private partner awards', () => {
  it('lets finance grant a time-bounded non-stacking partner discount', async () => {
    const organizationId = await makeOrg();
    await startProviderTrial(organizationId);
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const endsAt = new Date();
    endsAt.setUTCMonth(endsAt.getUTCMonth() + 12);
    const input = {
      percentOff: 25,
      endsAt: endsAt.toISOString(),
      reason: 'Launch partner agreement.',
    };
    const preview = await app.request(`/orgs/${organizationId}/discount-awards/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const { confirmation } = await json<{ confirmation: string }>(preview);

    const response = await app.request(`/orgs/${organizationId}/discount-awards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, confirmation }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organizationId,
      programKey: null,
      percentOff: 25,
      status: 'active',
    });
    expect(await auditCount('billing.partner_discount_granted', organizationId)).toBe(1);

    const stacked = await app.request(`/orgs/${organizationId}/discount-awards/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        percentOff: 10,
        endsAt: endsAt.toISOString(),
        reason: 'Second partner agreement.',
      }),
    });
    expect(stacked.status).toBe(409);
    await expect(stacked.json()).resolves.toMatchObject({ code: 'discount_award_conflict' });
  });

  it('rejects a partner award when Checkout completes after finance previews it', async () => {
    const organizationId = await makeOrg();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const endsAt = new Date();
    endsAt.setUTCMonth(endsAt.getUTCMonth() + 12);
    const input = {
      percentOff: 25,
      endsAt: endsAt.toISOString(),
      reason: 'Launch partner agreement.',
    };
    const preview = await app.request(`/orgs/${organizationId}/discount-awards/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const { confirmation } = await json<{ confirmation: string }>(preview);
    await startProviderTrial(organizationId);

    const response = await app.request(`/orgs/${organizationId}/discount-awards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, confirmation }),
    });

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toMatchObject({ code: 'precondition_failed' });
  });

  it('refuses to preview a partner award over an unknown Stripe discount', async () => {
    const organizationId = await makeOrg();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const endsAt = new Date();
    endsAt.setUTCMonth(endsAt.getUTCMonth() + 12);
    const getSubscription = vi.spyOn(getContainer().billing, 'getSubscription').mockResolvedValue({
      id: 'sub_external_partner_discount',
      customerId: `cus_${organizationId}`,
      referenceId: organizationId,
      status: 'active',
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      discountIds: ['di_external_partner'],
      couponIds: ['coupon_external_partner'],
    });
    const applyDiscount = vi.spyOn(getContainer().billing, 'applySubscriptionDiscount');

    const preview = await app.request(`/orgs/${organizationId}/discount-awards/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        percentOff: 25,
        endsAt: endsAt.toISOString(),
        reason: 'Launch partner agreement.',
      }),
    });

    expect(preview.status).toBe(409);
    await expect(preview.json()).resolves.toMatchObject({ code: 'discount_award_conflict' });
    expect(applyDiscount).not.toHaveBeenCalled();
    getSubscription.mockRestore();
    applyDiscount.mockRestore();
  });

  it('rejects free or longer-than-24-month partner grants', async () => {
    const organizationId = await makeOrg();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const tooLate = new Date();
    tooLate.setUTCMonth(tooLate.getUTCMonth() + 25);

    const free = await app.request(`/orgs/${organizationId}/discount-awards/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ percentOff: 100, endsAt: tooLate.toISOString(), reason: 'No.' }),
    });
    expect(free.status).toBe(422);

    const long = await app.request(`/orgs/${organizationId}/discount-awards/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ percentOff: 50, endsAt: tooLate.toISOString(), reason: 'Too long.' }),
    });
    expect(long.status).toBe(422);
  });

  it('retries one failed provider award with the same durable award and idempotency key', async () => {
    const organizationId = await makeOrg();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const endsAt = new Date();
    endsAt.setUTCMonth(endsAt.getUTCMonth() + 12);
    const input = {
      percentOff: 25,
      endsAt: endsAt.toISOString(),
      reason: 'Retryable partner agreement.',
    };
    vi.spyOn(getContainer().billing, 'createDiscountCoupon').mockRejectedValueOnce(
      new Error('Stripe timeout'),
    );
    const firstPreview = await app.request(`/orgs/${organizationId}/discount-awards/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const firstConfirmation = await json<{ confirmation: string }>(firstPreview);

    const failed = await app.request(`/orgs/${organizationId}/discount-awards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, confirmation: firstConfirmation.confirmation }),
    });
    expect(failed.status).toBe(409);
    const [failedAward] = await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.organizationId, organizationId));
    expect(failedAward?.status).toBe('provider_failed');

    const retryPreview = await app.request(`/orgs/${organizationId}/discount-awards/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const retryConfirmation = await json<{ confirmation: string }>(retryPreview);

    const retried = await app.request(`/orgs/${organizationId}/discount-awards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, confirmation: retryConfirmation.confirmation }),
    });
    expect(retried.status).toBe(200);
    const result = await json<{ id: string; status: string }>(retried);
    expect(result).toMatchObject({ id: failedAward?.id, status: 'scheduled' });
    const syncs = await db
      .select()
      .from(schema.billingProviderSync)
      .where(eq(schema.billingProviderSync.awardId, failedAward?.id ?? 'missing'));
    expect(syncs).toHaveLength(1);
    expect(syncs[0]?.attempts).toBe(2);
  });

  it('lets finance renew and revoke a current private partner award', async () => {
    const organizationId = await makeOrg();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const currentEnd = new Date();
    currentEnd.setUTCMonth(currentEnd.getUTCMonth() + 6);
    const renewedEnd = new Date();
    renewedEnd.setUTCMonth(renewedEnd.getUTCMonth() + 12);
    const [award] = await db
      .insert(schema.billingDiscountAward)
      .values({
        organizationId,
        percentOff: 25,
        status: 'active',
        startsAt: new Date(),
        endsAt: currentEnd,
        reviewAt: currentEnd,
        reason: 'Launch partner agreement.',
        providerCouponId: 'coupon_partner',
      })
      .returning();
    if (!award) throw new Error('partner award seed failed');

    const renewed = await app.request(`/discount-applications/awards/${award.id}/renewals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Partner agreement renewed.',
        endsAt: renewedEnd.toISOString(),
      }),
    });
    expect(renewed.status).toBe(200);
    await expect(renewed.json()).resolves.toMatchObject({
      id: award.id,
      reason: 'Partner agreement renewed.',
    });

    const removeDiscount = vi.spyOn(getContainer().billing, 'removeSubscriptionDiscount');
    const revoked = await app.request(`/discount-applications/awards/${award.id}/revocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Partner agreement ended.' }),
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({ id: award.id, status: 'revoked' });
    expect(removeDiscount).toHaveBeenCalledWith(
      organizationId,
      `discount-award:${award.id}:revoke`,
    );
  });

  it('refuses to renew an award over a different Stripe discount', async () => {
    const organizationId = await makeOrg();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    const currentEnd = new Date();
    currentEnd.setUTCMonth(currentEnd.getUTCMonth() + 6);
    const renewedEnd = new Date();
    renewedEnd.setUTCMonth(renewedEnd.getUTCMonth() + 12);
    const [award] = await db
      .insert(schema.billingDiscountAward)
      .values({
        organizationId,
        percentOff: 25,
        status: 'active',
        startsAt: new Date(),
        endsAt: currentEnd,
        reviewAt: currentEnd,
        reason: 'Launch partner agreement.',
        providerCouponId: 'coupon_owned',
        providerDiscountId: 'di_owned',
      })
      .returning();
    if (!award) throw new Error('partner award seed failed');
    const getSubscription = vi.spyOn(getContainer().billing, 'getSubscription').mockResolvedValue({
      id: 'sub_external_renewal_discount',
      referenceId: organizationId,
      status: 'active',
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      discountIds: ['di_external'],
      couponIds: ['coupon_external'],
    });
    const applyDiscount = vi.spyOn(getContainer().billing, 'applySubscriptionDiscount');

    const response = await app.request(`/discount-applications/awards/${award.id}/renewals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Partner agreement renewed.',
        endsAt: renewedEnd.toISOString(),
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'discount_award_conflict' });
    expect(applyDiscount).not.toHaveBeenCalled();
    getSubscription.mockRestore();
    applyDiscount.mockRestore();
  });
});

describe('users', () => {
  it('lists users (paginated) and supports search', async () => {
    const { userId } = await makeStaff('support');
    const named = await db
      .insert(schema.user)
      .values({ name: `Zephyrine ${uniq()}`, email: `zephyrine-${uniq()}@example.com` })
      .returning({ id: schema.user.id, email: schema.user.email });
    const app = appWithSession(admin, fakeSession(userId));

    // Unfiltered list (no search branch) with pagination.
    const all = await app.request('/users?limit=5&offset=0', { method: 'GET' });
    expect(all.status).toBe(200);
    const allBody = await json<{ items: unknown[]; total: number }>(all);
    expect(allBody.items.length).toBeGreaterThan(0);
    expect(allBody.total).toBeGreaterThanOrEqual(allBody.items.length);

    // Search branch (matches by name).
    const searched = await app.request('/users?search=Zephyrine', { method: 'GET' });
    const searchedBody = await json<{ items: { id: string }[]; total: number }>(searched);
    expect(searchedBody.items.some((i) => i.id === assertDefined(named[0]).id)).toBe(true);
  });

  it('gets a user with their org memberships', async () => {
    const { userId } = await makeStaff('support');
    const target = await makeUser('Member');
    const orgId = await makeOrg('active');
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Member', userId: target })
      .returning({ id: schema.actor.id });

    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/users/${target}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ user: { id: string }; memberships: { organizationId: string }[] }>(
      res,
    );
    expect(body.user.id).toBe(target);
    expect(body.memberships.some((m) => m.organizationId === orgId)).toBe(true);
  });

  it('404s an unknown user id', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/users/does-not-exist', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('orgs', () => {
  it('lists orgs unfiltered, by search, and by lifecycle state', async () => {
    const { userId } = await makeStaff('support');
    const pastDue = await makeOrg('past_due');
    const app = appWithSession(admin, fakeSession(userId));

    const unfiltered = await app.request('/orgs?limit=100', { method: 'GET' });
    expect((await json<{ total: number }>(unfiltered)).total).toBeGreaterThan(0);

    const slug = assertDefined(
      (
        await db
          .select()
          .from(schema.organization)
          .where(eq(schema.organization.id, pastDue))
          .limit(1)
      )[0],
    ).slug;
    const searched = await app.request(`/orgs?search=${slug}`, { method: 'GET' });
    expect(
      (await json<{ items: { id: string }[] }>(searched)).items.some((o) => o.id === pastDue),
    ).toBe(true);

    const filtered = await app.request('/orgs?lifecycleState=past_due', { method: 'GET' });
    const filteredBody = await json<{ items: { id: string; lifecycleState: string }[] }>(filtered);
    expect(filteredBody.items.every((o) => o.lifecycleState === 'past_due')).toBe(true);
    expect(filteredBody.items.some((o) => o.id === pastDue)).toBe(true);
  });

  it('gets an org by id (incl. export window timestamps) and 404s unknown', async () => {
    const { userId } = await makeStaff('support');
    const ew = await makeOrg('export_window', {
      exportReadyAt: new Date('2026-01-01T00:00:00.000Z'),
      deleteAfterAt: new Date('2026-01-15T00:00:00.000Z'),
    });
    const app = appWithSession(admin, fakeSession(userId));

    const res = await app.request(`/orgs/${ew}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ exportReadyAt: string | null; deleteAfterAt: string | null }>(res);
    expect(body.exportReadyAt).toBe('2026-01-01T00:00:00.000Z');
    expect(body.deleteAfterAt).toBe('2026-01-15T00:00:00.000Z');

    expect((await app.request('/orgs/nope', { method: 'GET' })).status).toBe(404);
  });
});

describe('lifecycle board', () => {
  it('groups orgs into one column per lifecycle state', async () => {
    const { userId } = await makeStaff('support');
    const active = await makeOrg('active');
    const ew = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));

    const res = await app.request('/lifecycle', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ columns: { lifecycleState: string; orgs: { id: string }[] }[] }>(res);
    const states = body.columns.map((c) => c.lifecycleState);
    expect(states).toEqual([
      'trialing',
      'active',
      'past_due',
      'export_window',
      'pending_deletion',
      'deleted',
    ]);
    const activeCol = assertDefined(body.columns.find((c) => c.lifecycleState === 'active'));
    const ewCol = assertDefined(body.columns.find((c) => c.lifecycleState === 'export_window'));
    expect(activeCol.orgs.some((o) => o.id === active)).toBe(true);
    expect(ewCol.orgs.some((o) => o.id === ew)).toBe(true);
  });
});

describe('lifecycle holds', () => {
  it('places a hold (audited), then releases it (audited)', async () => {
    const { userId } = await makeStaff('support');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));

    const placed = await app.request(`/orgs/${orgId}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'billing dispute' }),
    });
    expect(placed.status).toBe(201);
    const hold = await json<{ id: string; releasedAt: string | null }>(placed);
    expect(hold.releasedAt).toBeNull();
    expect(await auditCount('lifecycle_hold.placed', orgId)).toBe(1);

    const released = await app.request(`/orgs/${orgId}/holds/${hold.id}`, { method: 'DELETE' });
    expect(released.status).toBe(200);
    expect((await json<{ releasedAt: string | null }>(released)).releasedAt).not.toBeNull();
    expect(await auditCount('lifecycle_hold.released', orgId)).toBe(1);

    // Releasing again 404s (already released).
    expect(
      (await app.request(`/orgs/${orgId}/holds/${hold.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('404s placing a hold on an unknown org', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/orgs/missing/holds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('422s a hold with an empty reason', async () => {
    const { userId } = await makeStaff('support');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s releasing a hold that does not exist', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    expect((await app.request(`/orgs/${orgId}/holds/nope`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('billing exemptions', () => {
  it('grants (audited), then revokes (audited); double-revoke 404s', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));

    const granted = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'internal free use' }),
    });
    expect(granted.status).toBe(200);
    const exemption = await json<{ id: string; revokedAt: string | null }>(granted);
    expect(exemption.revokedAt).toBeNull();
    expect(await auditCount('billing.exemption_granted', orgId)).toBe(1);
    const [complimentaryGrant] = await db
      .select({
        status: schema.organizationProductEntitlement.status,
        source: schema.organizationProductEntitlement.source,
      })
      .from(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
    expect(complimentaryGrant).toEqual({ status: 'active', source: 'complimentary' });

    const orgAfterGrant = await app.request(`/orgs/${orgId}`, { method: 'GET' });
    expect((await json<{ isBillingExempt: boolean }>(orgAfterGrant)).isBillingExempt).toBe(true);

    const slug = assertDefined(
      (
        await db
          .select()
          .from(schema.organization)
          .where(eq(schema.organization.id, orgId))
          .limit(1)
      )[0],
    ).slug;
    const listAfterGrant = await app.request(`/orgs?search=${slug}`, { method: 'GET' });
    const listItem = (
      await json<{ items: { id: string; isBillingExempt: boolean }[] }>(listAfterGrant)
    ).items.find((o) => o.id === orgId);
    expect(listItem?.isBillingExempt).toBe(true);

    const revoked = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Founder access no longer needed' }),
    });
    expect(revoked.status).toBe(200);
    expect((await json<{ revokedAt: string | null }>(revoked)).revokedAt).not.toBeNull();
    expect(await auditCount('billing.exemption_revoked', orgId)).toBe(1);
    const [revokedGrant] = await db
      .select({ status: schema.organizationProductEntitlement.status })
      .from(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
    expect(revokedGrant?.status).toBe('canceled');

    const orgAfterRevoke = await app.request(`/orgs/${orgId}`, { method: 'GET' });
    expect((await json<{ isBillingExempt: boolean }>(orgAfterRevoke)).isBillingExempt).toBe(false);

    // Revoking again 404s (no active grant).
    expect(
      (
        await app.request(`/orgs/${orgId}/billing-exemption`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'Repeated revoke' }),
        })
      ).status,
    ).toBe(404);
  });

  it('403s a finance user (superadmin-only action)', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('404s granting on an unknown org', async () => {
    const { userId } = await makeStaff('superadmin');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/orgs/missing/billing-exemption', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('422s a grant with an empty reason', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('409s granting a second exemption while one is already active', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    const first = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'first' }),
    });
    expect(first.status).toBe(200);
    const second = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'second' }),
    });
    expect(second.status).toBe(409);
  });

  it('409s a complimentary grant while a paid Stripe subscription is current', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('active');
    await db
      .insert(schema.organizationProductEntitlement)
      .values({
        organizationId: orgId,
        productKey: 'docket_pro',
        status: 'active',
        source: 'stripe',
        stripeSubscriptionId: `sub_${orgId}`,
      })
      .onConflictDoUpdate({
        target: [
          schema.organizationProductEntitlement.organizationId,
          schema.organizationProductEntitlement.productKey,
        ],
        set: { status: 'active', source: 'stripe', stripeSubscriptionId: `sub_${orgId}` },
      });
    const app = appWithSession(admin, fakeSession(userId));

    const response = await app.request(`/orgs/${orgId}/billing-exemption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Founder production access' }),
    });

    expect(response.status).toBe(409);
  });

  it('404s revoking on an unknown org', async () => {
    const { userId } = await makeStaff('superadmin');
    const app = appWithSession(admin, fakeSession(userId));
    expect(
      (
        await app.request('/orgs/missing/billing-exemption', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'No longer eligible' }),
        })
      ).status,
    ).toBe(404);
  });
});

describe('billing actions', () => {
  it('lets finance run the safe Stripe reconciliation worker', async () => {
    const orgId = await makeOrg();
    const finance = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(finance.userId));
    await getContainer().billing.createCustomer(orgId);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: `cus_${orgId}`,
      countryVerificationRequired: false,
    });
    await startProviderTrial(orgId);

    const response = await app.request(`/orgs/${orgId}/reconcile`, { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      repaired: expect.any(Number),
      alerts: expect.any(Number),
    });
    const [entitlement] = await db
      .select()
      .from(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
    expect(entitlement).toMatchObject({ source: 'stripe', status: 'trialing' });
    expect(await auditCount('billing.reconciled', orgId)).toBe(1);
  });

  it('extends an eligible Stripe trial and reconciles the provider snapshot', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('active');
    await startProviderTrial(orgId);
    const before = await getContainer().billing.getSubscription(orgId);
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/extend-trial`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 14 }),
    });
    expect(res.status).toBe(200);
    const after = await getContainer().billing.getSubscription(orgId);
    expect(new Date(assertDefined(after?.trialEnd)).getTime()).toBe(
      new Date(assertDefined(before?.trialEnd)).getTime() + 14 * 24 * 60 * 60 * 1000,
    );
    const [entitlement] = await db
      .select()
      .from(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
    expect(entitlement).toMatchObject({ status: 'trialing', source: 'stripe' });
    expect(await stateOf(orgId)).toBe('active');
    expect(await auditCount('billing.trial_extended', orgId)).toBe(1);
  });

  it('404s extend-trial on an unknown org and 422s a bad body', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    expect(
      (
        await app.request('/orgs/missing/extend-trial', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ days: 7 }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/orgs/${orgId}/extend-trial`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ days: 0 }),
        })
      ).status,
    ).toBe(422);
  });

  it('removes finance actions that could forge paid access or schedule deletion', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));

    expect((await app.request(`/orgs/${orgId}/reactivate`, { method: 'POST' })).status).toBe(404);
    expect(
      (
        await app.request(`/orgs/${orgId}/lifecycle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lifecycleState: 'pending_deletion' }),
        })
      ).status,
    ).toBe(404);
    expect(await stateOf(orgId)).toBe('active');
  });
});

describe('impersonation', () => {
  it('starts a time-boxed session (audited) then ends it (audited)', async () => {
    const { userId } = await makeStaff('support');
    const target = await makeUser('Target');
    const app = appWithSession(admin, fakeSession(userId));

    const started = await app.request('/impersonations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: target, reason: 'support ticket #42', ttlMinutes: 30 }),
    });
    expect(started.status).toBe(201);
    const sess = await json<{
      id: string;
      targetUserId: string;
      endedAt: string | null;
      expiresAt: string;
    }>(started);
    expect(sess.targetUserId).toBe(target);
    expect(sess.endedAt).toBeNull();
    expect(new Date(sess.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(await auditCount('impersonation.started', target)).toBe(1);

    const ended = await app.request(`/impersonations/${sess.id}/end`, { method: 'POST' });
    expect(ended.status).toBe(200);
    expect((await json<{ endedAt: string | null }>(ended)).endedAt).not.toBeNull();
    expect(await auditCount('impersonation.ended', target)).toBe(1);

    // Ending again 404s.
    expect((await app.request(`/impersonations/${sess.id}/end`, { method: 'POST' })).status).toBe(
      404,
    );
  });

  it('uses the default ttl when omitted', async () => {
    const { userId } = await makeStaff('support');
    const target = await makeUser('Target');
    const app = appWithSession(admin, fakeSession(userId));
    const started = await app.request('/impersonations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: target, reason: 'default ttl' }),
    });
    expect(started.status).toBe(201);
    const sess = await json<{ expiresAt: string }>(started);
    expect(new Date(sess.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('404s impersonating an unknown target user', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/impersonations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: 'ghost', reason: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('422s a missing reason', async () => {
    const { userId } = await makeStaff('support');
    const target = await makeUser('Target');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/impersonations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: target }),
    });
    expect(res.status).toBe(422);
  });

  it('404s ending an unknown impersonation session', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    expect((await app.request('/impersonations/ghost/end', { method: 'POST' })).status).toBe(404);
  });
});

describe('audit feed and metrics', () => {
  it('returns the operator audit feed (paginated)', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));
    // Generate an audit event.
    await app.request(`/orgs/${orgId}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'feed seed' }),
    });
    const res = await app.request('/audit?limit=10&offset=0', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ items: { type: string; subjectId: string }[] }>(res);
    expect(
      body.items.some((e) => e.type === 'lifecycle_hold.placed' && e.subjectId === orgId),
    ).toBe(true);
  });

  it('returns counts: users, orgs, and orgs grouped by lifecycle state', async () => {
    const { userId } = await makeStaff('support');
    await makeOrg('trialing');
    await makeOrg('deleted');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{
      totalUsers: number;
      totalOrgs: number;
      orgsByLifecycle: { lifecycleState: string; count: number }[];
    }>(res);
    expect(body.totalUsers).toBeGreaterThan(0);
    expect(body.totalOrgs).toBeGreaterThan(0);
    const states = body.orgsByLifecycle.map((r) => r.lifecycleState);
    expect(states).toEqual([
      'trialing',
      'active',
      'past_due',
      'export_window',
      'pending_deletion',
      'deleted',
    ]);
    expect(
      assertDefined(body.orgsByLifecycle.find((r) => r.lifecycleState === 'trialing')).count,
    ).toBeGreaterThan(0);
    expect(
      assertDefined(body.orgsByLifecycle.find((r) => r.lifecycleState === 'deleted')).count,
    ).toBeGreaterThan(0);
  });
});
