import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  matchesCronSchedule,
  resolveCronMode,
  RUNNER_CRON_JOBS,
  runScheduledCronSweeps,
  selectDueCronJobs,
} from '../src/cron-sweeps';
import worker from '../src/index';

const baseEnv = {
  DOCKET_API_URL: 'https://api.example',
  CRON_SECRET: 'cron-secret-value',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cron expression matching', () => {
  it('matches every cadence used across Docket API cron jobs in UTC', () => {
    const t0400 = new Date('2026-11-18T04:00:00.000Z');
    const t0330 = new Date('2026-11-18T03:30:00.000Z');
    const t0437 = new Date('2026-11-18T04:37:00.000Z');
    const t0515 = new Date('2026-11-18T05:15:00.000Z');
    const t0510 = new Date('2026-11-18T05:10:00.000Z');

    expect(matchesCronSchedule('* * * * *', t0437)).toBe(true);
    expect(matchesCronSchedule('*/5 * * * *', t0515)).toBe(true);
    expect(matchesCronSchedule('*/5 * * * *', t0437)).toBe(false);
    expect(matchesCronSchedule('*/10 * * * *', t0510)).toBe(true);
    expect(matchesCronSchedule('*/10 * * * *', t0515)).toBe(false);
    expect(matchesCronSchedule('*/15 * * * *', t0515)).toBe(true);
    expect(matchesCronSchedule('*/15 * * * *', t0510)).toBe(false);
    expect(matchesCronSchedule('0 * * * *', t0400)).toBe(true);
    expect(matchesCronSchedule('15 * * * *', t0515)).toBe(true);
    expect(matchesCronSchedule('0 3 * * *', new Date('2026-11-18T03:00:00.000Z'))).toBe(true);
    expect(matchesCronSchedule('30 3 * * *', t0330)).toBe(true);
    expect(matchesCronSchedule('0 4 * * *', t0400)).toBe(true);
    expect(matchesCronSchedule('37 4 * * *', t0437)).toBe(true);
    expect(matchesCronSchedule('37 4 * * *', t0400)).toBe(false);
  });

  it('supports lists, ranges, stepped ranges, Sunday 0/7, and rejects invalid expressions', () => {
    const sundayMidnight = new Date('2026-11-15T00:00:00.000Z');
    expect(matchesCronSchedule('0 0 * * 7', sundayMidnight)).toBe(true);
    expect(matchesCronSchedule('0-10/5,30 * * * *', new Date('2026-11-15T00:05:00.000Z'))).toBe(
      true,
    );
    expect(matchesCronSchedule('0-10/5,30 * * * *', new Date('2026-11-15T00:30:00.000Z'))).toBe(
      true,
    );

    expect(matchesCronSchedule('* * *', sundayMidnight)).toBe(false);
    expect(matchesCronSchedule('*/0 * * * *', sundayMidnight)).toBe(false);
    expect(matchesCronSchedule('*/5/2 * * * *', sundayMidnight)).toBe(false);
    expect(matchesCronSchedule('60 * * * *', sundayMidnight)).toBe(false);
    expect(matchesCronSchedule('10-5 * * * *', sundayMidnight)).toBe(false);
    expect(matchesCronSchedule('1-2-3 * * * *', sundayMidnight)).toBe(false);
    expect(matchesCronSchedule('abc * * * *', sundayMidnight)).toBe(false);
    expect(matchesCronSchedule('* * * * *', new Date('invalid'))).toBe(false);
  });
});

describe('cron mode and due job selection', () => {
  it('validates mode values and restricts staging-athena to athena-triggers', () => {
    expect(resolveCronMode(undefined)).toBe('off');
    expect(resolveCronMode('off')).toBe('off');
    expect(resolveCronMode('staging-athena')).toBe('staging-athena');
    expect(resolveCronMode('all')).toBe('all');
    expect(() => resolveCronMode('bogus')).toThrow('Invalid DOCKET_CRON_MODE: bogus');

    const now = new Date('2026-11-18T03:00:00.000Z');
    expect(selectDueCronJobs('off', now)).toEqual([]);
    expect(selectDueCronJobs('staging-athena', now).map((job) => job.path)).toEqual([
      '/internal/cron/athena-triggers',
    ]);

    const allAt0300 = selectDueCronJobs('all', now).map((job) => job.path);
    expect(allAt0300).toContain('/internal/cron/lifecycle-sweep');
    expect(allAt0300).toContain('/internal/cron/expired-sessions-sweep');
    expect(allAt0300).not.toContain('/internal/cron/usage-rollup');
    expect(RUNNER_CRON_JOBS).toHaveLength(26);
  });
});

