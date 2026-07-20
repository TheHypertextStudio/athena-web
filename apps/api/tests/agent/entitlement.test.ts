import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { billingExemption } from '@docket/db';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';
import type * as AgentRuntimeModule from '@docket/agent-runtime';

import type { driveSession as DriveSession } from '../../src/agent/loop';
import type { assertAgentSessionsEntitled as Assert } from '../../src/billing/entitlement';
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
let assertAgentSessionsEntitled!: typeof Assert;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  agentRuntime = await import('@docket/agent-runtime');
  ({ driveSession } = await import('../../src/agent/loop'));
  ({ assertAgentSessionsEntitled } = await import('../../src/billing/entitlement'));
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
});

async function seedOrg(
  lifecycleState: 'trialing' | 'active' | 'past_due' | 'export_window',
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

const TEXT_ONLY: readonly AgentRuntimeModule.ScriptedTurn[] = [
  {
    message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    stopReason: 'end_turn',
  },
];

describe('assertAgentSessionsEntitled', () => {
  it('allows trialing and active; refuses everything else with the typed 402', async () => {
    const trialing = await seedOrg('trialing');
    await expect(assertAgentSessionsEntitled(trialing.orgId)).resolves.toBeUndefined();

    const active = await seedOrg('active');
    await expect(assertAgentSessionsEntitled(active.orgId)).resolves.toBeUndefined();

    const lapsed = await seedOrg('export_window');
    await expect(assertAgentSessionsEntitled(lapsed.orgId)).rejects.toMatchObject({
      status: 402,
      code: 'agent_plan_required',
    });
  });

  it('an active exemption entitles a non-entitled org; revoking it removes entitlement', async () => {
    const lapsed = await seedOrg('export_window');
    await expect(assertAgentSessionsEntitled(lapsed.orgId)).rejects.toMatchObject({
      status: 402,
      code: 'agent_plan_required',
    });

    const [grant] = await db
      .insert(billingExemption)
      .values({ organizationId: lapsed.orgId, reason: 'internal free use' })
      .returning({ id: billingExemption.id });
    await expect(assertAgentSessionsEntitled(lapsed.orgId)).resolves.toBeUndefined();

    await db
      .update(billingExemption)
      .set({ revokedAt: new Date() })
      .where(eq(billingExemption.id, grant!.id));
    await expect(assertAgentSessionsEntitled(lapsed.orgId)).rejects.toMatchObject({
      status: 402,
      code: 'agent_plan_required',
    });
  });
});

describe('the gate at driveSession first run', () => {
  it('refuses to start a session for an unentitled org', async () => {
    const seed = await seedOrg('past_due');
    await expect(
      driveSession(seed.orgId, seed.sessionId, {
        turnRuntime: new agentRuntime.MockAgentTurnRuntime({ script: TEXT_ONLY }),
      }),
    ).rejects.toMatchObject({ status: 402, code: 'agent_plan_required' });
  });

  it('does not re-gate a resume: a started session finishes despite a lapse', async () => {
    const seed = await seedOrg('active');
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
