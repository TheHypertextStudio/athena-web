import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as AgentRuntimeModule from '@docket/agent-runtime';
import type * as IntegrationsModule from '@docket/integrations';
import type { McpIntegrationOut } from '@docket/types';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type integrationsMcpRouter from '../../src/routes/integrations-mcp';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';
import type { unsealCredential as Unseal } from '../../src/lib/credentials';
import type { getContainer as GetContainer } from '../../src/container';

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['AGENT_MAX_TURNS'] = '8';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let agentRuntime!: typeof AgentRuntimeModule;
let integrations!: typeof IntegrationsModule;
let integrationsMcp!: typeof integrationsMcpRouter;
let agentSessions!: typeof agentSessionsRouter;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;
let unsealCredential!: typeof Unseal;
let getContainer!: typeof GetContainer;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  agentRuntime = await import('@docket/agent-runtime');
  integrations = await import('@docket/integrations');
  integrationsMcp = (await import('../../src/routes/integrations-mcp')).default;
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
  ({ unsealCredential } = await import('../../src/lib/credentials'));
  ({ getContainer } = await import('../../src/container'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const J = { 'content-type': 'application/json' };

interface Seed {
  orgId: string;
  teamId: string;
  humanActorId: string;
  agentId: string;
}

async function seedOrg(): Promise<Seed> {
  const slug = `im-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: org!.id, kind: 'human', displayName: 'Ada', userId: u!.id })
    .returning({ id: schema.actor.id });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: org!.id, name: 'Core', key: 'CORE' })
    .returning({ id: schema.team.id });
  const registeredAgent = await ensureDefaultAgent(org!.id, human!.id);
  return {
    orgId: org!.id,
    teamId: team!.id,
    humanActorId: human!.id,
    agentId: registeredAgent.id,
  };
}

function appFor(router: typeof integrationsMcpRouter, seed: Seed) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = {
      orgId: seed.orgId,
      actorId: seed.humanActorId,
      roleId: 'role_test',
      capabilities: ['view', 'contribute', 'assign', 'manage'],
    };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', router);
  app.onError(onError);
  return app;
}

async function connectSunsama(seed: Seed, bearerToken?: string): Promise<McpIntegrationOut> {
  const app = appFor(integrationsMcp, seed);
  const res = await app.request('/', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({
      url: 'https://mcp.sunsama.com/mcp',
      label: 'Sunsama',
      alias: 'sunsama',
      authMode: bearerToken ? 'bearer' : 'none',
      ...(bearerToken ? { bearerToken } : {}),
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as McpIntegrationOut;
}

describe('remote MCP integrations', () => {
  it('uses the MCP server metadata to preview a connector name', async () => {
    const seed = await seedOrg();
    const app = appFor(integrationsMcp, seed);
    const response = await app.request('/preview', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ url: 'https://mcp.sunsama.com/mcp' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Sunsama' });
  });

  it('creates OAuth servers pending user approval instead of falsely reporting a connection', async () => {
    const seed = await seedOrg();
    const app = appFor(integrationsMcp, seed);
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        url: 'https://api.sunsama.com/mcp',
        label: 'Sunsama',
        alias: 'sunsama',
        authMode: 'oauth',
      }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as McpIntegrationOut;
    expect(out).toMatchObject({ status: 'pending', authMode: 'oauth', toolCount: null });
  });

  it('connects with a live tools/list health check and reports the tool count', async () => {
    const seed = await seedOrg();
    const out = await connectSunsama(seed);
    expect(out.status).toBe('connected');
    expect(out.toolCount).toBe(2);
    expect(out.alias).toBe('sunsama');
    expect(out.lastError).toBeNull();
  });

  it('seals the bearer credential at rest (round-trips, never plaintext)', async () => {
    const seed = await seedOrg();
    const out = await connectSunsama(seed, 'super-secret-token');
    const creds = await db
      .select()
      .from(schema.integrationCredential)
      .where(eq(schema.integrationCredential.integrationId, out.id));
    expect(creds).toHaveLength(1);
    expect(creds[0]!.ciphertext).not.toContain('super-secret-token');
    expect(creds[0]!.ciphertext.startsWith('v1:gcm:')).toBe(true);
    expect(unsealCredential(creds[0]!.ciphertext)).toBe('super-secret-token');
  });

  it('keeps the original bearer-token request shape working for programmatic connectors', async () => {
    const seed = await seedOrg();
    const app = appFor(integrationsMcp, seed);
    const response = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        url: 'https://mcp.sunsama.com/mcp',
        label: 'Sunsama',
        alias: 'sunsama',
        bearerToken: 'legacy-org-token',
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as McpIntegrationOut).toMatchObject({
      authMode: 'bearer',
      status: 'connected',
    });
  });

  it('rejects a duplicate alias within the org', async () => {
    const seed = await seedOrg();
    await connectSunsama(seed);
    const app = appFor(integrationsMcp, seed);
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        url: 'https://mcp.sunsama.com/mcp',
        label: 'Sunsama again',
        alias: 'sunsama',
        authMode: 'none',
      }),
    });
    expect(res.status).toBe(409);
  });

  it('reports an unreachable server as error with the reason (never a false connected)', async () => {
    const seed = await seedOrg();
    const app = appFor(integrationsMcp, seed);
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        url: 'https://unknown.example.com/mcp',
        label: 'Ghost town',
        alias: 'ghost',
        authMode: 'none',
      }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as McpIntegrationOut;
    expect(out.status).toBe('error');
    expect(out.lastError).toMatch(/No MCP server reachable/);
  });

  it('re-verifies and disconnects (credential cascades)', async () => {
    const seed = await seedOrg();
    const out = await connectSunsama(seed, 'tok');
    const app = appFor(integrationsMcp, seed);

    const verified = await app.request(`/${out.id}/verify`, { method: 'POST', headers: J });
    expect(((await verified.json()) as McpIntegrationOut).status).toBe('connected');

    const deleted = await app.request(`/${out.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    const creds = await db
      .select()
      .from(schema.integrationCredential)
      .where(eq(schema.integrationCredential.integrationId, out.id));
    expect(creds).toHaveLength(0);
    const listed = await app.request('/', { method: 'GET' });
    expect((await listed.json()) as unknown[]).toHaveLength(0);
  });
});

