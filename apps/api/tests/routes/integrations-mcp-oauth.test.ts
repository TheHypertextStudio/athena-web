import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';
import type integrationsMcpOauthRouter from '../../src/routes/integrations-mcp-oauth';
import type {
  sealCredential as SealCredential,
  unsealCredential as UnsealCredential,
} from '../../src/lib/credentials';
import type { signConnectState as SignConnectState } from '../../src/lib/oauth-state';

const { completeMcpOAuthAuthorization } = vi.hoisted(() => ({
  completeMcpOAuthAuthorization: vi.fn(),
}));

vi.mock('@docket/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof IntegrationsModule>()),
  completeMcpOAuthAuthorization,
}));

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'https://docket.localhost';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['AGENT_MAX_TURNS'] = '8';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrationsMcpOauth!: typeof integrationsMcpOauthRouter;
let sealCredential!: typeof SealCredential;
let unsealCredential!: typeof UnsealCredential;
let signConnectState!: typeof SignConnectState;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  integrationsMcpOauth = (await import('../../src/routes/integrations-mcp-oauth')).default;
  ({ sealCredential, unsealCredential } = await import('../../src/lib/credentials'));
  ({ signConnectState } = await import('../../src/lib/oauth-state'));
});

afterEach(() => {
  vi.clearAllMocks();
});

async function seedPendingOAuth(): Promise<{ orgId: string; integrationId: string }> {
  const slug = `mcp-oauth-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: org!.id,
      provider: 'mcp',
      pattern: 'connector',
      roles: ['work'],
      status: 'pending',
      config: {
        url: 'https://mcp.sunsama.com/mcp',
        label: 'Sunsama',
        alias: `sun${Math.random().toString(36).slice(2, 7)}`,
        authMode: 'oauth',
      },
      syncCadenceMinutes: null,
    })
    .returning({ id: schema.integration.id });
  await db.insert(schema.integrationCredential).values({
    organizationId: org!.id,
    integrationId: row!.id,
    ciphertext: sealCredential(JSON.stringify({ kind: 'mcp_oauth_pending', codeVerifier: 'pkce' })),
  });
  return { orgId: org!.id, integrationId: row!.id };
}

describe('remote MCP OAuth callback', () => {
  it('exchanges a signed approval, verifies tools/list, and returns to Connections as connected', async () => {
    const seeded = await seedPendingOAuth();
    completeMcpOAuthAuthorization.mockResolvedValue({
      kind: 'mcp_oauth',
      tokens: { access_token: 'access', token_type: 'Bearer' },
      obtainedAt: new Date().toISOString(),
    });
    const state = signConnectState({
      integrationId: seeded.integrationId,
      orgId: seeded.orgId,
      userId: 'actor_test',
    });
    const app = new Hono().route('/', integrationsMcpOauth);

    const response = await app.request(
      `/callback?code=approval-code&state=${encodeURIComponent(state)}`,
    );

    expect(response.status).toBe(302);
    const [stored] = await db
      .select({
        status: schema.integration.status,
        lastError: schema.integration.lastError,
        ciphertext: schema.integrationCredential.ciphertext,
      })
      .from(schema.integration)
      .innerJoin(
        schema.integrationCredential,
        eq(schema.integrationCredential.integrationId, schema.integration.id),
      )
      .where(
        and(
          eq(schema.integration.id, seeded.integrationId),
          eq(schema.integration.provider, 'mcp'),
        ),
      );
    expect(stored?.lastError).toBeNull();
    expect(response.headers.get('location')).toContain(
      `/orgs/${seeded.orgId}/settings/connections?mcp=connected`,
    );
    expect(stored?.status).toBe('connected');
    expect(unsealCredential(stored!.ciphertext)).toContain('mcp_oauth');
    expect(completeMcpOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationCode: 'approval-code' }),
    );
  });

  it('rejects a callback whose state is missing or invalid without touching an integration', async () => {
    const app = new Hono().route('/', integrationsMcpOauth);
    const response = await app.request('/callback?code=approval-code&state=not-signed');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/?mcp=error');
    expect(completeMcpOAuthAuthorization).not.toHaveBeenCalled();
  });
});
