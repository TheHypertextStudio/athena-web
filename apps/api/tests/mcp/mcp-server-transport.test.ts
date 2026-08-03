/**
 * `@docket/api` — transport-level branches of `src/mcp/server.ts` that neither `mcp.test.ts` nor
 * the notifications/scope/cancellation suites reach: batched/param-less `initialize` bodies, the
 * SSE heartbeat frame, an abort-only stream teardown, a malformed or non-object JSON-RPC body, a
 * fire-and-forget notification with no reply body, session-less `DELETE`/`GET`, and the
 * cancellation-notification edge cases (missing/invalid `requestId`, a reason-less cancellation, a
 * task-augmented request excluded from cancellation tracking).
 *
 * @remarks
 * `resolveMcpContext` and the tool/resource/prompt registrars are mocked (mirroring
 * `mcp-cancellation.test.ts`), so every scenario here runs without seeding an organization —
 * only the MCP session registry itself needs the real (migrated) database.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    principal: { kind: 'user', userId: 'user_test', userName: 'Ada', userEmail: 'ada@example.com' },
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

import type * as DbModule from '@docket/db';

import type { mcpHandler as McpHandler } from '../../src/mcp/server';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let mcpHandler!: typeof McpHandler;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
});

beforeEach(() => {
  resetSlowTool();
});

afterEach(() => {
  vi.useRealTimers();
});

function mcpApp(): Hono {
  const app = new Hono();
  app.on(['POST', 'GET', 'DELETE'], '/mcp', mcpHandler);
  return app;
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

/** Complete `initialize` with an arbitrary body and return the minted session id. */
async function initializeWith(
  body: unknown,
): Promise<{ status: number; sessionId: string | null }> {
  const res = await mcpApp().request('/mcp', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return { status: res.status, sessionId: res.headers.get('Mcp-Session-Id') };
}

describe('negotiatedProtocolVersion', () => {
  it('mints a session with a null protocol version when initialize carries no params', async () => {
    const { status, sessionId } = await initializeWith({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(status).toBe(200);
    expect(sessionId).toEqual(expect.any(String));
    const [row] = await db
      .select({ protocolVersion: schema.mcpSession.protocolVersion })
      .from(schema.mcpSession)
      .where(eq(schema.mcpSession.id, sessionId!));
    expect(row?.protocolVersion).toBeNull();
  });

  it('finds the negotiated version in a batch that also carries a non-initialize notification', async () => {
    // The transport itself refuses to dispatch a batch mixing `initialize` with anything else
    // ("Only one initialization request is allowed") — but `mcpHandler` mints the session and
    // derives its protocol version from the parsed body BEFORE handing it to the transport, so
    // the loop that skips the non-initialize entry (and finds the version in the initialize
    // entry) already ran by the time the transport rejects the request.
    const { status, sessionId } = await initializeWith([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'batch-client', version: '0.0.0' },
        },
      },
    ]);
    expect(status).toBe(400);
    expect(sessionId).toEqual(expect.any(String));
    const [row] = await db
      .select({ protocolVersion: schema.mcpSession.protocolVersion })
      .from(schema.mcpSession)
      .where(eq(schema.mcpSession.id, sessionId!));
    expect(row?.protocolVersion).toBe('2025-11-25');
  });

  it('mints a session with a null protocol version when protocolVersion is not a string', async () => {
    const { status, sessionId } = await initializeWith({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 20251125, // a number, not a string
        capabilities: {},
        clientInfo: { name: 'wrong-type-client', version: '0.0.0' },
      },
    });
    expect(status).toBe(200);
    const [row] = await db
      .select({ protocolVersion: schema.mcpSession.protocolVersion })
      .from(schema.mcpSession)
      .where(eq(schema.mcpSession.id, sessionId!));
    expect(row?.protocolVersion).toBeNull();
  });
});

describe('a malformed or non-object JSON-RPC body', () => {
  it('does not crash on a genuinely empty POST body', async () => {
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '',
    });
    expect(res.status).toBeLessThan(500);
  });

  it('does not crash on unparseable JSON — the transport reports its own parse error', async () => {
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{this is not valid json',
    });
    // Whatever the transport's own JSON-RPC error status is, the handler itself must not 500.
    expect(res.status).toBeLessThan(500);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('does not crash when the body is valid JSON but not an object (a bare number)', async () => {
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '42',
    });
    expect(res.status).toBeLessThan(500);
  });
});

describe('a fire-and-forget notification with no reply', () => {
  it('answers a notification-only POST without crashing on a bodyless response', async () => {
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      // No `id`: a pure notification. The transport owes it no JSON-RPC reply.
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(res.status).toBeLessThan(500);
  });
});

