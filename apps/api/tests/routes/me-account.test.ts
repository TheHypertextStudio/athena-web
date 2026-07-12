import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  addMember,
  agedSession,
  appWithSession,
  captureOutbox,
  fakeSession,
  getDb,
  one,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

/** The migrated db module + the lazily-imported me-account router (both memoized). */
async function setup() {
  const schema = await getDb();
  const meAccount = (await import('../../src/routes/me-account')).default;
  return { schema, db: schema.db, meAccount, outbox: await captureOutbox() };
}

beforeAll(async () => {
  await setup(); // migrate + import once up front
});

describe('GET /me/account', () => {
  it('returns active status with no blockers and no export for a fresh user', async () => {
    const { db, schema, meAccount } = await setup();
    const userId = await seedUserWithHub(db, schema, 'ada');
    const app = appWithSession(meAccount, fakeSession(userId));
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deletionState: string;
      blockers: unknown[];
      export: unknown;
    };
    expect(body.deletionState).toBe('active');
    expect(body.blockers).toEqual([]);
    expect(body.export).toBeNull();
  });

  it('401s without a session', async () => {
    const { meAccount } = await setup();
    const app = appWithSession(meAccount, null);
    expect((await app.request('/', { method: 'GET' })).status).toBe(401);
  });
});

describe('POST /me/account/exports', () => {
  it('creates a selective pending export (201 + Location) and is idempotent (200)', async () => {
    const { db, schema, meAccount } = await setup();
    const userId = await seedUserWithHub(db, schema, 'exporter');
    const app = appWithSession(meAccount, fakeSession(userId));

    const res = await app.request('/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: ['account'], workspaceIds: [] }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      status: string;
      scope: { categories: string[]; workspaces: unknown[]; allWorkspaces: boolean };
    };
    expect(created.status).toBe('pending');
    expect(created.scope).toEqual({
      categories: ['account'],
      workspaces: [],
      allWorkspaces: false,
    });
    expect(res.headers.get('location')).toContain(`/v1/me/account/exports/${created.id}`);

    // A second request returns the existing pending export (200, no duplicate).
    const again = await app.request('/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: ['personal'], workspaceIds: [] }),
    });
    expect(again.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.accountExport)
      .where(eq(schema.accountExport.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('lists active selectable workspaces and rejects unavailable or suspended memberships', async () => {
    const { db, schema, meAccount } = await setup();
    const userId = await seedUserWithHub(db, schema, 'selector');
    const ownOrg = await seedOrg(db, schema);
    await addMember(db, schema, ownOrg, userId);
    const outsiderOrg = await seedOrg(db, schema);
    const suspendedOrg = await seedOrg(db, schema);
    await addMember(db, schema, suspendedOrg, userId, 'member', 'suspended');
    const app = appWithSession(meAccount, fakeSession(userId));

    const options = await app.request('/exports/options', { method: 'GET' });
    expect(options.status).toBe(200);
    const body = (await options.json()) as { deliveryEmail: string; workspaces: { id: string }[] };
    expect(body.deliveryEmail).toBe('ada@example.com');
    expect(body.workspaces).not.toHaveLength(0);
    expect(body.workspaces.map((workspace) => workspace.id)).not.toContain(suspendedOrg);

    const selected = await app.request('/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: ['workspaces'], workspaceIds: [ownOrg] }),
    });
    expect(selected.status).toBe(201);
    expect(
      ((await selected.json()) as { scope: { workspaces: { id: string }[] } }).scope.workspaces,
    ).toEqual([expect.objectContaining({ id: ownOrg })]);

    const rejected = await app.request('/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: ['workspaces'], workspaceIds: [outsiderOrg] }),
    });
    expect(rejected.status).toBe(404);

    const suspended = await app.request('/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: ['workspaces'], workspaceIds: [suspendedOrg] }),
    });
    expect(suspended.status).toBe(404);
  });
});

describe('GET /me/account/exports', () => {
  it('lists the user exports newest first; GET /exports/:id returns one (404 unknown)', async () => {
    const { db, schema, meAccount } = await setup();
    const userId = await seedUserWithHub(db, schema, 'lister');
    const app = appWithSession(meAccount, fakeSession(userId));
    const created = (await (
      await app.request('/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: ['personal'], workspaceIds: [] }),
      })
    ).json()) as {
      id: string;
    };

    const list = (await (await app.request('/exports', { method: 'GET' })).json()) as {
      items: { id: string }[];
    };
    expect(list.items.map((e) => e.id)).toContain(created.id);

    const single = await app.request(`/exports/${created.id}`, { method: 'GET' });
    expect(single.status).toBe(200);
    expect(((await single.json()) as { id: string }).id).toBe(created.id);

    const missing = await app.request('/exports/01ARZ3NDEKTSV4RRFFQ69G5FAV', { method: 'GET' });
    expect(missing.status).toBe(404);
  });
});

