import { beforeAll, describe, expect, it } from 'vitest';

import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../support/routes-harness';

/** The migrated db module + the lazily-imported oauth-clients router (both memoized). */
async function setup() {
  const schema = await getDb();
  const oauthClients = (await import('../../src/routes/oauth-clients')).default;
  return { schema, db: schema.db, oauthClients };
}

beforeAll(async () => {
  await setup(); // migrate + import once up front
});

describe('GET /oauth/clients/:clientId/metadata', () => {
  it("returns the client's server-persisted name and icon", async () => {
    const { db, schema, oauthClients } = await setup();
    const userId = await seedUserWithHub(db, schema, 'consenter');
    await db.insert(schema.oauthApplication).values({
      name: 'Claude Desktop',
      icon: 'https://example.test/icon.png',
      clientId: 'https://claude.test/.well-known/oauth-client',
      redirectUrls: 'https://claude.test/callback',
      type: 'public',
    });

    const app = appWithSession(oauthClients, fakeSession(userId));
    const res = await app.request(
      `/${encodeURIComponent('https://claude.test/.well-known/oauth-client')}/metadata`,
      { method: 'GET' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; icon: string | null };
    expect(body).toEqual({ name: 'Claude Desktop', icon: 'https://example.test/icon.png' });
  });

  it('returns null icon when the client registered none', async () => {
    const { db, schema, oauthClients } = await setup();
    const userId = await seedUserWithHub(db, schema, 'no-icon');
    await db.insert(schema.oauthApplication).values({
      name: 'Some MCP Client',
      clientId: 'no-icon-client',
      redirectUrls: 'https://client.test/callback',
      type: 'public',
    });

    const app = appWithSession(oauthClients, fakeSession(userId));
    const res = await app.request('/no-icon-client/metadata', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { icon: string | null }).icon).toBeNull();
  });

  it('404s for an unregistered client id', async () => {
    const { oauthClients } = await setup();
    const app = appWithSession(oauthClients, fakeSession('u1'));
    const res = await app.request('/unknown-client/metadata', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('401s without a session', async () => {
    const { oauthClients } = await setup();
    const app = appWithSession(oauthClients, null);
    const res = await app.request('/any-client/metadata', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
