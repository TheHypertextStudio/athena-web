import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';
import type integrationsLinearAgentOauthRouter from '../../src/routes/integrations-linear-agent-oauth';
import type { unsealCredential as UnsealCredential } from '../../src/lib/credentials';
import type { signLinearAgentInstallState as SignInstallState } from '../../src/lib/linear-agent-connect';

const { exchangeLinearAgentCode } = vi.hoisted(() => ({
  exchangeLinearAgentCode: vi.fn(),
}));

vi.mock('@docket/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof IntegrationsModule>()),
  exchangeLinearAgentCode,
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
  process.env['API_URL'] = 'https://api.docket.test';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
  process.env['LINEAR_AGENT_CLIENT_ID'] = 'agent-client-id';
  process.env['LINEAR_AGENT_CLIENT_SECRET'] = 'agent-client-secret';
  process.env['LINEAR_AGENT_WEBHOOK_SECRET'] = 'agent-webhook-secret';
});

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrationsLinearAgentOauth!: typeof integrationsLinearAgentOauthRouter;
let unsealCredential!: typeof UnsealCredential;
let signLinearAgentInstallState!: typeof SignInstallState;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  integrationsLinearAgentOauth = (await import('../../src/routes/integrations-linear-agent-oauth'))
    .default;
  ({ unsealCredential } = await import('../../src/lib/credentials'));
  ({ signLinearAgentInstallState } = await import('../../src/lib/linear-agent-connect'));
});

afterEach(() => {
  vi.clearAllMocks();
});

async function seedPendingLinearAgent(): Promise<{ orgId: string; integrationId: string }> {
  const slug = `lia-oauth-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: org!.id,
      provider: 'linear_agent',
      pattern: 'agent',
      roles: [],
      status: 'pending',
    })
    .returning({ id: schema.integration.id });
  return { orgId: org!.id, integrationId: row!.id };
}

describe('Linear Agent install callback', () => {
  it('exchanges the code, seals the token pair, and returns to Connections as connected', async () => {
    const seeded = await seedPendingLinearAgent();
    const tokens = {
      accessToken: 'linear-agent-access',
      tokenType: 'Bearer',
      expiresIn: 86_400,
      scope: 'app:mentionable,app:assignable',
      refreshToken: 'linear-agent-refresh',
    };
    exchangeLinearAgentCode.mockResolvedValue(tokens);
    const state = signLinearAgentInstallState({
      integrationId: seeded.integrationId,
      orgId: seeded.orgId,
    });
    const app = new Hono().route('/', integrationsLinearAgentOauth);

    const response = await app.request(
      `/callback?code=approval-code&state=${encodeURIComponent(state)}`,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `https://docket.localhost/orgs/${seeded.orgId}/settings/connections?linear_agent=connected`,
    );

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
          eq(schema.integration.provider, 'linear_agent'),
        ),
      );
    expect(stored?.status).toBe('connected');
    expect(stored?.lastError).toBeNull();
    expect(JSON.parse(unsealCredential(stored!.ciphertext))).toEqual(tokens);
    expect(exchangeLinearAgentCode).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'agent-client-id',
        clientSecret: 'agent-client-secret',
        redirectUri: 'https://api.docket.test/internal/integrations/linear-agent/callback',
        code: 'approval-code',
      }),
    );
  });

  it('rejects a callback whose state is missing or invalid without touching an integration', async () => {
    const app = new Hono().route('/', integrationsLinearAgentOauth);
    const response = await app.request('/callback?code=approval-code&state=not-signed');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/?linear_agent=error');
    expect(exchangeLinearAgentCode).not.toHaveBeenCalled();
  });

  it('records an error when Linear redirects back without a code', async () => {
    const seeded = await seedPendingLinearAgent();
    const state = signLinearAgentInstallState({
      integrationId: seeded.integrationId,
      orgId: seeded.orgId,
    });
    const app = new Hono().route('/', integrationsLinearAgentOauth);

    const response = await app.request(`/callback?state=${encodeURIComponent(state)}`);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain(
      `/orgs/${seeded.orgId}/settings/connections?linear_agent=error`,
    );
    const [row] = await db
      .select({ status: schema.integration.status, lastError: schema.integration.lastError })
      .from(schema.integration)
      .where(eq(schema.integration.id, seeded.integrationId));
    expect(row?.status).toBe('error');
    expect(row?.lastError).toBe('Linear Agent authorization was not completed');
  });

  it('records the failure reason when the code exchange throws', async () => {
    const seeded = await seedPendingLinearAgent();
    exchangeLinearAgentCode.mockRejectedValue(new Error('invalid_grant'));
    const state = signLinearAgentInstallState({
      integrationId: seeded.integrationId,
      orgId: seeded.orgId,
    });
    const app = new Hono().route('/', integrationsLinearAgentOauth);

    const response = await app.request(
      `/callback?code=approval-code&state=${encodeURIComponent(state)}`,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('linear_agent=error');
    const [row] = await db
      .select({ status: schema.integration.status, lastError: schema.integration.lastError })
      .from(schema.integration)
      .where(eq(schema.integration.id, seeded.integrationId));
    expect(row?.status).toBe('error');
    expect(row?.lastError).toBe('invalid_grant');
  });
});
