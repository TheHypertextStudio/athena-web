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
import { sweepNotionMirror } from './notion-mirror-reconcile';
import { sweepEmailSuggestionLifecycle } from '../lib/email-to-task/lifecycle';
import { sweepCalendarSync } from './calendar-sync-sweep';
import { sweepConnectorSync } from './integration-sync';
import { sweepDayCadence } from './day-cadence-sweep';
import { sweepDirectivePosture } from './directive-sweep';
import { sweepInboundEvents } from './event-sync';
import { sweepDailyDigests } from './daily-digest';
import { sweepLinearAgentSessions } from './linear-agent-sweep';
import { getContainer } from '../container';
import { sweepLegacyMentions } from '../content/legacy-mention-sweep';
import { sweepResourceUnfurls } from '../content/unfurl-sweep';
import { processSearchIndexJobs } from '../search/process-jobs';
import { sweepAthenaAssignmentTriggers } from '../agent/assignments';
import { sweepAgentDelegations } from '../agent/delegation';
import { reapIdleSessions } from '../mcp/session-registry';
import { sweepElicitations } from '../services/elicitation-service';
import { sweepExpiredSessions } from './session-sweep';

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
    const now = new Date();
    const result = await sweepConnectorSync(now);
    // A separate purpose on the same tick: the Notion mirror pushes Docket's work OUT, which is
    // the opposite direction from the connector sweep above and runs on its own leased runs.
    // Reported separately so a failure in one is never hidden by the other's success.
    const notionMirror = await sweepNotionMirror(now);
    return c.json({ swept: true, ...result, notionMirror });
  })
  // Elicitation deadlines: nothing Athena asks may pend forever. A question whose raiser declared
  // a defensible default is answered by Athena with her reasoning recorded; every other overdue
  // question is parked with nothing mutated, and the person is told the work is waiting on them.
  // Idempotent: a settled question is never re-swept.
  .post('/elicitation-deadlines', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepElicitations(new Date());
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
  // Search-index drain: process durable projection jobs produced by entity writes, event-log
  // routing, backfills, and repairs. The worker claims pending rows with status transitions, so a
  // scheduler retry cannot double-apply a projection.
  .post('/search-index', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await processSearchIndexJobs({ limit: 50 });
    return c.json({ swept: true, ...result });
  })
  // Resource-unfurl drain: resolve titles, icons, and previews for URLs someone referenced. Rows
  // are created `pending` by the mention reconciler so a description save never waits on a
  // third-party fetch; the lease lives on the row, so a scheduler retry re-claims rather than
  // duplicating.
  // One-way conversion of prose still holding the shortcode mention form an earlier
  // implementation stored. Idempotent and self-limiting: once no row matches, every tick is a
  // single indexed scan that finds nothing.
  .post('/legacy-mentions', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepLegacyMentions();
    return c.json({ swept: true, ...result });
  })
  .post('/unfurl-resources', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepResourceUnfurls(getContainer().unfurler, new Date());
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
  })
  // Calendar sweep: incrementally re-syncs every connected user's calendars, drains their due
  // provider-write outbox, and registers/renews push-notification watches so push hints keep
  // working. Idempotent + lease-guarded per layer (see `calendar-sync-engine.ts`), so a
  // concurrent manual "Sync Now" and this sweep never double-sync the same layer.
  .post('/sync-calendars', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepCalendarSync(new Date());
    return c.json({ swept: true, ...result });
  })
  // Linear Agent session-run sweep: finds queued (or lease-abandoned) `agent_session_run` rows,
  // drives each session's turn, and relays the resulting activity back to the Linear thread. The
  // generation claim inside `driveSession` is the atomic one, so a concurrent or retried
  // scheduler invocation can never double-drive the same run.
  .post('/run-linear-agent-sessions', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepLinearAgentSessions(new Date());
    return c.json({ swept: true, ...result });
  })
  // Directive-posture sweep: recompute each configured Hub's posture for its local today from
  // the day's blocks vs. the wall clock, and publish resources/updated for the directive
  // resource only when the posture actually changed — an unchanged day rewrites and publishes
  // nothing, so a scheduler retry is a no-op.
  .post('/directive-posture', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepDirectivePosture(new Date());
    return c.json({ swept: true, ...result });
  })
  // Day-cadence sweep: the proactive half of the daily loop. Materializes each configured Hub's
  // check-ins, re-cuts the remainder of a day that has genuinely drifted (subject to that Hub's
  // own `autoReorganizeOnDrift` setting and a cooldown), and fires every check-in that has come
  // due — each exactly once, claimed on `fired_at IS NULL`. A pass over a healthy day writes
  // nothing and notifies nobody, so a scheduler retry is a no-op.
  .post('/day-cadence', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const result = await sweepDayCadence(new Date());
    return c.json({ swept: true, ...result });
  })
  // User-owned Athena schedules are assignment-scoped, five-minute minimum, and re-authorize the
  // persisted owner before every run. The row claim and cooldown make scheduler retries harmless.
  .post('/athena-triggers', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const now = new Date();
    const result = await sweepAthenaAssignmentTriggers(now);
    // The other half of standing Athena, on the same tick: agent-assigned tasks are handed to an
    // execution surface and finished work comes back as a gated proposal. A separate purpose from
    // the trigger sweep above, so it is reported separately and a failure in one is never hidden
    // by the other's success. Every step is claimed in the database, so a retried tick is a no-op.
    const delegations = await sweepAgentDelegations(now);
    return c.json({ swept: true, ...result, delegations });
  })
  // Expired-session sweep: deletes every `session` row past its `expiresAt` — Better Auth itself
  // only prunes a row lazily (when that exact expired cookie comes back), so an abandoned browser
  // profile's row would otherwise sit in the table forever. Plain stateless delete, safe to retry.
  .post('/expired-sessions-sweep', async (c) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    const now = new Date();
    const result = await sweepExpiredSessions(now);
    // MCP sessions reap on the same tick. They are request-driven and never expire on their own,
    // so without this `mcp_session` and its subscriptions grow for the life of the deployment.
    const mcpSessions = await reapIdleSessions(now);
    return c.json({ swept: true, ...result, mcpSessions });
  });

export default cron;
