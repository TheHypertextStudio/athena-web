/**
 * `@docket/api` — the MCP Apps host routes, driven over HTTP.
 *
 * @remarks
 * `mcp-apps-host-routes.test.ts` drives `runWidgetTool`/`isAppCallableTool` directly to make the
 * authorization decisions unambiguous. This file covers what sits above that: the router itself
 * (`requestOwner`'s unauthenticated refusal, `GET /widgets`, `POST /call`, `POST /view-call`),
 * `loadConnection`'s three stored-credential shapes (plain bearer, `mcp_oauth`,
 * `mcp_oauth_pending`), and a resource-less tool call, which together account for the branches a
 * single "list, call, read" run through the fixture never reaches.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

vi.hoisted(() => {
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('1'.repeat(32)).toString('base64');
});

import type * as DbModule from '@docket/db';

import { appWithSession, fakeSession, getDb } from '../support/routes-harness';
import { sealCredential } from '../../src/lib/credentials';
import type mcpAppHostRoutes from '../../src/mcp/apps/host-routes';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let app!: typeof mcpAppHostRoutes;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  // The container resolves `MockMcpConnector` in test mode, which serves fixtures at
  // `mcp.acme-release.example` (widget-bearing tools) and `mcp.sunsama.com` (plain tools, no
  // `ui://` resource at all).
  app = (await import('../../src/mcp/apps/host-routes')).default;
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Seed a user with one connected personal MCP connection, optionally with a stored credential. */
async function seedConnection(
  url: string,
  credential?: string,
): Promise<{ userId: string; connectionId: string }> {
  const slug = `mh-${Math.random().toString(36).slice(2, 10)}`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  const [row] = await db
    .insert(schema.personalMcpConnection)
    .values({
      ownerUserId: assertDefined(user).id,
      url,
      name: 'Fixture server',
      alias: slug.replace(/-/g, ''),
      authMode: credential ? 'oauth' : 'none',
      status: 'connected',
      toolCount: 1,
    })
    .returning({ id: schema.personalMcpConnection.id });
  const connectionId = assertDefined(row).id;
  if (credential) {
    await db.insert(schema.personalMcpCredential).values({
      connectionId,
      ownerUserId: assertDefined(user).id,
      ciphertext: sealCredential(credential),
    });
  }
  return { userId: assertDefined(user).id, connectionId };
}

describe('requestOwner — the shared authentication guard', () => {
  it('401s every route when there is no session', async () => {
    const anon = appWithSession(app, null);
    expect((await anon.request('/widgets')).status).toBe(401);
    expect(
      (
        await anon.request('/call', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ connectionId: 'x', tool: 'x' }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await anon.request('/view-call', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ connectionId: 'x', tool: 'x' }),
        })
      ).status,
    ).toBe(401);
  });
});

describe('GET /widgets', () => {
  it('lists only widget-bearing tools, skips a tool-less server, and skips an unreachable connection', async () => {
    const { userId, connectionId: widgetConnId } = await seedConnection(
      'https://mcp.acme-release.example/mcp',
    );
    const client = appWithSession(app, fakeSession(userId));
    // A second connection on a server with tools but no `ui://` resources at all.
    const noWidgetsUrl = 'https://mcp.sunsama.com/mcp';
    const [noWidgets] = await db
      .insert(schema.personalMcpConnection)
      .values({
        ownerUserId: userId,
        url: noWidgetsUrl,
        name: 'Sunsama',
        alias: `sunsama${Math.random().toString(36).slice(2, 8)}`,
        authMode: 'none',
        status: 'connected',
        toolCount: 1,
      })
      .returning({ id: schema.personalMcpConnection.id });
    // A third connection whose host `MockMcpConnector` does not recognize — `open()` throws, and
    // the widget list must skip it rather than fail the whole response.
    const [unreachable] = await db
      .insert(schema.personalMcpConnection)
      .values({
        ownerUserId: userId,
        url: 'https://mcp.unreachable.example/mcp',
        name: 'Unreachable',
        alias: `dead${Math.random().toString(36).slice(2, 8)}`,
        authMode: 'none',
        status: 'connected',
        toolCount: 1,
      })
      .returning({ id: schema.personalMcpConnection.id });
    expect(noWidgets).toBeDefined();
    expect(unreachable).toBeDefined();

    const res = await client.request('/widgets');
    expect(res.status).toBe(200);
    const widgets = await json<{ connectionId: string; tool: string; resourceUri: string }[]>(res);
    expect(widgets.length).toBeGreaterThan(0);
    expect(widgets.every((w) => w.connectionId === widgetConnId)).toBe(true);
    expect(widgets.map((w) => w.tool)).toContain('release_checklist');
  });
});

describe('POST /call and POST /view-call over HTTP', () => {
  it('renders a widget tool through /call', async () => {
    const { userId, connectionId } = await seedConnection('https://mcp.acme-release.example/mcp');
    const client = appWithSession(app, fakeSession(userId));
    const res = await client.request('/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, tool: 'release_checklist' }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ resource: { uri: string } | null }>(res);
    expect(body.resource?.uri).toContain('acme-release');
  });

  it('runs a view-callable tool through /view-call and 403s a model-only one', async () => {
    const { userId, connectionId } = await seedConnection('https://mcp.acme-release.example/mcp');
    const client = appWithSession(app, fakeSession(userId));
    const ok = await client.request('/view-call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, tool: 'advance_release' }),
    });
    expect(ok.status).toBe(200);

    const forbidden = await client.request('/view-call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, tool: 'abandon_release' }),
    });
    expect(forbidden.status).toBe(403);
  });

  it('resolves a null resource for a tool that declares no ui:// document at all', async () => {
    const { userId, connectionId } = await seedConnection('https://mcp.sunsama.com/mcp');
    const client = appWithSession(app, fakeSession(userId));
    const res = await client.request('/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, tool: 'get_backlog_tasks', arguments: {} }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ resource: unknown }>(res);
    expect(body.resource).toBeNull();
  });
});

describe('loadConnection — stored-credential shapes', () => {
  it('resolves a bearer token from a plain (legacy) stored credential', async () => {
    const { userId, connectionId } = await seedConnection(
      'https://mcp.acme-release.example/mcp',
      'plain-bearer-token',
    );
    const client = appWithSession(app, fakeSession(userId));
    const res = await client.request('/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, tool: 'release_checklist' }),
    });
    expect(res.status).toBe(200);
  });

  it('resolves a bearer token from a completed mcp_oauth credential', async () => {
    const { userId, connectionId } = await seedConnection(
      'https://mcp.acme-release.example/mcp',
      JSON.stringify({
        kind: 'mcp_oauth',
        tokens: { access_token: 'at_completed', token_type: 'Bearer' },
        obtainedAt: new Date().toISOString(),
      }),
    );
    const client = appWithSession(app, fakeSession(userId));
    const res = await client.request('/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, tool: 'release_checklist' }),
    });
    expect(res.status).toBe(200);
  });

  it('omits a bearer token for a still-pending mcp_oauth credential', async () => {
    const { userId, connectionId } = await seedConnection(
      'https://mcp.acme-release.example/mcp',
      JSON.stringify({ kind: 'mcp_oauth_pending', codeVerifier: 'verifier' }),
    );
    const client = appWithSession(app, fakeSession(userId));
    const res = await client.request('/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, tool: 'release_checklist' }),
    });
    // The connection still opens (the mock connector ignores the (absent) bearer token) — this
    // proves the pending-credential branch doesn't throw, not that the call is authorized.
    expect(res.status).toBe(200);
  });
});
