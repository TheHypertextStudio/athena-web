/**
 * `@docket/api` — `buildServer`'s `MCP_TASKS_ENABLED` branch in `src/mcp/server.ts`.
 *
 * @remarks
 * Every other MCP suite runs with `MCP_TASKS_ENABLED` unset, so the `tasks` capability
 * advertisement and the `taskStore` binding built from {@link import('../../src/mcp/task-store').taskStoreForContext}
 * are otherwise never exercised. Its own file because the flag is read once, at import time.
 */
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('MCP_TASKS_ENABLED', 'true');

vi.mock('../../src/mcp/auth', () => ({
  resolveMcpContext: vi.fn(async () => ({
    principal: { kind: 'user', userId: 'user_test', userName: 'Ada', userEmail: 'ada@example.com' },
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  })),
}));
vi.mock('../../src/mcp/tools', () => ({ registerTools: vi.fn() }));
vi.mock('../../src/mcp/resources', () => ({ registerResources: vi.fn() }));
vi.mock('../../src/mcp/prompts', () => ({ registerPrompts: vi.fn() }));

import type { mcpHandler as McpHandler } from '../../src/mcp/server';
import { getMigratedDb } from '../support/db';

let mcpHandler!: typeof McpHandler;

beforeAll(async () => {
  await getMigratedDb();
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
});

function mcpApp(): Hono {
  const app = new Hono();
  app.on(['POST'], '/mcp', mcpHandler);
  return app;
}

describe('buildServer with MCP_TASKS_ENABLED=true', () => {
  it('advertises the tasks capability and binds a per-caller task store without crashing', async () => {
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'tasks-client', version: '0.0.0' },
        },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const line = text.split('\n').find((candidate) => candidate.startsWith('data: '));
    const message = JSON.parse((line ?? text).replace(/^data: /, '')) as {
      result?: { capabilities?: { tasks?: unknown } };
    };
    expect(message.result?.capabilities?.tasks).toBeDefined();
  });
});
