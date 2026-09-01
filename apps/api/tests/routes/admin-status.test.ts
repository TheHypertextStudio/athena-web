import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { assertDefined } from '@docket/test-utils';
import { appWithSession, fakeSession, getDb } from '../support/routes-harness';

import type { AdminStatusOut } from '../../src/admin-dto';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/app')).adminRouter;
});

let counter = 0;
/** A unique suffix per call — the PGlite database is shared across this suite. */
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}

/** Insert a staff user and return the signing-in user's id. */
async function makeStaff(): Promise<string> {
  const u = uniq();
  const users = await db
    .insert(schema.user)
    .values({ name: `Operator ${u}`, email: `operator-${u}@example.com` })
    .returning({ id: schema.user.id });
  const userId = assertDefined(users[0]).id;
  await db.insert(schema.staffUser).values({ userId, role: 'support' });
  return userId;
}

/** Record one probe result for a service at a given age in hours. */
async function recordProbe(
  serviceKey: string,
  outcome: 'up' | 'degraded' | 'down' | 'disabled' | 'unknown',
  hoursAgo: number,
): Promise<void> {
  await db.insert(schema.serviceProbe).values({
    serviceKey,
    outcome,
    latencyMs: 12,
    checkedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  });
}

/** Read the board as an admitted operator. */
async function readStatus(userId: string): Promise<AdminStatusOut> {
  const app = appWithSession(admin, fakeSession(userId));
  const res = await app.request('/status', { method: 'GET' });
  expect(res.status).toBe(200);
  return (await res.json()) as AdminStatusOut;
}

/** The entry for one service. */
function serviceOf(board: AdminStatusOut, key: string): AdminStatusOut['services'][number] {
  return assertDefined(board.services.find((service) => service.key === key));
}

describe('service status board', () => {
  it('refuses an anonymous caller', async () => {
    const anonymous = appWithSession(admin, null);
    expect((await anonymous.request('/status', { method: 'GET' })).status).toBe(401);
  });

  it('reports a service that has never been checked as unknown, not as healthy', async () => {
    const board = await readStatus(await makeStaff());

    // Every catalogued service appears, whether or not a probe row exists for it — a service that
    // silently drops out of the report is the failure this board exists to prevent.
    expect(board.services.length).toBeGreaterThan(0);
    const runner = serviceOf(board, 'runner');
    expect(runner.outcome).toBe('unknown');
    expect(runner.checkedAt).toBeNull();
    expect(runner.uptime.every((window) => window.uptime === null)).toBe(true);
  });

  it('computes uptime as successes over measurable checks in each window', async () => {
    const userId = await makeStaff();
    // Three up and one down inside 24h → 0.75 across every window.
    await recordProbe('api', 'up', 1);
    await recordProbe('api', 'up', 2);
    await recordProbe('api', 'up', 3);
    await recordProbe('api', 'down', 4);

    const day = assertDefined(
      serviceOf(await readStatus(userId), 'api').uptime.find((w) => w.windowHours === 24),
    );
    expect(day.checks).toBe(4);
    expect(day.successes).toBe(3);
    expect(day.uptime).toBeCloseTo(0.75);
  });

  it('excludes disabled and unknown checks from both halves of the ratio', async () => {
    const userId = await makeStaff();
    await recordProbe('web', 'up', 1);
    await recordProbe('web', 'disabled', 1);
    await recordProbe('web', 'unknown', 1);

    const day = assertDefined(
      serviceOf(await readStatus(userId), 'web').uptime.find((w) => w.windowHours === 24),
    );
    // A service switched off has not failed, and one with no traffic has not been measured.
    expect(day.checks).toBe(1);
    expect(day.uptime).toBe(1);
  });

  it('separates the windows, so an old failure leaves the recent one clean', async () => {
    const userId = await makeStaff();
    await recordProbe('admin', 'up', 1);
    await recordProbe('admin', 'down', 24 * 10);

    const windows = serviceOf(await readStatus(userId), 'admin').uptime;
    const day = assertDefined(windows.find((w) => w.windowHours === 24));
    const month = assertDefined(windows.find((w) => w.windowHours === 24 * 30));
    expect(day.uptime).toBe(1);
    expect(month.checks).toBe(2);
    expect(month.uptime).toBeCloseTo(0.5);
  });

  it('reports the newest check and the last time the service was healthy', async () => {
    const userId = await makeStaff();
    await recordProbe('database', 'up', 5);
    await recordProbe('database', 'down', 1);

    const service = serviceOf(await readStatus(userId), 'database');
    // The latest verdict is the failure; the last success is still remembered, which is what tells
    // an operator how long it has been broken.
    expect(service.outcome).toBe('down');
    expect(service.lastSuccessAt).not.toBeNull();
    expect(new Date(assertDefined(service.checkedAt)).getTime()).toBeGreaterThan(
      new Date(assertDefined(service.lastSuccessAt)).getTime(),
    );
  });

  it('summarizes every background-work ledger', async () => {
    const board = await readStatus(await makeStaff());

    expect(board.jobs.map((job) => job.key)).toEqual([
      'connector_sync',
      'agent_runs',
      'agent_dispatch',
      'search_index',
      'command_effects',
      'billing_sync',
    ]);
    for (const job of board.jobs) {
      expect(job.failures).toBeLessThanOrEqual(job.total);
    }
    expect(board.jobWindowHours).toBeGreaterThan(0);
  });
});
