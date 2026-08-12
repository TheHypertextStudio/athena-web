/**
 * The scheduler-provisioning contract.
 *
 * @remarks
 * Five cron routes once shipped with no Cloud Scheduler job, and every scheduled behavior
 * behind them was silently dead in prod — the dev scheduler ticks everything every three
 * seconds locally, so nothing looked broken where anyone was looking. Two things hold that
 * door shut:
 *
 * 1. **The drift comparison is pinned.** `computeRouteDrift` is the function the script warns
 *    from at provision time; drift in either direction must name the exact path, because a
 *    route with no job never runs and a job with no route POSTs a 404 forever.
 * 2. **The full path set is asserted here.** `cron.ts` and `JOBS` are two hand-maintained
 *    views of the same eighteen paths, so this file carries the list as the deliberate third
 *    copy: adding a route or a job without the other now fails CI instead of drifting
 *    silently until someone reads a deploy log.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  computeRouteDrift,
  CRON_ROUTES_FILE,
  JOBS,
  parseCronRoutes,
} from '../../scripts/scheduler-setup';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Every path the API declares and the scheduler must drive, exactly as mounted. */
const EXPECTED_PATHS = [
  '/internal/cron/account-deletion-sweep',
  '/internal/cron/account-export-sweep',
  '/internal/cron/athena-triggers',
  '/internal/cron/daily-digests',
  '/internal/cron/day-cadence',
  '/internal/cron/directive-posture',
  '/internal/cron/elicitation-deadlines',
  '/internal/cron/email-suggestions',
  '/internal/cron/expired-sessions-sweep',
  '/internal/cron/legacy-mentions',
  '/internal/cron/lifecycle-sweep',
  '/internal/cron/process-events',
  '/internal/cron/recurrence-materialization',
  '/internal/cron/run-linear-agent-sessions',
  '/internal/cron/search-index',
  '/internal/cron/sync-calendars',
  '/internal/cron/sync-connectors',
  '/internal/cron/unfurl-resources',
] as const;

describe('scheduler-setup — route parsing', () => {
  it('reads every .post route out of a cron app source, wherever the call sits', () => {
    const source = `
      const cron = new Hono()
        .post('/lifecycle-sweep', async (c) => c.json({}))
        // a comment between routes
        .post(
          '/unfurl-resources',
          async (c) => c.json({}),
        );
    `;
    expect(parseCronRoutes(source)).toEqual([
      '/internal/cron/lifecycle-sweep',
      '/internal/cron/unfurl-resources',
    ]);
  });
});

describe('scheduler-setup — drift detection', () => {
  it('flags a route with no job — the silently-dead direction this check exists for', () => {
    const drift = computeRouteDrift(
      ['/internal/cron/lifecycle-sweep', '/internal/cron/unfurl-resources'],
      [{ path: '/internal/cron/lifecycle-sweep' }],
    );
    expect(drift.unscheduled).toEqual(['/internal/cron/unfurl-resources']);
    expect(drift.dangling).toEqual([]);
  });

  it('flags a job with no route — the 404-forever direction', () => {
    const drift = computeRouteDrift(
      ['/internal/cron/lifecycle-sweep'],
      [{ path: '/internal/cron/lifecycle-sweep' }, { path: '/internal/cron/renamed-away' }],
    );
    expect(drift.unscheduled).toEqual([]);
    expect(drift.dangling).toEqual(['/internal/cron/renamed-away']);
  });

  it('stays quiet when the two views agree', () => {
    const drift = computeRouteDrift(
      ['/internal/cron/lifecycle-sweep'],
      [{ path: '/internal/cron/lifecycle-sweep' }],
    );
    expect(drift.unscheduled).toEqual([]);
    expect(drift.dangling).toEqual([]);
  });
});

describe('scheduler-setup — the eighteen jobs', () => {
  const cronSource = readFileSync(`${REPO_ROOT}${CRON_ROUTES_FILE}`, 'utf8');
  const routes = parseCronRoutes(cronSource);

  it('shows no drift between cron.ts and JOBS today', () => {
    const drift = computeRouteDrift(routes, JOBS);
    expect(drift.unscheduled).toEqual([]);
    expect(drift.dangling).toEqual([]);
  });

  it('pins the exact eighteen paths on both sides', () => {
    // Guards the parser too: an empty parse cannot pass off as "no drift" here.
    expect([...routes].sort()).toEqual([...EXPECTED_PATHS].sort());
    expect(JOBS.map((job) => job.path).sort()).toEqual([...EXPECTED_PATHS].sort());
    expect(JOBS).toHaveLength(18);
  });

  it('keeps every job id unique, since a duplicate would silently clobber its sibling', () => {
    expect(new Set(JOBS.map((job) => job.name)).size).toBe(JOBS.length);
  });
});
