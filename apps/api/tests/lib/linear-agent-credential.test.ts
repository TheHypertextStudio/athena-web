import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';
import type * as ContainerModule from '../../src/container';
import type { buildLinearAgentPortForIntegration as BuildLinearAgentPortForIntegration } from '../../src/lib/linear-agent-credential';
import type { sealCredential as SealCredential } from '../../src/lib/credentials';

const { buildLinearAgentClient } = vi.hoisted(() => ({
  buildLinearAgentClient: vi.fn(),
}));

const { refreshLinearAgentToken } = vi.hoisted(() => ({
  refreshLinearAgentToken: vi.fn(),
}));

vi.mock('../../src/container', async (importOriginal) => ({
  ...(await importOriginal<typeof ContainerModule>()),
  buildLinearAgentClient,
}));

vi.mock('@docket/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof IntegrationsModule>()),
  refreshLinearAgentToken,
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
  process.env['LINEAR_AGENT_CLIENT_ID'] = 'agent-client-id';
  process.env['LINEAR_AGENT_CLIENT_SECRET'] = 'agent-client-secret';
  process.env['LINEAR_AGENT_WEBHOOK_SECRET'] = 'agent-webhook-secret';
});

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let buildLinearAgentPortForIntegration!: typeof BuildLinearAgentPortForIntegration;
let sealCredential!: typeof SealCredential;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ({ buildLinearAgentPortForIntegration } = await import('../../src/lib/linear-agent-credential'));
  ({ sealCredential } = await import('../../src/lib/credentials'));
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Seed a connected `linear_agent` integration with the given sealed credential JSON. */
async function seedLinearAgentIntegration(
  credential: Record<string, unknown>,
): Promise<{ orgId: string; integrationId: string }> {
  const slug = `lac-${Math.random().toString(36).slice(2, 10)}`;
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
      status: 'connected',
    })
    .returning({ id: schema.integration.id });
  await db.insert(schema.integrationCredential).values({
    organizationId: org!.id,
    integrationId: row!.id,
    ciphertext: sealCredential(JSON.stringify(credential)),
  });
  return { orgId: org!.id, integrationId: row!.id };
}

describe('buildLinearAgentPortForIntegration', () => {
  it('uses the stored access token as-is when it is fresh', async () => {
    const seeded = await seedLinearAgentIntegration({
      accessToken: 'fresh-token',
      tokenType: 'Bearer',
      scope: 'app:mentionable,app:assignable',
      refreshToken: 'refresh-token',
      expiresIn: 86_400,
      obtainedAt: new Date().toISOString(),
    });

    await buildLinearAgentPortForIntegration(seeded.integrationId);

    expect(buildLinearAgentClient).toHaveBeenCalledWith('fresh-token');
    expect(refreshLinearAgentToken).not.toHaveBeenCalled();
  });

  it('uses the token as-is when the stored credential predates obtainedAt tracking', async () => {
    const seeded = await seedLinearAgentIntegration({ accessToken: 'legacy-token' });

    await buildLinearAgentPortForIntegration(seeded.integrationId);

    expect(buildLinearAgentClient).toHaveBeenCalledWith('legacy-token');
    expect(refreshLinearAgentToken).not.toHaveBeenCalled();
  });

  it('refreshes a token nearing its 24h expiry before building the port, and re-seals it', async () => {
    const obtainedAt = new Date(Date.now() - 86_400_000).toISOString(); // obtained ~24h ago
    const seeded = await seedLinearAgentIntegration({
      accessToken: 'stale-token',
      tokenType: 'Bearer',
      scope: 'app:mentionable,app:assignable',
      refreshToken: 'refresh-token',
      expiresIn: 86_400,
      obtainedAt,
    });
    refreshLinearAgentToken.mockResolvedValue({
      accessToken: 'fresh-token-2',
      tokenType: 'Bearer',
      scope: 'app:mentionable,app:assignable',
      expiresIn: 86_400,
      refreshToken: 'refresh-token-2',
    });

    await buildLinearAgentPortForIntegration(seeded.integrationId);

    expect(refreshLinearAgentToken).toHaveBeenCalledWith({
      clientId: 'agent-client-id',
      clientSecret: 'agent-client-secret',
      refreshToken: 'refresh-token',
    });
    expect(buildLinearAgentClient).toHaveBeenCalledWith('fresh-token-2');

    const { unsealCredential } = await import('../../src/lib/credentials');
    const [credentialRow] = await db
      .select({ ciphertext: schema.integrationCredential.ciphertext })
      .from(schema.integrationCredential)
      .where(eq(schema.integrationCredential.integrationId, seeded.integrationId));
    const stored = JSON.parse(unsealCredential(credentialRow!.ciphertext));
    expect(stored.accessToken).toBe('fresh-token-2');
    expect(stored.refreshToken).toBe('refresh-token-2');
  });

  it('degrades the integration to error (not a thrown exception) when refresh fails', async () => {
    const obtainedAt = new Date(Date.now() - 86_400_000).toISOString();
    const seeded = await seedLinearAgentIntegration({
      accessToken: 'stale-token',
      tokenType: 'Bearer',
      scope: 'app:mentionable,app:assignable',
      refreshToken: 'revoked-refresh-token',
      expiresIn: 86_400,
      obtainedAt,
    });
    refreshLinearAgentToken.mockRejectedValue(new Error('invalid_grant'));

    const port = await buildLinearAgentPortForIntegration(seeded.integrationId);

    expect(port).toBeNull();
    expect(buildLinearAgentClient).not.toHaveBeenCalled();
    const [row] = await db
      .select({ status: schema.integration.status, lastError: schema.integration.lastError })
      .from(schema.integration)
      .where(eq(schema.integration.id, seeded.integrationId));
    expect(row?.status).toBe('error');
    expect(row?.lastError).toBe('invalid_grant');
  });
});
