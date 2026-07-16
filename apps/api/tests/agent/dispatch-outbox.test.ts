import { agentSession, agentSessionDispatch, agentSessionRun, user } from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  admitAthenaGeneration,
  MAX_DISPATCH_ATTEMPTS,
  sweepAthenaDispatches,
} from '../../src/agent/async-runner';
import { enqueueRunGeneration } from '../../src/agent/run-generation';
import { getMigratedDb } from '../support/db';

let dbModule: Awaited<ReturnType<typeof getMigratedDb>>;

const config = {
  APP_MODE: 'production' as const,
  ATHENA_ASYNC_RUNNER_ENABLED: true,
  CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example',
  DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret-long-enough',
};

beforeAll(async () => {
  dbModule = await getMigratedDb();
});

beforeEach(async () => {
  await dbModule.db.delete(agentSessionDispatch);
});

async function seedPendingAthena() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [owner] = await dbModule.db
    .insert(user)
    .values({ name: 'Dispatch Owner', email: `dispatch-${suffix}@example.com` })
    .returning({ id: user.id });
  const [session] = await dbModule.db
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: owner!.id,
      trigger: 'delegation',
      status: 'pending',
    })
    .returning();
  return session!;
}

describe('Athena durable dispatch outbox', () => {
  it('commits one payload-free enqueue intent with the queued run', async () => {
    const session = await seedPendingAthena();

    const queued = await enqueueRunGeneration(session);

    const [intent] = await dbModule.db
      .select()
      .from(agentSessionDispatch)
      .where(eq(agentSessionDispatch.runId, queued.runId));
    expect(intent).toMatchObject({ action: 'enqueue', status: 'pending', attempt: 0 });
    expect(Object.keys(intent ?? {})).not.toEqual(
      expect.arrayContaining(['payload', 'prompt', 'ownerUserId', 'secret']),
    );
  });

  it('recovers a committed enqueue after the first Worker delivery fails', async () => {
    const session = await seedPendingAthena();
    const failedFetch = vi.fn().mockRejectedValue(new Error('connection reset'));

    await expect(
      admitAthenaGeneration(
        session,
        {},
        { config, enqueue: enqueueRunGeneration, fetch: failedFetch },
      ),
    ).resolves.toMatchObject({ mode: 'async' });

    const [run] = await dbModule.db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, session.id));
    const [pending] = await dbModule.db
      .select()
      .from(agentSessionDispatch)
      .where(eq(agentSessionDispatch.runId, run!.id));
    expect(pending).toMatchObject({ status: 'pending', attempt: 1 });
    expect(pending?.availableAt.getTime()).toBeGreaterThan(pending?.createdAt.getTime() ?? 0);

    await expect(
      admitAthenaGeneration(
        session,
        {},
        { config, enqueue: enqueueRunGeneration, fetch: failedFetch },
      ),
    ).resolves.toMatchObject({ mode: 'async', queued: { runId: run!.id } });
    expect(failedFetch).toHaveBeenCalledOnce();

    const deliveredFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    const result = await sweepAthenaDispatches(
      { now: pending!.availableAt, batchSize: 10 },
      { config, fetch: deliveredFetch },
    );

    expect(result).toEqual({ claimed: 1, delivered: 1, retried: 0, failed: 0 });
    const [delivered] = await dbModule.db
      .select()
      .from(agentSessionDispatch)
      .where(eq(agentSessionDispatch.id, pending!.id));
    expect(delivered).toMatchObject({ status: 'delivered', attempt: 2 });
    expect(delivered?.deliveredAt).toBeInstanceOf(Date);
  });

  it('conditionally leases an intent so concurrent sweepers deliver it once', async () => {
    const session = await seedPendingAthena();
    await enqueueRunGeneration(session);
    const fetch = vi.fn().mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    const now = new Date(Date.now() + 1_000);

    const results = await Promise.all([
      sweepAthenaDispatches({ now, batchSize: 10 }, { config, fetch }),
      sweepAthenaDispatches({ now, batchSize: 10 }, { config, fetch }),
    ]);

    expect(results.reduce((total, result) => total + result.claimed, 0)).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('takes a fresh claim clock for each delivery in a slow sequential batch', async () => {
    const first = await seedPendingAthena();
    const second = await seedPendingAthena();
    await enqueueRunGeneration(first);
    await enqueueRunGeneration(second);
    let currentMs = Date.now() + 1_000;
    const fetch = vi.fn().mockImplementation(async () => {
      currentMs += 20_000;
      return Response.json({ accepted: true }, { status: 202 });
    });

    const result = await sweepAthenaDispatches(
      { batchSize: 2, clock: () => new Date(currentMs) },
      { config, fetch },
    );

    expect(result).toEqual({ claimed: 2, delivered: 2, retried: 0, failed: 0 });
    const delivered = await dbModule.db
      .select({ deliveredAt: agentSessionDispatch.deliveredAt })
      .from(agentSessionDispatch)
      .orderBy(agentSessionDispatch.deliveredAt);
    expect(delivered.at(-1)!.deliveredAt!.getTime() - delivered[0]!.deliveredAt!.getTime()).toBe(
      20_000,
    );
  });

  it('moves an exhausted dispatch to failed attention state', async () => {
    const session = await seedPendingAthena();
    const queued = await enqueueRunGeneration(session);
    const now = new Date();
    await dbModule.db
      .update(agentSessionDispatch)
      .set({ attempt: MAX_DISPATCH_ATTEMPTS - 1, availableAt: now })
      .where(eq(agentSessionDispatch.runId, queued.runId));

    const result = await sweepAthenaDispatches(
      { now, batchSize: 10 },
      { config, fetch: vi.fn().mockRejectedValue(new Error('runner unavailable')) },
    );

    expect(result).toEqual({ claimed: 1, delivered: 0, retried: 0, failed: 1 });
    const [failed] = await dbModule.db
      .select()
      .from(agentSessionDispatch)
      .where(eq(agentSessionDispatch.runId, queued.runId));
    expect(failed).toMatchObject({ status: 'failed', attempt: MAX_DISPATCH_ATTEMPTS });
    expect(failed?.lastError).toBe('Athena runner delivery failed');

    const [failedRun] = await dbModule.db
      .select({ status: agentSessionRun.status })
      .from(agentSessionRun)
      .where(eq(agentSessionRun.id, queued.runId));
    const [failedSession] = await dbModule.db
      .select({ status: agentSession.status })
      .from(agentSession)
      .where(eq(agentSession.id, session.id));
    expect(failedRun?.status).toBe('failed');
    expect(failedSession?.status).toBe('failed');

    for (let index = 0; index < 7; index += 1) {
      const [other] = await dbModule.db
        .insert(agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: session.ownerUserId,
          trigger: 'delegation',
          status: 'pending',
        })
        .returning();
      await enqueueRunGeneration(other!);
    }
    const [next] = await dbModule.db
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: session.ownerUserId,
        trigger: 'delegation',
        status: 'pending',
      })
      .returning();
    await expect(enqueueRunGeneration(next!)).resolves.toBeDefined();
  });
});
