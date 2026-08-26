import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';
import type * as AgentRuntimeModule from '@docket/athena/turn';
import type { resolveProductCapability as ResolveProductCapability } from '@docket/billing/application/entitlement';

import type { driveSession as DriveSession } from '../../src/agent/loop';
import type { assertProductCapability as Assert } from '../../src/product-capability';
import type { sharedWorkCapabilityGuard as SharedWorkGuard } from '../../src/product-capability';
import type { AppEnv } from '../../src/context';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';
import { assertDefined } from '@docket/test-utils';

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
let sharedWorkCapabilityGuard!: typeof SharedWorkGuard;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;
let resolveProductCapability!: typeof ResolveProductCapability;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  agentRuntime = await import('@docket/athena/turn');
  ({ resolveProductCapability } = await import('@docket/billing/application/entitlement'));
  ({ driveSession } = await import('../../src/agent/loop'));
  ({ assertProductCapability, sharedWorkCapabilityGuard } =
    await import('../../src/product-capability'));
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
    .values({
      organizationId: assertDefined(org).id,
      kind: 'human',
      displayName: 'Ada',
      userId: assertDefined(u).id,
    })
    .returning({ id: schema.actor.id });
  const agent = await ensureDefaultAgent(assertDefined(org).id, assertDefined(human).id);
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: assertDefined(org).id,
      agentId: agent.id,
      trigger: 'delegation',
      status: 'pending',
      initiatorId: assertDefined(human).id,
    })
    .returning({ id: schema.agentSession.id });
  await db.insert(schema.sessionActivity).values({
    sessionId: assertDefined(session).id,
    organizationId: assertDefined(org).id,
    type: 'response',
    body: { text: 'Plan my day.' },
  });
  return { orgId: assertDefined(org).id, sessionId: assertDefined(session).id };
}

const TEXT_ONLY: readonly AgentRuntimeModule.ScriptedTurn[] = [
  {
    message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    stopReason: 'end_turn',
  },
];

async function grantDocketPro(
  orgId: string,
  status: 'trialing' | 'active' | 'past_due' | 'canceled' = 'active',
  source: 'stripe' | 'complimentary' = 'stripe',
  graceEndsAt?: Date,
): Promise<void> {
  await db.insert(schema.organizationProductEntitlement).values({
    organizationId: orgId,
    productKey: 'docket_pro',
    status,
    source,
    graceEndsAt,
  });
}

describe('resolveProductCapability', () => {
  it('does not infer paid capability access from an organization lifecycle state', async () => {
    const active = await seedOrg('active');
    await expect(resolveProductCapability(db, active.orgId, 'athena')).resolves.toEqual({
      kind: 'product-required',
    });
  });

  it('returns a delivery-neutral outcome for an active product grant', async () => {
    const org = await seedOrg('export_window');
    await grantDocketPro(org.orgId, 'active', 'complimentary');
    await expect(resolveProductCapability(db, org.orgId, 'athena')).resolves.toEqual({
      kind: 'entitled',
      productKey: 'docket_pro',
      source: 'complimentary',
    });
    await expect(resolveProductCapability(db, 'org_does_not_exist', 'athena')).resolves.toEqual({
      kind: 'organization-not-found',
    });
  });
});

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

  it('reports an expired payment grace period separately from a workspace that never had Pro', async () => {
    const org = await seedOrg('active');
    await grantDocketPro(org.orgId, 'past_due', 'stripe', new Date(Date.now() - 60_000));

    await expect(assertProductCapability(org.orgId, 'athena')).rejects.toMatchObject({
      status: 402,
      code: 'billing_grace_expired',
    });
  });
});

describe('sharedWorkCapabilityGuard', () => {
  function guardedApp(orgId: string, isPersonal: boolean): Hono<AppEnv> {
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('actorCtx', {
          orgId,
          actorId: 'actor_test',
          roleId: null,
          capabilities: [],
          isPersonal,
        });
        await next();
      })
      .use('*', sharedWorkCapabilityGuard)
      .get('/', (c) => c.json({ ok: true }))
      .post('/', (c) => c.json({ ok: true }));
    app.onError((error, c) => {
      const productError = error as { status?: number; code?: string };
      return c.json(
        { code: productError.code ?? 'internal_error' },
        productError.status === 402 ? 402 : 500,
      );
    });
    return app;
  }

  it('keeps baseline work available in a personal workspace without a product record', async () => {
    const org = await seedOrg('active');
    const response = await guardedApp(org.orgId, true).request('/');
    expect(response.status).toBe(200);
  });

  it('keeps shared work readable but requires Docket Pro for writes', async () => {
    const org = await seedOrg('active');
    const app = guardedApp(org.orgId, false);
    expect((await app.request('/')).status).toBe(200);
    const write = await app.request('/', { method: 'POST' });
    expect(write.status).toBe(402);
    await expect(write.json()).resolves.toMatchObject({ code: 'product_required' });
  });

  it('allows shared organization work with active Docket Pro', async () => {
    const org = await seedOrg('active');
    await grantDocketPro(org.orgId);
    const response = await guardedApp(org.orgId, false).request('/');
    expect(response.status).toBe(200);
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
