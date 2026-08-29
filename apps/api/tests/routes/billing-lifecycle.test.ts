import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';

import { appWithActor, getDb, seedBaseOrg, seedOrg } from '../support/routes-harness';
import type billingRouter from '../../src/routes/billing';
import type { billingExportDownload as BillingExportDownload } from '../../src/routes/billing';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let billing!: typeof billingRouter;
let exportDownload!: typeof BillingExportDownload;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/billing');
  billing = mod.default;
  exportDownload = mod.billingExportDownload;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Read an org's lifecycle columns straight from the db (bypassing the route). */
async function lifecycleOf(
  orgId: string,
): Promise<{ state: string; exportReadyAt: Date | null; deleteAfterAt: Date | null }> {
  const rows = await db
    .select({
      state: schema.organization.lifecycleState,
      exportReadyAt: schema.organization.exportReadyAt,
      deleteAfterAt: schema.organization.deleteAfterAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  return assertDefined(rows[0]);
}

// A valid ULID-shaped id that no seeded row uses (a path-level org id mismatch).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('billing lifecycle: GET /lifecycle', () => {
  it('returns the org lifecycle status (active, no timestamps) for a member', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    const app = appWithActor(billing, orgId, ['view']);
    const res = await app.request('/lifecycle', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{
      organizationId: string;
      lifecycleState: string;
      exportReadyAt: string | null;
      deleteAfterAt: string | null;
    }>(res);
    expect(body.organizationId).toBe(orgId);
    expect(body.lifecycleState).toBe('active');
    expect(body.exportReadyAt).toBeNull();
    expect(body.deleteAfterAt).toBeNull();
  });

  it('404s when the actor-context org row does not exist', async () => {
    const app = appWithActor(billing, MISSING_ULID, ['view']);
    const res = await app.request('/lifecycle', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('billing: GET /', () => {
  it('returns active products and the caller billing-management permission', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationProductEntitlement).values({
      organizationId: orgId,
      productKey: 'docket_pro',
      status: 'trialing',
      source: 'stripe',
      trialEndsAt: new Date('2026-08-25T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-25T00:00:00.000Z'),
    });

    const app = appWithActor(billing, orgId, ['view']);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      organizationId: orgId,
      listPrice: { amount: 800, currency: 'usd', interval: 'month' },
      accessMode: 'writable',
      canManageBilling: false,
      checkoutEnabled: false,
      effectiveDiscount: null,
      applicationStatus: null,
      issuedCredit: null,
      products: [
        {
          productKey: 'docket_pro',
          name: 'Docket Pro',
          status: 'trialing',
          source: 'stripe',
          trialEndsAt: '2026-08-25T00:00:00.000Z',
          renewalDate: '2026-08-25T00:00:00.000Z',
          cancelAtPeriodEnd: false,
          cancellationDate: null,
          graceEndsAt: null,
          providerObservedAt: null,
        },
      ],
    });
  });

  it('represents baseline Docket with no paid products', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    const app = appWithActor(billing, orgId, ['manage']);
    const res = await app.request('/', { method: 'GET' });
    expect(await json(res)).toEqual({
      organizationId: orgId,
      listPrice: { amount: 800, currency: 'usd', interval: 'month' },
      accessMode: 'read_only',
      canManageBilling: true,
      checkoutEnabled: false,
      effectiveDiscount: null,
      applicationStatus: null,
      issuedCredit: null,
      products: [],
    });
  });

  it('makes shared work read-only after Docket Pro ends', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationProductEntitlement).values({
      organizationId: orgId,
      productKey: 'docket_pro',
      status: 'canceled',
      source: 'stripe',
      canceledAt: new Date('2026-08-25T00:00:00.000Z'),
    });

    const res = await appWithActor(billing, orgId, ['view']).request('/');

    expect(res.status).toBe(200);
    expect(await json<{ accessMode: string }>(res)).toMatchObject({ accessMode: 'read_only' });
  });

  it('keeps personal baseline work writable without Docket Pro', async () => {
    const orgId = await seedOrg(db, schema, true, false);

    const res = await appWithActor(billing, orgId, ['view']).request('/');

    expect(res.status).toBe(200);
    expect(await json<{ accessMode: string }>(res)).toMatchObject({ accessMode: 'writable' });
  });

  it('makes shared work read-only when payment grace has expired', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationProductEntitlement).values({
      organizationId: orgId,
      productKey: 'docket_pro',
      status: 'past_due',
      source: 'stripe',
      graceEndsAt: new Date('2000-01-01T00:00:00.000Z'),
    });

    const res = await appWithActor(billing, orgId, ['view']).request('/');

    expect(res.status).toBe(200);
    expect(await json<{ accessMode: string }>(res)).toMatchObject({ accessMode: 'read_only' });
  });
});

