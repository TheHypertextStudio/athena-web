import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { assertDefined } from '@docket/test-utils';
import { getDb } from '../support/routes-harness';

import {
  type ProbeTarget,
  probeOne,
  PROBE_TARGETS,
  runServiceProbes,
} from '../../src/services/service-probes';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** A fetch that always rejects, standing in for a service that is not answering. */
const unreachable: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));

/** A fetch that answers with a fixed status. */
function responds(status: number): typeof fetch {
  return () => Promise.resolve(new Response(null, { status }));
}

/** One of our own HTTP-probed services, with a URL configured. */
const httpTarget: ProbeTarget = {
  key: 'api',
  label: 'API',
  kind: 'platform',
  method: 'http',
  url: 'http://example.invalid/v1/health',
};

describe('service probes', () => {
  it('records a service that does not answer as down, not as missing', async () => {
    const result = await probeOne(httpTarget, unreachable);

    expect(result.outcome).toBe('down');
    expect(result.reason).toBe('unreachable');
  });

  it('records a bad status as down and keeps the status for diagnosis', async () => {
    const result = await probeOne(httpTarget, responds(503));

    expect(result.outcome).toBe('down');
    expect(result.reason).toBe('bad_status');
    expect(result.statusCode).toBe(503);
  });

  it('records a healthy service with no failure reason', async () => {
    const result = await probeOne(httpTarget, responds(200));

    expect(result.outcome).toBe('up');
    expect(result.reason).toBeNull();
    expect(result.statusCode).toBe(200);
  });

  it('reports an unconfigured service as disabled rather than down', async () => {
    // A deployment that has not switched on the async runner has not failed at anything.
    const result = await probeOne({ ...httpTarget, key: 'runner', url: undefined }, unreachable);

    expect(result.outcome).toBe('disabled');
    expect(result.reason).toBe('not_configured');
  });

  it('never carries a thrown message into the stored reason', async () => {
    // The reason vocabulary is closed and application-owned, so provider text cannot reach the
    // column the console renders.
    const leaky: typeof fetch = () =>
      Promise.reject(new Error('connect failed to https://api.example.com?key=sk_live_SECRET'));
    const result = await probeOne(httpTarget, leaky);

    expect(result.reason).toBe('unreachable');
    expect(JSON.stringify(result)).not.toContain('sk_live_SECRET');
  });

  it('writes one row per service every pass, failures included', async () => {
    const before = (await db.select().from(schema.serviceProbe)).length;

    const results = await runServiceProbes(unreachable);

    const rows = await db.select().from(schema.serviceProbe);
    expect(rows.length - before).toBe(results.length);
    expect(results.length).toBe(PROBE_TARGETS.length);

    // Uptime is successes over total. A pass that only recorded its successes would report 100%
    // through a complete outage.
    const written = rows.slice(before);
    expect(written.some((row) => row.outcome === 'down')).toBe(true);
  });

  it('derives a dependency with no recent traffic as unknown rather than healthy', async () => {
    const stripe = assertDefined(PROBE_TARGETS.find((target) => target.key === 'stripe'));
    expect(stripe.method).toBe('derived');

    const result = await probeOne(stripe, unreachable);

    // Nothing asked Stripe anything, so nothing has been learned. Reporting "up" here would be the
    // connector failure mode: success claimed where nothing happened. `unknown` is distinct from
    // `disabled` — one means we cannot tell, the other means someone switched it off.
    expect(result.outcome).toBe('unknown');
    expect(result.reason).toBe('no_recent_activity');
  });

  it('probes no third party with a credential', () => {
    // Every dependency is derived from our own ledgers, so this module holds no provider secret
    // and issues no authenticated third-party request.
    for (const target of PROBE_TARGETS.filter((entry) => entry.kind === 'dependency')) {
      expect(target.method).toBe('derived');
      expect(target.url).toBeUndefined();
    }
  });
});
