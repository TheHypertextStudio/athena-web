import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { agentSession, agentSessionRun, sessionActivity, user } from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { advanceCloudflareGeneration } from '../../src/agent/execution-advance';
import { admitAthenaGeneration } from '../../src/agent/async-runner';
import {
  claimQueuedRunGeneration,
  enqueueRunGeneration,
  settleRunGeneration,
  type RunGenerationLease,
  withRunGenerationFence,
} from '../../src/agent/run-generation';
import { transitionLifecycle } from '../../src/routes/agent-session-helpers';
import { getMigratedDb } from '../support/db';

let dbModule: Awaited<ReturnType<typeof getMigratedDb>>;

const runGenerationSource = readFileSync(
  resolve(import.meta.dirname, '../../src/agent/run-generation.ts'),
  'utf8',
);

beforeAll(async () => {
  dbModule = await getMigratedDb();
});

async function seedPendingAthena(): Promise<{ ownerUserId: string; sessionId: string }> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [owner] = await dbModule.db
    .insert(user)
    .values({ name: 'Queue Owner', email: `queue-${suffix}@example.com` })
    .returning({ id: user.id });
  const [session] = await dbModule.db
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: owner!.id,
      trigger: 'delegation',
      status: 'pending',
    })
    .returning({ id: agentSession.id });
  return { ownerUserId: owner!.id, sessionId: session!.id };
}

