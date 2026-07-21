import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';
import type * as ContainerModule from '../../src/container';
import type { relayLinearAgentActivity as RelayLinearAgentActivity } from '../../src/lib/linear-agent-relay';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';
import type { sealCredential as SealCredential } from '../../src/lib/credentials';

const { buildLinearAgentClient } = vi.hoisted(() => ({
  buildLinearAgentClient: vi.fn(),
}));

vi.mock('../../src/container', async (importOriginal) => ({
  ...(await importOriginal<typeof ContainerModule>()),
  buildLinearAgentClient,
}));

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
let relayLinearAgentActivity!: typeof RelayLinearAgentActivity;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;
let sealCredential!: typeof SealCredential;
let MockLinearAgent!: typeof IntegrationsModule.MockLinearAgent;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ({ relayLinearAgentActivity } = await import('../../src/lib/linear-agent-relay'));
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
  ({ sealCredential } = await import('../../src/lib/credentials'));
  ({ MockLinearAgent } = await import('@docket/integrations'));
});

afterEach(() => {
  buildLinearAgentClient.mockReset();
});

interface SeededLinearSession {
  readonly orgId: string;
  readonly sessionId: string;
  readonly humanActorId: string;
}

/** Seed an org + agent + session + a connected `linear_agent` integration + external link. */
async function seedLinearSession(): Promise<SeededLinearSession> {
  const slug = `lar-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: u!.id });
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId: u!.id })
    .returning({ id: schema.actor.id });
  const humanActorId = human!.id;
  const agent = await ensureDefaultAgent(orgId, humanActorId);

  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: orgId,
      agentId: agent.id,
      trigger: 'mention',
      status: 'running',
      initiatorId: humanActorId,
    })
    .returning({ id: schema.agentSession.id });
  const sessionId = session!.id;

  const [intg] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'linear_agent',
      pattern: 'agent',
      roles: [],
      connection: { externalWorkspaceId: `ws_${slug}` },
      status: 'connected',
      createdBy: humanActorId,
    })
    .returning({ id: schema.integration.id });
  await db.insert(schema.integrationCredential).values({
    organizationId: orgId,
    integrationId: intg!.id,
    ciphertext: sealCredential(JSON.stringify({ accessToken: 'tok' })),
  });
  await db.insert(schema.agentSessionExternalLink).values({
    sessionId,
    organizationId: orgId,
    provider: 'linear',
    externalSessionId: `las_${slug}`,
    externalWorkspaceId: `ws_${slug}`,
  });

  return { orgId, sessionId, humanActorId };
}

/** Insert one `session_activity` row at an explicit `createdAt`/`updatedAt` (deterministic order). */
async function seedActivity(
  seeded: SeededLinearSession,
  at: Date,
  overrides: Partial<typeof schema.sessionActivity.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.sessionActivity)
    .values({
      sessionId: seeded.sessionId,
      organizationId: seeded.orgId,
      type: 'response',
      body: { text: 'hello' },
      createdAt: at,
      updatedAt: at,
      ...overrides,
    })
    .returning({ id: schema.sessionActivity.id });
  return row!.id;
}

/** Read back the external link row (for watermark assertions). */
async function externalLink(sessionId: string) {
  const [row] = await db
    .select()
    .from(schema.agentSessionExternalLink)
    .where(eq(schema.agentSessionExternalLink.sessionId, sessionId));
  return row!;
}

const T0 = new Date('2026-07-01T12:00:00.000Z');
function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

describe('relayLinearAgentActivity', () => {
  it('is a no-op for a session with no external link (not Linear-originated)', async () => {
    const port = new MockLinearAgent();
    buildLinearAgentClient.mockReturnValue(port);
    const [org] = await db
      .insert(schema.organization)
      .values({ name: 'plain', slug: `plain-${Math.random().toString(36).slice(2, 8)}` })
      .returning({ id: schema.organization.id });
    const [human] = await db
      .insert(schema.actor)
      .values({ organizationId: org!.id, kind: 'human', displayName: 'Ada' })
      .returning({ id: schema.actor.id });
    const agent = await ensureDefaultAgent(org!.id, human!.id);
    const [session] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: org!.id,
        agentId: agent.id,
        trigger: 'delegation',
        status: 'running',
      })
      .returning({ id: schema.agentSession.id });

    await relayLinearAgentActivity(org!.id, session!.id);
    expect(port.activityLog).toHaveLength(0);
  });

  it('skips a response row authored by the human reply mirror ("author: user")', async () => {
    const seeded = await seedLinearSession();
    const port = new MockLinearAgent();
    buildLinearAgentClient.mockReturnValue(port);
    await seedActivity(seeded, at(0), { type: 'response', body: { text: 'hi', author: 'user' } });

    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);

    expect(port.activityLog).toHaveLength(0);
    // Still "seen": the watermark advances past it so it is never retried forever.
    const link = await externalLink(seeded.sessionId);
    expect(link.lastRelayedActivityId).not.toBeNull();
    expect(link.lastRelayedActivityUpdatedAt).toEqual(at(0));
  });

  it('relays an agent-authored response row, marking it durable (no ephemeral flag)', async () => {
    const seeded = await seedLinearSession();
    const port = new MockLinearAgent();
    buildLinearAgentClient.mockReturnValue(port);
    await seedActivity(seeded, at(0), {
      type: 'response',
      body: { text: 'Here is your summary.' },
    });

    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);

    expect(port.activityLog).toHaveLength(1);
    // A durable row's `ephemeral` key is omitted entirely (not sent as `false`) — assert the
    // exact key set with `toEqual` so a stray `ephemeral` slipping in would fail this test.
    expect(port.activityLog[0]).toEqual({
      id: expect.any(String),
      agentSessionId: expect.any(String),
      type: 'response',
      body: 'Here is your summary.',
    });
  });

  it('gates a still-`proposed` action row (never relayed while gated), and relays it once it leaves `proposed`', async () => {
    const seeded = await seedLinearSession();
    const port = new MockLinearAgent();
    buildLinearAgentClient.mockReturnValue(port);
    const activityId = await seedActivity(seeded, at(0), {
      type: 'action',
      approvalStatus: 'proposed',
      body: { action: { kind: 'update_task', summary: 'Mark "Ship it" done' } },
    });

    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);
    expect(port.activityLog).toHaveLength(0);
    // The gated row is still advanced past (see module remarks) — not retried every tick.
    const afterGate = await externalLink(seeded.sessionId);
    expect(afterGate.lastRelayedActivityId).toBe(activityId);
    expect(afterGate.lastRelayedActivityUpdatedAt).toEqual(at(0));

    // The action is approved and applied: `executeApprovedActions` updates the SAME row in
    // place (not an insert) — this is the case `updatedAt` exists to catch.
    await db
      .update(schema.sessionActivity)
      .set({
        approvalStatus: 'applied',
        body: {
          action: {
            kind: 'update_task',
            summary: 'Mark "Ship it" done',
            result: { content: 'Marked done.', isError: false },
          },
        },
        updatedAt: at(1000),
      })
      .where(eq(schema.sessionActivity.id, activityId));

    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);

    expect(port.activityLog).toHaveLength(1);
    expect(port.activityLog[0]).toMatchObject({
      type: 'action',
      body: '**Mark "Ship it" done**\n\nMarked done.',
      ephemeral: true,
    });
    const afterApply = await externalLink(seeded.sessionId);
    expect(afterApply.lastRelayedActivityId).toBe(activityId);
    expect(afterApply.lastRelayedActivityUpdatedAt).toEqual(at(1000));
  });

  it('relays a rejected action row with a rejection note', async () => {
    const seeded = await seedLinearSession();
    const port = new MockLinearAgent();
    buildLinearAgentClient.mockReturnValue(port);
    await seedActivity(seeded, at(0), {
      type: 'action',
      approvalStatus: 'rejected',
      body: { action: { kind: 'delete_task', summary: 'Delete "Old draft"' } },
    });

    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);

    expect(port.activityLog).toHaveLength(1);
    expect(port.activityLog[0]?.body).toContain('Rejected by the approver');
  });

  it('advances the watermark past skipped rows so a re-run does not re-check them', async () => {
    const seeded = await seedLinearSession();
    const port = new MockLinearAgent();
    buildLinearAgentClient.mockReturnValue(port);
    await seedActivity(seeded, at(0), { type: 'response', body: { text: 'hi', author: 'user' } });
    await seedActivity(seeded, at(1000), { type: 'response', body: { text: 'Reply.' } });

    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);
    expect(port.activityLog).toHaveLength(1); // only the agent-authored one
    expect(port.activityLog[0]?.body).toBe('Reply.');

    // A second pass with nothing new must not re-post anything.
    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);
    expect(port.activityLog).toHaveLength(1);
  });

  it('stops at the first failure within a pass, keeps already-succeeded relays, and retries from exactly that point next tick', async () => {
    const seeded = await seedLinearSession();
    const port = new MockLinearAgent();
    buildLinearAgentClient.mockReturnValue(port);
    await seedActivity(seeded, at(0), { type: 'response', body: { text: 'First.' } });
    await seedActivity(seeded, at(1000), { type: 'response', body: { text: 'Second.' } });
    await seedActivity(seeded, at(2000), { type: 'response', body: { text: 'Third.' } });

    const original = port.agentActivityCreate.bind(port);
    const spy = vi.spyOn(port, 'agentActivityCreate');
    spy.mockImplementationOnce((input) => original(input)); // "First." succeeds
    spy.mockRejectedValueOnce(new Error('linear unavailable')); // "Second." fails

    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);

    // Only "First." made it; "Second."/"Third." were never attempted this pass.
    expect(port.activityLog.map((a) => a.body)).toEqual(['First.']);
    const midway = await externalLink(seeded.sessionId);
    expect(midway.lastRelayedActivityUpdatedAt).toEqual(at(0));

    // Next sweep tick: the transient failure has cleared (spy falls back to calling through).
    await relayLinearAgentActivity(seeded.orgId, seeded.sessionId);

    expect(port.activityLog.map((a) => a.body)).toEqual(['First.', 'Second.', 'Third.']);
    const final = await externalLink(seeded.sessionId);
    expect(final.lastRelayedActivityUpdatedAt).toEqual(at(2000));
  });
});
