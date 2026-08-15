import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { mcpHandler as McpHandler } from '../../src/mcp/server';
import type { resetNotifications as ResetNotifications } from '../../src/mcp/notify';
import { resetAuthMocks, verifyAccessToken } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { seedSkipConsentClient } from '../support/oauth-grant';
import { appWithActor, seedStatuses } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let mcpHandler!: typeof McpHandler;
let resetNotifications!: typeof ResetNotifications;

beforeAll(async () => {
  vi.stubEnv('MCP_ISSUER_URL', 'https://auth.docket.test');
  vi.stubEnv('MCP_RESOURCE_URL', 'https://api.docket.test/mcp');
  schema = await getMigratedDb();
  db = schema.db;
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
  resetNotifications = (await import('../../src/mcp/notify')).resetNotifications;
});

interface Seed {
  userId: string;
  orgId: string;
  teamId: string;
  actorId: string;
  roleId: string;
  taskId: string;
  clientId: string;
}

/** Seed an org whose human actor holds `view` org-wide. */
async function seedOrg(): Promise<Seed> {
  const slug = `mn-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const statusId = await seedStatuses(db, schema, orgId);

  const [role] = await db
    .insert(schema.role)
    .values({ organizationId: orgId, key: 'seeded', name: 'Seeded', capabilities: ['view'] })
    .returning({ id: schema.role.id });
  const roleId = assertDefined(role).id;

  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  const userId = assertDefined(user).id;
  await db.insert(schema.hub).values({ userId });

  const [actor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, roleId })
    .returning({ id: schema.actor.id });
  const actorId = assertDefined(actor).id;

  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: roleId,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['view'],
    effect: 'allow',
  });

  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  const teamId = assertDefined(team).id;

  const [task] = await db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      title: 'Ship',
      teamId,
      state: 'todo',
      statusId: statusId('task', 'todo'),
      createdBy: actorId,
    })
    .returning({ id: schema.task.id });

  const { clientId } = await seedSkipConsentClient(schema);
  return { userId, orgId, teamId, actorId, roleId, taskId: assertDefined(task).id, clientId };
}

function app(): Hono {
  const instance = new Hono();
  instance.on(['POST', 'GET', 'DELETE'], '/mcp', mcpHandler);
  return instance;
}

/** Authenticate the next `mcpHandler` call as `seed`'s user. */
function authAs(seed: Seed): void {
  verifyAccessToken.mockResolvedValue({
    sub: seed.userId,
    azp: seed.clientId,
    scope: 'work:read work:write agents:run connectors:link',
  });
}

function authorization(seed: Seed): string {
  authAs(seed);
  return 'Bearer test-token';
}

/** Complete `initialize` and return the minted session id. */
async function openSession(seed: Seed): Promise<string> {
  authAs(seed);
  const res = await app().request('/mcp', {
    method: 'POST',
    headers: {
      authorization: authorization(seed),
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
        clientInfo: { name: 'c', version: '0.0.0' },
      },
    }),
  });
  const sessionId = res.headers.get('Mcp-Session-Id');
  expect(sessionId).toEqual(expect.any(String));
  return assertDefined(sessionId);
}

/** One JSON-RPC reply, as returned by {@link rpc}. */
interface RpcReply {
  readonly status: number;
  readonly message: { readonly result?: unknown; readonly error?: { readonly message: string } };
}

/**
 * Send one JSON-RPC request on an existing session and read its reply to completion.
 *
 * @remarks
 * Draining the body is not optional. The transport answers over SSE when the client accepts it
 * and finishes writing *after* the handler returns, so a caller that ignores the body races the
 * work it just asked for — which is exactly how the first draft of these tests deleted a
 * subscription before it was inserted.
 */
async function rpc(
  seed: Seed,
  sessionId: string,
  method: string,
  params: Record<string, unknown>,
): Promise<RpcReply> {
  authAs(seed);
  const res = await app().request('/mcp', {
    method: 'POST',
    headers: {
      authorization: authorization(seed),
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method, params }),
  });
  const text = await res.text();
  if (!text) return { status: res.status, message: {} };
  // SSE frames the reply as `event: message\ndata: {...}`; a JSON response is the body itself.
  const line = text.split('\n').find((candidate) => candidate.startsWith('data: '));
  const raw = line ? line.slice(6) : text;
  try {
    return { status: res.status, message: JSON.parse(raw) as RpcReply['message'] };
  } catch {
    return { status: res.status, message: {} };
  }
}

/**
 * Open the notification stream and resolve the first data frame it emits.
 *
 * @remarks
 * Returns the reader too so the caller can abort — an unread SSE body keeps the handler's writer
 * loop alive and the test process open.
 */
async function openStream(
  seed: Seed,
  sessionId: string,
): Promise<{ nextFrame: () => Promise<unknown>; close: () => void }> {
  authAs(seed);
  const controller = new AbortController();
  const res = await app().request('/mcp', {
    method: 'GET',
    headers: {
      authorization: authorization(seed),
      accept: 'text/event-stream',
      'mcp-session-id': sessionId,
    },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = assertDefined(res.body).getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  const nextFrame = async (): Promise<unknown> => {
    for (;;) {
      const index = buffered.indexOf('\n\n');
      if (index !== -1) {
        const chunk = buffered.slice(0, index);
        buffered = buffered.slice(index + 2);
        // Skip heartbeat comments; only `data:` lines carry JSON-RPC.
        if (chunk.startsWith('data: ')) return JSON.parse(chunk.slice(6)) as unknown;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream closed before a frame arrived');
      buffered += decoder.decode(value, { stream: true });
    }
  };

  return {
    nextFrame,
    close: () => {
      void reader.cancel();
      controller.abort();
    },
  };
}

/** Resolve the next live notification promptly, failing clearly if a mutation fails to announce it. */
async function nextFrameWithin(nextFrame: () => Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('role-base mutation did not announce a changed tools list'));
    }, 1_000);
    void nextFrame().then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('notification stream failed'));
      },
    );
  });
}

afterEach(async () => {
  await resetNotifications();
  resetAuthMocks();
});

describe('MCP notification channel', () => {
  it('delivers resources/updated to a subscriber when the entity is written', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    const uri = `docket://${seed.orgId}/task/${seed.taskId}`;

    const subscribed = await rpc(seed, sessionId, 'resources/subscribe', { uri });
    expect(subscribed.message.error).toBeUndefined();

    const stream = await openStream(seed, sessionId);
    try {
      // Drive the real hook, not the notifier directly — the point is that an ordinary entity
      // write announces itself.
      const { enqueueSearchUpsert } = await import('../../src/search/write-through');
      await enqueueSearchUpsert(seed.orgId, 'task', seed.taskId);
      await expect(stream.nextFrame()).resolves.toMatchObject({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri },
      });
    } finally {
      stream.close();
    }
  });

  it('delivers a frame published by a writer that never saw the stream', async () => {
    // The cross-instance assertion: the notify hop goes through Postgres, so a publisher with no
    // reference to the holding instance still reaches it. This is what makes the design survive
    // `--max-instances=10` with no session affinity.
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    const stream = await openStream(seed, sessionId);
    try {
      const payload = JSON.stringify({
        sessionId,
        method: 'notifications/message',
        params: { level: 'info', logger: 'docket', data: { from: 'another instance' } },
      });
      await db.execute(sql`select pg_notify('mcp_notify', ${payload})`);
      await expect(stream.nextFrame()).resolves.toMatchObject({
        method: 'notifications/message',
        params: { data: { from: 'another instance' } },
      });
    } finally {
      stream.close();
    }
  });

  it('refuses a session id presented by a different principal', async () => {
    const owner = await seedOrg();
    const stranger = await seedOrg();
    const sessionId = await openSession(owner);

    const res = await rpc(stranger, sessionId, 'resources/subscribe', {
      uri: `docket://${owner.orgId}/task/${owner.taskId}`,
    });
    // A miss, not a denial — a guessed id must not confirm that a session exists.
    expect(res.status).toBe(404);
    const rows = await db
      .select()
      .from(schema.mcpSubscription)
      .where(eq(schema.mcpSubscription.sessionId, sessionId));
    expect(rows).toHaveLength(0);
  });

  it('refuses to subscribe to a resource the caller cannot read', async () => {
    const seed = await seedOrg();
    const other = await seedOrg();
    const sessionId = await openSession(seed);

    // A task in an org this caller has no actor in.
    const res = await rpc(seed, sessionId, 'resources/subscribe', {
      uri: `docket://${other.orgId}/task/${other.taskId}`,
    });
    expect(res.message.error).toBeDefined();

    const rows = await db
      .select()
      .from(schema.mcpSubscription)
      .where(eq(schema.mcpSubscription.sessionId, sessionId));
    expect(rows).toHaveLength(0);
  });

  it('ends a session and drops its subscriptions on DELETE', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    await rpc(seed, sessionId, 'resources/subscribe', {
      uri: `docket://${seed.orgId}/task/${seed.taskId}`,
    });

    authAs(seed);
    const deleted = await app().request('/mcp', {
      method: 'DELETE',
      headers: { authorization: authorization(seed), 'mcp-session-id': sessionId },
    });
    expect(deleted.status).toBe(204);

    const subs = await db
      .select()
      .from(schema.mcpSubscription)
      .where(eq(schema.mcpSubscription.sessionId, sessionId));
    expect(subs).toHaveLength(0);

    // The id is now inert.
    const after = await rpc(seed, sessionId, 'resources/subscribe', {
      uri: `docket://${seed.orgId}/task/${seed.taskId}`,
    });
    expect(after.status).toBe(404);
  });

  it('allows only one notification stream per session', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    const stream = await openStream(seed, sessionId);
    try {
      authAs(seed);
      const second = await app().request('/mcp', {
        method: 'GET',
        headers: {
          authorization: authorization(seed),
          accept: 'text/event-stream',
          'mcp-session-id': sessionId,
        },
      });
      expect(second.status).toBe(409);
    } finally {
      stream.close();
    }
  });

  it('tells a live session its tool list moved when a grant changes', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    const stream = await openStream(seed, sessionId);
    try {
      const { notifyGrantsChanged } = await import('../../src/mcp/notify');
      // Addressed by role, which is the indirect case: the join has to walk role → actor →
      // principal key before it can find the session.
      await notifyGrantsChanged(seed.orgId, 'role', seed.roleId);
      await expect(stream.nextFrame()).resolves.toMatchObject({
        method: 'notifications/tools/list_changed',
      });
    } finally {
      stream.close();
    }
  });

  it('tells affected sessions when a role baseline changes', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    const stream = await openStream(seed, sessionId);
    try {
      const roles = (await import('../../src/routes/roles')).default;
      const rolesApp = appWithActor(roles, seed.orgId, ['manage'], seed.actorId, null, seed.roleId);
      const changed = await rolesApp.request(`/${seed.roleId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseCapability: 'contribute' }),
      });

      expect(changed.status).toBe(200);
      const frame = await nextFrameWithin(stream.nextFrame);
      expect(frame).toMatchObject({ method: 'notifications/tools/list_changed' });
    } finally {
      stream.close();
    }
  });

  it('tells affected sessions when deleting a role baseline', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    const stream = await openStream(seed, sessionId);
    try {
      const roles = (await import('../../src/routes/roles')).default;
      const rolesApp = appWithActor(roles, seed.orgId, ['manage'], seed.actorId, null, seed.roleId);
      const deleted = await rolesApp.request(`/${seed.roleId}`, { method: 'DELETE' });

      expect(deleted.status).toBe(200);
      await expect(nextFrameWithin(stream.nextFrame)).resolves.toMatchObject({
        method: 'notifications/tools/list_changed',
      });
    } finally {
      stream.close();
    }
  });

  it('addresses a grant change aimed at a single actor', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    const stream = await openStream(seed, sessionId);
    try {
      const { notifyGrantsChanged } = await import('../../src/mcp/notify');
      await notifyGrantsChanged(seed.orgId, 'actor', seed.actorId);
      await expect(stream.nextFrame()).resolves.toMatchObject({
        method: 'notifications/tools/list_changed',
      });
    } finally {
      stream.close();
    }
  });

  it('suppresses log frames below the level the session asked for', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    await rpc(seed, sessionId, 'logging/setLevel', { level: 'error' });
    const stream = await openStream(seed, sessionId);
    try {
      const { notifyLog } = await import('../../src/mcp/notify');
      await notifyLog(sessionId, 'info', { event: 'ignored' });
      await notifyLog(sessionId, 'error', { event: 'delivered' });
      // The first frame to arrive must be the error one; the info frame was dropped server-side.
      await expect(stream.nextFrame()).resolves.toMatchObject({
        method: 'notifications/message',
        params: { level: 'error', data: { event: 'delivered' } },
      });
    } finally {
      stream.close();
    }
  });

  it('persists the log level a session asks for', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    const res = await rpc(seed, sessionId, 'logging/setLevel', { level: 'warning' });
    expect(res.message.error).toBeUndefined();

    const rows = await db
      .select({ logLevel: schema.mcpSession.logLevel })
      .from(schema.mcpSession)
      .where(eq(schema.mcpSession.id, sessionId));
    expect(rows[0]?.logLevel).toBe('warning');
  });

  it('reaps sessions idle past the TTL', async () => {
    const seed = await seedOrg();
    const sessionId = await openSession(seed);
    await db
      .update(schema.mcpSession)
      .set({ lastSeenAt: new Date(Date.now() - 48 * 60 * 60 * 1000) })
      .where(eq(schema.mcpSession.id, sessionId));

    const { reapIdleSessions } = await import('../../src/mcp/session-registry');
    expect(await reapIdleSessions()).toBeGreaterThan(0);

    const rows = await db
      .select({ endedAt: schema.mcpSession.endedAt })
      .from(schema.mcpSession)
      .where(and(eq(schema.mcpSession.id, sessionId)));
    expect(rows[0]?.endedAt).not.toBeNull();
  });
});
