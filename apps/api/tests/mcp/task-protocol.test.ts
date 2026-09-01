/**
 * `@docket/api` — the MCP Tasks extension's own JSON-RPC surface: `tasks/get`, `tasks/update`,
 * `tasks/cancel`, `subscriptions/listen`, and the `notifications/tasks` push.
 *
 * @remarks
 * A real `McpServer` + `Client` pair, connected over `InMemoryTransport` — the same pattern
 * `mcp-surface.test.ts` uses — exercising the actual `task-protocol.ts`/`task-store.ts`/
 * `task-tools.ts` production code against the real migrated PGlite `mcp_task`/`mcp_session`/
 * `mcp_subscription` tables, not a mock. Every request the client sends is a genuine JSON-RPC
 * round trip through the SDK's `Protocol` dispatch, including the raw `params._meta` this suite
 * uses to test capability negotiation — something the SDK's typed client helpers do not expose,
 * so these use `client.request(...)` directly.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { MCP_TASKS_EXTENSION } from '@docket/integrations/mcp-tasks-contract';

import type { McpContext } from '../../src/mcp/auth';
import { createMcpCatalog, registerOptionalTaskTool } from '../../src/mcp/catalog';
import { attachStream } from '../../src/mcp/notify';
import { createSession } from '../../src/mcp/session-registry';
import { installTaskProtocolHandlers } from '../../src/mcp/task-protocol';
import type { TaskInputBroker } from '../../src/mcp/task-tools';
import { createTaskToolHandler } from '../../src/mcp/task-tools';
import { taskStoreForContext } from '../../src/mcp/task-store';
import '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;

beforeAll(async () => {
  schema = await getMigratedDb();
});

function userCtx(userId: string): McpContext {
  return {
    principal: { kind: 'user', userId, userName: 'Ada', userEmail: `${userId}@example.com` },
    scopes: [],
  };
}

/** `_meta` declaring the tasks extension, per the committed spec's own example. */
const DECLARES_TASKS = {
  _meta: {
    'io.modelcontextprotocol/clientCapabilities': { extensions: { [MCP_TASKS_EXTENSION]: {} } },
  },
};

const harnesses: { close(): Promise<void> }[] = [];

interface Harness {
  readonly client: Client;
  readonly sessionId: string | null;
}

/**
 * Connect a real server exposing one task-augmented test tool (`echo_task`, which optionally
 * requests mid-flight input) plus the full task-protocol surface under test, and a real client.
 *
 * @param ctx - The authenticated caller.
 * @param withSession - `false` builds the server the way a caller who never sent `initialize`
 * would see it — no `Mcp-Session-Id`, so `subscriptions/listen` has nowhere to register a
 * listener and must refuse.
 */
