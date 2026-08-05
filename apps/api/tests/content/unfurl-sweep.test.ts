import { eq } from 'drizzle-orm';
import { MockUnfurler, type Unfurler } from '@docket/integrations';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { sweepResourceUnfurls } from '../../src/content/unfurl-sweep';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema: typeof DbModule;
let db: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedPending(
  orgId: string,
  canonicalUrl: string,
  provider: 'web' | 'google_drive' = 'web',
): Promise<string> {
  const row = one(
    await db
      .insert(schema.externalResource)
      .values({
        organizationId: orgId,
        provider,
        canonicalKey: `${provider}:${canonicalUrl}`,
        canonicalUrl,
        resourceType: 'unknown',
        // Explicit rather than defaulted: the column defaults to the database's own `now()`, which
        // is later than the fixed clock these tests sweep with, so a defaulted row would never be
        // due and every assertion would vacuously see zero claims.
        unfurlAfter: new Date('2026-01-01T00:00:00Z'),
      })
      .returning({ id: schema.externalResource.id }),
  );
  return row.id;
}

async function load(id: string) {
  return one(
    await db.select().from(schema.externalResource).where(eq(schema.externalResource.id, id)),
  );
}

/** An unfurler that always fails, for exercising the retry and give-up paths. */
const alwaysFails: Unfurler = {
  unfurl: () => Promise.resolve({ status: 'failed', reason: 'http_503' }),
};

/** An unfurler that refuses the URL outright. */
const unsupported: Unfurler = {
  unfurl: () => Promise.resolve({ status: 'unsupported' }),
};

describe('sweepResourceUnfurls', () => {
  it('resolves a pending web resource and stamps its freshness window', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const id = await seedPending(orgId, 'https://example.com/handbook/onboarding');

    const now = new Date('2026-08-04T12:00:00Z');
    const result = await sweepResourceUnfurls(new MockUnfurler(), now);
    expect(result.resolved).toBeGreaterThanOrEqual(1);

    const row = await load(id);
    expect(row.unfurlStatus).toBe('ok');
    expect(row.title).toBe('onboarding (example.com)');
    expect(row.siteName).toBe('example.com');
    expect(row.fetchedAt).toEqual(now);
    expect(row.staleAfter?.getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1000);
    // The lease must be surrendered, or the row is stuck until it expires.
    expect(row.unfurlLeaseToken).toBeNull();
  });

  it('never fetches a provider-owned URL over plain HTTP', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const id = await seedPending(
      orgId,
      'https://docs.google.com/document/d/sweepDoc/edit',
      'google_drive',
    );

    const exploding: Unfurler = {
      unfurl: () => {
        throw new Error('a provider URL must not reach the generic unfurler');
      },
    };
    await sweepResourceUnfurls(exploding, new Date('2026-08-04T12:00:00Z'));

    const row = await load(id);
    expect(row.unfurlStatus).toBe('requires_connection');
    // Critically, no fabricated title. A blind fetch here would have stored "Sign in - Google".
    expect(row.title).toBeNull();
  });

  it('leaves a failed row pending with backoff so it retries later', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const now = new Date('2026-08-04T12:00:00Z');
    const id = await seedPending(orgId, 'https://flaky.example.com/one');

    await sweepResourceUnfurls(alwaysFails, now);

    const row = await load(id);
    expect(row.unfurlStatus).toBe('pending');
    expect(row.unfurlAttempts).toBe(1);
    expect(row.unfurlError).toBe('http_503');
    expect(row.unfurlAfter.getTime()).toBeGreaterThan(now.getTime());
  });

  it('gives up on a URL it will never be able to parse', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const id = await seedPending(orgId, 'https://example.com/binary-thing');

    await sweepResourceUnfurls(unsupported, new Date('2026-08-04T12:00:00Z'));

    expect((await load(id)).unfurlStatus).toBe('unsupported');
  });

  it('does not re-claim a row it already resolved', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    await seedPending(orgId, 'https://example.com/claim-once');

    const first = await sweepResourceUnfurls(new MockUnfurler(), new Date('2026-08-04T12:00:00Z'));
    const second = await sweepResourceUnfurls(new MockUnfurler(), new Date('2026-08-04T12:00:05Z'));

    expect(first.claimed).toBeGreaterThanOrEqual(1);
    expect(second.claimed).toBeLessThan(first.claimed + 1);
  });
});