describe('GET /me/account/exports/:exportId/file', () => {
  it('streams a ready export as a zip attachment; 409 when not ready', async () => {
    const schema = await getDb();
    const db = schema.db;
    const { getContainer } = await import('../../src/container');
    const { meAccountExportDownload } = await import('../../src/routes/me-account');
    const userId = await seedUserWithHub(db, schema, 'downloader');
    const blobKey = `exports/account/${userId}/test.zip`;
    await getContainer().blob.put(
      blobKey,
      new TextEncoder().encode('PK-zip-bytes'),
      'application/zip',
    );
    const job = one(
      await db
        .insert(schema.accountExport)
        .values({ userId, status: 'ready', blobKey, readyAt: new Date() })
        .returning({ id: schema.accountExport.id }),
    );

    const app = appWithSession(meAccountExportDownload, fakeSession(userId));
    const res = await app.request(`/${job.id}/file`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain(
      'attachment; filename="docket-export-',
    );
    expect(res.headers.get('content-disposition')).toContain('.zip"');
    expect(await res.text()).toBe('PK-zip-bytes');

    // A pending export of the same user exists but isn't downloadable → 409 Conflict.
    const pending = one(
      await db
        .insert(schema.accountExport)
        .values({ userId })
        .returning({ id: schema.accountExport.id }),
    );
    const notReady = await app.request(`/${pending.id}/file`, { method: 'GET' });
    expect(notReady.status).toBe(409);

    const stale = appWithSession(meAccountExportDownload, agedSession(userId, 600_000));
    expect((await stale.request(`/${job.id}/file`, { method: 'GET' })).status).toBe(401);

    // An unknown export id → 404 Not Found.
    const unknown = await app.request('/01ARZ3NDEKTSV4RRFFQ69G5FAV/file', { method: 'GET' });
    expect(unknown.status).toBe(404);
  });
});

describe('DELETE /me/account (schedule deletion)', () => {
  it('schedules deletion (202 Accepted) on a fresh session with no blockers', async () => {
    const { db, schema, meAccount, outbox } = await setup();
    const userId = await seedUserWithHub(db, schema, 'leaver');
    const before = outbox.length;
    const app = appWithSession(meAccount, agedSession(userId, 0));
    const res = await app.request('/', { method: 'DELETE' });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { deletionState: string }).deletionState).toBe(
      'pending_deletion',
    );

    const h = one(
      await db
        .select({ state: schema.hub.deletionState })
        .from(schema.hub)
        .where(eq(schema.hub.userId, userId)),
    );
    expect(h.state).toBe('pending_deletion');

    expect(outbox).toHaveLength(before + 1);
    const sent = outbox[outbox.length - 1]!;
    expect(sent.to).toBe('ada@example.com');
    expect(sent.subject).toContain('scheduled for deletion');
    const intent = await notificationIntentForSubject(schema, sent.subject, userId);
    expect(intent).toMatchObject({
      senderType: 'system',
      category: 'account',
      priority: 'high',
      audience: { type: 'user', userId },
      channels: ['web', 'email'],
      status: 'sent',
      createdBy: 'system',
    });
    await expectDeliveriesForIntent(schema, intent.id, ['web', 'email']);
  });

  it('rejects a stale session with reauth_required (401)', async () => {
    const { schema, meAccount } = await setup();
    const userId = await seedUserWithHub(schema.db, schema, 'stale');
    const app = appWithSession(meAccount, agedSession(userId, 10 * 60 * 1000));
    const res = await app.request('/', { method: 'DELETE' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('reauth_required');
  });

  it('rejects with deletion_blocked (409) when the user solely owns a shared org', async () => {
    const { db, schema, meAccount } = await setup();
    const userId = await seedUserWithHub(db, schema, 'soleowner');
    const mate = await seedUserWithHub(db, schema, 'mate');
    const orgId = await seedOrg(db, schema, false);
    await addMember(db, schema, orgId, userId, 'owner');
    await addMember(db, schema, orgId, mate, 'member'); // a second member → shared, solely owned

    const app = appWithSession(meAccount, agedSession(userId, 0));
    const res = await app.request('/', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('deletion_blocked');
  });
});

describe('POST /me/account/reactivation', () => {
  it('recovers a scheduled deletion back to active', async () => {
    const { schema, meAccount, outbox } = await setup();
    const userId = await seedUserWithHub(schema.db, schema, 'regret');
    const app = appWithSession(meAccount, agedSession(userId, 0));
    await app.request('/', { method: 'DELETE' });
    const before = outbox.length;

    const res = await app.request('/reactivation', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deletionState: string }).deletionState).toBe('active');

    expect(outbox).toHaveLength(before + 1);
    const sent = outbox[outbox.length - 1]!;
    expect(sent.to).toBe('ada@example.com');
    expect(sent.subject).toContain('deletion was canceled');
    const intent = await notificationIntentForSubject(schema, sent.subject, userId);
    expect(intent).toMatchObject({
      senderType: 'system',
      category: 'account',
      priority: 'high',
      audience: { type: 'user', userId },
      channels: ['web', 'email'],
      status: 'sent',
      createdBy: 'system',
    });
    await expectDeliveriesForIntent(schema, intent.id, ['web', 'email']);
  });
});

async function notificationIntentForSubject(
  schema: Awaited<ReturnType<typeof getDb>>,
  subject: string,
  userId: string,
) {
  const intents = await schema.db
    .select()
    .from(schema.notificationIntent)
    .where(eq(schema.notificationIntent.subject, subject));
  const intent = intents.find((row) => {
    const audience = row.audience as { readonly type?: string; readonly userId?: string };
    return audience.type === 'user' && audience.userId === userId;
  });
  if (!intent) throw new Error(`Expected notification intent for ${subject}`);
  return intent;
}

async function expectDeliveriesForIntent(
  schema: Awaited<ReturnType<typeof getDb>>,
  intentId: string,
  channels: readonly string[],
): Promise<void> {
  const deliveries = await schema.db
    .select()
    .from(schema.notificationDelivery)
    .where(eq(schema.notificationDelivery.notificationId, intentId));
  for (const channel of channels) {
    expect(deliveries).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel, status: 'sent' })]),
    );
  }
}
