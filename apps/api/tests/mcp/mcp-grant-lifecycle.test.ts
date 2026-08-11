/**
 * MISS-05 — the life of an OAuth grant, from "the consent screen said so" to "it is revoked".
 *
 * @remarks
 * The consent screen at `/oauth/authorize` promises a person that an outside app will be able to
 * do exactly the things listed and nothing else. That promise is only true if every permission the
 * authorization server can issue has an enforcement point behind it, so this suite walks
 * `OAUTH_ISSUABLE_SCOPES` rather than a hand-written list of the interesting ones.
 *
 * `mcp-scope.test.ts` already covers the `work:read`/`work:write` axis in depth. This file closes
 * what it left open:
 *
 * - `agents:run` and `connectors:link` were only ever asserted to *appear* in the challenge
 *   string. Here they are exercised in both directions — denied without the permission, and
 *   carried through to a real write with it.
 * - An invalid or expired credential answers 401 with the discovery-pointing challenge.
 * - Revoking a grant from the user's own settings tears down the stored authorization.
 *
 * Same mocking approach as `mcp-scope.test.ts`: `tests/support/auth-mock` stands in for Better
 * Auth's boundary and `tests/support/db` supplies a migrated PGlite.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import { OAUTH_ISSUABLE_SCOPES, type Capability } from '@docket/types';

import type * as AuthModule from '../../src/mcp/auth';
import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type * as ScopeModule from '../../src/mcp/scope';
import type * as ServerModule from '../../src/mcp/server';
import { getSession, resetAuthMocks, verifyAccessToken } from '../support/auth-mock';
import { getMigratedDb, grantDocketPro } from '../support/db';
import { seedConsentedClient } from '../support/oauth-grant';
import type * as RoutesHarness from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let scopeMod!: typeof ScopeModule;
let serverMod!: typeof ServerModule;
let authMod!: typeof AuthModule;
let connectedAppsRouter!: unknown;
/**
 * The shared route harness, imported lazily.
 *
 * @remarks
 * Deliberately NOT a static import. `routes-harness` reaches the DI container, which loads the
 * API env slice — and that slice snapshots `process.env` the first time it is imported. A static
 * import would therefore run before the `vi.stubEnv` calls below, leaving `MCP_RESOURCE_URL`
 * unset, and every Bearer request in this file would be refused as "tokens are not accepted on
 * this resource" — a 401 that looks exactly like a bad credential.
 */
let harness!: typeof RoutesHarness;

beforeAll(async () => {
  // Configure OAuth before importing MCP modules that read the API env slice.
  vi.stubEnv('MCP_ISSUER_URL', 'https://auth.docket.test');
  vi.stubEnv('MCP_RESOURCE_URL', 'https://api.docket.test/mcp');
  vi.stubEnv('WEB_URL', 'https://docket.test');
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  scopeMod = await import('../../src/mcp/scope');
  serverMod = await import('../../src/mcp/server');
  authMod = await import('../../src/mcp/auth');
  connectedAppsRouter = (await import('../../src/routes/connected-apps')).default;
  harness = await import('../support/routes-harness');
});

afterEach(() => {
  resetAuthMocks();
});

/** Everything one seeded workspace exposes to a test. */
interface Workspace {
  readonly userId: string;
  readonly email: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly actorId: string;
  /** A registered agent `run_agent` can be pointed at. */
  readonly agentId: string;
  /** A connected integration `link_external` can materialize an item from. */
  readonly integrationId: string;
}

/**
 * Seed an org whose human actor holds `capabilities` org-wide, plus the two rows the
 * `agents:run` and `connectors:link` tools resolve before they write.
 *
 * @remarks
 * Both of those tools 404 on a missing agent/integration *after* the scope gate, so seeding them
 * is what makes "the permission carried the call all the way to a write" distinguishable from
 * "the call died one layer later for an unrelated reason".
 *
 * @param capabilities - Org-wide grant capabilities for the seeded human actor.
 * @returns The seeded ids.
 */
