/**
 * `@docket/api` — the directive MCP surface (curfew-integration.md §1–§4).
 *
 * @remarks
 * Three seams, tested the way their consumers reach them: the `docket://hub/directive` static
 * resource and the `acknowledge_directive` tool through an in-memory identity-bound server
 * (mirroring `mcp-plan-tools.test.ts` / `mcp-scope.test.ts`), and the posture sweep's
 * change-only, per-Hub notification publish through the real `/mcp` HTTP handler and its
 * LISTEN/NOTIFY stream (mirroring `mcp-notifications.test.ts`).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { DirectiveOut } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import type { resetNotifications as ResetNotifications } from '../../src/mcp/notify';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import type { mcpHandler as McpHandler } from '../../src/mcp/server';
import type * as ScopeModule from '../../src/mcp/scope';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type { sweepDirectivePosture as SweepDirectivePosture } from '../../src/routes/directive-sweep';
import { getSession, resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let registerResources!: typeof RegisterResources;
let scopeMod!: typeof ScopeModule;
let mcpHandler!: typeof McpHandler;
let resetNotifications!: typeof ResetNotifications;
let sweepDirectivePosture!: typeof SweepDirectivePosture;

beforeAll(async () => {
  // Configure OAuth before importing MCP modules that read the API env slice.
  vi.stubEnv('MCP_ISSUER_URL', 'https://auth.docket.test');
  vi.stubEnv('MCP_RESOURCE_URL', 'https://api.docket.test/mcp');
  vi.stubEnv('WEB_URL', 'https://docket.test');
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  registerResources = (await import('../../src/mcp/resources')).registerResources;
  scopeMod = await import('../../src/mcp/scope');
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
  resetNotifications = (await import('../../src/mcp/notify')).resetNotifications;
  sweepDirectivePosture = (await import('../../src/routes/directive-sweep')).sweepDirectivePosture;
});

const URI = 'docket://hub/directive';
const TZ = 'UTC';

interface Seed {
  userId: string;
  hubId: string;
  email: string;
}

/** Seed a bare user + Hub. No scheduling preference, so the sweep never picks these up. */
async function seedHubUser(): Promise<Seed> {
  const slug = `dm-${Math.random().toString(36).slice(2, 10)}`;
  const email = `${slug}@e.com`;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const [h] = await db
    .insert(schema.hub)
    .values({ userId: u!.id })
    .returning({ id: schema.hub.id });
  return { userId: u!.id, hubId: h!.id, email };
}

/** Seed the native-blocks calendar layer a block needs to hang off. */
async function seedLayer(userId: string): Promise<string> {
  const [layer] = await db
    .insert(schema.calendarLayer)
    .values({
      userId,
      connectionId: null,
      provider: 'docket',
      sourceKind: 'native_blocks',
      title: 'Docket blocks',
      selected: true,
      visibleByDefault: true,
      editableCore: true,
      primary: false,
    })
    .returning({ id: schema.calendarLayer.id });
  return layer!.id;
}

/** Seed one scheduler-placed block on the calendar. */
async function seedBlock(
  userId: string,
  layerId: string,
  title: string,
  startsAt: Date,
  endsAt: Date,
): Promise<void> {
  await db.insert(schema.calendarItem).values({
    userId,
    layerId,
    connectionId: null,
    kind: 'native_block',
    provider: 'docket',
    status: 'confirmed',
    syncState: 'clean',
    title,
    startsAt,
    endsAt,
    origin: 'scheduler',
  });
}

/** Seed the planning run that makes a day read as `ready` rather than `not_generated`. */
async function seedRun(hubId: string, weekStartDate: string): Promise<void> {
  await db.insert(schema.scheduleRun).values({ hubId, weekStartDate, timezone: TZ, blockCount: 1 });
}

/** A "ready" day for `seed`: a run covering `date` plus one block from `start` to `end`. */
async function seedReadyDay(seed: Seed, date: string, start: Date, end: Date): Promise<void> {
  const layerId = await seedLayer(seed.userId);
  await seedRun(seed.hubId, date);
  await seedBlock(seed.userId, layerId, 'Cut the trailer', start, end);
}

function ctxFor(seed: Seed, scopes: readonly string[], clientId: string | null = null): McpContext {
  return {
    principal: { kind: 'user', userId: seed.userId, userName: 'Ada', userEmail: seed.email },
    scopes,
    clientId,
  };
}

const AGENT_CTX: McpContext = {
  principal: {
    kind: 'agent',
    agentId: 'agt_test',
    agentActorId: 'act_test',
    orgId: 'org_test',
    displayName: 'Athena',
  },
  scopes: ['work:read', 'work:write', 'agents:run'],
};

const harnesses: { close(): Promise<void> }[] = [];

/** Connect an identity-bound in-memory MCP server for `ctx`. */
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
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
  await resetNotifications();
  resetAuthMocks();
});

async function readDirective(client: Client): Promise<DirectiveOut> {
  const res = await client.readResource({ uri: URI });
  return JSON.parse((res.contents[0] as { text: string }).text) as DirectiveOut;
}

function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
}

