import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../support/routes-harness';

/** The migrated database and lazily imported passkey router. */
async function setup() {
  const schema = await getDb();
  const mePasskeys = (await import('../../src/routes/me-passkeys')).default;
  return { schema, db: schema.db, mePasskeys };
}

beforeAll(async () => {
  await setup();
});

/** Seed one credential with recognizable private material that must never cross the API. */
async function seedPasskey(
  userId: string,
  suffix: string,
  overrides: Partial<{
    name: string;
    deviceType: string;
    backedUp: boolean;
    transports: string;
    aaguid: string;
    lastUsedAt: Date;
  }> = {},
): Promise<{ id: string; credentialID: string }> {
  const { db, schema } = await setup();
  const credentialID = `credential-${suffix}`;
  const [row] = await db
    .insert(schema.passkey)
    .values({
      name: overrides.name ?? `Passkey ${suffix}`,
      publicKey: `private-public-key-material-${suffix}`,
      userId,
      credentialID,
      counter: 7,
      deviceType: overrides.deviceType ?? 'singleDevice',
      backedUp: overrides.backedUp ?? false,
      transports: overrides.transports ?? 'internal',
      aaguid: overrides.aaguid ?? '00000000-0000-0000-0000-000000000000',
      lastUsedAt: overrides.lastUsedAt,
    })
    .returning({ id: schema.passkey.id });
  return { id: assertDefined(row).id, credentialID };
}

describe('GET /me/passkeys', () => {
  it('returns only safe summaries for the signed-in user, newest first', async () => {
    const { db, schema, mePasskeys } = await setup();
    const userId = await seedUserWithHub(db, schema, `passkey-list-${Math.random()}`);
    const otherId = await seedUserWithHub(db, schema, `passkey-other-${Math.random()}`);
    const lastUsedAt = new Date('2026-08-31T12:00:00.000Z');
    const mine = await seedPasskey(userId, `mine-${Math.random()}`, {
      backedUp: true,
      deviceType: 'multiDevice',
      transports: 'internal,hybrid',
      lastUsedAt,
    });
    await seedPasskey(otherId, `other-${Math.random()}`);

    const app = appWithSession(mePasskeys, fakeSession(userId));
    const response = await app.request('/', { method: 'GET' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: mine.id,
      backedUp: true,
      deviceType: 'multiDevice',
      transports: ['internal', 'hybrid'],
      lastUsedAt: lastUsedAt.toISOString(),
    });
    expect(body.items[0]).not.toHaveProperty('credentialID');
    expect(body.items[0]).not.toHaveProperty('publicKey');
    expect(body.items[0]).not.toHaveProperty('counter');
  });

  it('requires a session', async () => {
    const { mePasskeys } = await setup();
    expect((await appWithSession(mePasskeys, null).request('/')).status).toBe(401);
  });
});

describe('PATCH /me/passkeys/:id', () => {
  it('renames an owned passkey and trims the label', async () => {
    const { db, schema, mePasskeys } = await setup();
    const userId = await seedUserWithHub(db, schema, `passkey-rename-${Math.random()}`);
    const owned = await seedPasskey(userId, `rename-${Math.random()}`);
    const response = await appWithSession(mePasskeys, fakeSession(userId)).request(`/${owned.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Pixel passkey  ' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: owned.id, name: 'Pixel passkey' });
    const [stored] = await db
      .select({ name: schema.passkey.name })
      .from(schema.passkey)
      .where(eq(schema.passkey.id, owned.id));
    expect(stored?.name).toBe('Pixel passkey');
  });

  it('hides passkeys owned by another user', async () => {
    const { db, schema, mePasskeys } = await setup();
    const userId = await seedUserWithHub(db, schema, `passkey-guesser-${Math.random()}`);
    const otherId = await seedUserWithHub(db, schema, `passkey-owner-${Math.random()}`);
    const other = await seedPasskey(otherId, `hidden-${Math.random()}`);
    const response = await appWithSession(mePasskeys, fakeSession(userId)).request(`/${other.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stolen' }),
    });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /me/passkeys/:id', () => {
  it('returns the provider credential ID after deleting one of multiple owned passkeys', async () => {
    const { db, schema, mePasskeys } = await setup();
    const userId = await seedUserWithHub(db, schema, `passkey-delete-${Math.random()}`);
    const removed = await seedPasskey(userId, `remove-${Math.random()}`);
    await seedPasskey(userId, `keep-${Math.random()}`);

    const response = await appWithSession(mePasskeys, fakeSession(userId)).request(
      `/${removed.id}`,
      { method: 'DELETE' },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true, credentialId: removed.credentialID });
    const rows = await db
      .select({ id: schema.passkey.id })
      .from(schema.passkey)
      .where(eq(schema.passkey.id, removed.id));
    expect(rows).toEqual([]);
  });

  it('preserves the last-passkey lockout guard', async () => {
    const { db, schema, mePasskeys } = await setup();
    const userId = await seedUserWithHub(db, schema, `passkey-last-${Math.random()}`);
    const only = await seedPasskey(userId, `only-${Math.random()}`);

    const response = await appWithSession(mePasskeys, fakeSession(userId)).request(`/${only.id}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(403);
    const remaining = await db
      .select({ id: schema.passkey.id })
      .from(schema.passkey)
      .where(eq(schema.passkey.id, only.id));
    expect(remaining).toHaveLength(1);
  });

  it('allows the last passkey to be removed when a linked sign-in account remains', async () => {
    const { db, schema, mePasskeys } = await setup();
    const userId = await seedUserWithHub(db, schema, `passkey-linked-${Math.random()}`);
    const only = await seedPasskey(userId, `linked-${Math.random()}`);
    await db.insert(schema.account).values({
      userId,
      providerId: 'google',
      accountId: `google-${Math.random()}`,
    });

    const response = await appWithSession(mePasskeys, fakeSession(userId)).request(`/${only.id}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(200);
  });
});
