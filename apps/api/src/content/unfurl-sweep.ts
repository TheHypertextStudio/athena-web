/**
 * Resolve the metadata of resources someone has referenced, off the write path.
 *
 * @remarks
 * Writing a description must never wait on Google or on an arbitrary web server, so
 * `reconcileMentions` creates resource rows in `pending` and this sweep fills them in. A chip
 * therefore appears instantly with the label its author typed, and gains its real title, icon, and
 * preview a beat later.
 *
 * The lease lives on the row rather than in a jobs table, because one row *is* one URL *is* one
 * unfurl job — dedupe is structural instead of a convention someone has to remember. Backoff
 * mirrors the search index sweep so the two behave alike under a failing dependency.
 */
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Unfurler } from '@docket/integrations';
import { resourceProviderById } from '@docket/types';

import { enqueueSearchUpsert } from '../search/write-through';

/** How many rows one sweep pass claims. Bounded so a backlog drains steadily rather than in bursts. */
const BATCH = 25;

/** Give up after this many attempts; a URL that has failed five times is not about to succeed. */
const MAX_ATTEMPTS = 5;

/** How long a claimed row stays claimed before another worker may reclaim it. */
const LEASE_MS = 60_000;

/** How long resolved metadata is trusted before it is worth refetching. */
const FRESH_MS = 24 * 60 * 60 * 1000;

/** Exponential backoff, capped, matching `search/process-jobs.ts`. */
function backoffMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
}

/** Outcome counts for one sweep pass, returned so the cron response is inspectable. */
export interface UnfurlSweepResult {
  readonly claimed: number;
  readonly resolved: number;
  readonly failed: number;
}

/**
 * Claim and resolve a batch of pending resources.
 *
 * @param unfurler - The outbound boundary; the mock double in local and test runs.
 * @param now - The clock, injected so tests need no real timers.
 * @returns What the pass did.
 */
export async function sweepResourceUnfurls(
  unfurler: Unfurler,
  now: Date = new Date(),
): Promise<UnfurlSweepResult> {
  const schema = await import('@docket/db');
  const leaseToken = `lease_${now.getTime()}_${Math.floor(now.getTime() % 100000)}`;

  // Claim in one statement so two workers cannot take the same row: the UPDATE's WHERE re-checks
  // the lease, and only rows this statement actually changed come back.
  const claimed = await schema.db
    .update(schema.externalResource)
    .set({
      unfurlLeaseToken: leaseToken,
      unfurlLeaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      unfurlAttempts: sql`${schema.externalResource.unfurlAttempts} + 1`,
    })
    .where(
      and(
        eq(schema.externalResource.unfurlStatus, 'pending'),
        lte(schema.externalResource.unfurlAfter, now),
        or(
          isNull(schema.externalResource.unfurlLeaseExpiresAt),
          lte(schema.externalResource.unfurlLeaseExpiresAt, now),
        ),
        sql`${schema.externalResource.id} in (
          select id from ${schema.externalResource}
          where unfurl_status = 'pending' and unfurl_after <= ${now}
          order by unfurl_after asc
          limit ${BATCH}
        )`,
      ),
    )
    .returning();

  let resolved = 0;
  let failed = 0;

  for (const row of claimed) {
    // A source that needs a credential is resolved through its own API, never fetched over plain
    // HTTP: an unauthenticated GET of a Drive, SharePoint, or Notion URL returns that product's
    // sign-in page, which would title every such file "Sign in". The registry declares which
    // sources those are, so this stays true as sources are added.
    const definition = row.provider === 'web' ? undefined : resourceProviderById(row.provider);
    if (definition?.resolution === 'credentialed') {
      await schema.db
        .update(schema.externalResource)
        .set({
          unfurlStatus: 'requires_connection',
          unfurlLeaseToken: null,
          unfurlLeaseExpiresAt: null,
          fetchedAt: now,
        })
        .where(eq(schema.externalResource.id, row.id));
      continue;
    }

    const outcome = await unfurler.unfurl(row.canonicalUrl);
    if (outcome.status === 'ok') {
      resolved += 1;
      await schema.db
        .update(schema.externalResource)
        .set({
          unfurlStatus: 'ok',
          title: outcome.metadata.title ?? null,
          description: outcome.metadata.description ?? null,
          siteName: outcome.metadata.siteName ?? null,
          iconUrl: outcome.metadata.iconUrl ?? null,
          thumbnailUrl: outcome.metadata.thumbnailUrl ?? null,
          resourceType: outcome.metadata.resourceType,
          unfurlError: null,
          unfurlLeaseToken: null,
          unfurlLeaseExpiresAt: null,
          fetchedAt: now,
          staleAfter: new Date(now.getTime() + FRESH_MS),
        })
        .where(eq(schema.externalResource.id, row.id));
      continue;
    }

    failed += 1;
    const exhausted = outcome.status === 'unsupported' || row.unfurlAttempts >= MAX_ATTEMPTS;
    await schema.db
      .update(schema.externalResource)
      .set({
        unfurlStatus: exhausted
          ? outcome.status === 'unsupported'
            ? 'unsupported'
            : 'failed'
          : 'pending',
        unfurlError: outcome.status === 'failed' ? outcome.reason : 'unsupported',
        unfurlAfter: new Date(now.getTime() + backoffMs(row.unfurlAttempts)),
        unfurlLeaseToken: null,
        unfurlLeaseExpiresAt: null,
      })
      .where(eq(schema.externalResource.id, row.id));
  }

  // Every claimed row was rewritten by one of the branches above — resolved, deferred to a
  // connection, or failed — so the search index needs all of them, not just the successes. This is
  // what puts a referenced resource in the Library and the command palette at all: rows are
  // created here in `pending` by `reconcileMentions`, and this sweep is the first moment they have
  // settled enough to project. Announcing after the loop rather than inside each branch means a
  // future branch cannot forget to.
  // Concurrently, bounded by BATCH: each publish re-reads its own row through the projector, so
  // awaiting them one at a time made a 25-row pass 25 sequential round trips for no ordering gain.
  await Promise.all(
    claimed.map((row) => enqueueSearchUpsert(row.organizationId, 'external_resource', row.id)),
  );

  return { claimed: claimed.length, resolved, failed };
}