describe('docket://hub/directive resource', () => {
  it('returns the caller’s own day: plan, posture, reason, gates', async () => {
    const seed = await seedHubUser();
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    // The block starts exactly now and runs an hour, so it is in flight with enough slack that
    // the posture heuristic reads the day as on_track.
    await seedReadyDay(seed, date, now, new Date(now.getTime() + 60 * 60 * 1000));

    const client = await connect(ctxFor(seed, ['work:read']));
    const directive = await readDirective(client);

    expect(directive.schemaVersion).toBe('directive/1');
    expect(directive.date).toBe(date);
    expect(directive.timezone).toBe(TZ);
    expect(directive.directiveId).toEqual(expect.any(String));
    expect(directive.agendaReadiness).toBe('ready');
    expect(directive.plan).toHaveLength(1);
    expect(directive.plan[0]).toMatchObject({ title: 'Cut the trailer', status: 'planned' });
    expect(directive.posture).toBe('on_track');
    expect(directive.reason.length).toBeGreaterThan(0);
    expect(directive.gates.map((gate) => gate.kind).sort()).toEqual(['day_end', 'day_start']);
  });

  it('is advertised alongside the other Hub statics', async () => {
    const seed = await seedHubUser();
    const client = await connect(ctxFor(seed, ['work:read']));
    const listed = await client.listResources();
    expect(listed.resources.map((resource) => resource.uri)).toContain(URI);
  });

  it('denies the read to a token lacking work:read', async () => {
    const seed = await seedHubUser();
    const client = await connect(ctxFor(seed, ['work:write']));
    await expect(client.readResource({ uri: URI })).rejects.toThrow(/work:read/);
  });

  it('is not something an agent principal can read', async () => {
    // A directive is a person's; an agent has no Hub — reported as absent, not forbidden.
    const client = await connect(AGENT_CTX);
    await expect(client.readResource({ uri: URI })).rejects.toThrow(/Hub not found/);
  });
});