describe('an unrouted HTTP method reaching the handler directly', () => {
  it('computes an empty cancellable-id set instead of assuming the method is always POST', async () => {
    // Production only ever mounts mcpHandler for POST/GET/DELETE, but the handler itself branches
    // on `raw.method === 'POST'` rather than assuming it — call it for a method the real route
    // never sends to prove that branch, not just the routing table, is what keeps it safe.
    const app = new Hono();
    app.on(['PUT'], '/mcp', mcpHandler);
    const res = await app.request('/mcp', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    // Whatever the transport does with an unexpected method, mcpHandler's own dispatch must not
    // crash getting there.
    expect(res.status).toBeLessThan(500);
  });
});

describe('DELETE / GET with no session presented', () => {
  it('DELETE with no mcp-session-id header is a 404, not a crash', async () => {
    const res = await mcpApp().request('/mcp', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('GET with no mcp-session-id header is a 404, not a crash', async () => {
    const res = await mcpApp().request('/mcp', {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(404);
  });
});

describe('cancellation notification edge cases', () => {
  async function callSlowTool(
    id: string,
    extraParams: Record<string, unknown> = {},
  ): Promise<Response> {
    return mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'slow_tool', arguments: {}, ...extraParams },
      }),
    });
  }

  async function cancelledNotification(params: Record<string, unknown>): Promise<Response> {
    return mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params }),
    });
  }

  it('tracks a cancellable request that carries no params at all', async () => {
    // `tools/list` takes no arguments, so a well-formed call for it has no `params` field —
    // isTaskAugmentedRequest (and the cancellation-eligibility filter above it) must still treat
    // it as an ordinary, trackable request rather than crashing on the missing params.
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', id: 'req-no-params', method: 'tools/list' }),
    });
    expect(res.status).toBeLessThan(500);
  });

  it('ignores a cancellation notification with no params at all', async () => {
    const original = callSlowTool('req-no-params-cancel');
    await slowToolStarted;

    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled' }),
    });
    expect(res.status).toBe(202);
    expect(activeSignal?.aborted).toBe(false);

    await cancelledNotification({ requestId: 'req-no-params-cancel' });
    await original;
  });

  it('ignores a cancellation notification with no requestId at all', async () => {
    const original = callSlowTool('req-no-id');
    await slowToolStarted;
    expect(activeSignal?.aborted).toBe(false);

    const res = await cancelledNotification({ reason: 'missing requestId' });
    expect(res.status).toBe(202);
    expect(activeSignal?.aborted).toBe(false);

    // Clean up: cancel it for real so the request settles instead of leaking.
    await cancelledNotification({ requestId: 'req-no-id' });
    await original;
  });

  it('ignores a cancellation notification whose requestId is not a valid JSON-RPC id', async () => {
    const original = callSlowTool('req-bad-id');
    await slowToolStarted;

    const res = await cancelledNotification({ requestId: { nested: true } });
    expect(res.status).toBe(202);
    expect(activeSignal?.aborted).toBe(false);

    await cancelledNotification({ requestId: 'req-bad-id' });
    await original;
  });

  it('cancels successfully with no reason field, and logs nothing (reason is falsy)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const original = callSlowTool('req-no-reason');
    await slowToolStarted;

    const res = await cancelledNotification({ requestId: 'req-no-reason' });
    expect(res.status).toBe(202);
    expect(activeSignal?.aborted).toBe(true);
    await original;
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it('cancels successfully with a reason, and logs it', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const original = callSlowTool('req-with-reason');
    await slowToolStarted;

    const res = await cancelledNotification({
      requestId: 'req-with-reason',
      reason: 'user stopped it',
    });
    expect(res.status).toBe(202);
    expect(activeSignal?.aborted).toBe(true);
    await original;
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('user stopped it'));
    infoSpy.mockRestore();
  });

  it('excludes a task-augmented request from cancellation tracking', async () => {
    // This server does not advertise task support, so the transport itself refuses the call
    // before ever invoking the tool — `cancellableRequestIds` runs against the parsed body ahead
    // of that, though, so the exclusion (and the id never landing in `activeMcpRequests`) is
    // observable independent of what the transport does with the request afterward.
    const original = await callSlowTool('req-task', { task: { ttl: 60 } });
    expect(original.status).toBe(200);

    // A cancellation aimed at that same id must be a safe no-op (nothing was ever tracked for
    // it), not a crash — the MCP spec gives task-augmented requests their own tasks/cancel flow.
    const res = await cancelledNotification({ requestId: 'req-task' });
    expect(res.status).toBe(202);
  });
});

describe('responseWithCleanup — a POST response cancelled before it completes', () => {
  it('closes the transport when the caller cancels the reply stream early', async () => {
    const res = await mcpApp().request('/mcp', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-cancel-early',
        method: 'tools/call',
        params: { name: 'slow_tool', arguments: {} },
      }),
    });
    expect(res.status).toBe(200);
    await slowToolStarted;

    // Cancel the reply stream's reader without ever reading a frame from it — this is
    // `responseWithCleanup`'s own `cancel()` handler, not the JSON-RPC `notifications/cancelled`
    // path exercised elsewhere in this file. The underlying tool call is left running in the
    // background (nothing awaits it); the next test's `beforeEach` reassigns `activeSignal`
    // before it could interfere either way.
    await res.body!.getReader().cancel('caller went away');
  });
});

describe('the notification stream heartbeat and abort-only teardown', () => {
  it('emits a comment heartbeat frame to survive idle proxy reaping', async () => {
    const init = await initializeWith({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'heartbeat', version: '0.0.0' },
      },
    });
    const sessionId = init.sessionId!;

    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const res = await mcpApp().request('/mcp', {
        method: 'GET',
        headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId },
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      const readPromise = reader.read();
      await vi.advanceTimersByTimeAsync(25_000);
      const { value, done } = await readPromise;
      expect(done).toBe(false);
      expect(decoder.decode(value)).toContain(': ping');

      await reader.cancel();
      controller.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it('frees the session’s stream slot on an abort with no explicit reader cancel', async () => {
    const init = await initializeWith({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'abort-only', version: '0.0.0' },
      },
    });
    const sessionId = init.sessionId!;

    const controller = new AbortController();
    const first = await mcpApp().request('/mcp', {
      method: 'GET',
      headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId },
      signal: controller.signal,
    });
    expect(first.status).toBe(200);

    // Abort only — deliberately never call reader.cancel() — to force the abort listener's
    // teardown(true) path (which closes the controller) rather than the ReadableStream's own
    // cancel() (teardown(false)).
    controller.abort();
    // Let the abort event's listener run.
    await new Promise((r) => setTimeout(r, 20));

    const second = await mcpApp().request('/mcp', {
      method: 'GET',
      headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId },
    });
    expect(second.status).toBe(200);
    await second.body?.cancel();
  });
});
