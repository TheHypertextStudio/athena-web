import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';
import type * as AgentRuntimeModule from '@docket/agent-runtime';

import type { driveSession as DriveSession } from '../../src/agent/loop';
import type { assertProductCapability as Assert } from '../../src/billing/entitlement';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';
process.env['AGENT_MAX_TURNS'] = '6';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let agentRuntime!: typeof AgentRuntimeModule;
let driveSession!: typeof DriveSession;
let assertProductCapability!: typeof Assert;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  agentRuntime = await import('@docket/agent-runtime');
  ({ driveSession } = await import('../../src/agent/loop'));
  ({ assertProductCapability } = await import('../../src/billing/entitlement'));
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
});

async function seedOrg(
  lifecycleState: 'trialing' | 'active' | 'past_due' | 'export_window' = 'active',
): Promise<{ orgId: string; sessionId: string }> {
  const slug = `en-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState })
    .returning({ id: schema.organization.id });
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: org!.id, kind: 'human', displayName: 'Ada', userId: u!.id })
    .returning({ id: schema.actor.id });
  const agent = await ensureDefaultAgent(org!.id, human!.id);
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: org!.id,
      agentId: agent.id,
      trigger: 'delegation',
      status: 'pending',
      initiatorId: human!.id,
    })
    .returning({ id: schema.agentSession.id });
  await db.insert(schema.sessionActivity).values({
    sessionId: session!.id,
    organizationId: org!.id,
    type: 'response',
    body: { text: 'Plan my day.' },
  });
  return { orgId: org!.id, sessionId: session!.id };
}

async function grantDocketPro(
  orgId: string,
  status: 'trialing' | 'active' | 'past_due' | 'canceled' = 'active',
  source: 'stripe' | 'complimentary' = 'stripe',
): Promise<void> {
  await db.insert(schema.organizationProductEntitlement).values({
    organizationId: orgId,
    productKey: 'docket_pro',
    status,
    source,
  });
}

const TEXT_ONLY: readonly AgentRuntimeModule.ScriptedTurn[] = [
  {
    message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    stopReason: 'end_turn',
  },
];

describe('assertProductCapability', () => {
  it.each(['shared_work', 'integrations', 'mcp', 'athena', 'voice'] as const)(
    'requires an active product that grants %s',
    async (capability) => {
      const org = await seedOrg('active');
      await expect(assertProductCapability(org.orgId, capability)).rejects.toMatchObject({
        status: 402,
        code: 'product_required',
      });

      await grantDocketPro(org.orgId);
      await expect(assertProductCapability(org.orgId, capability)).resolves.toBeUndefined();
    },
  );

  it.each(['trialing', 'active'] as const)('accepts a %s Docket Pro grant', async (status) => {
    const org = await seedOrg('export_window');
    await grantDocketPro(org.orgId, status);
    await expect(assertProductCapability(org.orgId, 'athena')).resolves.toBeUndefined();
  });

  it.each(['past_due', 'canceled'] as const)('refuses a %s Docket Pro grant', async (status) => {
    const org = await seedOrg('active');
    await grantDocketPro(org.orgId, status);
    await expect(assertProductCapability(org.orgId, 'athena')).rejects.toMatchObject({
      status: 402,
      code: 'product_required',
    });
  });

  it('accepts a complimentary Docket Pro grant', async () => {
    const org = await seedOrg('past_due');
    await grantDocketPro(org.orgId, 'active', 'complimentary');
    await expect(assertProductCapability(org.orgId, 'athena')).resolves.toBeUndefined();
  });
});

describe('the gate at driveSession first run', () => {
  it('refuses to start a session for an unentitled org', async () => {
    const seed = await seedOrg('past_due');
    await expect(
      driveSession(seed.orgId, seed.sessionId, {
        turnRuntime: new agentRuntime.MockAgentTurnRuntime({ script: TEXT_ONLY }),
      }),
    ).rejects.toMatchObject({ status: 402, code: 'product_required' });
  });

  it('does not re-gate a resume: a started session finishes despite a lapse', async () => {
    const seed = await seedOrg('active');
    await grantDocketPro(seed.orgId);
    // Mark the session as already started (a resume, not a first run), then lapse the plan.
    await db
      .update(schema.agentSession)
      .set({ startedAt: new Date() })
      .where(eq(schema.agentSession.id, seed.sessionId));
    await db
      .update(schema.organization)
      .set({ lifecycleState: 'past_due' })
      .where(eq(schema.organization.id, seed.orgId));

    const settled = await driveSession(seed.orgId, seed.sessionId, {
      turnRuntime: new agentRuntime.MockAgentTurnRuntime({ script: TEXT_ONLY }),
    });
    expect(settled.status).toBe('completed');
  });
});
