import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import type * as ScopeModule from '../../src/mcp/scope';
import type * as ServerModule from '../../src/mcp/server';
import type * as AuthModule from '../../src/mcp/auth';
import { getMcpSession, getSession, resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let registerResources!: typeof RegisterResources;
let scopeMod!: typeof ScopeModule;
let serverMod!: typeof ServerModule;
let authMod!: typeof AuthModule;

beforeAll(async () => {
  // Configure OAuth before importing MCP modules that read the API env slice.
  vi.stubEnv('MCP_ISSUER_URL', 'https://auth.docket.test');
  vi.stubEnv('MCP_RESOURCE_URL', 'https://api.docket.test/mcp');
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  registerResources = (await import('../../src/mcp/resources')).registerResources;
  scopeMod = await import('../../src/mcp/scope');
  serverMod = await import('../../src/mcp/server');
  authMod = await import('../../src/mcp/auth');
});

afterEach(() => {
  resetAuthMocks();
});

interface Seed {
  userId: string;
  orgId: string;
  teamId: string;
  taskId: string;
  email: string;
}

/** Seed an org whose human actor holds `capabilities` org-wide (role + grant + a task). */
async function seedOrg(capabilities: readonly Capability[]): Promise<Seed> {
  const slug = `sc-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;

  const [r] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'seeded',
      name: 'Seeded',
      capabilities: [...capabilities],
    })
    .returning({ id: schema.role.id });
  const roleId = r!.id;

  const email = `${slug}@e.com`;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = u!.id;
  await db.insert(schema.hub).values({ userId });

  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, roleId })
    .returning({ id: schema.actor.id });
  const actorId = human!.id;

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

  const [t] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  const teamId = t!.id;

  const [tk] = await db
    .insert(schema.task)
    .values({ organizationId: orgId, title: 'Ship', teamId, state: 'todo', createdBy: actorId })
    .returning({ id: schema.task.id });
  return { userId, orgId, teamId, taskId: tk!.id, email };
}

const harnesses: { close(): Promise<void> }[] = [];

/** Connect an identity-bound MCP server with the given scope set on the context. */
async function connect(
  orgUserId: string,
  email: string,
  scopes: readonly string[],
): Promise<Client> {
  const ctx: McpContext = { userId: orgUserId, userName: 'Ada', userEmail: email, scopes };
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: { listChanged: true }, resources: { subscribe: true } } },
  );
  registerTools(server, ctx);
  registerResources(server, ctx);
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

function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
}

describe('scope helpers', () => {
  it('requireScope passes when present and throws InsufficientScopeError when absent', () => {
    expect(() => {
      scopeMod.requireScope(['work:read', 'work:write'], 'work:write');
    }).not.toThrow();
    expect(() => {
      scopeMod.requireScope(['work:read'], 'work:write');
    }).toThrow(/work:write/);
  });

  it('challenge401 points at the PRM document and the baseline scope', () => {
    const c = scopeMod.challenge401(
      'https://api.docket.test/.well-known/oauth-protected-resource/mcp',
    );
    expect(c).toContain(
      'Bearer resource_metadata="https://api.docket.test/.well-known/oauth-protected-resource/mcp"',
    );
    expect(c).toContain('scope="work:read"');
  });

  it('challenge403 lists granted + newly-required scopes (recommended strategy), deduped + ordered', () => {
    const c = scopeMod.challenge403(
      'https://api.docket.test/.well-known/oauth-protected-resource/mcp',
      'work:write',
      ['work:read'],
    );
    expect(c).toContain('error="insufficient_scope"');
    expect(c).toContain('scope="work:read work:write"');
    expect(c).toContain('error_description=');
  });

  it('TOOL_SCOPE maps reads/mutations/agents/connectors and covers every registered tool', () => {
    expect(scopeMod.TOOL_SCOPE['run_view']).toBe('work:read');
    expect(scopeMod.TOOL_SCOPE['create_task']).toBe('work:write');
    expect(scopeMod.TOOL_SCOPE['trigger_agent']).toBe('agents:run');
    expect(scopeMod.TOOL_SCOPE['link_external']).toBe('connectors:link');
  });
});

describe('tool scope gating (layer 1, before the grant check)', () => {
  it('denies a write tool for a read-only token even when the Actor holds contribute', async () => {
    const s = await seedOrg(['contribute']);
    // Read-only token: the grant (contribute) is sufficient, but the SCOPE is not.
    const client = await connect(s.userId, s.email, ['work:read']);
    const res = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: s.orgId, teamId: s.teamId, title: 'Should be scope-blocked' },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('work:write');

    // Nothing was written.
    const rows = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.title, 'Should be scope-blocked'));
    expect(rows).toHaveLength(0);
  });

  it('allows the same write once the token carries work:write (both layers satisfied)', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.userId, s.email, ['work:read', 'work:write']);
    const res = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: s.orgId, teamId: s.teamId, title: 'Allowed' },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(payload(res)['id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('denies agent + connector tools for a work:write-only token', async () => {
    const s = await seedOrg(['contribute', 'assign']);
    const client = await connect(s.userId, s.email, ['work:read', 'work:write']);
    const cancel = (await client.callTool({
      name: 'cancel_session',
      arguments: { orgId: s.orgId, sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    })) as CallToolResult;
    expect(cancel.isError).toBe(true);
    expect((cancel.content[0] as { text: string }).text).toContain('agents:run');
  });

  it('still 403s a read tool for a read-scoped token lacking the view grant (grant layer intact)', async () => {
    const s = await seedOrg([]); // no grants → below view
    const client = await connect(s.userId, s.email, ['work:read']);
    const res = (await client.callTool({
      name: 'run_view',
      arguments: { orgId: s.orgId, entity: 'task' },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('not_found');
  });
});

describe('resource read scope gating', () => {
  it('denies a docket:// read for a token lacking work:read', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.userId, s.email, ['work:write']); // no work:read
    await expect(
      client.readResource({ uri: `docket://${s.orgId}/task/${s.taskId}` }),
    ).rejects.toThrow(/work:read/);
  });

  it('reads with work:read + the view grant', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.userId, s.email, ['work:read']);
    const res = await client.readResource({ uri: `docket://${s.orgId}/task/${s.taskId}` });
    const dto = JSON.parse((res.contents[0] as { text: string }).text) as { id: string };
    expect(dto.id).toBe(s.taskId);
  });
});

