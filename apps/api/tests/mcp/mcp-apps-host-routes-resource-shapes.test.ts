/**
 * `@docket/api` — `toResourceOut`'s optional-field branches and the `callToolRaw`-absent
 * fallback.
 *
 * @remarks
 * Every fixture `@docket/integrations` ships (`mcp.acme-release.example`,
 * `mcp.sunsama.com`) always declares the SAME shape for the fields this file cares about — its
 * one `ui://` resource always sets `prefersBorder`, always has a (deliberately empty)
 * `meta.csp`, never sets `meta.permissions`, and its session always implements `callToolRaw`.
 * Real third-party MCP Apps servers vary all four independently, so this file swaps in a
 * minimal, fully in-repo test double for the container's `mcpConnector` to exercise the
 * combinations no shared fixture happens to produce, rather than reshaping a fixture other
 * tests/workers also depend on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  McpConnector,
  RemoteMcpSession,
  RemoteToolDescriptor,
  RemoteUiResource,
} from '@docket/integrations';
import { MCP_UI_MIME_TYPE } from '@docket/types';

import type * as ContainerModule from '../../src/container';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

const state = vi.hoisted(() => ({
  session: null as RemoteMcpSession | null,
  openedWith: [] as { url: string; bearerToken?: string }[],
}));

vi.mock('../../src/container', async (importOriginal) => {
  const original = await importOriginal<typeof ContainerModule>();
  const fakeConnector: McpConnector = {
    open: async (endpoint) => {
      state.openedWith.push({
        url: endpoint.url,
        ...(endpoint.bearerToken ? { bearerToken: endpoint.bearerToken } : {}),
      });
      if (!state.session) throw new Error('test session not configured');
      return state.session;
    },
  };
  return {
    ...original,
    getContainer: () => ({ ...original.getContainer(), mcpConnector: fakeConnector }),
  };
});

import type * as DbModule from '@docket/db';

import { appWithSession, fakeSession, getDb } from '../support/routes-harness';
import type mcpAppHostRoutes from '../../src/mcp/apps/host-routes';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let app!: typeof mcpAppHostRoutes;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Build a one-tool session that serves `resource` (or omits `readUiResource` when `undefined`). */
function sessionWithResource(
  resource: RemoteUiResource | null,
  options: { readUiResource?: boolean; callToolRaw?: boolean } = {},
): RemoteMcpSession {
  const descriptor: RemoteToolDescriptor = {
    name: 'render_card',
    description: 'Render a test card.',
    inputSchema: { type: 'object', properties: {} },
    ui: { resourceUri: 'ui://test/card' },
  };
  const includeReadUiResource = options.readUiResource ?? true;
  const includeCallToolRaw = options.callToolRaw ?? true;
  return {
    serverInfo: () => ({ name: 'test-server' }),
    listTools: async () => [descriptor],
    callTool: async () => ({ content: 'ok', isError: false }),
    ...(includeCallToolRaw
      ? {
          callToolRaw: async () => ({
            content: [{ type: 'text', text: 'ok' }],
            structuredContent: { ok: true },
            isError: false,
          }),
        }
      : {}),
    ...(includeReadUiResource ? { readUiResource: async () => resource } : {}),
    close: async () => undefined,
  };
}

beforeEach(async () => {
  schema = await getDb();
  db = schema.db;
  app = (await import('../../src/mcp/apps/host-routes')).default;
  state.session = null;
  state.openedWith = [];
});

/** Seed a user with one connected personal MCP connection. */
async function seedConnection(): Promise<{ userId: string; connectionId: string }> {
  const slug = `shape-${Math.random().toString(36).slice(2, 10)}`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  const [row] = await db
    .insert(schema.personalMcpConnection)
    .values({
      ownerUserId: user!.id,
      url: 'https://mcp.shape-fixture.example/mcp',
      name: 'Shape fixture',
      alias: slug,
      authMode: 'none',
      status: 'connected',
      toolCount: 1,
    })
    .returning({ id: schema.personalMcpConnection.id });
  return { userId: user!.id, connectionId: row!.id };
}

/** Call `render_card` through `/call` and return the parsed body. */
async function callRenderCard(
  connectionId: string,
  userId: string,
): Promise<{
  resource: { uri: string; prefersBorder?: boolean; csp?: unknown; permissions?: unknown } | null;
}> {
  const client = appWithSession(app, fakeSession(userId));
  const res = await client.request('/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId, tool: 'render_card' }),
  });
  expect(res.status).toBe(200);
  return json(res);
}

describe('toResourceOut — optional-field branches', () => {
  it('omits prefersBorder from the response when the resource does not declare it', async () => {
    const { userId, connectionId } = await seedConnection();
    state.session = sessionWithResource({
      uri: 'ui://test/card',
      mimeType: MCP_UI_MIME_TYPE,
      text: '<html></html>',
      // No `meta` at all — prefersBorder, csp, and permissions are all absent.
    });
    const body = await callRenderCard(connectionId, userId);
    expect(body.resource).not.toBeNull();
    expect(body.resource).not.toHaveProperty('prefersBorder');
    expect(body.resource).not.toHaveProperty('csp');
    expect(body.resource).not.toHaveProperty('permissions');
  });

  it('carries every declared CSP domain list and the permissions block through', async () => {
    const { userId, connectionId } = await seedConnection();
    state.session = sessionWithResource({
      uri: 'ui://test/card',
      mimeType: MCP_UI_MIME_TYPE,
      text: '<html></html>',
      meta: {
        prefersBorder: false,
        csp: {
          connectDomains: ['https://api.example.com'],
          resourceDomains: ['https://cdn.example.com'],
          frameDomains: ['https://embed.example.com'],
          baseUriDomains: ['https://example.com'],
        },
        permissions: { camera: {} },
      },
    });
    const body = await callRenderCard(connectionId, userId);
    expect(body.resource?.prefersBorder).toBe(false);
    expect(body.resource?.csp).toEqual({
      connectDomains: ['https://api.example.com'],
      resourceDomains: ['https://cdn.example.com'],
      frameDomains: ['https://embed.example.com'],
      baseUriDomains: ['https://example.com'],
    });
    expect(body.resource?.permissions).toEqual({ camera: {} });
  });

  it('resolves a null resource for a non-renderable document (wrong mimeType)', async () => {
    const { userId, connectionId } = await seedConnection();
    state.session = sessionWithResource({
      uri: 'ui://test/card',
      mimeType: 'text/html', // missing the `profile=mcp-app` marker
      text: '<html></html>',
    });
    const body = await callRenderCard(connectionId, userId);
    expect(body.resource).toBeNull();
  });

  it('falls back to a flattened text result when the session has no callToolRaw', async () => {
    const { userId, connectionId } = await seedConnection();
    state.session = sessionWithResource(null, { readUiResource: false, callToolRaw: false });
    const client = appWithSession(app, fakeSession(userId));
    const res = await client.request('/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, tool: 'render_card' }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ result: { content: { type: string; text: string }[] } }>(res);
    expect(body.result.content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});