describe('acknowledge_directive tool', () => {
  it('round-trips: read the directive, acknowledge it, and land one attributed audit row', async () => {
    const seed = await seedHubUser();
    const now = new Date();
    await seedReadyDay(
      seed,
      now.toISOString().slice(0, 10),
      now,
      new Date(now.getTime() + 60 * 60 * 1000),
    );

    const client = await connect(ctxFor(seed, ['work:read', 'work:write'], 'client_curlew'));
    const directive = await readDirective(client);

    const res = (await client.callTool({
      name: 'acknowledge_directive',
      arguments: {
        directiveId: directive.directiveId,
        appliedPosture: directive.posture,
        enforced: false,
        note: 'Rendered the agenda before releasing the gate.',
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(payload(res)).toMatchObject({ acknowledged: true });
    expect(payload(res)['acknowledgedAt']).toEqual(expect.any(String));

    const rows = await db
      .select()
      .from(schema.directiveAcknowledgment)
      .where(eq(schema.directiveAcknowledgment.hubId, seed.hubId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      directiveId: directive.directiveId,
      appliedPosture: directive.posture,
      enforced: false,
      // The registered OAuth client the call arrived through — the audit trail's only
      // attribution, and never a name (curfew-integration.md §0).
      clientId: 'client_curlew',
      acknowledgedByUserId: seed.userId,
    });
  });

  it('is idempotent by upsert: a retry overwrites the row rather than appending one', async () => {
    const seed = await seedHubUser();
    const now = new Date();
    await seedReadyDay(
      seed,
      now.toISOString().slice(0, 10),
      now,
      new Date(now.getTime() + 60 * 60 * 1000),
    );
    const client = await connect(ctxFor(seed, ['work:read', 'work:write']));
    const directive = await readDirective(client);

    const args = {
      directiveId: directive.directiveId,
      appliedPosture: directive.posture,
      enforced: false,
    };
    await client.callTool({ name: 'acknowledge_directive', arguments: args });
    await client.callTool({
      name: 'acknowledge_directive',
      arguments: { ...args, enforced: true },
    });

    const rows = await db
      .select()
      .from(schema.directiveAcknowledgment)
      .where(eq(schema.directiveAcknowledgment.hubId, seed.hubId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enforced).toBe(true);
  });

  it('denies the write to a token lacking work:write, and writes nothing', async () => {
    const seed = await seedHubUser();
    const client = await connect(ctxFor(seed, ['work:read']));
    const res = (await client.callTool({
      name: 'acknowledge_directive',
      arguments: { directiveId: 'dir_x', appliedPosture: 'on_track', enforced: false },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('work:write');

    const rows = await db
      .select()
      .from(schema.directiveAcknowledgment)
      .where(eq(schema.directiveAcknowledgment.hubId, seed.hubId));
    expect(rows).toHaveLength(0);
  });

  it('is not something an agent principal can call', async () => {
    const client = await connect(AGENT_CTX);
    const res = (await client.callTool({
      name: 'acknowledge_directive',
      arguments: { directiveId: 'dir_x', appliedPosture: 'on_track', enforced: false },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });

  it('is gated work:write in TOOL_SCOPE, so the transport preflight covers it too', () => {
    expect(scopeMod.TOOL_SCOPE['acknowledge_directive']).toBe('work:write');
  });
});

// ── the sweep, through the real transport ────────────────────────────────────

/** A fixed instant, so the sweep's posture math never depends on the test machine's clock. */
const NOW = new Date('2026-08-07T20:00:00.000Z');
const DATE = '2026-08-07';

function app(): Hono {
  const instance = new Hono();
  instance.on(['POST', 'GET', 'DELETE'], '/mcp', mcpHandler);
  return instance;
}

/** Authenticate the next `mcpHandler` call as `seed`'s user (first-party cookie path). */
function authAs(seed: Seed): void {
  getSession.mockResolvedValue({ user: { id: seed.userId, name: 'Ada', email: seed.email } });
}

/** Complete `initialize` and return the minted session id. */
async function openSession(seed: Seed): Promise<string> {
  authAs(seed);
  const res = await app().request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
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
  return sessionId!;
}

/** Subscribe `seed`'s session to the directive resource, draining the reply. */
async function subscribe(seed: Seed, sessionId: string): Promise<void> {
  authAs(seed);
  const res = await app().request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/subscribe',
      params: { uri: URI },
    }),
  });
  // Drain the body: the transport finishes writing after the handler returns, and the
  // subscription insert rides that completion.
  const text = await res.text();
  expect(text).not.toContain('"error"');
}

/** Open the notification stream and expose a frame reader plus teardown. */
async function openStream(
  seed: Seed,
  sessionId: string,
): Promise<{ nextFrame: () => Promise<unknown>; close: () => void }> {
  authAs(seed);
  const controller = new AbortController();
  const res = await app().request('/mcp', {
    method: 'GET',
    headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
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

  return {
    nextFrame,
    close: () => {
      void reader.cancel();
      controller.abort();
    },
  };
}

/** A configured Hub the sweep will pick up, with one long-overrun block on `DATE`. */
async function seedSweptHub(): Promise<Seed> {
  const seed = await seedHubUser();
  await db.insert(schema.schedulingPreference).values({ hubId: seed.hubId, timezone: TZ });
  await seedReadyDay(
    seed,
    DATE,
    new Date('2026-08-07T15:00:00.000Z'),
    new Date('2026-08-07T16:00:00.000Z'),
  );
  return seed;
}

describe('sweepDirectivePosture', () => {
  it('publishes resources/updated to a subscriber on change, and only on change', async () => {
    const seed = await seedSweptHub();
    const sessionId = await openSession(seed);
    await subscribe(seed, sessionId);

    const stream = await openStream(seed, sessionId);
    try {
      // First pass: the day has never been computed, so the posture moves (the block is four
      // hours overrun) and exactly this Hub publishes.
      const first = await sweepDirectivePosture(NOW);
      expect(first.failed).toBe(0);
      expect(first.changed).toBe(1);
      await expect(stream.nextFrame()).resolves.toMatchObject({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: URI },
      });

      // Second pass at the same instant: same posture, same reason, same directiveId — nothing
      // is rewritten and nothing is published. A healthy cadence is silent.
      const second = await sweepDirectivePosture(NOW);
      expect(second.failed).toBe(0);
      expect(second.changed).toBe(0);
    } finally {
      stream.close();
    }

    const [row] = await db
      .select()
      .from(schema.dayDirective)
      .where(eq(schema.dayDirective.hubId, seed.hubId));
    expect(row?.posture).toBe('intervention_recommended');
    expect(row?.recommendedCalendarItemId).not.toBeNull();
  });

  it('addresses the publish to the affected Hub’s own sessions, not every subscriber of the URI', async () => {
    const swept = await seedSweptHub();
    // A bystander subscribed to the same (caller-scoped) URI. No scheduling preference, so the
    // sweep never evaluates this Hub — its session must not be woken by the other Hub's change.
    const bystander = await seedHubUser();

    const sweptSession = await openSession(swept);
    await subscribe(swept, sweptSession);
    const bystanderSession = await openSession(bystander);
    await subscribe(bystander, bystanderSession);

    const sweptStream = await openStream(swept, sweptSession);
    const bystanderStream = await openStream(bystander, bystanderSession);
    try {
      const result = await sweepDirectivePosture(NOW);
      expect(result.failed).toBe(0);
      expect(result.changed).toBe(1);

      await expect(sweptStream.nextFrame()).resolves.toMatchObject({
        method: 'notifications/resources/updated',
        params: { uri: URI },
      });

      // Prove the negative without a timeout: notifications on one channel arrive in publish
      // order, so a marker published *after* the sweep must be the bystander's FIRST frame —
      // if the sweep had (wrongly) addressed the bystander, resources/updated would precede it.
      const marker = JSON.stringify({
        sessionId: bystanderSession,
        method: 'notifications/message',
        params: { level: 'info', logger: 'docket', data: { marker: true } },
      });
      await db.execute(sql`select pg_notify('mcp_notify', ${marker})`);
      await expect(bystanderStream.nextFrame()).resolves.toMatchObject({
        method: 'notifications/message',
        params: { data: { marker: true } },
      });
    } finally {
      sweptStream.close();
      bystanderStream.close();
    }
  });
});
