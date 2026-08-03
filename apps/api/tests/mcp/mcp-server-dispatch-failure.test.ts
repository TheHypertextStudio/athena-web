/**
 * `@docket/api` — `mcpHandler`'s own outer catch in `src/mcp/server.ts`: when dispatch itself
 * throws (rather than the transport producing a normal error response), the handler must still
 * close the transport/server and re-throw instead of leaving them open.
 *
 * @remarks
 * Every other MCP suite exercises the transport's own well-formed error responses, never a raw
 * thrown exception from dispatch — that requires making `withRequestScope` itself throw, which is
 * only practical by replacing it at the module boundary. Its own file so the mock never leaks into
 * a real dispatch elsewhere in the suite.
 */
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/mcp/auth', () => ({
  resolveMcpContext: vi.fn(async () => ({
    principal: { kind: 'user', userId: 'user_test', userName: 'Ada', userEmail: 'ada@example.com' },
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  })),
}));
vi.mock('../../src/mcp/tools', () => ({ registerTools: vi.fn() }));
vi.mock('../../src/mcp/resources', () => ({ registerResources: vi.fn() }));
vi.mock('../../src/mcp/prompts', () => ({ registerPrompts: vi.fn() }));
vi.mock('../../src/mcp/request-context', () => ({
  withRequestScope: vi.fn(() => {
    throw new Error('dispatch scope exploded');
  }),
}));

import type { mcpHandler as McpHandler } from '../../src/mcp/server';

let mcpHandler!: typeof McpHandler;

beforeAll(async () => {
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
});

function mcpApp(): Hono {
  const app = new Hono();
  app.on(['POST'], '/mcp', mcpHandler);
  return app;
}

describe('mcpHandler dispatch failure', () => {
  it('propagates a thrown dispatch error instead of swallowing it', async () => {
    const app = mcpApp();
    // A minimal Hono app with no onError registered: an uncaught handler throw surfaces as
    // Hono's own default 500, which is enough to prove the error actually propagated up through
    // mcpHandler rather than being swallowed by the catch.
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'whatever', arguments: {} },
      }),
    });
    expect(res.status).toBe(500);
  });
});
