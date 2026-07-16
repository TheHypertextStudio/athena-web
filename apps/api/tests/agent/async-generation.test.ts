import { agentSession, agentSessionRun, user } from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { claimQueuedRunGeneration, enqueueRunGeneration } from '../../src/agent/run-generation';
import { getMigratedDb } from '../support/db';

let dbModule: Awaited<ReturnType<typeof getMigratedDb>>;

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
});
