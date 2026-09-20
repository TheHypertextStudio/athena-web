import { fullSchema, type Database } from '@docket/db';
import { WorkSchedulePlanCreate } from '@docket/planning/work-location-contract';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import {
  readVersionedWorkSchedule,
  replaceWorkSchedulePlan,
} from '../../src/services/work-location/schedule-repository';

const databaseUrl = process.env['DATABASE_URL'] ?? '';
let firstSql: Sql;
let secondSql: Sql;
let firstDb: Database;
let secondDb: Database;

function plan(effectiveFrom: string, timezone: string) {
  return WorkSchedulePlanCreate.parse({
    anchorDate: '2026-09-07',
    timezone,
    effectiveFrom,
    effectiveUntil: null,
    cycleDays: [{ segments: [] }],
  });
}

function barrier(parties: number): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === parties) release();
    await open;
  };
}

function writerApp(
  database: Database,
  hubId: string,
  input: ReturnType<typeof plan>,
  waitForBoth: () => Promise<void>,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.put('/schedule', async (c) => {
    await waitForBoth();
    return c.json(await replaceWorkSchedulePlan(database, hubId, input, c.req.header('If-Match')));
  });
  app.onError(onError);
  return app;
}

beforeAll(async () => {
  expect(databaseUrl).toMatch(/^postgres(?:ql)?:/);
  firstSql = postgres(databaseUrl, { connection: { TimeZone: 'UTC' }, max: 1, prepare: false });
  secondSql = postgres(databaseUrl, { connection: { TimeZone: 'UTC' }, max: 1, prepare: false });
  firstDb = drizzle(firstSql, { schema: fullSchema });
  secondDb = drizzle(secondSql, { schema: fullSchema });
});

afterAll(async () => {
  await Promise.all([firstSql.end(), secondSql.end()]);
});

describe('work-schedule conditional writes on PostgreSQL', () => {
  it('lets exactly one connection commit when both use one strong validator', async () => {
    const firstPid = (await firstSql<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]?.pid;
    const secondPid = (await secondSql<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]?.pid;
    expect(firstPid).toEqual(expect.any(Number));
    expect(secondPid).toEqual(expect.any(Number));
    expect(firstPid).not.toBe(secondPid);

    const suffix = crypto.randomUUID();
    const userId = `schedule-race-user-${suffix}`;
    const hubId = `schedule-race-hub-${suffix}`;
    await firstDb.insert(fullSchema.user).values({
      id: userId,
      name: 'Schedule race user',
      email: `${suffix}@schedule-race.example.test`,
    });
    await firstDb.insert(fullSchema.hub).values({ id: hubId, userId, name: 'Schedule race Hub' });
    await replaceWorkSchedulePlan(firstDb, hubId, plan('2026-09-07', 'UTC'));
    const original = await readVersionedWorkSchedule(firstDb, hubId);
    const waitForBoth = barrier(2);
    const firstApp = writerApp(
      firstDb,
      hubId,
      plan('2026-09-14', 'America/Los_Angeles'),
      waitForBoth,
    );
    const secondApp = writerApp(
      secondDb,
      hubId,
      plan('2026-09-21', 'America/New_York'),
      waitForBoth,
    );

    const [first, second] = await Promise.all([
      firstApp.request('/schedule', {
        method: 'PUT',
        headers: { 'If-Match': original.etag },
      }),
      secondApp.request('/schedule', {
        method: 'PUT',
        headers: { 'If-Match': original.etag },
      }),
    ]);
    const final = await readVersionedWorkSchedule(firstDb, hubId);

    expect([first.status, second.status].sort()).toEqual([200, 412]);
    expect(final.etag).not.toBe(original.etag);
    expect(final.value.plans).toHaveLength(2);
    expect(
      final.value.plans.filter((candidate) =>
        ['America/Los_Angeles', 'America/New_York'].includes(candidate.timezone),
      ),
    ).toHaveLength(1);
  });
});