async function connect(ctx: McpContext, withSession = true): Promise<Harness> {
  const sessionId = withSession ? await createSession(ctx, null) : null;
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        completions: {},
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      },
      taskStore: taskStoreForContext(ctx, sessionId),
    },
  );
  const catalog = createMcpCatalog(server, { tasksEnabled: true });
  const echoInput = { needsInput: z.boolean().optional(), shouldThrow: z.boolean().optional() };
  registerOptionalTaskTool(
    catalog,
    'echo_task',
    {
      title: 'Echo task',
      inputSchema: echoInput,
      outputSchema: { ok: z.boolean() },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execution: { taskSupport: 'optional' },
    },
    createTaskToolHandler<typeof echoInput>(async (input, broker: TaskInputBroker) => {
      if (input.shouldThrow) throw new Error('echo_task asked to blow up');
      if (input.needsInput) {
        await broker.requestInput('confirm', {
          method: 'elicitation/create',
          params: { message: 'Proceed?' },
        });
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
        structuredContent: { ok: true },
      };
    }),
    () => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
      structuredContent: { ok: true },
    }),
  );
  catalog.installListHandlers(ctx);
  installTaskProtocolHandlers(server, ctx, sessionId);

  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'c', version: '0.0.0' },
    { capabilities: { tasks: { requests: { tools: { call: {} } } } } },
  );
  await Promise.all([server.connect(st), client.connect(ct)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return { client, sessionId };
}

afterEach(async () => {
  while (harnesses.length > 0) await assertDefined(harnesses.pop()).close();
});

const DetailedTaskResult = z
  .object({
    resultType: z.string(),
    taskId: z.string(),
    status: z.string(),
    ttlMs: z.union([z.number(), z.null()]).optional(),
  })
  .loose();

const CreatedTaskResult = z.object({ task: z.object({ taskId: z.string(), status: z.string() }) });

/** Create an `echo_task` task, returning its id. */
async function createEchoTask(client: Client, needsInput = false): Promise<string> {
  const created = await client.request(
    {
      method: 'tools/call',
      params: { name: 'echo_task', arguments: { needsInput }, task: { ttl: 60_000 } },
    },
    CreatedTaskResult,
  );
  return created.task.taskId;
}

describe('tasks/get', () => {
  it('rejects a request that does not declare the tasks extension in its own _meta', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const taskId = await createEchoTask(client);

    await expect(
      client.request({ method: 'tasks/get', params: { taskId } }, DetailedTaskResult),
    ).rejects.toThrow(/-32003|Missing required client capability/);
  });

  it('returns the spec-shaped detailed task (ttlMs, resultType complete) when the extension is declared', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const taskId = await createEchoTask(client);

    const task = await client.request(
      { method: 'tasks/get', params: { taskId, ...DECLARES_TASKS } },
      DetailedTaskResult,
    );
    expect(task.resultType).toBe('complete');
    expect(task.taskId).toBe(taskId);
    expect(task).toHaveProperty('ttlMs');
    expect(task).not.toHaveProperty('ttl');
  });

  it('reports an inline result once the task completes, with no separate tasks/result step', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const taskId = await createEchoTask(client);

    await expect
      .poll(
        async () =>
          client.request(
            { method: 'tasks/get', params: { taskId, ...DECLARES_TASKS } },
            DetailedTaskResult,
          ),
        { timeout: 2000 },
      )
      .toMatchObject({ status: 'completed' });

    const finalTask = await client.request(
      { method: 'tasks/get', params: { taskId, ...DECLARES_TASKS } },
      DetailedTaskResult.extend({ result: z.looseObject({}).optional() }),
    );
    expect(finalTask.result).toMatchObject({ structuredContent: { ok: true } });
  });

  it('reports -32602 for an unknown task id', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    await expect(
      client.request(
        { method: 'tasks/get', params: { taskId: 'not-a-real-id', ...DECLARES_TASKS } },
        DetailedTaskResult,
      ),
    ).rejects.toThrow(/Task not found/);
  });

  it('reports `failed` with a JSON-RPC-shaped error when the tool body throws', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const created = await client.request(
      {
        method: 'tools/call',
        params: { name: 'echo_task', arguments: { shouldThrow: true }, task: { ttl: 60_000 } },
      },
      CreatedTaskResult,
    );

    await expect
      .poll(
        async () =>
          client.request(
            { method: 'tasks/get', params: { taskId: created.task.taskId, ...DECLARES_TASKS } },
            DetailedTaskResult.extend({ error: z.looseObject({}).optional() }),
          ),
        { timeout: 2000 },
      )
      .toMatchObject({ status: 'failed' });

    const finalTask = await client.request(
      { method: 'tasks/get', params: { taskId: created.task.taskId, ...DECLARES_TASKS } },
      DetailedTaskResult.extend({ error: z.looseObject({}).optional() }),
    );
    expect(finalTask.error).toMatchObject({ message: 'echo_task asked to blow up' });
  });
});