async function seedWorkspace(capabilities: readonly Capability[]): Promise<Workspace> {
  const slug = `gl-${Math.random().toString(36).slice(2, 10)}`;
  const orgId = harness.one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  ).id;
  await grantDocketPro(schema, orgId);

  const roleId = harness.one(
    await db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: 'seeded',
        name: 'Seeded',
        capabilities: [...capabilities],
      })
      .returning({ id: schema.role.id }),
  ).id;

  const email = `${slug}@e.com`;
  const userId = harness.one(
    await db.insert(schema.user).values({ name: 'Ada', email }).returning({ id: schema.user.id }),
  ).id;
  await db.insert(schema.hub).values({ userId });

  const actorId = harness.one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, roleId })
      .returning({ id: schema.actor.id }),
  ).id;

  if (capabilities.length > 0) {
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: roleId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: [...capabilities],
      effect: 'allow',
    });
  }

  const teamId = harness.one(
    await db
      .insert(schema.team)
      .values({
        organizationId: orgId,
        name: 'Core',
        key: `G${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id }),
  ).id;

  const agentActorId = harness.one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id }),
  ).id;
  const agentId = harness.one(
    await db
      .insert(schema.agent)
      .values({ organizationId: orgId, actorId: agentActorId })
      .returning({ id: schema.agent.id }),
  ).id;

  const integrationId = harness.one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'linear',
        pattern: 'connector',
        roles: ['work'],
        status: 'connected',
      })
      .returning({ id: schema.integration.id }),
  ).id;

  return { userId, email, orgId, teamId, actorId, agentId, integrationId };
}

const harnesses: { close(): Promise<void> }[] = [];

/** Connect an identity-bound MCP server carrying exactly `scopes`. */
async function connect(workspace: Workspace, scopes: readonly string[]): Promise<Client> {
  const ctx: McpContext = {
    principal: {
      kind: 'user',
      userId: workspace.userId,
      userName: 'Ada',
      userEmail: workspace.email,
    },
    scopes,
  };
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()!.close();
});

/** The text of a tool result's first content block. */
function text(res: CallToolResult): string {
  return (res.content[0] as { text: string }).text;
}

/** The JSON payload of a successful tool result. */
function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse(text(res)) as Record<string, unknown>;
}

/** A Hono app mounting the real `/mcp` handler, for the HTTP-level challenges. */
function mcpApp(): Hono {
  const app = new Hono();
  app.on(['POST', 'GET'], '/mcp', serverMod.mcpHandler);
  return app;
}

/** Call `/mcp` with an optional bearer credential. */
async function mcpRequest(
  body: unknown,
  credential: string | null,
): Promise<{ status: number; wwwAuthenticate: string; json: () => Promise<unknown> }> {
  const res = await mcpApp().request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(credential === null ? {} : { authorization: `Bearer ${credential}` }),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    wwwAuthenticate: res.headers.get('www-authenticate') ?? '',
    json: () => res.json(),
  };
}

/** A `tools/call` JSON-RPC envelope. */
function toolCall(name: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

describe('every issuable permission has an enforcement point', () => {
  it('gates a tool on each of the four capability permissions', () => {
    // The consent screen lists these; if one of them gated nothing, the screen would be telling a
    // person about access that does not exist — which is the whole of MISS-05.
    const enforced = new Set(Object.values(scopeMod.TOOL_SCOPE));
    for (const scope of scopeMod.MCP_SCOPES) {
      expect(enforced, `${scope} gates no tool`).toContain(scope);
    }
    expect(scopeMod.RESOURCE_READ_SCOPE).toBe('work:read');
  });

  it('advertises exactly the set the authorization server is configured from', () => {
    // `CONNECT_SCOPES` and `oauthProvider({ scopes })` now derive from one array in
    // `@docket/types`, so the resource server cannot advertise a permission the AS will not issue.
    expect([...scopeMod.CONNECT_SCOPES]).toEqual([...OAUTH_ISSUABLE_SCOPES]);
    expect(scopeMod.MCP_SCOPES).not.toContain(scopeMod.OFFLINE_ACCESS_SCOPE);
    expect([...scopeMod.MCP_SCOPES, scopeMod.OFFLINE_ACCESS_SCOPE]).toEqual([
      ...OAUTH_ISSUABLE_SCOPES,
    ]);
  });
});

describe('a credential that was never granted agents:run or connectors:link', () => {
  it('cannot start or steer an agent, however well-granted the person is', async () => {
    // `contribute` + `assign` org-wide: the grant layer would allow all of this. Only the
    // permission the person approved on the consent screen stands in the way.
    const ws = await seedWorkspace(['contribute', 'assign']);
    const client = await connect(ws, ['work:read', 'work:write']);

    const run = (await client.callTool({
      name: 'run_agent',
      arguments: { orgId: ws.orgId, agentId: ws.agentId },
    })) as CallToolResult;
    expect(run.isError).toBe(true);
    expect(text(run)).toContain('agents:run');

    const manage = (await client.callTool({
      name: 'manage_session',
      arguments: { orgId: ws.orgId, sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', action: 'cancel' },
    })) as CallToolResult;
    expect(manage.isError).toBe(true);
    expect(text(manage)).toContain('agents:run');

    // Nothing was started.
    const sessions = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.organizationId, ws.orgId));
    expect(sessions).toHaveLength(0);
  });

  it('cannot link an external item', async () => {
    const ws = await seedWorkspace(['contribute']);
    const client = await connect(ws, ['work:read', 'work:write']);

    const res = (await client.callTool({
      name: 'link_external',
      arguments: {
        orgId: ws.orgId,
        integrationId: ws.integrationId,
        teamId: ws.teamId,
        title: 'Should be blocked',
        externalId: 'ext-blocked',
      },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('connectors:link');

    const linked = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(eq(schema.task.externalId, 'ext-blocked'));
    expect(linked).toHaveLength(0);
  });

  it('gets a 403 with the stable insufficient_scope code over HTTP, for both permissions', async () => {
    const ws = await seedWorkspace(['contribute', 'assign']);
    const { clientId } = await seedConsentedClient(schema, ws.userId, ['work:read']);
    verifyAccessToken.mockResolvedValue({ sub: ws.userId, azp: clientId, scope: 'work:read' });

    for (const [tool, required, args] of [
      ['run_agent', 'agents:run', { orgId: ws.orgId, agentId: ws.agentId }],
      [
        'link_external',
        'connectors:link',
        {
          orgId: ws.orgId,
          integrationId: ws.integrationId,
          teamId: ws.teamId,
          title: 'x',
          externalId: 'ext-403',
        },
      ],
    ] as const) {
      const res = await mcpRequest(toolCall(tool, args), 'read-only');
      expect(res.status, `${tool} must step up`).toBe(403);
      expect(res.wwwAuthenticate).toContain('error="insufficient_scope"');
      expect(res.wwwAuthenticate).toContain(required);
      const problem = (await res.json()) as { code: string; scope: string; type: string };
      // The stable code an outside client branches on — not prose, which is free to change.
      expect(problem.code).toBe('insufficient_scope');
      expect(problem.scope).toBe(required);
      expect(problem.type).toMatch(/\/problems\/insufficient_scope$/);
    }
  });
});

describe('a credential that was granted the permission', () => {
  it('runs an agent and then steers the session it created', async () => {
    const ws = await seedWorkspace(['contribute', 'assign']);
    const client = await connect(ws, ['work:read', 'agents:run']);

    const run = (await client.callTool({
      name: 'run_agent',
      arguments: { orgId: ws.orgId, agentId: ws.agentId, prompt: 'Draft the launch plan' },
    })) as CallToolResult;
    expect(run.isError).toBeFalsy();
    const sessionId = payload(run)['id'];
    expect(sessionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const cancel = (await client.callTool({
      name: 'manage_session',
      arguments: { orgId: ws.orgId, sessionId, action: 'cancel' },
    })) as CallToolResult;
    expect(cancel.isError).toBeFalsy();
    expect(payload(cancel)['status']).toBe('canceled');
  });

  it('links an external item', async () => {
    const ws = await seedWorkspace(['contribute']);
    const client = await connect(ws, ['work:read', 'connectors:link']);

    const res = (await client.callTool({
      name: 'link_external',
      arguments: {
        orgId: ws.orgId,
        integrationId: ws.integrationId,
        teamId: ws.teamId,
        title: 'Imported issue',
        externalId: 'ext-allowed',
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(payload(res)['alreadyLinked']).toBe(false);

    const linked = await db
      .select({ title: schema.task.title })
      .from(schema.task)
      .where(
        and(eq(schema.task.organizationId, ws.orgId), eq(schema.task.externalId, 'ext-allowed')),
      );
    expect(linked).toHaveLength(1);
    expect(linked[0]?.title).toBe('Imported issue');
  });
});

describe('an invalid or expired credential', () => {
  it('is refused with a 401 that points at discovery and names every permission on offer', async () => {
    // Whatever the reason verification failed — bad signature, wrong audience, past its expiry —
    // the resource server answers the same way: 401 plus the document that tells the client how to
    // get a good credential. Anything less specific leaves a connector stuck with no recovery.
    getSession.mockResolvedValue(null);
    verifyAccessToken.mockRejectedValue(new Error('"exp" claim timestamp check failed'));

    const res = await mcpRequest(toolCall('list_work', { orgId: 'x', entity: 'task' }), 'expired');
    expect(res.status).toBe(401);
    expect(res.wwwAuthenticate).toContain('resource_metadata=');
    expect(res.wwwAuthenticate).toContain('/.well-known/oauth-protected-resource/mcp');
    expect(res.wwwAuthenticate).toContain(`scope="${[...OAUTH_ISSUABLE_SCOPES].join(' ')}"`);
  });

  it('is refused at the resolver too, so no path treats it as anonymous-but-allowed', async () => {
    verifyAccessToken.mockRejectedValueOnce(new Error('signature verification failed'));
    const headers = new Headers({ authorization: 'Bearer forged' });
    await expect(authMod.resolveMcpContext(headers)).rejects.toMatchObject({ status: 401 });
  });
});

describe('revoking the grant from the user’s own settings', () => {
  /** Seed a registered client plus the caller's consent and both issued-token rows. */
  async function seedGrant(userId: string): Promise<string> {
    const clientId = `client-${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(schema.oauthClient).values({
      clientId,
      name: 'Docket E2E Agent',
      redirectUris: ['https://client.example/callback'],
    });
    await db
      .insert(schema.oauthConsent)
      .values({ clientId, userId, scopes: [...OAUTH_ISSUABLE_SCOPES], createdAt: new Date() });
    const refreshId = harness.one(
      await db
        .insert(schema.oauthRefreshToken)
        .values({
          token: `refresh-${clientId}`,
          clientId,
          userId,
          scopes: [...OAUTH_ISSUABLE_SCOPES],
        })
        .returning({ id: schema.oauthRefreshToken.id }),
    ).id;
    await db.insert(schema.oauthAccessToken).values({
      token: `access-${clientId}`,
      clientId,
      userId,
      refreshId,
      scopes: [...OAUTH_ISSUABLE_SCOPES],
      expiresAt: new Date(Date.now() + 900_000),
    });
    return clientId;
  }

  it('lists the app, then removes it and everything it could have used to come back', async () => {
    const ws = await seedWorkspace(['contribute']);
    const clientId = await seedGrant(ws.userId);
    const app = harness.appWithSession(
      connectedAppsRouter,
      harness.fakeSession(ws.userId, 'Ada', ws.email),
    );

    const before = (await (await app.request('/')).json()) as {
      items: { clientId: string; name: string; scopes: string[] }[];
    };
    expect(before.items).toHaveLength(1);
    expect(before.items[0]?.clientId).toBe(clientId);
    expect(before.items[0]?.scopes).toEqual([...OAUTH_ISSUABLE_SCOPES]);

    const revoked = await app.request(`/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ revoked: true });

    const after = (await (await app.request('/')).json()) as { items: unknown[] };
    expect(after.items).toEqual([]);

    // The grant, the issued access token, and — critically — the refresh token are all gone.
    // Leaving the refresh row behind would let a "revoked" app quietly mint itself a fresh
    // credential and carry on, which is indistinguishable from never having revoked it.
    for (const [name, table] of [
      ['oauth_consent', schema.oauthConsent],
      ['oauth_access_token', schema.oauthAccessToken],
      ['oauth_refresh_token', schema.oauthRefreshToken],
    ] as const) {
      const rows = await db.select().from(table).where(eq(table.clientId, clientId));
      expect(rows, `${name} still holds a row for the revoked client`).toHaveLength(0);
    }
  });

  it('only ever touches the caller’s own grants', async () => {
    const mine = await seedWorkspace([]);
    const theirs = await seedWorkspace([]);
    const clientId = await seedGrant(theirs.userId);

    const app = harness.appWithSession(
      connectedAppsRouter,
      harness.fakeSession(mine.userId, 'Ada', mine.email),
    );
    const res = await app.request(`/${encodeURIComponent(clientId)}`, { method: 'DELETE' });

    // Idempotent by contract, so revoking someone else's grant is not an error — it is a no-op.
    expect(res.status).toBe(200);
    const survivors = await db
      .select()
      .from(schema.oauthConsent)
      .where(eq(schema.oauthConsent.clientId, clientId));
    expect(survivors).toHaveLength(1);
  });

  it('refuses to revoke anything for a caller with no session', async () => {
    const app = harness.appWithSession(connectedAppsRouter, null);
    const res = await app.request('/some-client', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('stops the token the app was already holding, on its very next call', async () => {
    // The clause that makes revocation a security control rather than a bookkeeping gesture.
    // Docket's access tokens are self-contained JWTs: deleting rows cannot reach into one a client
    // already has, so if the resource server checked only the signature, a revoked app would keep
    // reading for the rest of the token's 15-minute life — the exact window someone revoking a
    // suspicious app is trying to close. The token below is deliberately kept *valid* throughout
    // (the verifier keeps resolving it), so the only thing that can change the answer is the grant.
    const ws = await seedWorkspace(['view']);
    const clientId = await seedGrant(ws.userId);
    verifyAccessToken.mockResolvedValue({
      sub: ws.userId,
      azp: clientId,
      scope: 'work:read work:write',
    });

    const call = toolCall('list_work', { orgId: ws.orgId, entity: 'task' });
    const before = await mcpRequest(call, 'still-valid-jwt');
    expect(before.status, 'the grant is live, so the call must be served').not.toBe(401);

    const app = harness.appWithSession(
      connectedAppsRouter,
      harness.fakeSession(ws.userId, 'Ada', ws.email),
    );
    expect(
      (await app.request(`/${encodeURIComponent(clientId)}`, { method: 'DELETE' })).status,
    ).toBe(200);

    const after = await mcpRequest(call, 'still-valid-jwt');
    expect(after.status, 'the revoked app must be refused immediately').toBe(401);
    // And it is refused the same way any other bad credential is: with the document that says how
    // to get a good one, so a legitimate client can re-run consent instead of failing opaquely.
    expect(after.wwwAuthenticate).toContain('resource_metadata=');
    expect(after.wwwAuthenticate).toContain('/.well-known/oauth-protected-resource/mcp');
  });
});
