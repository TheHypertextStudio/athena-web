import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Stub Better Auth: the internal principal path never touches it, but the auth module
// imports it at module scope.
const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';

import type { McpContext } from '../../src/mcp/auth';
import type { resolveActor as ResolveActor } from '../../src/mcp/auth';
import type {
  internalAgentContext as InternalAgentContext,
  AGENT_SESSION_SCOPES as AgentSessionScopes,
} from '../../src/mcp/internal-session';
import type { buildServer as BuildServer } from '../../src/mcp/server';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';
process.env['AGENT_MAX_TURNS'] = '8';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let internalAgentContext!: typeof InternalAgentContext;
let AGENT_SESSION_SCOPES!: typeof AgentSessionScopes;
let resolveActor!: typeof ResolveActor;
let buildServer!: typeof BuildServer;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ({ internalAgentContext, AGENT_SESSION_SCOPES } = await import('../../src/mcp/internal-session'));
  ({ resolveActor } = await import('../../src/mcp/auth'));
  ({ buildServer } = await import('../../src/mcp/server'));
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
});

interface Seed {
  orgId: string;
  teamId: string;
  humanActorId: string;
  /** The org's default (Athena) agent, materialized via ensureDefaultAgent. */
  agentId: string;
  agentActorId: string;
}

/** Seed an org with a human creator and the lazily-materialized default agent. */
async function seedOrg(): Promise<Seed> {
  const slug = `mi-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;

  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId: u!.id })
    .returning({ id: schema.actor.id });

  const [t] = await db
    .insert(schema.team)
    .values({ organizationId: orgId, name: 'Core', key: 'CORE' })
    .returning({ id: schema.team.id });

  const agent = await ensureDefaultAgent(orgId, human!.id);
  const [agentRow] = await db
    .select({ actorId: schema.agent.actorId })
    .from(schema.agent)
    .where(eq(schema.agent.id, agent.id))
    .limit(1);

  return {
    orgId,
    teamId: t!.id,
    humanActorId: human!.id,
    agentId: agent.id,
    agentActorId: agentRow!.actorId,
  };
}

const harnesses: { close(): Promise<void> }[] = [];

/** Connect an in-process MCP client to the identical buildServer used at /mcp. */
async function connect(ctx: McpContext): Promise<Client> {
  const server = buildServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'athena-loop-test', version: '0.0.0' });
  await client.connect(clientTransport);
  harnesses.push({ close: () => client.close() });
  return client;
}

describe('internalAgentContext', () => {
  it('resolves an agent principal carrying the fixed session scopes (no connectors:link)', async () => {
    const seed = await seedOrg();
    const ctx = await internalAgentContext(seed.orgId, seed.agentId);
    expect(ctx.principal.kind).toBe('agent');
    if (ctx.principal.kind === 'agent') {
      expect(ctx.principal.agentId).toBe(seed.agentId);
      expect(ctx.principal.agentActorId).toBe(seed.agentActorId);
      expect(ctx.principal.orgId).toBe(seed.orgId);
      expect(ctx.principal.displayName).toBe('Athena');
    }
    expect(ctx.scopes).toEqual(AGENT_SESSION_SCOPES);
    expect(ctx.scopes).not.toContain('connectors:link');
  });

  it('404s for an agent that belongs to a different org (existence-hiding)', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    await expect(internalAgentContext(a.orgId, b.agentId)).rejects.toThrow(/not found/i);
  });

  it('resolveActor returns the agent actor for its own org and 404s cross-org', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const ctx = await internalAgentContext(a.orgId, a.agentId);
    const resolved = await resolveActor(ctx, a.orgId);
    expect(resolved).toEqual({ orgId: a.orgId, actorId: a.agentActorId });
    await expect(resolveActor(ctx, b.orgId)).rejects.toThrow(/not found/i);
  });
});

describe('ensureDefaultAgent grant seeding', () => {
  it('seeds an org-wide view+contribute actor-grant for the default agent', async () => {
    const seed = await seedOrg();
    const rows = await db
      .select()
      .from(schema.grant)
      .where(
        and(
          eq(schema.grant.subjectKind, 'actor'),
          eq(schema.grant.subjectId, seed.agentActorId),
          eq(schema.grant.resourceKind, 'organization'),
          eq(schema.grant.resourceId, seed.orgId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capabilities).toEqual(['view', 'contribute']);
    expect(rows[0]?.effect).toBe('allow');
    expect(rows[0]?.cascades).toBe(true);
  });

  it('is idempotent: re-resolving does not duplicate the grant', async () => {
    const seed = await seedOrg();
    await ensureDefaultAgent(seed.orgId, seed.humanActorId);
    await ensureDefaultAgent(seed.orgId, seed.humanActorId);
    const rows = await db
      .select()
      .from(schema.grant)
      .where(
        and(eq(schema.grant.subjectKind, 'actor'), eq(schema.grant.subjectId, seed.agentActorId)),
      );
    expect(rows).toHaveLength(1);
  });
});

describe('in-process MCP as the agent principal', () => {
  it('create_task succeeds with the seeded grant and attributes the task to the agent actor', async () => {
    const seed = await seedOrg();
    const ctx = await internalAgentContext(seed.orgId, seed.agentId);
    const client = await connect(ctx);
    const res = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: seed.orgId, teamId: seed.teamId, title: 'Book the venue' },
    })) as CallToolResult;
    expect(res.isError ?? false).toBe(false);

    const created = await db
      .select({ id: schema.task.id, createdBy: schema.task.createdBy })
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(created).toHaveLength(1);
    expect(created[0]?.createdBy).toBe(seed.agentActorId);
  });

  it('is denied (existence-hiding) for an agent actor holding no grants', async () => {
    const seed = await seedOrg();
    // Register a second agent with NO grants (only the default agent gets seeded).
    const [bareActor] = await db
      .insert(schema.actor)
      .values({ organizationId: seed.orgId, kind: 'agent', displayName: 'Bare' })
      .returning({ id: schema.actor.id });
    const [bare] = await db
      .insert(schema.agent)
      .values({ organizationId: seed.orgId, actorId: bareActor!.id })
      .returning({ id: schema.agent.id });

    const ctx = await internalAgentContext(seed.orgId, bare!.id);
    const client = await connect(ctx);
    const res = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: seed.orgId, teamId: seed.teamId, title: 'Nope' },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });

  it('enforces the scope layer: connectors:link tools refuse the agent principal', async () => {
    const seed = await seedOrg();
    const ctx = await internalAgentContext(seed.orgId, seed.agentId);
    const client = await connect(ctx);
    const res = (await client.callTool({
      name: 'link_external',
      arguments: {
        orgId: seed.orgId,
        integrationId: '01HZ0000000000000000000000',
        teamId: seed.teamId,
        title: 'Linked item',
        externalId: 'octo/repo#1',
      },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    expect(text).toMatch(/insufficient_scope|scope/i);
  });
});
