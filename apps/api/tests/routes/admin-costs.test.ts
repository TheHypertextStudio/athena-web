import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';

import type {
  AdminCostDetailOut,
  AdminCostsOut,
  AdminRate,
  AdminRatesOut,
} from '../../src/admin-cost-dto';
import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedStaffUser,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/app')).adminRouter;
});

beforeEach(async () => {
  await db.delete(schema.usageDaily);
  await db.delete(schema.usageRate);
  await db.delete(schema.usageMeterRun);
});

const MONTH = '2026-03';
const DAY = '2026-03-10';

/** An admitted operator's app. */
async function operator(role: 'support' | 'finance' | 'superadmin' = 'finance') {
  const { userId, staffUserId } = await seedStaffUser(db, schema, role);
  return { app: appWithSession(admin, fakeSession(userId)), staffUserId };
}

/** Add a rate through the API. */
async function addRate(
  app: ReturnType<typeof appWithSession>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request('/costs/rates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The ranked report for the test month. */
async function readReport(
  app: ReturnType<typeof appWithSession>,
  lens: 'caused' | 'pays' = 'caused',
): Promise<AdminCostsOut> {
  const res = await app.request(`/costs?month=${MONTH}&lens=${lens}`, { method: 'GET' });
  expect(res.status).toBe(200);
  return (await res.json()) as AdminCostsOut;
}

describe('cost report access', () => {
  it('refuses an anonymous caller, a non-operator and the support tier', async () => {
    expect((await appWithSession(admin, null).request('/costs')).status).toBe(401);

    const civilian = await seedUserWithHub(db, schema, 'Civilian');
    const civilianApp = appWithSession(admin, fakeSession(civilian));
    expect((await civilianApp.request('/costs')).status).toBe(403);

    const { app } = await operator('support');
    expect((await app.request('/costs')).status).toBe(403);
    expect((await app.request('/costs/rates')).status).toBe(403);
  });
});

describe('rate card', () => {
  it('adds a rate, audits it, and lists newest first', async () => {
    const { app, staffUserId } = await operator('finance');

    const first = await addRate(app, {
      resource: 'ai_input_tokens',
      microsPerMillionUnits: 3_000_000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      note: 'list price',
    });
    const second = await addRate(app, {
      resource: 'ai_input_tokens',
      microsPerMillionUnits: 2_000_000,
      effectiveFrom: '2026-03-01T00:00:00.000Z',
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const listed = (await (await app.request('/costs/rates')).json()) as AdminRatesOut;
    expect(listed.rates.map((rate) => rate.microsPerMillionUnits)).toEqual([2_000_000, 3_000_000]);

    const created = (await first.json()) as AdminRate;
    const audited = await db
      .select()
      .from(schema.operatorAuditEvent)
      .where(eq(schema.operatorAuditEvent.subjectId, created.id));
    expect(assertDefined(audited[0])).toMatchObject({
      type: 'usage_rate.created',
      staffUserId,
    });
  });

  it('refuses a second rate for the same resource, dimension and instant', async () => {
    const { app } = await operator('finance');
    const body = {
      resource: 'postgres_bytes',
      microsPerMillionUnits: 11_667,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    };

    expect((await addRate(app, body)).status).toBe(201);
    expect((await addRate(app, { ...body, microsPerMillionUnits: 99 })).status).toBe(409);
  });

  it('refuses a resource the ledger does not meter and a negative price', async () => {
    const { app } = await operator('finance');

    expect(
      (
        await addRate(app, {
          resource: 'coffee',
          microsPerMillionUnits: 1,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await addRate(app, {
          resource: 'object_bytes',
          microsPerMillionUnits: -1,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
        })
      ).status,
    ).toBe(422);
  });
});

describe('cost report', () => {
  it('ranks people by priced cost and reports each meter’s freshness', async () => {
    const { app } = await operator('finance');
    const big = await seedUserWithHub(db, schema, 'Big');
    const small = await seedUserWithHub(db, schema, 'Small');
    await db.insert(schema.usageRate).values({
      resource: 'ai_input_tokens',
      microsPerMillionUnits: 1_000_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await db.insert(schema.usageDaily).values([
      { day: DAY, userId: big, resource: 'ai_input_tokens', dimension: 'm', quantity: 5_000_000 },
      { day: DAY, userId: small, resource: 'ai_input_tokens', dimension: 'm', quantity: 1_000_000 },
    ]);

    const report = await readReport(app);

    expect(report.holders.map((holder) => holder.key)).toEqual([`user:${big}`, `user:${small}`]);
    expect(assertDefined(report.holders[0])).toMatchObject({
      kind: 'user',
      name: 'Big',
      costMicros: 5_000_000,
      hasUnpriced: false,
      topResource: 'ai_input_tokens',
    });
    expect(report.totalCostMicros).toBe(6_000_000);
    expect(report.meters.map((meter) => meter.meter)).toEqual([
      'ai_tokens',
      'postgres_storage',
      'object_storage',
    ]);
    expect(report.meters.every((meter) => meter.stale)).toBe(true);
  });

  it('marks usage with no rate as unpriced instead of free', async () => {
    const { app } = await operator('finance');
    const userId = await seedUserWithHub(db, schema, 'Unpriced');
    await db.insert(schema.usageDaily).values({
      day: DAY,
      userId,
      resource: 'object_bytes',
      dimension: 'attachment',
      quantity: 2_000,
    });

    const report = await readReport(app);

    expect(assertDefined(report.holders[0])).toMatchObject({ costMicros: 0, hasUnpriced: true });
    expect(report.hasUnpriced).toBe(true);
  });

  it('shows who pays by splitting workspace storage among the workspace owners', async () => {
    const { app } = await operator('finance');
    const { orgId } = await seedBaseOrg(db, schema);
    const alice = await seedUserWithHub(db, schema, 'Alice');
    const bob = await seedUserWithHub(db, schema, 'Bob');
    const guest = await seedUserWithHub(db, schema, 'Guest');
    await addMember(db, schema, orgId, alice, 'owner');
    await addMember(db, schema, orgId, bob, 'owner');
    await db.insert(schema.usageRate).values({
      resource: 'postgres_bytes',
      microsPerMillionUnits: 1_000_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await db.insert(schema.usageDaily).values({
      day: DAY,
      userId: guest,
      organizationId: orgId,
      resource: 'postgres_bytes',
      dimension: 'task',
      quantity: 4_000_000,
    });

    const caused = await readReport(app, 'caused');
    const pays = await readReport(app, 'pays');

    expect(caused.holders.map((holder) => holder.key)).toEqual([`user:${guest}`]);
    expect(pays.holders.map((holder) => holder.key).sort()).toEqual(
      [`user:${alice}`, `user:${bob}`].sort(),
    );
    expect(pays.holders.map((holder) => holder.costMicros)).toEqual([2_000_000, 2_000_000]);
    expect(pays.totalCostMicros).toBe(caused.totalCostMicros);
  });

  it('breaks one holder down by resource, workspace and day, with a lifetime total', async () => {
    const { app } = await operator('finance');
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'Detail');
    await db.insert(schema.usageRate).values({
      resource: 'ai_input_tokens',
      microsPerMillionUnits: 1_000_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await db.insert(schema.usageDaily).values([
      {
        day: DAY,
        userId,
        organizationId: orgId,
        resource: 'ai_input_tokens',
        dimension: 'm',
        quantity: 3_000_000,
        unmeasuredEvents: 2,
      },
      {
        day: '2026-02-01',
        userId,
        resource: 'ai_input_tokens',
        dimension: 'm',
        quantity: 1_000_000,
      },
    ]);

    const res = await app.request(
      `/costs/holders/${encodeURIComponent(`user:${userId}`)}?month=${MONTH}`,
    );
    expect(res.status).toBe(200);
    const detail = (await res.json()) as AdminCostDetailOut;

    expect(detail.lifetimeCostMicros).toBe(4_000_000);
    expect(detail.lines).toEqual([
      {
        resource: 'ai_input_tokens',
        dimension: 'm',
        quantity: 3_000_000,
        costMicros: 3_000_000,
        unmeasuredEvents: 2,
      },
    ]);
    expect(detail.workspaces).toEqual([
      { organizationId: orgId, name: expect.any(String), costMicros: 3_000_000 },
    ]);
    expect(detail.daily).toEqual([{ day: DAY, costMicros: 3_000_000 }]);
  });

  it('answers not found for a holder with no recorded usage', async () => {
    const { app } = await operator('finance');

    const res = await app.request(`/costs/holders/${encodeURIComponent('user:nobody')}`);

    expect(res.status).toBe(404);
  });
});
