/**
 * `@docket/api` — the scope step-up's session-aware notification, in `src/mcp/server.ts`.
 *
 * @remarks
 * `mcp-scope.test.ts` proves the 403 `insufficient_scope` step-up itself, but always over a
 * connection with no `mcp-session-id` presented, so `mcpHandler`'s `if (session) { notifyLog(...) }`
 * branch — telling a live notification stream which tool it just lost and why — has never run.
 * This file completes `initialize` with the SAME under-scoped bearer token first, so the refused
 * `tools/call` carries a session the handler can address.
 */
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type { mcpHandler as McpHandler } from '../../src/mcp/server';
import { resetAuthMocks, verifyAccessToken } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { seedConsentedClient } from '../support/oauth-grant';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let mcpHandler!: typeof McpHandler;

beforeAll(async () => {
  // Configure OAuth before importing MCP modules that read the API env slice.
  vi.stubEnv('MCP_ISSUER_URL', 'https://auth.docket.test');
  vi.stubEnv('MCP_RESOURCE_URL', 'https://api.docket.test/mcp');
  vi.stubEnv('WEB_URL', 'https://docket.test');
  schema = await getMigratedDb();
  db = schema.db;
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
});

interface Seed {
  readonly userId: string;
  readonly orgId: string;
  readonly email: string;
}

/** Seed an org whose human actor holds `contribute` (enough for a `work:write` grant check). */
async function seedOrg(): Promise<Seed> {
  const slug = `sn-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  const [role] = await db
    .insert(schema.role)
    .values({ organizationId: orgId, key: 'seeded', name: 'Seeded', capabilities: ['contribute'] })
    .returning({ id: schema.role.id });
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = user!.id;
  await db.insert(schema.hub).values({ userId });
  await db.insert(schema.actor).values({
    organizationId: orgId,
    kind: 'human',
    displayName: 'Ada',
    userId,
    roleId: role!.id,
  });
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: role!.id,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['contribute'],
    effect: 'allow',
  });
  return { userId, orgId, email };
}

function app(): Hono {
  const instance = new Hono();
  instance.on(['POST', 'GET'], '/mcp', mcpHandler);
  return instance;
}

describe('scope step-up notifies a live session about the tool it lost', () => {
  it('warns the notification stream with the required scope when a session is already open', async () => {
    const seed = await seedOrg();
    const { clientId } = await seedConsentedClient(schema, seed.userId, ['work:read']);
    verifyAccessToken.mockResolvedValue({ sub: seed.userId, azp: clientId, scope: 'work:read' });
    const bearerHeaders = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer ro',
    };

    // 1. Establish a session with the SAME under-scoped bearer token (initialize is never scope
    //    gated, so a work:read-only token completes it fine).
    const init = await app().request('/mcp', {
      method: 'POST',
      headers: bearerHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'step-up-session', version: '0.0.0' },
        },
      }),
    });
    const sessionId = init.headers.get('Mcp-Session-Id');
    expect(sessionId).toEqual(expect.any(String));

    // 2. Open the notification stream on that session, still with the same token.
    const controller = new AbortController();
    const stream = await app().request('/mcp', {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        'mcp-session-id': sessionId!,
        authorization: 'Bearer ro',
      },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    const nextFrame = async (): Promise<unknown> => {
      for (;;) {
        const index = buffered.indexOf('\n\n');
        if (index !== -1) {
          const chunk = buffered.slice(0, index);
          buffered = buffered.slice(index + 2);
          if (chunk.startsWith('data: ')) return JSON.parse(chunk.slice(6)) as unknown;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream closed before a frame arrived');
        buffered += decoder.decode(value, { stream: true });
      }
    };

    // 3. The refused call, on the same session + token.
    const res = await app().request('/mcp', {
      method: 'POST',
      headers: { ...bearerHeaders, 'mcp-session-id': sessionId! },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'capture', arguments: { orgId: seed.orgId, text: 'blocked' } },
      }),
    });
    expect(res.status).toBe(403);

    await expect(nextFrame()).resolves.toMatchObject({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: {
        level: 'warning',
        data: { event: 'tool_scope_refused', requiredScope: 'work:write' },
      },
    });

    await reader.cancel();
    controller.abort();
    resetAuthMocks();
  });
});