describe('billing lifecycle mutations', () => {
  it.each(['/lifecycle/start-export-window', '/lifecycle/reactivate'])(
    'removes the billing-driven data lifecycle endpoint %s',
    async (path) => {
      const { orgId } = await seedBaseOrg(db, schema);
      const app = appWithActor(billing, orgId, ['manage']);

      expect((await app.request(path, { method: 'POST' })).status).toBe(404);
      expect(await lifecycleOf(orgId)).toMatchObject({
        state: 'active',
        exportReadyAt: null,
        deleteAfterAt: null,
      });
    },
  );
});

describe('billing: POST /export', () => {
  it('generates a downloadable archive of the org work layer and stamps exportReadyAt', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    // Seed a couple of work-layer rows so the archive is non-trivial.
    await db.insert(schema.initiative).values({
      organizationId: orgId,
      name: 'Q3 Goals',
      status: 'active',
      statusId: statusId('initiative', 'active'),
      targetDate: new Date('2026-06-30T00:00:00.000Z'),
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 0,
      createdBy: humanActorId,
    });
    await db.insert(schema.project).values({
      organizationId: orgId,
      teamId,
      name: 'Q2 launch',
      status: 'planned',
      statusId: statusId('project', 'planned'),
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      startDateResolution: 'quarter',
      startDateFiscalYearStartMonth: 0,
      targetDate: new Date('2026-06-30T00:00:00.000Z'),
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 0,
      createdBy: humanActorId,
    });
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Ship export',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      createdBy: humanActorId,
    });

    const app = appWithActor(billing, orgId, ['manage']);
    const res = await app.request('/export', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await json<{ downloadUrl: string; expiresAt: string }>(res);
    // The download is an API path behind the caller's session and `manage`, never the object
    // store's own address. Handing back a blob URL made a full dump of the org readable by anyone
    // who obtained the link, for as long as the object existed.
    expect(body.downloadUrl).toBe(`/v1/orgs/${orgId}/billing/export/file`);
    expect(body.downloadUrl).not.toMatch(/^(file|https?):\/\//);
    expect(body.downloadUrl).not.toContain('blob.vercel-storage.com');
    // expiresAt is in the future.
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const download = appWithActor(exportDownload, orgId, ['manage']);
    const file = await download.request('/file');
    expect(file.status).toBe(200);
    const archive = (await file.json()) as {
      tables: { project: Record<string, unknown>[]; initiative: Record<string, unknown>[] };
    };
    expect(archive.tables.project[0]).toMatchObject({
      startDateResolution: 'quarter',
      startDateFiscalYearStartMonth: 0,
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 0,
    });
    expect(archive.tables.initiative[0]).toMatchObject({
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 0,
    });

    // exportReadyAt is stamped on the org.
    const persisted = await lifecycleOf(orgId);
    expect(persisted.exportReadyAt).not.toBeNull();
  });

  it('only includes the calling org rows (tenant isolation)', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    // A task in org B that must NOT appear in org A's export.
    await db.insert(schema.task).values({
      organizationId: b.orgId,
      teamId: b.teamId,
      title: 'Other org secret',
      state: 'todo',
      statusId: b.statusId('task', 'todo'),
      createdBy: b.humanActorId,
    });
    // A task in org A that MUST appear.
    await db.insert(schema.task).values({
      organizationId: a.orgId,
      teamId: a.teamId,
      title: 'My org task',
      state: 'todo',
      statusId: a.statusId('task', 'todo'),
      createdBy: a.humanActorId,
    });

    const app = appWithActor(billing, a.orgId, ['manage']);
    const res = await app.request('/export', { method: 'POST' });
    expect(res.status).toBe(200);

    // Read the archive back through the authenticated route rather than off disk, so this also
    // proves the route serves the bytes it promised.
    const download = appWithActor(exportDownload, a.orgId, ['manage']);
    const file = await download.request('/file');
    expect(file.status).toBe(200);
    const archive = await file.text();
    expect(archive).toContain('My org task');
    expect(archive).not.toContain('Other org secret');
  });

  it('denies the download to a member without manage', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithActor(billing, orgId, ['manage']);
    expect((await app.request('/export', { method: 'POST' })).status).toBe(200);

    const download = appWithActor(exportDownload, orgId, ['contribute']);
    expect((await download.request('/file')).status).toBe(403);
  });

  it('404s the download when no export has been generated', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const download = appWithActor(exportDownload, orgId, ['manage']);
    expect((await download.request('/file')).status).toBe(404);
  });

  it('404s the download once the export has aged past its advertised TTL', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithActor(billing, orgId, ['manage']);
    expect((await app.request('/export', { method: 'POST' })).status).toBe(200);

    // Age the artifact past the 14-day window. `expiresAt` used to be a number the handler
    // computed and nothing checked; it is now enforced on every read.
    await db
      .update(schema.organization)
      .set({ exportReadyAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.organization.id, orgId));

    const download = appWithActor(exportDownload, orgId, ['manage']);
    expect((await download.request('/file')).status).toBe(404);
  });

  it('is denied (403) for a member without manage', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithActor(billing, orgId, ['contribute']);
    const res = await app.request('/export', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('404s when the actor-context org row does not exist', async () => {
    const app = appWithActor(billing, MISSING_ULID, ['manage']);
    const res = await app.request('/export', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
