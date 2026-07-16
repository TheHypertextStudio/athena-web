import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

import type * as DbModule from '@docket/db';
import type { PersonalMcpConnectionOut } from '@docket/types';

import type personalAthenaRouter from '../../src/routes/personal-athena';
import type { openToolbox as OpenToolbox } from '../../src/agent/toolbox';
import type { unsealCredential as UnsealCredential } from '../../src/lib/credentials';
import { appWithSession, fakeSession, getDb, one } from '../support/routes-harness';

const JSON_HEADERS = { 'content-type': 'application/json' };

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let personalAthena!: typeof personalAthenaRouter;
let openToolbox!: typeof OpenToolbox;
let unsealCredential!: typeof UnsealCredential;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  personalAthena = (await import('../../src/routes/personal-athena')).default;
  ({ openToolbox } = await import('../../src/agent/toolbox'));
  ({ unsealCredential } = await import('../../src/lib/credentials'));
});

async function seedUser(label: string): Promise<string> {
  return one(
    await db
      .insert(schema.user)
      .values({ name: label, email: `${label}-${Math.random().toString(36).slice(2)}@example.com` })
      .returning({ id: schema.user.id }),
  ).id;
}

async function connect(
  userId: string,
  input: Partial<Record<'name' | 'alias' | 'authMode' | 'bearerToken', string>> = {},
): Promise<PersonalMcpConnectionOut> {
  const app = appWithSession(personalAthena, fakeSession(userId));
  const response = await app.request('/connections', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      url: 'https://mcp.sunsama.com/mcp',
      name: 'Sunsama',
      alias: 'sunsama',
      authMode: 'none',
      ...input,
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PersonalMcpConnectionOut;
}

describe('personal Athena MCP connections', () => {
  it('discovers the server name and keeps it visible on every response', async () => {
    const userId = await seedUser('Metadata');
    const app = appWithSession(personalAthena, fakeSession(userId));
    const preview = await app.request('/connections/preview', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ url: 'https://mcp.sunsama.com/mcp' }),
    });
    expect(await preview.json()).toEqual({ name: 'Sunsama' });

    const created = await connect(userId);
    expect(created).toMatchObject({ name: 'Sunsama', status: 'connected', toolCount: 2 });
    const updated = await app.request(`/connections/${created.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Daily planning' }),
    });
    expect(await updated.json()).toMatchObject({ name: 'Daily planning', alias: 'sunsama' });
  });

  it('isolates two users in the same workspace while the owner can reuse the connection', async () => {
    const ownerUserId = await seedUser('Owner');
    const otherUserId = await seedUser('Other');
    const created = await connect(ownerUserId);

    const ownerApp = appWithSession(personalAthena, fakeSession(ownerUserId));
    const otherApp = appWithSession(personalAthena, fakeSession(otherUserId));
    expect((await (await ownerApp.request('/connections')).json()) as unknown[]).toHaveLength(1);
    expect((await (await otherApp.request('/connections')).json()) as unknown[]).toHaveLength(0);
    expect(
      (await otherApp.request(`/connections/${created.id}/reconnect`, { method: 'POST' })).status,
    ).toBe(404);

    const toolbox = await openToolbox({ kind: 'athena', ownerUserId });
    try {
      expect(toolbox.tools.some((tool) => tool.name === 'sunsama__get_backlog_tasks')).toBe(true);
      const result = await toolbox.callTool('sunsama__get_backlog_tasks', {});
      expect(result.isError).toBe(false);
      expect(result.content).toContain('Book the venue for the offsite');
    } finally {
      await toolbox.close();
    }
  });

  it('encrypts credentials and deletion revokes the remote tools', async () => {
    const userId = await seedUser('Bearer');
    const created = await connect(userId, {
      authMode: 'bearer',
      bearerToken: 'owner-secret-token',
    });
    const credential = one(
      await db
        .select()
        .from(schema.personalMcpCredential)
        .where(eq(schema.personalMcpCredential.connectionId, created.id)),
    );
    expect(credential.ownerUserId).toBe(userId);
    expect(credential.ciphertext).not.toContain('owner-secret-token');
    expect(unsealCredential(credential.ciphertext)).toBe('owner-secret-token');

    const app = appWithSession(personalAthena, fakeSession(userId));
    expect((await app.request(`/connections/${created.id}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect(
      await db
        .select()
        .from(schema.personalMcpCredential)
        .where(eq(schema.personalMcpCredential.connectionId, created.id)),
    ).toHaveLength(0);
    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    try {
      expect(toolbox.tools.some((tool) => tool.name.startsWith('sunsama__'))).toBe(false);
    } finally {
      await toolbox.close();
    }
  });

  it('keeps workspace MCP connections available only to registered agents', async () => {
    const ownerUserId = await seedUser('Compatibility');
    const [org] = await db
      .insert(schema.organization)
      .values({ name: 'Compat', slug: `compat-${Math.random().toString(36).slice(2)}` })
      .returning({ id: schema.organization.id });
    const [agentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: org!.id, kind: 'agent', displayName: 'Registered' })
      .returning({ id: schema.actor.id });
    const [registered] = await db
      .insert(schema.agent)
      .values({ organizationId: org!.id, actorId: agentActor!.id })
      .returning({ id: schema.agent.id });
    await db.insert(schema.integration).values({
      organizationId: org!.id,
      provider: 'mcp',
      pattern: 'connector',
      roles: ['work'],
      status: 'connected',
      syncCadenceMinutes: null,
      config: {
        url: 'https://mcp.sunsama.com/mcp',
        label: 'Workspace source',
        alias: 'workspace_source',
        authMode: 'none',
      },
    });

    const athena = await openToolbox({ kind: 'athena', ownerUserId });
    const agent = await openToolbox({
      kind: 'registered_agent',
      organizationId: org!.id,
      agentId: registered!.id,
    });
    try {
      expect(athena.tools.some((tool) => tool.name.startsWith('workspace_source__'))).toBe(false);
      expect(agent.tools.some((tool) => tool.name === 'workspace_source__get_backlog_tasks')).toBe(
        true,
      );
    } finally {
      await athena.close();
      await agent.close();
    }
  });
});
