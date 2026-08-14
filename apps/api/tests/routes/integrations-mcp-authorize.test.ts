/**
 * `@docket/api` — `POST /:id/authorize` (remote-MCP OAuth start) branch coverage: mocks
 * `beginMcpOAuthAuthorization` (the real implementation makes a live network call against the
 * target MCP server's OAuth discovery, which this suite never wants to do) so the route's own
 * branches — non-OAuth 409, the signed-state `authUserId` inclusion, the `clientMetadataUrl`
 * derivation, and the two failure-message shapes — are exercised deterministically.
 */
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';

import type integrationsMcpRouter from '../../src/routes/integrations-mcp';
import { env } from '../../src/env';
import { verifyConnectState } from '../../src/lib/oauth-state';
import { appWithActor, fakeSession } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

const { beginMcpOAuthAuthorization } = vi.hoisted(() => ({
  beginMcpOAuthAuthorization: vi.fn(),
}));

vi.mock('@docket/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof IntegrationsModule>()),
  beginMcpOAuthAuthorization,
}));

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['AGENT_MAX_TURNS'] = '8';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrationsMcp!: typeof integrationsMcpRouter;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  integrationsMcp = (await import('../../src/routes/integrations-mcp')).default;
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * `env`'s fields are `readonly` at the type level, but the underlying object is a plain mutable
 * object at runtime — one test below toggles `API_URL` for its duration (restored in a
 * `finally`) to reach the branch where `mcpOAuthClientMetadataUrl()` returns `undefined`.
 * Mirrors `integrations-edges.test.ts`'s established pattern for the same env.
 */
const mutableEnv = env as unknown as { API_URL: string };

const J = { 'content-type': 'application/json' };

