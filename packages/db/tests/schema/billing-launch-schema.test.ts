/** Storage invariants for launch-safe organization billing. */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  billingCheckoutAttempt,
  billingCredit,
  billingDiscountApplication,
  billingDiscountAward,
  billingDiscountProgram,
  billingProviderEvent,
  fullSchema,
  organization,
  organizationBillingAccount,
  user,
} from '../../src';

let client!: PGlite;
const db = drizzle(new PGlite('memory://'), { schema: fullSchema });

describe('billing launch schema', () => {
  beforeAll(async () => {
    client = db.$client;
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => {
    await client.close();
  });

  it('enforces one provider customer and one open Checkout attempt per organization', async () => {
    const [org] = await db
      .insert(organization)
      .values({ name: 'Billing test', slug: `billing-${Date.now()}`, lifecycleState: 'active' })
      .returning({ id: organization.id });
    if (!org) throw new Error('Organization insertion returned no row');

    await db
      .insert(organizationBillingAccount)
      .values({ organizationId: org.id, stripeCustomerId: 'cus_launch_test' });
    await expect(
      db
        .insert(organizationBillingAccount)
        .values({ organizationId: org.id, stripeCustomerId: 'cus_duplicate' }),
    ).rejects.toBeDefined();

    await db.insert(billingCheckoutAttempt).values({
      organizationId: org.id,
      productKey: 'docket_pro',
      status: 'open',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    await expect(
      db.insert(billingCheckoutAttempt).values({
        organizationId: org.id,
        productKey: 'docket_pro',
        status: 'creating',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeDefined();
  });

  it('claims each provider event id once', async () => {
    const event = {
      providerEventId: 'evt_launch_unique',
      type: 'customer.subscription.updated',
      providerCreatedAt: new Date('2026-08-25T00:00:00.000Z'),
    };
    await db.insert(billingProviderEvent).values(event);
    await expect(db.insert(billingProviderEvent).values(event)).rejects.toBeDefined();
  });

  it('stores one audit row for each issued provider credit note', async () => {
    const [org] = await db
      .insert(organization)
      .values({ name: 'Credit test', slug: `credit-${Date.now()}`, lifecycleState: 'active' })
      .returning({ id: organization.id });
    if (!org) throw new Error('Organization insertion returned no row');
    const [award] = await db
      .insert(billingDiscountAward)
      .values({
        organizationId: org.id,
        percentOff: 25,
        status: 'active',
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2027-08-01T00:00:00.000Z'),
        reviewAt: new Date('2027-08-01T00:00:00.000Z'),
        reason: 'Credit identity test',
      })
      .returning({ id: billingDiscountAward.id });
    if (!award) throw new Error('Award insertion returned no row');
    const credit = {
      organizationId: org.id,
      awardId: award.id,
      status: 'issued' as const,
      currency: 'usd',
      baseAmount: 100,
      taxAmount: 0,
      totalAmount: 100,
      servicePeriodStartsAt: new Date('2026-08-01T00:00:00.000Z'),
      servicePeriodEndsAt: new Date('2026-09-01T00:00:00.000Z'),
      providerInvoiceId: 'in_credit_identity',
      providerCreditNoteId: 'cn_credit_identity',
      issuedAt: new Date('2026-08-15T00:00:00.000Z'),
    };

    await db.insert(billingCredit).values(credit);
    await expect(db.insert(billingCredit).values(credit)).rejects.toBeDefined();
  });

  it('prevents stacked awards and duplicate in-review applications', async () => {
    const [org] = await db
      .insert(organization)
      .values({ name: 'Discount test', slug: `discount-${Date.now()}`, lifecycleState: 'active' })
      .returning({ id: organization.id });
    if (!org) throw new Error('Organization insertion returned no row');
    await db.insert(user).values({
      id: 'discount-application-user',
      name: 'Application Test',
      email: `application-${Date.now()}@example.edu`,
      emailVerified: true,
    });
    const programs = await db.select().from(billingDiscountProgram);
    expect(programs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'student', percentOff: 50, reviewMonths: 12 }),
        expect.objectContaining({ key: 'nonprofit', percentOff: 50, reviewMonths: 12 }),
      ]),
    );

    const [submittedApplication] = await db
      .insert(billingDiscountApplication)
      .values({
        organizationId: org.id,
        programKey: 'student',
        applicantUserId: 'discount-application-user',
        status: 'submitted',
        updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      })
      .returning({ updatedAt: billingDiscountApplication.updatedAt });
    if (!submittedApplication) throw new Error('Application insertion returned no row');
    await expect(
      db.insert(billingDiscountApplication).values({
        organizationId: org.id,
        programKey: 'nonprofit',
        applicantUserId: 'discount-application-user',
        status: 'needs_information',
      }),
    ).rejects.toBeDefined();

    const [activeAward] = await db
      .insert(billingDiscountAward)
      .values({
        organizationId: org.id,
        programKey: 'student',
        percentOff: 50,
        status: 'active',
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: new Date('2027-08-25T00:00:00.000Z'),
        reviewAt: new Date('2027-08-25T00:00:00.000Z'),
        reason: 'Verified student',
        updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      })
      .returning({ updatedAt: billingDiscountAward.updatedAt });
    if (!activeAward) throw new Error('Award insertion returned no row');
    await expect(
      db.insert(billingDiscountAward).values({
        organizationId: org.id,
        programKey: 'nonprofit',
        percentOff: 50,
        status: 'scheduled',
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: new Date('2027-08-25T00:00:00.000Z'),
        reviewAt: new Date('2027-08-25T00:00:00.000Z'),
        reason: 'Verified nonprofit',
      }),
    ).rejects.toBeDefined();

    const [reviewedApplication] = await db
      .update(billingDiscountApplication)
      .set({ status: 'approved', decisionReason: 'Verified enrollment' })
      .where(eq(billingDiscountApplication.organizationId, org.id))
      .returning({
        status: billingDiscountApplication.status,
        updatedAt: billingDiscountApplication.updatedAt,
      });
    expect(reviewedApplication?.status).toBe('approved');
    expect(reviewedApplication?.updatedAt.getTime()).toBeGreaterThan(
      submittedApplication.updatedAt.getTime(),
    );

    const [endingAward] = await db
      .update(billingDiscountAward)
      .set({ status: 'ending' })
      .where(eq(billingDiscountAward.organizationId, org.id))
      .returning({
        status: billingDiscountAward.status,
        updatedAt: billingDiscountAward.updatedAt,
      });
    expect(endingAward?.status).toBe('ending');
    expect(endingAward?.updatedAt.getTime()).toBeGreaterThan(activeAward.updatedAt.getTime());
  });
});