describe('tasks/cancel', () => {
  it('rejects a request that does not declare the tasks extension', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const taskId = await createEchoTask(client, true);

    await expect(
      client.request({ method: 'tasks/cancel', params: { taskId } }, DetailedTaskResult),
    ).rejects.toThrow(/-32003|Missing required client capability/);
  });

  it('acknowledges with the spec resultType and reaches a terminal status', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const taskId = await createEchoTask(client, true);

    const cancelled = await client.request(
      { method: 'tasks/cancel', params: { taskId, ...DECLARES_TASKS } },
      DetailedTaskResult,
    );
    expect(cancelled.resultType).toBe('complete');
    expect(cancelled.status).toBe('cancelled');
  });

  it('reports -32602 for an unknown task id', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    await expect(
      client.request(
        { method: 'tasks/cancel', params: { taskId: 'not-a-real-id', ...DECLARES_TASKS } },
        DetailedTaskResult,
      ),
    ).rejects.toThrow(/Task not found/);
  });
});

describe('tasks/update (mid-flight input)', () => {
  it('moves a task through input_required, resumes it via tasks/update, and it completes', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const taskId = await createEchoTask(client, true);

    await expect
      .poll(
        async () =>
          client.request(
            { method: 'tasks/get', params: { taskId, ...DECLARES_TASKS } },
            DetailedTaskResult.extend({
              inputRequests: z.record(z.string(), z.unknown()).optional(),
            }),
          ),
        { timeout: 2000 },
      )
      .toMatchObject({ status: 'input_required' });

    const snapshot = await client.request(
      { method: 'tasks/get', params: { taskId, ...DECLARES_TASKS } },
      DetailedTaskResult.extend({ inputRequests: z.record(z.string(), z.unknown()).optional() }),
    );
    expect(snapshot.inputRequests).toMatchObject({ confirm: { method: 'elicitation/create' } });

    const ack = await client.request(
      {
        method: 'tasks/update',
        params: { taskId, inputResponses: { confirm: { action: 'accept' } }, ...DECLARES_TASKS },
      },
      z.object({ resultType: z.string() }),
    );
    expect(ack.resultType).toBe('complete');

    await expect
      .poll(
        async () =>
          client.request(
            { method: 'tasks/get', params: { taskId, ...DECLARES_TASKS } },
            DetailedTaskResult,
          ),
        { timeout: 2000 },
      )
      .toMatchObject({ status: 'completed' });
  });

  it('rejects tasks/update from a client that does not declare the extension', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const taskId = await createEchoTask(client, true);

    await expect(
      client.request(
        { method: 'tasks/update', params: { taskId, inputResponses: {} } },
        z.object({ resultType: z.string() }),
      ),
    ).rejects.toThrow(/-32003|Missing required client capability/);
  });

  it('reports -32602 for an unknown task id', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    await expect(
      client.request(
        {
          method: 'tasks/update',
          params: { taskId: 'not-a-real-id', inputResponses: {}, ...DECLARES_TASKS },
        },
        z.object({ resultType: z.string() }),
      ),
    ).rejects.toThrow(/Task not found/);
  });
});

