/**
 * `@docket/api` — the lifecycle-sweep cron handler (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * `POST /internal/cron/lifecycle-sweep` runs the idempotent org data-lifecycle sweep
 * ({@link sweepLifecycle}): orgs past their export-window deadline advance
 * `export_window → pending_deletion → deleted`. It is guarded by a shared
 * `CRON_SECRET` bearer (matching the platform scheduler's `Authorization: Bearer …`
 * or an `x-cron-secret` header); a missing/incorrect secret 401s. Non-RPC, so it
 * lives in `server.ts` alongside `/api/auth` rather than the typed app. `now` is read
 * at request time, never at module scope, and the sweep is safe to retry.
 */
import { db } from '@docket/db';
import { Hono } from 'hono';

import { sweepAccountDeletions } from '../account/lifecycle';
import { sweepAccountExports } from '../account/export';
import { env } from '../env';
import { sweepLifecycle } from '../billing/lifecycle';
import { sweepEmailSuggestions } from '../lib/email-to-task/sweep';
import { sweepEmailSuggestionLifecycle } from '../lib/email-to-task/lifecycle';
import { sweepConnectorSync } from './integration-sync';
import { sweepInboundEvents } from './event-sync';
import { sweepDailyDigests } from './daily-digest';

/** Extract the presented cron secret from `Authorization: Bearer …` or `x-cron-secret`. */
function presentedSecret(
  authorization: string | undefined,
  xCronSecret: string | undefined,
): string | undefined {
  if (xCronSecret) return xCronSecret;
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length);
  return undefined;
}

/** Whether the request carries the correct cron secret. */
function authorized(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const presented = presentedSecret(c.req.header('authorization'), c.req.header('x-cron-secret'));
  return Boolean(presented) && presented === env.CRON_SECRET;
}

/** The cron app: secret-guarded, idempotent scheduled sweeps. */
const cron = new Hono()
  .post('/lifecycle-sweep', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const now = new Date();
    const result = await sweepLifecycle(db, now.toISOString());
    // Suggestion expiry/retention rides the same daily tick (transient proposals, not records).
    const suggestions = await sweepEmailSuggestionLifecycle(now);
    return c.json({ swept: true, ...result, suggestions });
  })
  // Background connector mirroring: re-syncs every due `mirror` integration so connectors
  // stay current without a manual click. Idempotent + lease-guarded (see {@link runSync}), so
  // the platform scheduler can call it on a fixed cadence and a failed run records + notifies
  // rather than vanishing.
  .post('/sync-connectors', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepConnectorSync(new Date());
    return c.json({ swept: true, ...result });
  })
  // Email-to-task ingest: pull threads from every opted-in Gmail integration and synthesize
  // task suggestions (funnel → synthesize → persist). Idempotent (one suggestion per thread).
  .post('/email-suggestions', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepEmailSuggestions(new Date());
    return c.json({ swept: true, ...result });
  })
  // Activity-feed drain: normalize received webhook events into canonical events and
  // fan them out to recipients. Idempotent + lease-guarded (see {@link sweepInboundEvents});
  // run on a tight cadence so captured activity surfaces quickly.
  .post('/process-events', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepInboundEvents(new Date());
    return c.json({ swept: true, ...result });
  })
  // Daily-digest sweep: generate + email each opted-in user's end-of-day summary once their
  // local send time passes. The unique (user_id, digest_date) watermark makes this safe to
  // call frequently (send times are per-user/local, so a coarse fixed schedule won't fit all).
  .post('/daily-digests', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepDailyDigests(new Date());
    return c.json({ swept: true, ...result });
  })
  // Account-deletion sweep: hard-delete every account whose 14-day grace window has elapsed,
  // re-checking ownership blockers first so a late sole-owner conflict never orphans a shared
  // org. Idempotent (the rows are gone after a purge), so safe on a fixed daily cadence.
  .post('/account-deletion-sweep', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const now = new Date().toISOString();
    const result = await sweepAccountDeletions(db, now);
    return c.json({ swept: true, ...result });
  })
  // Account-export sweep: generate each pending personal-data export to blob storage, email the
  // download link, and expire artifacts past their TTL. Idempotent + safe to retry (only
  // `pending` jobs are generated, only un-expired `ready` jobs are expired).
  .post('/account-export-sweep', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const now = new Date().toISOString();
    const result = await sweepAccountExports(db, now);
    return c.json({ swept: true, ...result });
  });

export default cron;
