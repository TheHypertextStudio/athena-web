/**
 * `@docket/api` — the real (non-mocked) recovery path Cloudflare retries land on.
 *
 * @remarks
 * `execution-advance.test.ts` proves `advanceCloudflareGeneration`'s own state machine against
 * injected dependencies. This file proves the DEFAULT dependencies — `recoverPersistedGeneration`
 * and `loadWaitingGeneration` — against a real database, because those two functions are what
 * actually run in production and a mock can never catch a bug in the query itself (a wrong status
 * filter, a wrong generation comparison). Every case here sets a run to a status a
 * "claim" attempt would find already-settled, then asserts the retry reports the persisted
 * outcome instead of duplicating work.
 */
import { agentSession, agentSessionRun, user } from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { advanceCloudflareGeneration } from '../../src/agent/execution-advance';
import { enqueueRunGeneration, type RunGenerationMessage } from '../../src/agent/run-generation';
import { getMigratedDb } from '../support/db';

let dbModule: Awaited<ReturnType<typeof getMigratedDb>>;

beforeAll(async () => {
  dbModule = await getMigratedDb();
});

/** Seed a pending Athena session and its deterministic generation-1 queued run. */
async function seedQueuedGeneration(): Promise<{
  ownerUserId: string;
  sessionId: string;
  message: RunGenerationMessage;
}> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [owner] = await dbModule.db
    .insert(user)
    .values({ name: 'Recovery Owner', email: `recovery-${suffix}@example.com` })
    .returning({ id: user.id });
  const [created] = await dbModule.db
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: owner!.id,
      trigger: 'delegation',
      status: 'pending',
    })
    .returning({ id: agentSession.id });
  const [session] = await dbModule.db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, created!.id));
  const { message } = await enqueueRunGeneration(session!);
  return { ownerUserId: owner!.id, sessionId: session!.id, message };
}

describe('recoverPersistedGeneration (real default dependencies)', () => {
  it('reports "wait" for a run already marked waiting', async () => {
    const { message } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'waiting' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));

    await expect(advanceCloudflareGeneration(message, 'run')).resolves.toEqual({ state: 'wait' });
  });

  it('reports "failed" for a run already marked failed', async () => {
    const { message } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'failed' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));

    await expect(advanceCloudflareGeneration(message, 'run')).resolves.toEqual({
      state: 'failed',
    });
  });

  it('reports "complete" for a run already marked canceled', async () => {
    const { message } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'canceled' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));

    await expect(advanceCloudflareGeneration(message, 'run')).resolves.toEqual({
      state: 'complete',
    });
  });

  it('reports "failed" for a completed run whose session has since failed', async () => {
    const { message, sessionId } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'completed' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));
    await dbModule.db
      .update(agentSession)
      .set({ status: 'failed' })
      .where(eq(agentSession.id, sessionId));

    await expect(advanceCloudflareGeneration(message, 'run')).resolves.toEqual({
      state: 'failed',
    });
  });

  it('reports "complete" for a completed run whose session has since completed', async () => {
    const { message, sessionId } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'completed' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));
    await dbModule.db
      .update(agentSession)
      .set({ status: 'completed' })
      .where(eq(agentSession.id, sessionId));

    await expect(advanceCloudflareGeneration(message, 'run')).resolves.toEqual({
      state: 'complete',
    });
  });

  it('continues into a later generation that was already admitted', async () => {
    const { message, sessionId } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'completed' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));
    const [session] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, sessionId));
    const second = await enqueueRunGeneration({ ...session!, status: 'running' });

    const result = await advanceCloudflareGeneration(message, 'run');
    expect(result).toEqual({ state: 'continue', next: second.message });
  });

  it('enqueues a fresh generation when the session is still running with nothing queued', async () => {
    const { message, sessionId } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'completed' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));
    await dbModule.db
      .update(agentSession)
      .set({ status: 'running' })
      .where(eq(agentSession.id, sessionId));

    const result = await advanceCloudflareGeneration(message, 'run');
    expect(result.state).toBe('continue');
    if (result.state === 'continue') {
      expect(result.next.generation).toBe(2);
      expect(result.next.sessionId).toBe(sessionId);
    }
  });

  it('propagates the original conflict when the session is idle with nothing to recover', async () => {
    const { message, sessionId } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'completed' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));
    await dbModule.db
      .update(agentSession)
      .set({ status: 'awaiting_input' })
      .where(eq(agentSession.id, sessionId));

    await expect(advanceCloudflareGeneration(message, 'run')).rejects.toThrow(
      'Queued session generation is unavailable',
    );
  });

  it('reports the session as not found when the message names one that does not exist', async () => {
    // `claimQueuedRunGeneration` throws NotFoundError (not ConflictError) for a missing session,
    // so this never reaches the recovery path at all — it propagates directly.
    const message: RunGenerationMessage = {
      sessionId: 'nonexistent-session',
      generation: 1,
      workflowId: 'nonexistent-session:1',
    };
    await expect(advanceCloudflareGeneration(message, 'run')).rejects.toThrow('Session not found');
  });
});

describe('loadWaitingGeneration (real default dependencies)', () => {
  it('resumes a session that is genuinely waiting for a person', async () => {
    const { message, sessionId } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'waiting' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));
    await dbModule.db
      .update(agentSession)
      .set({ status: 'awaiting_input' })
      .where(eq(agentSession.id, sessionId));

    const result = await advanceCloudflareGeneration(message, 'wake');
    expect(result.state).toBe('continue');
    if (result.state === 'continue') expect(result.next.generation).toBe(2);
  });

  it('refuses to wake a generation that is not the current human wait', async () => {
    const { message } = await seedQueuedGeneration();
    // Never marked "waiting": the latest run is still queued, so this is not the current wait.
    await expect(advanceCloudflareGeneration(message, 'wake')).rejects.toThrow(
      'Workflow generation is not the current human wait',
    );
  });

  it('refuses to wake with a stale generation once a newer one exists', async () => {
    const { message, sessionId } = await seedQueuedGeneration();
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'waiting' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));
    const [session] = await dbModule.db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, sessionId));
    await dbModule.db
      .update(agentSessionRun)
      .set({ status: 'completed' })
      .where(eq(agentSessionRun.workflowInstanceId, message.workflowId));
    await enqueueRunGeneration({ ...session!, status: 'running' });

    // `message` still names generation 1, which is no longer the latest.
    await expect(advanceCloudflareGeneration(message, 'wake')).rejects.toThrow(
      'Workflow generation is not the current human wait',
    );
  });
});