describe('the union toolbox: remote read + local writes in one session', () => {
  it('reads the Sunsama backlog immediately (remote read tool) and lands approved creates', async () => {
    const seed = await seedOrg();
    await connectSunsama(seed, 'tok');

    // Turn 0: read the remote source (readOnlyHint → executes under Ask-first).
    // Turn 1: batch-create the three tasks it found. Turn 2: summary.
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_su_read',
              name: 'sunsama__get_backlog_tasks',
              input: {},
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: {
          role: 'assistant',
          content: integrations.SUNSAMA_BACKLOG.map((item, i) => ({
            type: 'tool_use' as const,
            id: `toolu_su_c${String(i)}`,
            name: 'create_task',
            input: { orgId: seed.orgId, teamId: seed.teamId, title: item.title },
          })),
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Imported 3 tasks.' }] },
        stopReason: 'end_turn',
      },
    ];
    const runtime = new agentRuntime.MockAgentTurnRuntime({ script });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
      runtime.streamTurn(input),
    );

    const sessions = new Hono<AppEnv>();
    sessions.use('*', async (c, next) => {
      const ctx: ActorCtx = {
        orgId: seed.orgId,
        actorId: seed.humanActorId,
        roleId: 'role_test',
        capabilities: ['view', 'contribute', 'assign'],
      };
      c.set('actorCtx', ctx);
      await next();
    });
    sessions.route('/', agentSessions);
    sessions.onError(onError);

    const created = await sessions.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        prompt: 'Import my Sunsama backlog',
        agentId: seed.agentId,
      }),
    });
    expect(created.status).toBe(200);
    const session = (await created.json()) as { id: string; status: string };
    // The remote read executed without pausing; the creates hold the gate.
    expect(session.status).toBe('awaiting_approval');

    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, session.id));
    const read = activities.find(
      (a) => a.type === 'action' && a.body.action?.toolCall?.connection === 'sunsama',
    );
    expect(read?.approvalStatus).toBe('applied');
    expect(read?.body.action?.toolCall?.tool).toBe('get_backlog_tasks');
    expect(read?.body.action?.result?.content).toContain('Book the venue for the offsite');

    const group = activities.find(
      (a) => a.approvalStatus === 'proposed' && a.proposalGroupId,
    )?.proposalGroupId;
    const approved = await sessions.request(`/${session.id}/proposals/${group}/approve`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({}),
    });
    expect(((await approved.json()) as { status: string }).status).toBe('completed');

    const tasks = await db
      .select({ title: schema.task.title })
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(tasks.map((t) => t.title).sort()).toEqual([
      'Book the venue for the offsite',
      'Reply to the partnership email',
      'Send the contractor agreement',
    ]);
  });
});