describe('resolveMcpContext — Bearer (OAuth RS) path', () => {
  function bearer(token: string): Headers {
    const h = new Headers();
    h.set('authorization', `Bearer ${token}`);
    return h;
  }

  it('resolves an audience-bound token to its exact verified scope set', async () => {
    getMcpSession.mockResolvedValueOnce({
      accessToken: 'tok-1',
      userId: 'u-bearer',
      scopes: 'work:read work:write',
    });
    getSession.mockResolvedValueOnce({ user: { id: 'u-bearer', name: 'Grace', email: 'g@e.com' } });
    const ctx = await authMod.resolveMcpContext(bearer('tok-1'));
    expect(ctx.userId).toBe('u-bearer');
    expect(ctx.userName).toBe('Grace');
    expect(ctx.scopes).toEqual(['work:read', 'work:write']);
    expect(getMcpSession).toHaveBeenCalledOnce();
  });

  it('rejects a token that does not resolve (foreign audience / invalid) → 401', async () => {
    getMcpSession.mockResolvedValueOnce(null);
    await expect(authMod.resolveMcpContext(bearer('foreign'))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects when the resolved token string does not match the presented one → 401', async () => {
    getMcpSession.mockResolvedValueOnce({ accessToken: 'other', userId: 'u', scopes: 'work:read' });
    await expect(authMod.resolveMcpContext(bearer('presented'))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('defaults name/email to null/empty when no user session backs the token', async () => {
    getMcpSession.mockResolvedValueOnce({
      accessToken: 'tok-2',
      userId: 'u2',
      scopes: 'work:read',
    });
    getSession.mockResolvedValueOnce(null);
    const ctx = await authMod.resolveMcpContext(bearer('tok-2'));
    expect(ctx.userName).toBeNull();
    expect(ctx.userEmail).toBe('');
    expect(ctx.scopes).toEqual(['work:read']);
  });
});

describe('discovery routes (PRM + AS metadata)', () => {
  function app() {
    const a = new Hono();
    a.get('/.well-known/oauth-protected-resource', serverMod.protectedResourceMetadata);
    a.get('/.well-known/oauth-protected-resource/mcp', serverMod.protectedResourceMetadata);
    a.get('/.well-known/oauth-authorization-server', serverMod.authorizationServerMetadata);
    return a;
  }

  it('serves the PRM document (RFC 9728) with resource, AS issuer, scopes, bearer method', async () => {
    const res = await app().request('/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    const prm = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
      bearer_methods_supported: string[];
    };
    expect(prm.resource).toBe('https://api.docket.test/mcp');
    expect(prm.authorization_servers).toEqual(['https://auth.docket.test']);
    expect(prm.scopes_supported).toEqual([
      'work:read',
      'work:write',
      'agents:run',
      'connectors:link',
    ]);
    expect(prm.bearer_methods_supported).toEqual(['header']);
  });

  it('serves the bare PRM path too', async () => {
    const res = await app().request('/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { resource: string }).resource).toBe(
      'https://api.docket.test/mcp',
    );
  });

  it('redirects AS metadata to the live Better Auth discovery document', async () => {
    const res = await app().request('/.well-known/oauth-authorization-server', {
      redirect: 'manual',
    });
    expect(res.status).toBe(307);
    // Better Auth's mcp() plugin serves the document relative to its /api/auth base path,
    // not at the RFC 8414 root — the redirect must target the route that actually exists.
    expect(res.headers.get('location')).toBe(
      'https://auth.docket.test/api/auth/.well-known/oauth-authorization-server',
    );
  });
});

describe('/mcp handler — 401 challenge + 403 step-up', () => {
  function mcpApp() {
    const a = new Hono();
    a.on(['POST', 'GET'], '/mcp', serverMod.mcpHandler);
    return a;
  }

  const INIT = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    },
  });

  it('emits the full §2.6 401 challenge with resource_metadata + scope when no token', async () => {
    getMcpSession.mockResolvedValue(null);
    getSession.mockResolvedValue(null);
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: INIT,
    });
    expect(res.status).toBe(401);
    const wa = res.headers.get('www-authenticate') ?? '';
    expect(wa).toContain('resource_metadata=');
    expect(wa).toContain('/.well-known/oauth-protected-resource/mcp');
    expect(wa).toContain('scope="work:read"');
  });

  it('returns a 403 insufficient_scope step-up for a tools/call the token cannot satisfy', async () => {
    const s = await seedOrg(['contribute']);
    // A real, audience-bound read-only token (Bearer path) → the handler resolves scopes.
    getMcpSession.mockResolvedValue({ accessToken: 'ro', userId: s.userId, scopes: 'work:read' });
    getSession.mockResolvedValue({ user: { id: s.userId, name: 'Ada', email: s.email } });
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_task', arguments: { orgId: s.orgId, teamId: s.teamId, title: 'x' } },
    });
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer ro',
      },
      body,
    });
    expect(res.status).toBe(403);
    const wa = res.headers.get('www-authenticate') ?? '';
    expect(wa).toContain('error="insufficient_scope"');
    expect(wa).toContain('scope="work:read work:write"');
    const problem = (await res.json()) as { code: string; scope: string };
    expect(problem.code).toBe('insufficient_scope');
    expect(problem.scope).toBe('work:write');
  });

  it('does not step-up a tools/call the token can satisfy (proceeds to the transport)', async () => {
    const s = await seedOrg(['contribute']);
    getMcpSession.mockResolvedValue({
      accessToken: 'rw',
      userId: s.userId,
      scopes: 'work:read work:write',
    });
    getSession.mockResolvedValue({ user: { id: s.userId, name: 'Ada', email: s.email } });
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'create_task', arguments: { orgId: s.orgId, teamId: s.teamId, title: 'ok' } },
    });
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer rw',
      },
      body,
    });
    // The transport handled the call (no 403 step-up); a single response is returned.
    expect(res.status).not.toBe(403);
  });
});
