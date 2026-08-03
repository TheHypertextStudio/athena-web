import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

const { beginMcpOAuthAuthorization } = vi.hoisted(() => ({
  beginMcpOAuthAuthorization: vi.fn(),
}));

vi.mock('@docket/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof IntegrationsModule>()),
  beginMcpOAuthAuthorization,
}));

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';
import type { PersonalMcpConnectionOut } from '@docket/types';

import { env } from '../../src/env';
import type personalAthenaRouter from '../../src/routes/personal-athena';
import type {
  loadPersonalMcpConnection as LoadPersonalMcpConnection,
  verifyPersonalMcpConnection as VerifyPersonalMcpConnection,
} from '../../src/routes/personal-athena';
import type { getContainer as GetContainer } from '../../src/container';
import type { openToolbox as OpenToolbox } from '../../src/agent/toolbox';
import type {
  sealCredential as SealCredential,
  unsealCredential as UnsealCredential,
} from '../../src/lib/credentials';
import { appWithSession, fakeSession, getDb, one } from '../support/routes-harness';

const JSON_HEADERS = { 'content-type': 'application/json' };

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let personalAthena!: typeof personalAthenaRouter;
let openToolbox!: typeof OpenToolbox;
let sealCredential!: typeof SealCredential;
let unsealCredential!: typeof UnsealCredential;
let getContainer!: typeof GetContainer;
let verifyPersonalMcpConnection!: typeof VerifyPersonalMcpConnection;
let loadPersonalMcpConnection!: typeof LoadPersonalMcpConnection;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({
    default: personalAthena,
    verifyPersonalMcpConnection,
    loadPersonalMcpConnection,
  } = await import('../../src/routes/personal-athena'));
  ({ openToolbox } = await import('../../src/agent/toolbox'));
  ({ sealCredential, unsealCredential } = await import('../../src/lib/credentials'));
  ({ getContainer } = await import('../../src/container'));
});

