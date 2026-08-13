import { beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '../support/routes-harness';

/** Every path the cron app exposes. Each one runs a privileged sweep and must be secret-guarded. */
const CRON_PATHS: readonly string[] = [
  '/lifecycle-sweep',
  '/sync-connectors',
  '/elicitation-deadlines',
  '/email-suggestions',
  '/process-events',
  '/search-index',
  '/legacy-mentions',
  '/unfurl-resources',
  '/daily-digests',
  '/pull-activity',
  '/account-deletion-sweep',
  '/account-export-sweep',
  '/sync-calendars',
  '/recurrence-materialization',
  '/run-linear-agent-sessions',
  '/directive-posture',
  '/day-cadence',
  '/athena-triggers',
  '/expired-sessions-sweep',
];

/** The migrated db module plus the lazily-imported cron router. */
async function setup() {
  await getDb();
  return (await import('../../src/routes/cron')).default;
}

beforeAll(async () => {
  await setup();
});

describe('cron secret guard', () => {
  it('refuses every sweep when no secret is presented', async () => {
    // Asserted across the whole surface rather than per route as each is written. These endpoints
    // delete accounts, send mail and spend provider quota, so a route added without the guard is a
    // way to trigger all of that unauthenticated — and the guard is one line that is easy to omit.
    const cron = await setup();
    for (const path of CRON_PATHS) {
      const res = await cron.request(path, { method: 'POST' });
      expect(res.status, path).toBe(401);
    }
  });

  it('refuses a wrong secret, in either header', async () => {
    // Two spellings are accepted so the scheduler can use whichever it has; both must verify rather
    // than merely be present.
    const cron = await setup();
    for (const headers of [
      { authorization: 'Bearer not-the-secret' },
      { 'x-cron-secret': 'not-the-secret' },
      { authorization: 'Bearer ' },
      { authorization: 'not-even-bearer' },
    ]) {
      const res = await cron.request('/pull-activity', { method: 'POST', headers });
      expect(res.status, JSON.stringify(headers)).toBe(401);
    }
  });

  it('runs the activity pull when the secret is right', async () => {
    // The positive case, so the guard cannot be satisfied by refusing everything.
    const cron = await setup();
    const res = await cron.request('/pull-activity', {
      method: 'POST',
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ swept: true });
  });

  it('covers every route the cron app actually declares', async () => {
    // A list of paths in a test rots the moment somebody adds a route. Comparing against the router's
    // own registry means a new unguarded sweep fails here instead of shipping unnoticed.
    const cron = await setup();
    const declared = new Set(
      (cron.routes as { path: string; method: string }[])
        .filter((route) => route.method === 'POST')
        .map((route) => route.path),
    );
    expect([...declared].sort()).toEqual([...CRON_PATHS].sort());
  });
});
