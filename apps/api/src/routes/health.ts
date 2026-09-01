/**
 * `@docket/api` — the platform liveness probe.
 *
 * @remarks
 * This route was a hardcoded `{ status: 'ok' }` literal, which meant it answered "is this process
 * running" and nothing more. The API is useless without its database, so the probe reported healthy
 * through a total outage — and it is the check the deploy gates promotion on, so it would also have
 * promoted a revision that could not serve a single request.
 *
 * The check is one `select 1` behind a short deadline. That is deliberately the cheapest question
 * that distinguishes "reachable" from "not", because a probe runs on a schedule and a heavy one
 * becomes its own source of load.
 */
import { db } from '@docket/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

/**
 * How long the database check may take before the probe calls it unreachable.
 *
 * @remarks
 * A connection that has not answered in this long is not serving requests either, and a probe that
 * waits longer than the thing it is checking would report stale news.
 */
const DATABASE_TIMEOUT_MS = 2_000;

/** What a health check concluded about one dependency. */
export type DependencyStatus = 'ok' | 'unreachable';

/** A dependency check, injectable so the failing path is testable without breaking a database. */
export type DependencyCheck = () => Promise<DependencyStatus>;

/**
 * Ask the database whether it is answering.
 *
 * @returns `ok` when a trivial query completes inside {@link DATABASE_TIMEOUT_MS}, `unreachable`
 * when it fails or takes longer.
 */
export async function checkDatabase(): Promise<DependencyStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      db
        .execute(sql`select 1`)
        .then<DependencyStatus>(() => 'ok')
        .catch<DependencyStatus>(() => 'unreachable'),
      new Promise<DependencyStatus>((resolve) => {
        timer = setTimeout(() => {
          resolve('unreachable');
        }, DATABASE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    // The losing branch of a race is abandoned, not cancelled — without this the timer and its
    // closure sit on the heap for the full deadline after every healthy check.
    if (timer) clearTimeout(timer);
  }
}

/**
 * Build the liveness route.
 *
 * @remarks
 * Returns `200` while every dependency answers and `503` when one does not, so a load balancer, the
 * deploy gate, and the operator console all read the same signal without parsing the body. The body
 * names which dependency failed, because "the API is down" and "the API is up but Postgres is not"
 * call for different responses from whoever is paged.
 *
 * @param database - How to check the database. Injectable so a test can exercise the failing path
 * without making a real database unreachable.
 * @returns the mounted health router.
 */
export function createHealthRoutes(database: DependencyCheck = checkDatabase): Hono {
  return new Hono().get('/', async (c) => {
    const result = await database();
    const healthy = result === 'ok';
    return c.json(
      { status: healthy ? 'ok' : 'degraded', dependencies: { database: result } },
      healthy ? 200 : 503,
    );
  });
}

/** The liveness route as the server mounts it. */
export const healthRoutes = createHealthRoutes();