afterEach(() => {
  beginMcpOAuthAuthorization.mockReset();
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
  input: Partial<Record<'name' | 'alias' | 'authMode' | 'bearerToken' | 'url', string>> = {},
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

  it('refuses every route to a caller with no session', async () => {
    const app = appWithSession(personalAthena, null);
    expect((await app.request('/connections')).status).toBe(401);
  });

  it('leaves an oauth connection pending rather than verifying it eagerly', async () => {
    const userId = await seedUser('OAuthPending');
    const created = await connect(userId, { authMode: 'oauth' });
    expect(created).toMatchObject({ authMode: 'oauth', status: 'pending', toolCount: null });
  });

  it('refuses a second connection that reuses an existing alias or URL', async () => {
    const userId = await seedUser('Duplicate');
    await connect(userId, { alias: 'shared_alias' });

    const byAlias = await appWithSession(personalAthena, fakeSession(userId)).request(
      '/connections',
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          url: 'https://mcp.acme-release.example/mcp',
          name: 'Different server',
          alias: 'shared_alias',
          authMode: 'none',
        }),
      },
    );
    expect(byAlias.status).toBe(409);

    const byUrl = await appWithSession(personalAthena, fakeSession(userId)).request(
      '/connections',
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          url: 'https://mcp.sunsama.com/mcp',
          name: 'Same server, new alias',
          alias: 'a_different_alias',
          authMode: 'none',
        }),
      },
    );
    expect(byUrl.status).toBe(409);
  });

  it('records a connection error rather than throwing when the remote server is unreachable', async () => {
    const userId = await seedUser('Unreachable');
    const app = appWithSession(personalAthena, fakeSession(userId));
    const response = await app.request('/connections', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        url: 'https://mcp.does-not-exist.example/mcp',
        name: 'Ghost server',
        alias: 'ghost',
        authMode: 'none',
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as PersonalMcpConnectionOut;
    expect(body.status).toBe('error');
    expect(body.lastError).toContain('No MCP server reachable');
  });

  it('reconnects using an in-progress OAuth credential with no bearer token yet', async () => {
    const userId = await seedUser('OAuthInProgress');
    const created = await connect(userId, { authMode: 'oauth' });
    await db.insert(schema.personalMcpCredential).values({
      connectionId: created.id,
      ownerUserId: userId,
      ciphertext: sealCredential(
        JSON.stringify({ kind: 'mcp_oauth_pending', codeVerifier: 'pkce' }),
      ),
    });

    const app = appWithSession(personalAthena, fakeSession(userId));
    const response = await app.request(`/connections/${created.id}/reconnect`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect((await response.json()) as PersonalMcpConnectionOut).toMatchObject({
      status: 'connected',
      toolCount: 2,
    });
  });

  it('refuses to rename a connection into an alias another connection already owns', async () => {
    const userId = await seedUser('AliasConflict');
    await connect(userId, { alias: 'taken' });
    const other = await connect(userId, {
      alias: 'free',
      url: 'https://mcp.acme-release.example/mcp',
    });

    const app = appWithSession(personalAthena, fakeSession(userId));
    const response = await app.request(`/connections/${other.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ alias: 'taken' }),
    });
    expect(response.status).toBe(409);
  });

  it('starts an OAuth approval and persists its encrypted pending state', async () => {
    beginMcpOAuthAuthorization.mockResolvedValue({
      authorizationUrl: 'https://mcp.sunsama.com/authorize?state=abc',
      credential: { kind: 'mcp_oauth_pending', codeVerifier: 'verifier-value' },
    });
    const userId = await seedUser('OAuthStart');
    const created = await connect(userId, { authMode: 'oauth' });

    const app = appWithSession(personalAthena, fakeSession(userId));
    const response = await app.request(`/connections/${created.id}/authorize`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect((await response.json()) as { authorizationUrl: string }).toEqual({
      authorizationUrl: 'https://mcp.sunsama.com/authorize?state=abc',
    });
    expect(beginMcpOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: created.url, clientMetadataUrl: expect.any(String) }),
    );
    const credential = one(
      await db
        .select()
        .from(schema.personalMcpCredential)
        .where(eq(schema.personalMcpCredential.connectionId, created.id)),
    );
    expect(unsealCredential(credential.ciphertext)).toContain('mcp_oauth_pending');
  });

  it('omits the client metadata URL when the API is not served over HTTPS', async () => {
    beginMcpOAuthAuthorization.mockResolvedValue({
      authorizationUrl: 'https://mcp.sunsama.com/authorize?state=abc',
      credential: { kind: 'mcp_oauth_pending', codeVerifier: 'verifier-value' },
    });
    // `env` is typed `Readonly<...>` (its values are meant to come only from validated process
    // env), but it is a plain object at runtime — mutating it here for one test, then restoring
    // it, is the same technique `tests/lib/slack-app.test.ts` uses for its own `env` overrides.
    const mutableEnv = env as { API_URL: string };
    const originalApiUrl = mutableEnv.API_URL;
    mutableEnv.API_URL = 'http://api.docket.localhost';
    try {
      const userId = await seedUser('OAuthInsecure');
      const created = await connect(userId, { authMode: 'oauth' });
      const app = appWithSession(personalAthena, fakeSession(userId));
      const response = await app.request(`/connections/${created.id}/authorize`, {
        method: 'POST',
      });
      expect(response.status).toBe(200);
      expect(beginMcpOAuthAuthorization).toHaveBeenCalledWith(
        expect.not.objectContaining({ clientMetadataUrl: expect.anything() }),
      );
    } finally {
      mutableEnv.API_URL = originalApiUrl;
    }
  });

  it('refuses to start OAuth for a connection that does not use it', async () => {
    const userId = await seedUser('NotOAuth');
    const created = await connect(userId, { authMode: 'none' });
    const app = appWithSession(personalAthena, fakeSession(userId));
    const response = await app.request(`/connections/${created.id}/authorize`, { method: 'POST' });
    expect(response.status).toBe(409);
  });

  it('discovers a server name that falls back to its bare identifier with no title', async () => {
    const userId = await seedUser('NoTitle');
    const openSpy = vi.spyOn(getContainer().mcpConnector, 'open').mockResolvedValueOnce({
      serverInfo: () => ({ name: 'bare-server' }),
      listTools: async () => [],
      callTool: async () => ({ content: '', isError: false }),
      close: async () => undefined,
    });
    const app = appWithSession(personalAthena, fakeSession(userId));
    const preview = await app.request('/connections/preview', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ url: 'https://mcp.no-title.example/mcp' }),
    });
    expect(await preview.json()).toEqual({ name: 'bare-server' });
    openSpy.mockRestore();
  });

  it('uses a completed OAuth token as the bearer credential on reconnect', async () => {
    const userId = await seedUser('OAuthCompleted');
    const created = await connect(userId, { authMode: 'oauth' });
    await db.insert(schema.personalMcpCredential).values({
      connectionId: created.id,
      ownerUserId: userId,
      ciphertext: sealCredential(
        JSON.stringify({
          kind: 'mcp_oauth',
          tokens: { access_token: 'real-access-token', token_type: 'bearer' },
          obtainedAt: new Date().toISOString(),
        }),
      ),
    });
    const openSpy = vi.spyOn(getContainer().mcpConnector, 'open');

    const app = appWithSession(personalAthena, fakeSession(userId));
    const response = await app.request(`/connections/${created.id}/reconnect`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect((await response.json()) as PersonalMcpConnectionOut).toMatchObject({
      status: 'connected',
    });
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ bearerToken: 'real-access-token' }),
    );
    openSpy.mockRestore();
  });

  it('records a non-Error connection failure with a generic message', async () => {
    const userId = await seedUser('WeirdThrow');
    const openSpy = vi
      .spyOn(getContainer().mcpConnector, 'open')
      .mockRejectedValueOnce('a plain string rejection, not an Error');
    const app = appWithSession(personalAthena, fakeSession(userId));

    const response = await app.request('/connections', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        url: 'https://mcp.weird-throw.example/mcp',
        name: 'Odd server',
        alias: 'odd',
        authMode: 'none',
      }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as PersonalMcpConnectionOut).toMatchObject({
      status: 'error',
      lastError: 'Connection failed',
    });
    openSpy.mockRestore();
  });

  it('refuses to verify a connection that vanished between its load and its health check', async () => {
    const userId = await seedUser('VanishingConnection');
    const created = await connect(userId);
    const row = await loadPersonalMcpConnection(userId, created.id);
    await db
      .delete(schema.personalMcpConnection)
      .where(eq(schema.personalMcpConnection.id, row.id));

    await expect(verifyPersonalMcpConnection(row)).rejects.toThrow('Connection not found');
  });

  it('renames a connection to a genuinely new alias with no conflict', async () => {
    const userId = await seedUser('RenameFree');
    const created = await connect(userId, { alias: 'old_alias' });
    const app = appWithSession(personalAthena, fakeSession(userId));
    const response = await app.request(`/connections/${created.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ alias: 'new_alias' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as PersonalMcpConnectionOut).toMatchObject({
      alias: 'new_alias',
    });
  });

  it('hides an edit that lost a race with the connection’s own deletion', async () => {
    const userId = await seedUser('RaceDelete');
    const created = await connect(userId);
    const app = appWithSession(personalAthena, fakeSession(userId));

    const [patchResponse, deleteResponse] = await Promise.all([
      app.request(`/connections/${created.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'Renamed mid-delete' }),
      }),
      app.request(`/connections/${created.id}`, { method: 'DELETE' }),
    ]);

    // Exactly one of the two racing requests observed the row still there to act on; the other
    // found it already gone. Both outcomes are a defended not-found, never a crash or a silent
    // write to a deleted row.
    const statuses = [patchResponse.status, deleteResponse.status].sort();
    expect(statuses).toEqual([200, 404].sort());
  });
});