describe('subscriptions/listen + notifications/tasks', () => {
  it('rejects a listen request that does not declare the extension', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    await expect(
      client.request(
        { method: 'subscriptions/listen', params: { notifications: { taskIds: [] } } },
        z.looseObject({}),
      ),
    ).rejects.toThrow(/-32003|Missing required client capability/);
  });

  it('refuses to listen without an MCP session to address the push to', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`), false);
    await expect(
      client.request(
        {
          method: 'subscriptions/listen',
          params: { notifications: { taskIds: [] }, ...DECLARES_TASKS },
        },
        z.looseObject({}),
      ),
    ).rejects.toThrow(/needs an MCP session/);
  });

  it('accepts a listen request that omits taskIds, subscribing to nothing', async () => {
    const { client } = await connect(userCtx(`u-${Math.random().toString(36).slice(2)}`));
    const ack = await client.request(
      { method: 'subscriptions/listen', params: { notifications: {}, ...DECLARES_TASKS } },
      z.looseObject({}),
    );
    expect(ack).toEqual({});
  });

  it('pushes notifications/tasks on every status transition after subscribing, with zero tasks/get calls needed', async () => {
    // notifications/tasks and notifications/subscriptions/acknowledged ride the same
    // out-of-band SSE channel every other MCP notification does (`notify.ts`'s Postgres
    // LISTEN/NOTIFY fan-out, held open by the `/mcp` GET route) — not the request/response JSON-RPC
    // transport this suite's InMemoryTransport client/server pair uses. `attachStream` is the real
    // production entry point that route installs; calling it directly here is what makes this a
    // genuine end-to-end check of `notifyTaskStatus`/`notifySubscriptionsAcknowledged` rather than
    // a check of something no code path actually delivers to.
    const { client, sessionId } = await connect(
      userCtx(`u-${Math.random().toString(36).slice(2)}`),
    );
    if (!sessionId) throw new Error('expected connect() to mint a session by default');
    const taskId = await createEchoTask(client, true);

    const frames: Record<string, unknown>[] = [];
    const detach = await attachStream(sessionId, (frame) => {
      frames.push(JSON.parse(frame) as Record<string, unknown>);
    });
    expect(detach).not.toBeNull();

    const ack = await client.request(
      {
        method: 'subscriptions/listen',
        params: { notifications: { taskIds: [taskId] }, ...DECLARES_TASKS },
      },
      z.looseObject({}),
    );
    expect(ack).toEqual({});

    await expect
      .poll(() => frames.some((n) => n['method'] === 'notifications/subscriptions/acknowledged'), {
        timeout: 2000,
      })
      .toBe(true);
    const acknowledged = frames.find(
      (n) => n['method'] === 'notifications/subscriptions/acknowledged',
    ) as { params?: { notifications?: { taskIds?: string[] } } };
    expect(acknowledged.params?.notifications?.taskIds).toEqual([taskId]);

    // Resume the task purely by answering tasks/update — never call tasks/get.
    await client.request(
      {
        method: 'tasks/update',
        params: { taskId, inputResponses: { confirm: { action: 'accept' } }, ...DECLARES_TASKS },
      },
      z.object({ resultType: z.string() }),
    );

    await expect
      .poll(() => frames.filter((n) => n['method'] === 'notifications/tasks').length, {
        timeout: 2000,
      })
      .toBeGreaterThanOrEqual(2); // input_required -> working, then -> completed

    const statuses = frames
      .filter((n) => n['method'] === 'notifications/tasks')
      .map((n) => (n['params'] as { status?: string } | undefined)?.status);
    expect(statuses).toContain('working');
    expect(statuses).toContain('completed');
    const lastCompleted = frames.find(
      (n) =>
        n['method'] === 'notifications/tasks' &&
        (n['params'] as { status?: string } | undefined)?.status === 'completed',
    ) as { params?: { taskId?: string; result?: unknown } } | undefined;
    expect(lastCompleted?.params?.taskId).toBe(taskId);
    expect(lastCompleted?.params?.result).toBeDefined();

    detach?.();
  });

  it('silently skips a task id the caller does not own rather than confirming its existence', async () => {
    const ownerCtx = userCtx(`owner-${Math.random().toString(36).slice(2)}`);
    const { client: ownerClient } = await connect(ownerCtx);
    const foreignTaskId = await createEchoTask(ownerClient);

    const { client: otherClient } = await connect(
      userCtx(`other-${Math.random().toString(36).slice(2)}`),
    );
    const ack = await otherClient.request(
      {
        method: 'subscriptions/listen',
        params: { notifications: { taskIds: [foreignTaskId] }, ...DECLARES_TASKS },
      },
      z.looseObject({}),
    );
    expect(ack).toEqual({});

    const subs = await schema.db
      .select()
      .from(schema.mcpSubscription)
      .where(eq(schema.mcpSubscription.uri, `mcp-task:${foreignTaskId}`));
    expect(subs).toHaveLength(0);
  });
});