async function seedOrg(): Promise<string> {
  const slug = `mcp-auth-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  return assertDefined(org).id;
}

/** Seed an org-scoped MCP integration with the given `authMode`, returning its id. */
async function seedMcpIntegration(
  orgId: string,
  authMode: 'oauth' | 'bearer' | 'none' = 'oauth',
): Promise<string> {
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'mcp',
      pattern: 'connector',
      roles: ['work'],
      status: 'pending',
      config: {
        url: 'https://mcp.sunsama.com/mcp',
        label: 'Sunsama',
        alias: `sunsama-${Math.random().toString(36).slice(2, 8)}`,
        authMode,
      },
      syncCadenceMinutes: null,
    })
    .returning({ id: schema.integration.id });
  return assertDefined(row).id;
}

describe('POST /:id/authorize — starting a remote MCP OAuth approval', () => {
  it('404s for an id that does not resolve to an org-scoped MCP integration', async () => {
    const orgId = await seedOrg();
    const app = appWithActor(integrationsMcp, orgId, ['manage']);

    const res = await app.request('/01ARZ3NDEKTSV4RRFFQ69G5FAV/authorize', {
      method: 'POST',
      headers: J,
    });

    expect(res.status).toBe(404);
    expect(beginMcpOAuthAuthorization).not.toHaveBeenCalled();
  });

  it('409s when the integration is not configured for OAuth', async () => {
    const orgId = await seedOrg();
    const id = await seedMcpIntegration(orgId, 'bearer');
    const app = appWithActor(integrationsMcp, orgId, ['manage']);

    const res = await app.request(`/${id}/authorize`, { method: 'POST', headers: J });

    expect(res.status).toBe(409);
    expect(beginMcpOAuthAuthorization).not.toHaveBeenCalled();
  });

  it('signs the connect state WITHOUT authUserId when the caller carries no browser session', async () => {
    const orgId = await seedOrg();
    const id = await seedMcpIntegration(orgId, 'oauth');
    beginMcpOAuthAuthorization.mockResolvedValue({
      authorizationUrl: 'https://auth.sunsama.example/authorize?x=1',
      credential: { kind: 'mcp_oauth_pending', codeVerifier: 'verifier-1' },
    });
    const app = appWithActor(integrationsMcp, orgId, ['manage']);

    const res = await app.request(`/${id}/authorize`, { method: 'POST', headers: J });

    expect(res.status).toBe(200);
    expect((await res.json()) as { authorizationUrl: string }).toEqual({
      authorizationUrl: 'https://auth.sunsama.example/authorize?x=1',
    });
    expect(beginMcpOAuthAuthorization).toHaveBeenCalledTimes(1);
    const call = assertDefined(beginMcpOAuthAuthorization.mock.calls[0])[0] as { state: string };
    const decoded = verifyConnectState(call.state);
    expect(decoded).toMatchObject({ integrationId: id, orgId });
    expect(decoded).not.toHaveProperty('authUserId');

    const creds = await db
      .select()
      .from(schema.integrationCredential)
      .where(eq(schema.integrationCredential.integrationId, id));
    expect(creds).toHaveLength(1);
  });

  it('signs the connect state WITH authUserId when the caller carries a browser session', async () => {
    const orgId = await seedOrg();
    const id = await seedMcpIntegration(orgId, 'oauth');
    beginMcpOAuthAuthorization.mockResolvedValue({
      authorizationUrl: 'https://auth.sunsama.example/authorize?x=2',
      credential: { kind: 'mcp_oauth_pending', codeVerifier: 'verifier-2' },
    });
    const app = appWithActor(
      integrationsMcp,
      orgId,
      ['manage'],
      'actor_test',
      fakeSession('user_browser_1'),
    );

    const res = await app.request(`/${id}/authorize`, { method: 'POST', headers: J });

    expect(res.status).toBe(200);
    const call = assertDefined(beginMcpOAuthAuthorization.mock.calls[0])[0] as { state: string };
    const decoded = verifyConnectState(call.state);
    expect(decoded).toMatchObject({ integrationId: id, orgId, authUserId: 'user_browser_1' });
  });

  it('derives clientMetadataUrl from a https API_URL by default', async () => {
    const orgId = await seedOrg();
    const id = await seedMcpIntegration(orgId, 'oauth');
    beginMcpOAuthAuthorization.mockResolvedValue({
      authorizationUrl: 'https://auth.sunsama.example/authorize?x=3',
      credential: { kind: 'mcp_oauth_pending', codeVerifier: 'verifier-3' },
    });
    const app = appWithActor(integrationsMcp, orgId, ['manage']);

    const res = await app.request(`/${id}/authorize`, { method: 'POST', headers: J });

    expect(res.status).toBe(200);
    const call = assertDefined(beginMcpOAuthAuthorization.mock.calls[0])[0] as {
      clientMetadataUrl?: string;
    };
    expect(call.clientMetadataUrl).toBe(`${env.API_URL}/.well-known/mcp-client.json`);
  });

  it('omits clientMetadataUrl when API_URL is not deployed behind https', async () => {
    const orgId = await seedOrg();
    const id = await seedMcpIntegration(orgId, 'oauth');
    beginMcpOAuthAuthorization.mockResolvedValue({
      authorizationUrl: 'https://auth.sunsama.example/authorize?x=4',
      credential: { kind: 'mcp_oauth_pending', codeVerifier: 'verifier-4' },
    });
    const original = mutableEnv.API_URL;
    mutableEnv.API_URL = 'http://localhost:4000';
    try {
      const app = appWithActor(integrationsMcp, orgId, ['manage']);
      const res = await app.request(`/${id}/authorize`, { method: 'POST', headers: J });
      expect(res.status).toBe(200);
      const call = assertDefined(beginMcpOAuthAuthorization.mock.calls[0])[0] as {
        clientMetadataUrl?: string;
      };
      expect(call.clientMetadataUrl).toBeUndefined();
    } finally {
      mutableEnv.API_URL = original;
    }
  });

  it('marks the integration errored with the thrown message when authorization discovery fails', async () => {
    const orgId = await seedOrg();
    const id = await seedMcpIntegration(orgId, 'oauth');
    beginMcpOAuthAuthorization.mockRejectedValue(new Error('discovery failed'));
    const app = appWithActor(integrationsMcp, orgId, ['manage']);

    await app.request(`/${id}/authorize`, { method: 'POST', headers: J });

    const [stored] = await db
      .select({ status: schema.integration.status, lastError: schema.integration.lastError })
      .from(schema.integration)
      .where(eq(schema.integration.id, id));
    expect(stored).toMatchObject({ status: 'error', lastError: 'discovery failed' });
  });

  it('marks the integration errored with a fallback message when authorization rejects a non-Error value', async () => {
    const orgId = await seedOrg();
    const id = await seedMcpIntegration(orgId, 'oauth');
    beginMcpOAuthAuthorization.mockRejectedValue('raw string rejection');
    const app = appWithActor(integrationsMcp, orgId, ['manage']);

    // A thrown non-Error value isn't normalized by Hono's `onError` the way a real Error is, so
    // it surfaces as a rejection here rather than a handled response — the integration's error
    // state is already persisted (inside the route's `catch`) before the re-throw, which is what
    // this test actually verifies.
    await expect(app.request(`/${id}/authorize`, { method: 'POST', headers: J })).rejects.toBe(
      'raw string rejection',
    );

    const [stored] = await db
      .select({ status: schema.integration.status, lastError: schema.integration.lastError })
      .from(schema.integration)
      .where(eq(schema.integration.id, id));
    expect(stored).toMatchObject({
      status: 'error',
      lastError: 'MCP OAuth authorization could not start',
    });
  });
});
