/**
 * `@docket/api` — targeted coverage for `src/agent/run-generation.ts` admission/lease branches
 * the primary `async-generation.test.ts` suite does not reach: rejecting an unrunnable status,
 * rejecting a still-fresh running generation, the owner concurrency ceiling from
 * `enqueueRunGeneration` itself, a `resumeSession: false` enqueue whose parent session status has
 * already moved on by the time a delayed Workflow claim arrives, the `resumeSession: false`
 * default runnable-status set, and the standalone lease-fencing primitives
 * (`renewRunGeneration`, `assertRunGeneration`, `checkpointRunGeneration`, `settleRunGeneration`,
 * the heartbeat's own failure surfacing).
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { agentSession, agentSessionRun, user } from '@docket/db';

import type {
  assertRunGeneration as AssertRunGeneration,
  checkpointRunGeneration as CheckpointRunGeneration,
  claimQueuedRunGeneration as ClaimQueuedRunGeneration,
  claimRunGeneration as ClaimRunGeneration,
  enqueueRunGeneration as EnqueueRunGeneration,
  renewRunGeneration as RenewRunGeneration,
  RunGenerationLease,
  settleRunGeneration as SettleRunGeneration,
  startRunGenerationHeartbeat as StartRunGenerationHeartbeat,
} from '../../src/agent/run-generation';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let dbModule: Awaited<ReturnType<typeof getMigratedDb>>;
let enqueueRunGeneration: typeof EnqueueRunGeneration;
let claimQueuedRunGeneration: typeof ClaimQueuedRunGeneration;
let claimRunGeneration: typeof ClaimRunGeneration;
let renewRunGeneration: typeof RenewRunGeneration;
let assertRunGeneration: typeof AssertRunGeneration;
let checkpointRunGeneration: typeof CheckpointRunGeneration;
let settleRunGeneration: typeof SettleRunGeneration;
let startRunGenerationHeartbeat: typeof StartRunGenerationHeartbeat;

beforeAll(async () => {
  dbModule = await getMigratedDb();
  ({
    enqueueRunGeneration,
    claimQueuedRunGeneration,
    claimRunGeneration,
    renewRunGeneration,
    assertRunGeneration,
    checkpointRunGeneration,
    settleRunGeneration,
    startRunGenerationHeartbeat,
  } = await import('../../src/agent/run-generation'));
});

/** Seed a pending Athena session (its own owner, so concurrency-ceiling tests stay isolated). */
async function seedPendingAthena(): Promise<{ ownerUserId: string; sessionId: string }> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [owner] = await dbModule.db
    .insert(user)
    .values({ name: 'Gen Owner', email: `gen-${suffix}@example.com` })
    .returning({ id: user.id });
  const [session] = await dbModule.db
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: assertDefined(owner).id,
      trigger: 'delegation',
      status: 'pending',
    })
    .returning({ id: agentSession.id });
  return { ownerUserId: assertDefined(owner).id, sessionId: assertDefined(session).id };
}

/** Seed an org + registered-agent session so tests can exercise the non-Athena executor shape. */
async function seedRegisteredAgentSession(): Promise<{
  sessionId: string;
  organizationId: string;
  agentId: string;
}> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const dbmod = await import('@docket/db');
  const [org] = await dbModule.db
    .insert(dbmod.organization)
    .values({ name: suffix, slug: suffix, lifecycleState: 'active' })
    .returning({ id: dbmod.organization.id });
  const [u] = await dbModule.db
    .insert(user)
    .values({ name: 'Owner', email: `ra-${suffix}@example.com` })
    .returning({ id: user.id });
  await dbModule.db.insert(dbmod.hub).values({ userId: assertDefined(u).id });
  const [actor] = await dbModule.db
    .insert(dbmod.actor)
    .values({
      organizationId: assertDefined(org).id,
      kind: 'human',
      displayName: 'Owner',
      userId: assertDefined(u).id,
    })
    .returning({ id: dbmod.actor.id });
  const ensured = await (
    await import('../../src/lib/default-agent')
  ).ensureDefaultAgent(assertDefined(org).id, assertDefined(actor).id);
  const [session] = await dbModule.db
    .insert(agentSession)
    .values({
      organizationId: assertDefined(org).id,
      agentId: ensured.id,
      trigger: 'delegation',
      status: 'pending',
    })
    .returning({ id: agentSession.id });
  return {
    sessionId: assertDefined(session).id,
    organizationId: assertDefined(org).id,
    agentId: ensured.id,
  };
}

async function loadSession(sessionId: string): Promise<typeof agentSession.$inferSelect> {
  const [row] = await dbModule.db.select().from(agentSession).where(eq(agentSession.id, sessionId));
  return assertDefined(row);
}

async function loadRun(sessionId: string): Promise<typeof agentSessionRun.$inferSelect> {
  const [row] = await dbModule.db
    .select()
    .from(agentSessionRun)
    .where(eq(agentSessionRun.sessionId, sessionId));
  return assertDefined(row);
}

