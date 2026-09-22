/**
 * Shared fixtures for the staff finance routes: staff callers, discount applications, and the
 * provider snapshots the in-memory billing gateway is stubbed to report.
 */
import type { Subscription } from '@docket/billing/contracts';
import type * as DbModule from '@docket/db';
import type { Hono } from 'hono';

import type { AppEnv } from '../../src/context';
import { appWithSession, fakeSession, getDb, one, seedOrg, seedStaffUser } from './routes-harness';

/** A staff tier that can reach the admin router. */
export type StaffRole = 'support' | 'finance' | 'superadmin';

/** The admin router mounted behind one staff member's session. */
export interface StaffApp {
  readonly app: Hono<AppEnv>;
  readonly staffUserId: string;
}

/** A seeded discount application and the workspace it belongs to. */
export interface SeededApplication {
  readonly applicationId: string;
  readonly organizationId: string;
}

/** Load the migrated database module and the admin router. */
export async function loadAdmin(): Promise<{ schema: typeof DbModule; admin: unknown }> {
  const schema = await getDb();
  const admin = (await import('../../src/app')).adminRouter;
  return { schema, admin };
}

/** Mount the admin router for a freshly seeded staff member of the given tier. */
export async function staffApp(
  schema: typeof DbModule,
  admin: unknown,
  role: StaffRole,
): Promise<StaffApp> {
  const staff = await seedStaffUser(schema.db, schema, role);
  return {
    app: appWithSession(admin, fakeSession(staff.userId)),
    staffUserId: staff.staffUserId,
  };
}

/** Send a JSON POST through a mounted app. */
export function postJson(app: Hono<AppEnv>, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

/** Parse a JSON response body as the given shape. */
export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** An ISO timestamp the given number of calendar months from now. */
export function monthsFromNow(months: number): Date {
  const value = new Date();
  value.setUTCMonth(value.getUTCMonth() + months);
  return value;
}

/** Seed a workspace with no billing product, so no entitlement masks the provider state. */
export async function seedBillingOrg(schema: typeof DbModule, isPersonal = false): Promise<string> {
  return seedOrg(schema.db, schema, isPersonal, false);
}

/** Seed a submitted discount application with its submission event. */
export async function seedApplication(
  schema: typeof DbModule,
  programKey: 'student' | 'nonprofit' = 'student',
): Promise<SeededApplication> {
  const db = schema.db;
  const organizationId = await seedBillingOrg(schema, programKey === 'student');
  const applicantUserId = one(
    await db
      .insert(schema.user)
      .values({
        name: 'Applicant',
        email: `applicant-${Math.random().toString(36).slice(2)}@x.test`,
      })
      .returning({ id: schema.user.id }),
  ).id;
  const application = one(
    await db
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
      .returning(),
  );
  await db.insert(schema.billingDiscountApplicationEvent).values({
    applicationId: application.id,
    type: 'submitted',
    actorUserId: applicantUserId,
  });
  return { applicationId: application.id, organizationId };
}

/** The award columns a scenario chooses; the rest describe a current six-month partner term. */
export type AwardSeed = Pick<typeof DbModule.billingDiscountAward.$inferInsert, 'organizationId'> &
  Partial<typeof DbModule.billingDiscountAward.$inferInsert>;

/** Insert a discount award, defaulting to an active award that ends in six months. */
export async function seedAward(
  schema: typeof DbModule,
  values: AwardSeed,
): Promise<typeof DbModule.billingDiscountAward.$inferSelect> {
  const endsAt = monthsFromNow(6);
  return one(
    await schema.db
      .insert(schema.billingDiscountAward)
      .values({
        percentOff: 25,
        status: 'active',
        startsAt: new Date(),
        endsAt,
        reviewAt: endsAt,
        reason: 'Seeded award.',
        ...values,
      })
      .returning(),
  );
}

/**
 * A current provider subscription with no Docket-owned discount.
 *
 * @remarks
 * Deliberately omits `customerId` and `cancelAtPeriodEnd`: Stripe does not always return them, and
 * the preview fingerprint must still be stable when they are absent.
 */
export function activeSubscription(
  organizationId: string,
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id: `sub_${organizationId}`,
    referenceId: organizationId,
    status: 'active',
    currentPeriodEnd: monthsFromNow(1).toISOString(),
    ...overrides,
  };
}
