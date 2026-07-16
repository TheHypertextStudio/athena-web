import type * as DbModule from '@docket/db';
import type meAthenaRoute from '../../src/routes/me-athena';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const runnerMocks = vi.hoisted(() => ({
  admit: vi.fn(),
  wake: vi.fn(),
}));

vi.mock('../../src/agent/async-runner', () => ({
  asynchronousRunnerEnabled: () => true,
  admitAthenaGeneration: runnerMocks.admit,
  wakeWaitingAthenaGeneration: runnerMocks.wake,
}));

import type { AppEnv } from '../../src/context';
import { enqueueRunGeneration } from '../../src/agent/run-generation';
import { onError } from '../../src/error';
import { fakeSession, getDb } from '../support/routes-harness';

let schema: typeof DbModule;
let meAthena: typeof meAthenaRoute;

beforeAll(async () => {
  schema = await getDb();
  meAthena = (await import('../../src/routes/me-athena')).default;
});

describe('personal Athena asynchronous acknowledgement', () => {
  it('returns 202 after persisting work and handing off the opaque generation', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Async Owner', email: `async-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    runnerMocks.admit.mockImplementation(async (session, options) => ({
      mode: 'async',
      queued: await enqueueRunGeneration(session, options),
    }));
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('session', fakeSession(owner!.id));
      await next();
    });
    app.route('/', meAthena);
    app.onError(onError);

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Prepare the launch plan.' }),
    });

    expect(response.status).toBe(202);
    expect(runnerMocks.admit).toHaveBeenCalledWith(
      expect.objectContaining({ executorKind: 'athena', ownerUserId: owner!.id }),
      { runnableStatuses: ['pending'] },
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 'running',
      objective: 'Prepare the launch plan.',
    });
    const [queued] = await schema.db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.ownerUserId, owner!.id));
    expect(queued?.status).toBe('queued');
  });
});