describe('queued Athena generations', () => {
  it('persists the deterministic queued generation before a worker can claim it', async () => {
    const seed = await seedPendingAthena();
    const [session] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));

    const first = await enqueueRunGeneration(session!);
    const duplicateAdmission = await enqueueRunGeneration(session!);

    expect(first.message).toEqual({
      sessionId: seed.sessionId,
      generation: 1,
      workflowId: `${seed.sessionId}:1`,
    });
    expect(duplicateAdmission).toEqual(first);
    const [queued] = await dbModule.db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, seed.sessionId));
    expect(queued).toMatchObject({ status: 'queued', attempt: 0, leaseToken: null });
  });

  it('returns async acceptance with the parent running and its generation queued', async () => {
    const seed = await seedPendingAthena();
    const [session] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const fetch = vi.fn(async () => Response.json({ accepted: true }, { status: 202 }));

    const admission = await admitAthenaGeneration(
      session!,
      { runnableStatuses: ['pending'] },
      {
        config: {
          APP_MODE: 'production',
          ATHENA_ASYNC_RUNNER_ENABLED: true,
          CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example',
          DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret-long-enough',
        },
        enqueue: enqueueRunGeneration,
        fetch,
      },
    );

    expect(admission.mode).toBe('async');
    const [current] = await dbModule.db
      .select({ status: agentSession.status })
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const [run] = await dbModule.db
      .select({ status: agentSessionRun.status })
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, seed.sessionId));
    expect(current?.status).toBe('running');
    expect(run?.status).toBe('queued');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('atomically parks a just-accepted queued generation when its owner pauses', async () => {
    const seed = await seedPendingAthena();
    const [pending] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const queued = await enqueueRunGeneration(pending!);
    const [running] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));

    const paused = await transitionLifecycle(running!, 'pause');

    expect(paused.status).toBe('awaiting_input');
    const [run] = await dbModule.db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, seed.sessionId));
    expect(run).toMatchObject({ status: 'waiting', leaseToken: null, leaseExpiresAt: null });
    await expect(advanceCloudflareGeneration(queued.message, 'run')).resolves.toEqual({
      state: 'wait',
    });
  });

  it('atomically cancels a just-accepted queued generation before a delayed Workflow claim', async () => {
    const seed = await seedPendingAthena();
    const [pending] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const queued = await enqueueRunGeneration(pending!);
    const [running] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));

    const canceled = await transitionLifecycle(running!, 'cancel');

    expect(canceled.status).toBe('canceled');
    const [run] = await dbModule.db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, seed.sessionId));
    expect(run).toMatchObject({ status: 'canceled', leaseToken: null, leaseExpiresAt: null });
    await expect(advanceCloudflareGeneration(queued.message, 'run')).resolves.toEqual({
      state: 'complete',
    });
  });

  it('claims only the exact persisted generation and fences duplicate workers', async () => {
    const seed = await seedPendingAthena();
    const [session] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const queued = await enqueueRunGeneration(session!);

    const claimed = await claimQueuedRunGeneration(queued.message);

    expect(claimed.session.id).toBe(seed.sessionId);
    expect(claimed.lease).toMatchObject({ sessionId: seed.sessionId, generation: 1 });
    await expect(claimQueuedRunGeneration(queued.message)).rejects.toThrow(/generation/i);
    const [run] = await dbModule.db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, seed.sessionId));
    expect(run).toMatchObject({ status: 'running', attempt: 1 });
    expect(run?.leaseToken).toBeTruthy();
  });

  it('reclaims an expired exact generation and fences the stale worker token', async () => {
    const seed = await seedPendingAthena();
    const [session] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const queued = await enqueueRunGeneration(session!);
    const claimedAt = new Date('2026-07-16T18:00:00.000Z');
    const first = await claimQueuedRunGeneration(queued.message, {
      now: claimedAt,
      leaseDurationMs: 1_000,
    });

    await expect(
      claimQueuedRunGeneration(queued.message, {
        now: new Date(claimedAt.getTime() + 999),
        leaseDurationMs: 1_000,
      }),
    ).rejects.toThrow(/generation/i);

    const recovered = await claimQueuedRunGeneration(queued.message, {
      now: new Date(claimedAt.getTime() + 1_000),
      leaseDurationMs: 1_000,
    });

    expect(recovered.lease.leaseToken).not.toBe(first.lease.leaseToken);
    const [run] = await dbModule.db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.id, first.lease.runId));
    expect(run).toMatchObject({ status: 'running', attempt: 2 });
    expect(run?.leaseToken).toBe(recovered.lease.leaseToken);

    await expect(
      withRunGenerationFence(
        first.lease,
        async (tx) => {
          await tx.insert(sessionActivity).values({
            sessionId: seed.sessionId,
            organizationId: null,
            type: 'response',
            body: { text: 'stale worker write' },
          });
        },
        new Date(claimedAt.getTime() + 1_001),
      ),
    ).rejects.toThrow(/lease was lost/i);
    expect(
      await dbModule.db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, seed.sessionId)),
    ).toHaveLength(0);
  });

  it('lets a duplicate Workflow callback drive an expired running generation', async () => {
    const seed = await seedPendingAthena();
    const [session] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const queued = await enqueueRunGeneration(session!);
    const claimedAt = new Date('2026-07-16T19:00:00.000Z');
    const first = await claimQueuedRunGeneration(queued.message, {
      now: claimedAt,
      leaseDurationMs: 1_000,
    });
    const drive = vi.fn(async (_orgId: string, _sessionId: string, _lease: RunGenerationLease) => ({
      ...session!,
      status: 'completed' as const,
    }));

    await expect(
      advanceCloudflareGeneration(queued.message, 'run', {
        claim: (message) =>
          claimQueuedRunGeneration(message, {
            now: new Date(claimedAt.getTime() + 1_000),
            leaseDurationMs: 60_000,
          }),
        drive,
        enqueue: vi.fn(),
        loadWaiting: vi.fn(),
      }),
    ).resolves.toEqual({ state: 'complete' });

    expect(drive).toHaveBeenCalledOnce();
    const recoveredLease = drive.mock.calls[0]?.[2];
    expect(recoveredLease?.leaseToken).not.toBe(first.lease.leaseToken);
    const [run] = await dbModule.db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.id, first.lease.runId));
    expect(run).toMatchObject({ status: 'running', attempt: 2 });
  });

  it('rechecks owner capacity before reclaiming an expired exact generation', async () => {
    const seed = await seedPendingAthena();
    const [session] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const queued = await enqueueRunGeneration(session!);
    const claimedAt = new Date('2026-07-16T20:00:00.000Z');
    const first = await claimQueuedRunGeneration(queued.message, {
      now: claimedAt,
      leaseDurationMs: 1_000,
    });
    const competingSessions = await dbModule.db
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
      competingSessions.map(({ id }) => ({
        sessionId: id,
        ownerUserId: seed.ownerUserId,
        generation: 1,
        workflowInstanceId: `${id}:1`,
        status: 'running' as const,
        attempt: 1,
        leaseToken: `competing-${id}`,
        leaseExpiresAt: new Date(claimedAt.getTime() + 61_000),
      })),
    );

    await expect(
      claimQueuedRunGeneration(queued.message, {
        now: new Date(claimedAt.getTime() + 1_000),
        leaseDurationMs: 60_000,
      }),
    ).rejects.toThrow(/concurrent run limit/i);
    const [run] = await dbModule.db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.id, first.lease.runId));
    expect(run).toMatchObject({ attempt: 1, leaseToken: first.lease.leaseToken });
  });

  it('settles while a concurrent lifecycle transition waits on the same parent-first lock order', async () => {
    const seed = await seedPendingAthena();
    const [pending] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const queued = await enqueueRunGeneration(pending!);
    const claimed = await claimQueuedRunGeneration(queued.message);
    const [running] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    let effectEntered!: () => void;
    const effectStarted = new Promise<void>((resolve) => {
      effectEntered = resolve;
    });
    let releaseEffect!: () => void;
    const effectReleased = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });

    const settlement = settleRunGeneration(claimed.lease, 'completed', undefined, async () => {
      effectEntered();
      await effectReleased;
    });
    await effectStarted;
    const lifecycle = transitionLifecycle(running!, 'cancel');
    await Promise.resolve();
    releaseEffect();

    const [settlementResult, lifecycleResult] = await Promise.allSettled([settlement, lifecycle]);
    // PGlite serializes transaction callbacks and cannot reproduce PostgreSQL row-lock deadlocks.
    // Keep the real concurrent outcome above, and guard the production SQL acquisition order that
    // makes the same race deadlock-free under PostgreSQL's independent connections.
    const settlementSource = runGenerationSource.slice(
      runGenerationSource.indexOf('export async function settleRunGeneration'),
      runGenerationSource.indexOf('/** A renewable heartbeat'),
    );
    const sessionLockIndex = settlementSource.indexOf('.from(agentSession)');
    const runSettlementIndex = settlementSource.indexOf('.update(agentSessionRun)');
    expect(sessionLockIndex).toBeGreaterThanOrEqual(0);
    expect(runSettlementIndex).toBeGreaterThan(sessionLockIndex);
    expect(settlementResult.status).toBe('fulfilled');
    expect(lifecycleResult.status).toBe('rejected');
    if (lifecycleResult.status === 'rejected') {
      expect(lifecycleResult.reason).toBeInstanceOf(Error);
      expect((lifecycleResult.reason as Error).message).toMatch(/terminal state/i);
    }
  });

  it('uses one owner-first admission lock order when dispatch and readmission race', async () => {
    const seed = await seedPendingAthena();
    const [first] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, seed.sessionId));
    const queued = await enqueueRunGeneration(first!);
    const [second] = await dbModule.db
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: seed.ownerUserId,
        trigger: 'delegation',
        status: 'pending',
      })
      .returning();

    const outcomes = await Promise.allSettled([
      claimQueuedRunGeneration(queued.message),
      enqueueRunGeneration(second!),
    ]);

    expect(outcomes.every(({ status }) => status === 'fulfilled')).toBe(true);
    const helperStart = runGenerationSource.indexOf('async function lockRunAdmissionSession');
    const helperEnd = runGenerationSource.indexOf(
      '/**\n * Persist the next deterministic',
      helperStart,
    );
    expect(helperStart).toBeGreaterThanOrEqual(0);
    const helperSource = runGenerationSource.slice(helperStart, helperEnd);
    const observedSessionIndex = helperSource.indexOf('.from(agentSession)');
    const ownerLockIndex = helperSource.indexOf('.from(user)');
    const lockedSessionIndex = helperSource.indexOf(
      '.from(agentSession)',
      observedSessionIndex + 1,
    );
    expect(ownerLockIndex).toBeGreaterThan(observedSessionIndex);
    expect(lockedSessionIndex).toBeGreaterThan(ownerLockIndex);

    const enqueueSource = runGenerationSource.slice(
      runGenerationSource.indexOf('export async function enqueueRunGeneration'),
      runGenerationSource.indexOf('/** Claim the exact queued generation'),
    );
    const queuedClaimSource = runGenerationSource.slice(
      runGenerationSource.indexOf('export async function claimQueuedRunGeneration'),
      runGenerationSource.indexOf('/**\n * Claim or recover the runnable generation'),
    );
    const directClaimSource = runGenerationSource.slice(
      runGenerationSource.indexOf('export async function claimRunGeneration'),
      runGenerationSource.indexOf('/** Renew a generation'),
    );
    for (const source of [enqueueSource, queuedClaimSource, directClaimSource]) {
      expect(source).toContain('lockRunAdmissionSession');
    }
  });
});