describe('enqueueRunGeneration admission checks', () => {
  it('refuses to enqueue a session outside the runnable set', async () => {
    const seed = await seedPendingAthena();
    await dbModule.db
      .update(agentSession)
      .set({ status: 'completed' })
      .where(eq(agentSession.id, seed.sessionId));
    const session = await loadSession(seed.sessionId);

    await expect(enqueueRunGeneration(session)).rejects.toThrow(
      'Session is not in a runnable state',
    );
  });

  it('refuses to enqueue while a fresh (unexpired) generation is already running', async () => {
    const seed = await seedPendingAthena();
    const session = await loadSession(seed.sessionId);
    await claimRunGeneration(session, { leaseDurationMs: 60_000 });

    const running = await loadSession(seed.sessionId);
    await expect(enqueueRunGeneration(running)).rejects.toThrow(
      'Session generation is already running',
    );
  });

  it('enforces the owner concurrency ceiling directly from enqueueRunGeneration', async () => {
    const seed = await seedPendingAthena();
    const session = await loadSession(seed.sessionId);
    const competing = await dbModule.db
      .insert(agentSession)
      .values(
        Array.from({ length: 8 }, () => ({
          executorKind: 'athena' as const,
          ownerUserId: seed.ownerUserId,
          trigger: 'delegation' as const,
          status: 'running' as const,
        })),
      )
      .returning({ id: agentSession.id });
    await dbModule.db.insert(agentSessionRun).values(
      competing.map(({ id }) => ({
        sessionId: id,
        ownerUserId: seed.ownerUserId,
        generation: 1,
        workflowInstanceId: `${id}:1`,
        status: 'running' as const,
        attempt: 1,
        leaseToken: `slot-${id}`,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })),
    );

    await expect(enqueueRunGeneration(session)).rejects.toThrow(/concurrent run limit/i);
  });

  it('enqueues a registered-agent generation with workspace (not owner) attribution', async () => {
    const seed = await seedRegisteredAgentSession();
    const session = await loadSession(seed.sessionId);

    const queued = await enqueueRunGeneration(session);

    const run = await loadRun(seed.sessionId);
    expect(run).toMatchObject({
      organizationId: seed.organizationId,
      ownerUserId: null,
      status: 'queued',
    });
    expect(queued.message.generation).toBe(1);
  });

  it('leaves a paused parent session alone when resumeSession is false', async () => {
    const seed = await seedPendingAthena();
    await dbModule.db
      .update(agentSession)
      .set({ status: 'awaiting_approval' })
      .where(eq(agentSession.id, seed.sessionId));
    const parked = await loadSession(seed.sessionId);

    await enqueueRunGeneration(parked, {
      resumeSession: false,
      runnableStatuses: ['awaiting_approval'],
    });

    const afterEnqueue = await loadSession(seed.sessionId);
    expect(afterEnqueue.status).toBe('awaiting_approval');
    const run = await loadRun(seed.sessionId);
    expect(run.status).toBe('queued');
  });

  it('clears a stale endedAt when clearEndedAt admits a previously-ended session', async () => {
    const seed = await seedPendingAthena();
    await dbModule.db
      .update(agentSession)
      .set({ status: 'failed', endedAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(agentSession.id, seed.sessionId));
    const ended = await loadSession(seed.sessionId);
    expect(ended.endedAt).toBeTruthy();

    await enqueueRunGeneration(ended, { runnableStatuses: ['failed'], clearEndedAt: true });

    const reopened = await loadSession(seed.sessionId);
    expect(reopened.status).toBe('running');
    expect(reopened.endedAt).toBeNull();
  });
});

describe('claimQueuedRunGeneration observing a parent that settled before the claim arrived', () => {
  it.each([
    ['awaiting_input', 'waiting'],
    ['awaiting_approval', 'waiting'],
    ['failed', 'failed'],
    ['completed', 'completed'],
    ['canceled', 'canceled'],
  ] as const)(
    'marks a still-queued run %s when the parent session is already %s',
    async (parentStatus, expectedRunStatus) => {
      const seed = await seedPendingAthena();
      await dbModule.db
        .update(agentSession)
        .set({ status: parentStatus })
        .where(eq(agentSession.id, seed.sessionId));
      const parked = await loadSession(seed.sessionId);
      const queued = await enqueueRunGeneration(parked, {
        resumeSession: false,
        runnableStatuses: [parentStatus],
      });

      await expect(claimQueuedRunGeneration(queued.message)).rejects.toThrow(
        'Queued session generation follows the parent lifecycle state',
      );

      const run = await loadRun(seed.sessionId);
      expect(run).toMatchObject({
        status: expectedRunStatus,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      expect(run.completedAt).toBeTruthy();
    },
  );

  it('claims normally when the parent session is merely pending (not yet running)', async () => {
    const seed = await seedPendingAthena();
    const session = await loadSession(seed.sessionId);
    const queued = await enqueueRunGeneration(session, {
      resumeSession: false,
      runnableStatuses: ['pending'],
    });

    const claimed = await claimQueuedRunGeneration(queued.message);

    expect(claimed.session.id).toBe(seed.sessionId);
    const run = await loadRun(seed.sessionId);
    expect(run.status).toBe('running');
  });
});

describe('claimRunGeneration admission checks', () => {
  it('defaults to including awaiting_approval in the runnable set when resumeSession is false', async () => {
    const seed = await seedPendingAthena();
    await dbModule.db
      .update(agentSession)
      .set({ status: 'awaiting_approval' })
      .where(eq(agentSession.id, seed.sessionId));
    const parked = await loadSession(seed.sessionId);

    const lease = await claimRunGeneration(parked, { resumeSession: false });

    expect(lease.sessionId).toBe(seed.sessionId);
    const afterClaim = await loadSession(seed.sessionId);
    // resumeSession: false never flips the parent session back to running.
    expect(afterClaim.status).toBe('awaiting_approval');
  });

  it('refuses a session outside the runnable set', async () => {
    const seed = await seedPendingAthena();
    await dbModule.db
      .update(agentSession)
      .set({ status: 'canceled' })
      .where(eq(agentSession.id, seed.sessionId));
    const session = await loadSession(seed.sessionId);

    await expect(claimRunGeneration(session)).rejects.toThrow('Session is not in a runnable state');
  });

  it('clears a stale endedAt when clearEndedAt admits a previously-ended session', async () => {
    const seed = await seedPendingAthena();
    await dbModule.db
      .update(agentSession)
      .set({ status: 'failed', endedAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(agentSession.id, seed.sessionId));
    const ended = await loadSession(seed.sessionId);
    expect(ended.endedAt).toBeTruthy();

    await claimRunGeneration(ended, { runnableStatuses: ['failed'], clearEndedAt: true });

    const reopened = await loadSession(seed.sessionId);
    expect(reopened.status).toBe('running');
    expect(reopened.endedAt).toBeNull();
  });
});

describe('standalone lease-fencing primitives', () => {
  const staleLease: RunGenerationLease = {
    runId: 'run_missing',
    sessionId: 'session_missing',
    generation: 1,
    leaseToken: 'not-the-current-token',
    leaseDurationMs: 60_000,
  };

  it('renewRunGeneration refuses a lease it no longer owns', async () => {
    await expect(renewRunGeneration(staleLease)).rejects.toThrow(
      'Session generation lease was lost',
    );
  });

  it('assertRunGeneration refuses a lease it no longer owns', async () => {
    await expect(assertRunGeneration(staleLease)).rejects.toThrow(
      'Session generation lease was lost',
    );
  });

  it('checkpointRunGeneration refuses a lease it no longer owns', async () => {
    await expect(checkpointRunGeneration(staleLease)).rejects.toThrow(
      'Session generation lease was lost',
    );
  });

  it('settleRunGeneration refuses a session id that does not exist', async () => {
    await expect(settleRunGeneration(staleLease, 'completed')).rejects.toThrow('Session not found');
  });

  it.each(['completed', 'failed', 'canceled', 'awaiting_input', 'awaiting_approval'] as const)(
    'settleRunGeneration maps sessionStatus %s to the matching run + session state',
    async (sessionStatus) => {
      const seed = await seedPendingAthena();
      const session = await loadSession(seed.sessionId);
      const lease = await claimRunGeneration(session, { leaseDurationMs: 60_000 });

      const settled = await settleRunGeneration(lease, sessionStatus, 'optional detail');

      expect(settled.status).toBe(sessionStatus);
      const run = await loadRun(seed.sessionId);
      const expectedRunStatus =
        sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'canceled'
          ? sessionStatus
          : 'waiting';
      expect(run.status).toBe(expectedRunStatus);
    },
  );

  it('the heartbeat surfaces a renewal failure to the next assertActive call', async () => {
    const seed = await seedPendingAthena();
    const session = await loadSession(seed.sessionId);
    const lease = await claimRunGeneration(session, { leaseDurationMs: 60_000 });
    // Simulate another worker taking the lease over: the heartbeat's next renewal attempt will
    // fail its token-fenced conditional update.
    await dbModule.db
      .update(agentSessionRun)
      .set({ leaseToken: 'stolen-by-another-worker' })
      .where(eq(agentSessionRun.id, lease.runId));

    const heartbeat = startRunGenerationHeartbeat(lease, 5);
    try {
      await new Promise((r) => setTimeout(r, 40));
      await expect(heartbeat.assertActive()).rejects.toThrow('Session generation lease was lost');
    } finally {
      heartbeat.stop();
    }
  });
});