describe('runScheduledCronSweeps', () => {
  it('short-circuits in off mode and fails closed when CRON_SECRET is missing', async () => {
    const fetchMock = vi.fn();
    await expect(runScheduledCronSweeps(baseEnv, { fetch: fetchMock })).resolves.toEqual({
      mode: 'off',
      due: 0,
      succeeded: 0,
      failed: 0,
      failures: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      runScheduledCronSweeps(
        { DOCKET_API_URL: 'https://api.example', DOCKET_CRON_MODE: 'all', CRON_SECRET: '   ' },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow('Missing CRON_SECRET for Cloudflare cron sweep');
  });

  it('authenticates each due POST with CRON_SECRET and records HTTP or network failures', async () => {
    const fetchMock = vi.fn((url: URL | string, _init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/internal/cron/process-events')) {
        return Promise.resolve(new Response('boom', { status: 503 }));
      }
      if (target.endsWith('/internal/cron/search-index')) {
        return Promise.reject(new Error('network reset'));
      }
      return Promise.resolve(Response.json({ ok: true }));
    });

    const summary = await runScheduledCronSweeps(
      { ...baseEnv, DOCKET_CRON_MODE: 'all' },
      { fetch: fetchMock as typeof fetch, now: new Date('2026-11-18T00:05:00.000Z') },
    );

    expect(summary.mode).toBe('all');
    expect(summary.due).toBe(9);
    expect(summary.succeeded).toBe(7);
    expect(summary.failed).toBe(2);
    expect(summary.failures).toEqual([
      {
        name: 'docket-process-events',
        path: '/internal/cron/process-events',
        status: 503,
        error: 'HTTP 503',
      },
      {
        name: 'docket-search-index',
        path: '/internal/cron/search-index',
        error: 'network reset',
      },
    ]);

    const firstInit = fetchMock.mock.calls[0]?.[1];
    expect(firstInit?.method).toBe('POST');
    expect(firstInit?.body).toBe('{}');
    expect(firstInit?.headers).toEqual({
      'content-type': 'application/json',
      'x-cron-secret': 'cron-secret-value',
      authorization: 'Bearer cron-secret-value',
    });
  });

  it('fans out cron sweeps from worker.scheduled when DOCKET_CRON_MODE is enabled', async () => {
    const fetchMock = vi.fn((url: URL | string) => {
      if (String(url).endsWith('/internal/athena/execution/dispatch/sweep')) {
        return Promise.resolve(Response.json({ claimed: 0, delivered: 0, retried: 0, failed: 0 }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await worker.scheduled(
      { scheduledTime: Date.parse('2026-11-18T04:37:00.000Z') } as ScheduledController,
      {
        ...baseEnv,
        DOCKET_CRON_MODE: 'all',
        ATHENA_RUN_QUEUE: { send: vi.fn() },
        ATHENA_WORKFLOW: { get: vi.fn() },
        CLOUDFLARE_TO_DOCKET_HMAC_SECRET: 'cloudflare-to-docket-secret',
        DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret',
      } as never,
    );

    const calledPaths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(calledPaths).toContain('/internal/athena/execution/dispatch/sweep');
    expect(calledPaths).toContain('/internal/cron/athena-triggers');
    expect(calledPaths).toContain('/internal/cron/document-image-cleanup');
  });

  it('still runs scheduled cron sweeps when async runner HMAC secret is omitted', async () => {
    const fetchMock = vi.fn((_url: URL | string) => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await worker.scheduled(
      { scheduledTime: Date.parse('2026-11-18T04:37:00.000Z') } as ScheduledController,
      {
        ...baseEnv,
        DOCKET_CRON_MODE: 'all',
        ATHENA_RUN_QUEUE: { send: vi.fn() },
        ATHENA_WORKFLOW: { get: vi.fn() },
      } as never,
    );

    const calledPaths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(calledPaths).not.toContain('/internal/athena/execution/dispatch/sweep');
    expect(calledPaths).toContain('/internal/cron/athena-triggers');
    expect(calledPaths).toContain('/internal/cron/document-image-cleanup');
  });

  it('finishes cron sweeps before rethrowing when the dispatch sweep fails', async () => {
    const fetchMock = vi.fn((url: URL | string) => {
      if (String(url).endsWith('/internal/athena/execution/dispatch/sweep')) {
        return Promise.resolve(new Response('unauthorized', { status: 401 }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      worker.scheduled(
        { scheduledTime: Date.parse('2026-11-18T04:37:00.000Z') } as ScheduledController,
        {
          ...baseEnv,
          DOCKET_CRON_MODE: 'all',
          ATHENA_RUN_QUEUE: { send: vi.fn() },
          ATHENA_WORKFLOW: { get: vi.fn() },
          CLOUDFLARE_TO_DOCKET_HMAC_SECRET: 'cloudflare-to-docket-secret',
          DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret',
        } as never,
      ),
    ).rejects.toThrow('Docket dispatch sweep failed (401)');

    const calledPaths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(calledPaths).toContain('/internal/cron/athena-triggers');
    expect(calledPaths).toContain('/internal/cron/document-image-cleanup');
  });
});
