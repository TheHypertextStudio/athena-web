import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

let activeSignal: AbortSignal | null = null;
let slowToolStarted!: Promise<void>;
let markSlowToolStarted!: () => void;

function resetSlowTool(): void {
  activeSignal = null;
  slowToolStarted = new Promise((resolve) => {
    markSlowToolStarted = resolve;
  });
}

resetSlowTool();

vi.mock('../../src/mcp/auth', () => ({
  resolveMcpContext: vi.fn(async () => ({
    userId: 'user_test',
    userName: 'Ada',
    userEmail: 'ada@example.com',
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  })),
}));

vi.mock('../../src/mcp/tools', () => ({
  registerTools: vi.fn((server: { registerTool: (...args: unknown[]) => void }) => {
    server.registerTool(
      'slow_tool',
      {
        title: 'Slow tool',
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (_input: unknown, extra: { signal: AbortSignal }) => {
        activeSignal = extra.signal;
        markSlowToolStarted();
        await new Promise<void>((resolve) => {
          extra.signal.addEventListener(
            'abort',
            () => {
              resolve();
            },
            { once: true },
          );
        });
        return { content: [{ type: 'text', text: 'aborted' }] };
      },
    );
  }),
}));

vi.mock('../../src/mcp/resources', () => ({ registerResources: vi.fn() }));
vi.mock('../../src/mcp/prompts', () => ({ registerPrompts: vi.fn() }));

import type { mcpHandler as McpHandler } from '../../src/mcp/server';

let mcpHandler!: typeof McpHandler;

beforeAll(async () => {
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
});

function mcpApp(): Hono {
  const app = new Hono();
  app.on(['POST', 'GET'], '/mcp', mcpHandler);
  return app;
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
};

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value);
    }, ms);
  });
}

describe('/mcp cancellation notifications', () => {
  it('aborts an active request and does not emit its response afterward', async () => {
    resetSlowTool();
    const app = mcpApp();
    const original = await app.request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'tools/call',
        params: { name: 'slow_tool', arguments: {} },
      }),
    });
    expect(original.status).toBe(200);

    await slowToolStarted;
    expect(activeSignal?.aborted).toBe(false);

    const cancellation = await app.request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 'req-1', reason: 'test requested cancellation' },
      }),
    });

    expect(cancellation.status).toBe(202);
    expect(activeSignal?.aborted).toBe(true);
    await expect(Promise.race([original.text(), timeout(250, '__timeout__')])).resolves.toBe('');
  });
});
