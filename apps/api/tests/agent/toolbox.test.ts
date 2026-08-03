/**
 * `@docket/api` — the toolbox's remote-MCP connection handling: oauth-token selection, silent
 * token refresh, and the connection-error branches that must never throw out of `openToolbox`.
 *
 * @remarks
 * `tests/routes/personal-athena-connections.test.ts` covers the personal connection *route*
 * (creation, verification-on-connect, deletion). This file is scoped to `openToolbox` itself: what
 * it does with an already-`connected` row whose credential or reachability has changed since.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // sealCredential/unsealCredential need a real 32-byte key; the shared API_TEST_ENV omits one
  // because most suites never seal a credential.
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

const { refreshMcpOAuthCredential } = vi.hoisted(() => ({ refreshMcpOAuthCredential: vi.fn() }));
vi.mock('@docket/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof IntegrationsModule>()),
  refreshMcpOAuthCredential,
}));

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';

import type { openToolbox as OpenToolbox } from '../../src/agent/toolbox';
import type { getContainer as GetContainer } from '../../src/container';
import type { sealCredential as SealCredential } from '../../src/lib/credentials';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let openToolbox!: typeof OpenToolbox;
let sealCredential!: typeof SealCredential;
let getContainer!: typeof GetContainer;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ openToolbox } = await import('../../src/agent/toolbox'));
  ({ sealCredential } = await import('../../src/lib/credentials'));
  ({ getContainer } = await import('../../src/container'));
});

async function seedUser(label: string): Promise<string> {
  const [row] = await db
    .insert(schema.user)
    .values({ name: label, email: `${label}-${Math.random().toString(36).slice(2)}@x.test` })
    .returning({ id: schema.user.id });
  return row!.id;
}

/** Seed a workspace with one registered agent, returning what `openToolbox` needs. */
async function seedRegisteredAgent(): Promise<{ organizationId: string; agentId: string }> {
  const slug = `tb-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [actor] = await db
    .insert(schema.actor)
    .values({ organizationId: org!.id, kind: 'agent', displayName: 'Registered' })
    .returning({ id: schema.actor.id });
  const [registered] = await db
    .insert(schema.agent)
    .values({ organizationId: org!.id, actorId: actor!.id })
    .returning({ id: schema.agent.id });
  return { organizationId: org!.id, agentId: registered!.id };
}

const STALE_OAUTH = {
  kind: 'mcp_oauth' as const,
  tokens: {
    access_token: 'stale-token',
    refresh_token: 'refresh-1',
    token_type: 'bearer' as const,
    expires_in: 3600,
  },
  clientInformation: { client_id: 'client-1' },
  discoveryState: { authorizationServerUrl: 'https://mcp.sunsama.com/authorize' },
  // Obtained long enough ago that `mcpOAuthTokenNeedsRefresh` reports true unconditionally.
  obtainedAt: '2000-01-01T00:00:00.000Z',
};

const REFRESHED_OAUTH = {
  kind: 'mcp_oauth' as const,
  tokens: {
    access_token: 'refreshed-token',
    refresh_token: 'refresh-1',
    token_type: 'bearer' as const,
    expires_in: 3600,
  },
  obtainedAt: new Date().toISOString(),
};

describe('openToolbox — personal (Athena) remote MCP connections', () => {
  it('sends a fresh mcp_oauth access token as the bearer credential, unrefreshed', async () => {
    const userId = await seedUser('OAuthFresh');
    const [conn] = await db
      .insert(schema.personalMcpConnection)
      .values({
        ownerUserId: userId,
        name: 'Sunsama',
        alias: 'sunsama',
        url: 'https://mcp.sunsama.com/mcp',
        authMode: 'oauth',
        status: 'connected',
      })
      .returning({ id: schema.personalMcpConnection.id });
    await db.insert(schema.personalMcpCredential).values({
      connectionId: conn!.id,
      ownerUserId: userId,
      // No `expires_in`, so `mcpOAuthTokenNeedsRefresh` short-circuits false: never refreshed.
      ciphertext: sealCredential(
        JSON.stringify({
          kind: 'mcp_oauth',
          tokens: { access_token: 'fresh-token', token_type: 'bearer' },
          obtainedAt: new Date().toISOString(),
        }),
      ),
    });
    const openSpy = vi.spyOn(getContainer().mcpConnector, 'open');

    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    try {
      expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ bearerToken: 'fresh-token' }));
      expect(refreshMcpOAuthCredential).not.toHaveBeenCalled();
    } finally {
      await toolbox.close();
      openSpy.mockRestore();
    }
  });

  it('leaves the bearer token unset for a still-pending oauth approval', async () => {
    const userId = await seedUser('OAuthPending');
    const [conn] = await db
      .insert(schema.personalMcpConnection)
      .values({
        ownerUserId: userId,
        name: 'Sunsama',
        alias: 'sunsama',
        url: 'https://mcp.sunsama.com/mcp',
        authMode: 'oauth',
        status: 'connected',
      })
      .returning({ id: schema.personalMcpConnection.id });
    await db.insert(schema.personalMcpCredential).values({
      connectionId: conn!.id,
      ownerUserId: userId,
      ciphertext: sealCredential(
        JSON.stringify({ kind: 'mcp_oauth_pending', codeVerifier: 'verifier-x' }),
      ),
    });
    const openSpy = vi.spyOn(getContainer().mcpConnector, 'open');

    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    try {
      expect(openSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ bearerToken: expect.anything() }),
      );
    } finally {
      await toolbox.close();
      openSpy.mockRestore();
    }
  });

  it('silently refreshes a stale oauth token and persists it back for the Athena owner', async () => {
    refreshMcpOAuthCredential.mockReset();
    refreshMcpOAuthCredential.mockResolvedValueOnce(REFRESHED_OAUTH);
    const userId = await seedUser('OAuthRefreshAthena');
    const [conn] = await db
      .insert(schema.personalMcpConnection)
      .values({
        ownerUserId: userId,
        name: 'Sunsama',
        alias: 'sunsama',
        url: 'https://mcp.sunsama.com/mcp',
        authMode: 'oauth',
        status: 'connected',
      })
      .returning({ id: schema.personalMcpConnection.id });
    await db.insert(schema.personalMcpCredential).values({
      connectionId: conn!.id,
      ownerUserId: userId,
      ciphertext: sealCredential(JSON.stringify(STALE_OAUTH)),
    });
    const openSpy = vi.spyOn(getContainer().mcpConnector, 'open');

    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    try {
      expect(refreshMcpOAuthCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: expect.objectContaining({ access_token: 'stale-token' }),
        }),
      );
      expect(openSpy).toHaveBeenCalledWith(
        expect.objectContaining({ bearerToken: 'refreshed-token' }),
      );
      const [persisted] = await db
        .select({ ciphertext: schema.personalMcpCredential.ciphertext })
        .from(schema.personalMcpCredential)
        .where(eq(schema.personalMcpCredential.connectionId, conn!.id));
      const { unsealCredential } = await import('../../src/lib/credentials');
      expect(unsealCredential(persisted!.ciphertext)).toContain('refreshed-token');
    } finally {
      await toolbox.close();
      openSpy.mockRestore();
    }
  });

  it('marks a personal connection errored, without throwing, when its server is unreachable', async () => {
    const userId = await seedUser('Unreachable');
    await db.insert(schema.personalMcpConnection).values({
      ownerUserId: userId,
      name: 'Ghost',
      alias: 'ghost',
      url: 'https://mcp.does-not-exist.example/mcp',
      authMode: 'none',
      status: 'connected',
    });

    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    try {
      expect(toolbox.tools.some((tool) => tool.name.startsWith('ghost__'))).toBe(false);
    } finally {
      await toolbox.close();
    }
    const [row] = await db
      .select()
      .from(schema.personalMcpConnection)
      .where(eq(schema.personalMcpConnection.ownerUserId, userId));
    expect(row).toMatchObject({ status: 'error' });
    expect(row?.lastError).toContain('No MCP server reachable');
    expect(row?.lastErrorAt).toBeInstanceOf(Date);
  });

  it('records a non-Error connection failure with the generic fallback message', async () => {
    const userId = await seedUser('WeirdThrow');
    await db.insert(schema.personalMcpConnection).values({
      ownerUserId: userId,
      name: 'Odd',
      alias: 'odd',
      url: 'https://mcp.sunsama.com/mcp',
      authMode: 'none',
      status: 'connected',
    });
    const openSpy = vi
      .spyOn(getContainer().mcpConnector, 'open')
      .mockRejectedValueOnce('a plain string rejection, not an Error');

    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    await toolbox.close();
    openSpy.mockRestore();

    const [row] = await db
      .select()
      .from(schema.personalMcpConnection)
      .where(eq(schema.personalMcpConnection.ownerUserId, userId));
    expect(row).toMatchObject({ status: 'error', lastError: 'Connection failed' });
  });

  it('defaults a tool call with no input to an empty argument object', async () => {
    const userId = await seedUser('DefaultArgs');
    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    try {
      // `capture` requires `orgId`/`text`; calling with no input at all exercises the `input ?? {}`
      // fallback and still comes back as a normal (failed) tool result, never a thrown exception.
      const result = await toolbox.callTool('capture', undefined);
      expect(result.isError).toBe(true);
    } finally {
      await toolbox.close();
    }
  });
});

describe('openToolbox — registered-agent remote MCP connections', () => {
  it('silently refreshes a stale oauth token and persists it back for the registered agent', async () => {
    refreshMcpOAuthCredential.mockReset();
    refreshMcpOAuthCredential.mockResolvedValueOnce(REFRESHED_OAUTH);
    const { organizationId, agentId } = await seedRegisteredAgent();
    const [integrationRow] = await db
      .insert(schema.integration)
      .values({
        organizationId,
        provider: 'mcp',
        pattern: 'connector',
        roles: ['work'],
        status: 'connected',
        syncCadenceMinutes: null,
        config: {
          url: 'https://mcp.sunsama.com/mcp',
          label: 'Workspace source',
          alias: 'workspace_source',
          authMode: 'oauth',
        },
      })
      .returning({ id: schema.integration.id });
    await db.insert(schema.integrationCredential).values({
      organizationId,
      integrationId: integrationRow!.id,
      ciphertext: sealCredential(JSON.stringify(STALE_OAUTH)),
    });
    const openSpy = vi.spyOn(getContainer().mcpConnector, 'open');

    const toolbox = await openToolbox({ kind: 'registered_agent', organizationId, agentId });
    try {
      expect(refreshMcpOAuthCredential).toHaveBeenCalledOnce();
      expect(openSpy).toHaveBeenCalledWith(
        expect.objectContaining({ bearerToken: 'refreshed-token' }),
      );
      const [persisted] = await db
        .select({ ciphertext: schema.integrationCredential.ciphertext })
        .from(schema.integrationCredential)
        .where(eq(schema.integrationCredential.integrationId, integrationRow!.id));
      const { unsealCredential } = await import('../../src/lib/credentials');
      expect(unsealCredential(persisted!.ciphertext)).toContain('refreshed-token');
    } finally {
      await toolbox.close();
      openSpy.mockRestore();
    }
  });

  it('marks a workspace integration errored, without throwing, when its server is unreachable', async () => {
    const { organizationId, agentId } = await seedRegisteredAgent();
    const [integrationRow] = await db
      .insert(schema.integration)
      .values({
        organizationId,
        provider: 'mcp',
        pattern: 'connector',
        roles: ['work'],
        status: 'connected',
        syncCadenceMinutes: null,
        config: {
          url: 'https://mcp.does-not-exist.example/mcp',
          label: 'Ghost workspace source',
          alias: 'ghost_source',
          authMode: 'none',
        },
      })
      .returning({ id: schema.integration.id });

    const toolbox = await openToolbox({ kind: 'registered_agent', organizationId, agentId });
    try {
      expect(toolbox.tools.some((tool) => tool.name.startsWith('ghost_source__'))).toBe(false);
    } finally {
      await toolbox.close();
    }
    const [row] = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.id, integrationRow!.id));
    expect(row).toMatchObject({ status: 'error' });
    expect(row?.lastError).toContain('No MCP server reachable');
  });
});
