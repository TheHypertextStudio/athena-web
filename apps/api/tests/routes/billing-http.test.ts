import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { db as DbType, organization as OrgTable } from '@docket/db';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type billingRouter from '../../src/routes/billing';
import type cronRouter from '../../src/routes/cron';
import type webhooksRouter from '../../src/routes/webhooks';

// The shared `db` and `env` are constructed from process.env on first access, so the
// required vars must be set BEFORE any module that touches them is imported.
process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let db!: typeof DbType;
let organization!: typeof OrgTable;
let webhooks!: typeof webhooksRouter;
let cron!: typeof cronRouter;
let billing!: typeof billingRouter;

/** Mount the billing router behind an injected actor context with the given capabilities. */
function billingApp(orgId: string, capabilities: readonly string[]) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = { orgId, actorId: 'actor_test', roleId: 'role_test', capabilities };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', billing);
  app.onError(onError);
  return app;
}

beforeAll(async () => {
  const dbmod = await import('@docket/db');
  db = dbmod.db;
  organization = dbmod.organization;
  // Migrate the shared in-memory PGlite instance the handlers write through.
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  webhooks = (await import('../../src/routes/webhooks')).default;
  cron = (await import('../../src/routes/cron')).default;
  billing = (await import('../../src/routes/billing')).default;
});

/** Insert an org and return its id. */
async function makeOrg(
  state: 'active' | 'export_window' | 'pending_deletion',
  deleteAfterAt?: Date,
): Promise<string> {
  const slug = `http-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(organization)
    .values({
      name: slug,
      slug,
      lifecycleState: state,
      ...(deleteAfterAt ? { deleteAfterAt } : {}),
    })
    .returning({ id: organization.id });
  return rows[0]!.id;
}

/** Read an org's lifecycle state. */
async function stateOf(id: string): Promise<string> {
  const rows = await db
    .select({ s: organization.lifecycleState })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);
  return rows[0]!.s;
}

describe('POST /billing/webhook', () => {
  it('400s on a malformed payload', async () => {
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ not: 'an event' }),
    });
    expect(res.status).toBe(400);
  });

  it('folds a canceled event into the export window', async () => {
    const id = await makeOrg('active');
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_1',
        type: 'subscription.canceled',
        referenceId: id,
        subscription: {
          id: 'sub_1',
          referenceId: id,
          status: 'canceled',
          currentPeriodEnd: '2026-01-01T00:00:00.000Z',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; effect: string };
    expect(body.received).toBe(true);
    expect(body.effect).toBe('export_window');
    expect(await stateOf(id)).toBe('export_window');
  });

  it('folds an active event back to active', async () => {
    const id = await makeOrg('export_window', new Date('2030-01-01T00:00:00.000Z'));
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_2',
        type: 'subscription.updated',
        referenceId: id,
        subscription: {
          id: 'sub_2',
          referenceId: id,
          status: 'active',
          currentPeriodEnd: '2030-01-01T00:00:00.000Z',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(res.status).toBe(200);
    expect(await stateOf(id)).toBe('active');
  });
});

describe('POST /cron/lifecycle-sweep', () => {
  it('401s without the cron secret', async () => {
    const res = await cron.request('/lifecycle-sweep', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('401s with a wrong secret', async () => {
    const res = await cron.request('/lifecycle-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(401);
  });

  it('sweeps overdue orgs when authorized via Bearer', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const id = await makeOrg('export_window', past);
    const res = await cron.request('/lifecycle-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      swept: boolean;
      toPendingDeletion: number;
      toDeleted: number;
    };
    expect(body.swept).toBe(true);
    expect(body.toPendingDeletion).toBeGreaterThanOrEqual(1);
    expect(await stateOf(id)).toBe('pending_deletion');
  });

  it('accepts the x-cron-secret header too', async () => {
    const res = await cron.request('/lifecycle-sweep', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-cron-secret' },
    });
    expect(res.status).toBe(200);
  });
});

describe('billing router (org-scoped, via the BillingGateway port)', () => {
  const ORG = 'org_billing_router';

  it('GET / returns null before any subscription exists', async () => {
    const app = billingApp(`${ORG}_none`, ['view']);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('POST /checkout requires manage (403 for a view-only member)', async () => {
    const app = billingApp(ORG, ['view']);
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('POST /checkout returns a hosted url, after which GET / reflects the trialing sub', async () => {
    const app = billingApp(ORG, ['manage']);
    const checkout = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ successUrl: 'https://app/ok', cancelUrl: 'https://app/no' }),
    });
    expect(checkout.status).toBe(200);
    const created = (await checkout.json()) as { url: string };
    expect(created.url).toMatch(/^https?:\/\//);

    // The memoized container shares one InMemoryBillingGateway, so the status read sees it.
    const status = await app.request('/', { method: 'GET' });
    const sub = (await status.json()) as { referenceId: string; status: string } | null;
    expect(sub?.referenceId).toBe(ORG);
    expect(sub?.status).toBe('trialing');
  });

  it('POST /portal returns a hosted portal url for a manager', async () => {
    const app = billingApp(ORG, ['manage']);
    const res = await app.request('/portal', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^https?:\/\//);
  });
});
