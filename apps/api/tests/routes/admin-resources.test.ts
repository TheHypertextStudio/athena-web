import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { assertDefined } from '@docket/test-utils';
import { appWithSession, fakeSession, getDb } from '../support/routes-harness';

import type { AdminResourcesOut } from '../../src/admin-dto';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/app')).adminRouter;
});

let counter = 0;
/** A unique suffix per call — the PGlite database is shared across this suite. */
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}

/** Insert a staff user of the given tier and return the signing-in user's id. */
async function makeStaff(role: 'support' | 'finance' | 'superadmin'): Promise<string> {
  const u = uniq();
  const users = await db
    .insert(schema.user)
    .values({ name: `Operator ${u}`, email: `operator-${u}@example.com` })
    .returning({ id: schema.user.id });
  const userId = assertDefined(users[0]).id;
  await db.insert(schema.staffUser).values({ userId, role });
  return userId;
}

/** Read the resources report as an admitted operator. */
async function readResources(userId: string): Promise<AdminResourcesOut> {
  const app = appWithSession(admin, fakeSession(userId));
  const res = await app.request('/resources', { method: 'GET' });
  expect(res.status).toBe(200);
  return (await res.json()) as AdminResourcesOut;
}

/** The entry for one store in a resources report. */
function storeOf(report: AdminResourcesOut, store: string): AdminResourcesOut['storage'][number] {
  return assertDefined(report.storage.find((entry) => entry.store === store));
}

describe('platform resource usage', () => {
  it('refuses an anonymous caller and a non-staff account', async () => {
    const anonymous = appWithSession(admin, null);
    expect((await anonymous.request('/resources', { method: 'GET' })).status).toBe(401);

    const u = uniq();
    const users = await db
      .insert(schema.user)
      .values({ name: `Civilian ${u}`, email: `civilian-${u}@example.com` })
      .returning({ id: schema.user.id });
    const civilian = appWithSession(admin, fakeSession(assertDefined(users[0]).id));
    expect((await civilian.request('/resources', { method: 'GET' })).status).toBe(403);
  });

  it('reports the database size', async () => {
    const report = await readResources(await makeStaff('support'));

    expect(report.databaseByteSize).toBeGreaterThan(0);
  });

  it('counts a stored object against its own store and the platform total', async () => {
    const userId = await makeStaff('support');
    const before = await readResources(userId);

    const u = uniq();
    const orgs = await db
      .insert(schema.organization)
      .values({ name: `Org ${u}`, slug: `org-${u}` })
      .returning({ id: schema.organization.id });
    const organizationId = assertDefined(orgs[0]).id;

    await db.insert(schema.documentImage).values({
      organizationId,
      blobKey: `images/${u}.png`,
      fileName: 'diagram.png',
      mimeType: 'image/png',
      byteSize: 4096,
    });

    const after = await readResources(userId);
    expect(storeOf(after, 'document_image').objectCount).toBe(
      storeOf(before, 'document_image').objectCount + 1,
    );
    expect(storeOf(after, 'document_image').byteSize).toBe(
      storeOf(before, 'document_image').byteSize + 4096,
    );
    expect(after.storageByteSize).toBe(before.storageByteSize + 4096);
  });

  it('reports every store, and reads an empty store as zero rather than omitting it', async () => {
    const report = await readResources(await makeStaff('support'));

    expect(report.storage.map((entry) => entry.store)).toEqual([
      'attachment',
      'document_image',
      'discount_evidence',
    ]);
    for (const entry of report.storage) {
      expect(entry.objectCount).toBeGreaterThanOrEqual(0);
      expect(entry.byteSize).toBeGreaterThanOrEqual(0);
    }
    expect(report.storageByteSize).toBe(
      report.storage.reduce((total, entry) => total + entry.byteSize, 0),
    );
  });
});
