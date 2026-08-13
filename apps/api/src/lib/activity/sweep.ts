/**
 * `@docket/api` — the activity poll: go and ask every connected tool what the person did.
 *
 * @remarks
 * The counterpart to the webhook drain. Where `sweepInboundEvents` drains events that arrived,
 * this one fetches events that never will, for the sources that expose no webhook — which, before
 * it existed, meant a person whose day lived in mail and calendar had an empty activity log.
 *
 * **Why a cron sweep rather than a queue.** This is periodic, fan-out, IO-bound, per-user,
 * retryable work — textbook queue material, and `apps/runner` already has queues and Workflows. The
 * sweep is still the right choice: seventeen jobs already work this way, and a second execution
 * model for one feature costs more in divergence than the batch cap costs in throughput. If the
 * per-user fan-out ever outgrows one tick, the honest fix is to move *all* the sweeps, not to make
 * this one special.
 *
 * Provider-backed pulls ride {@link runLeasedSync} unchanged, which is where every reliability
 * property comes from for free: the lease serializes overlapping ticks, the `sync_run` row records
 * the attempt, a token failure flips the integration to `error` and notifies its owner, and a
 * provider outage is persisted rather than swallowed.
 */
import { actor, calendarConnection, db, hub, integration, organization, syncRun } from '@docket/db';
import type { ActivitySource } from '@docket/integrations';
import { ACTIVITY_PROVIDER_IDS } from '@docket/types';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';

import { writeEventDrafts, type DraftWriteTally } from '../../events/write-drafts';
import { connectorFor } from '../../routes/integration-provider';
import { runLeasedSync } from '../../routes/integration-sync';
import { calendarActivitySource } from './calendar-activity-source';
import { localDayFor } from './local-day';

/** How often one integration's activity is re-polled. */
export const ACTIVITY_PULL_CADENCE_MINUTES = 30;

/** The most drafts one source contributes to a single pull. */
export const MAX_ACTIVITY_DRAFTS = 200;

/**
 * The shortest window a pull will ever ask for, regardless of where the local day began.
 *
 * @remarks
 * Not a nicety — without it the poll has a hole. Just after local midnight the day-so-far is minutes
 * wide, so a pull would ask a provider about almost nothing; and because these searches are
 * eventually consistent, something a person did at 23:50 may only become findable at 00:05, by which
 * time a day-bounded window has already moved past it. That activity would then never be pulled by
 * anything, and the day it belonged to would be quietly incomplete forever.
 *
 * Over-fetching costs nothing: `dedupeKey` makes the overlap free, and the *read* side filters by
 * day, so a wider pull cannot put activity in the wrong day.
 */
export const MIN_ACTIVITY_LOOKBACK_MS = 26 * 60 * 60 * 1000;

/** The window one pull should ask about: the local day so far, widened to the minimum lookback. */
function pullWindow(now: Date, dayStart: Date): { since: string; until: string } {
  const floor = new Date(now.getTime() - MIN_ACTIVITY_LOOKBACK_MS);
  const since = dayStart.getTime() < floor.getTime() ? dayStart : floor;
  return { since: since.toISOString(), until: now.toISOString() };
}

/** Integrations examined in one sweep, so a large tenant cannot starve the tick. */
const SWEEP_BATCH_LIMIT = 50;

/** What one activity sweep did. */
export interface ActivitySweepResult {
  /** Provider-backed pulls attempted. */
  readonly integrations: number;
  /** People whose calendars were projected. */
  readonly users: number;
  /** Drafts produced across every source. */
  readonly drafts: number;
  /** Canonical events created (duplicates excluded). */
  readonly events: number;
  /** Recipient rows written. */
  readonly recipients: number;
  /** Pulls that failed. The failure is recorded on the run and the integration too. */
  readonly failed: number;
  /** Pulls that hit {@link MAX_ACTIVITY_DRAFTS}, so the window was not fully read. */
  readonly truncated: number;
}

const EMPTY: ActivitySweepResult = {
  integrations: 0,
  users: 0,
  drafts: 0,
  events: 0,
  recipients: 0,
  failed: 0,
  truncated: 0,
};

/** Add two results, so per-source work can be accumulated without mutable bookkeeping. */
function merge(
  left: ActivitySweepResult,
  right: Partial<ActivitySweepResult>,
): ActivitySweepResult {
  return {
    integrations: left.integrations + (right.integrations ?? 0),
    users: left.users + (right.users ?? 0),
    drafts: left.drafts + (right.drafts ?? 0),
    events: left.events + (right.events ?? 0),
    recipients: left.recipients + (right.recipients ?? 0),
    failed: left.failed + (right.failed ?? 0),
    truncated: left.truncated + (right.truncated ?? 0),
  };
}

/** One integration eligible for an activity pull. */
type IntegrationRow = typeof integration.$inferSelect;

/** The person's timezone, defaulting to UTC exactly as the digest sweep does. */
async function timezoneFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ preferences: hub.preferences })
    .from(hub)
    .where(eq(hub.userId, userId))
    .limit(1);
  return row?.preferences.timezone ?? 'UTC';
}

/**
 * When each integration last ran an activity pull.
 *
 * @remarks
 * Deliberately *not* `integration.lastSyncedAt`. That column is stamped by `finishSuccess` for
 * every purpose, so a task mirror or a mail ingest advances it too — using it here would let an
 * unrelated sync suppress the activity poll for half an hour, and the resulting gap would look like
 * a quiet day rather than a missed one. The `sync_run` history is the only per-purpose record, and
 * `sync_run_integration_idx` on `(integration_id, started_at)` already serves this.
 */
export async function lastActivityPullAt(
  integrationIds: readonly string[],
): Promise<Map<string, Date>> {
  if (integrationIds.length === 0) return new Map();
  const rows = await db
    .select({ integrationId: syncRun.integrationId, startedAt: syncRun.startedAt })
    .from(syncRun)
    .where(
      and(
        inArray(syncRun.integrationId, [...integrationIds]),
        eq(syncRun.purpose, 'activity_pull'),
      ),
    )
    .orderBy(desc(syncRun.startedAt));
  // Newest first, so the first row seen for an integration is its latest run. Deliberately not a
  // `max()` aggregate: drivers disagree about whether an aggregated timestamp comes back as a Date
  // or a string, and a silently-stringified value here would disable the cadence gate rather than
  // fail — the poll would hammer every provider on every tick and nothing would look wrong.
  const byId = new Map<string, Date>();
  for (const row of rows) {
    if (!byId.has(row.integrationId)) byId.set(row.integrationId, row.startedAt);
  }
  return byId;
}

/** Pull one provider-backed integration under the leased spine. */
async function pullIntegration(
  row: IntegrationRow,
  userId: string,
  now: Date,
): Promise<Partial<ActivitySweepResult>> {
  const window = pullWindow(now, localDayFor(now, await timezoneFor(userId)).startsAt);
  let tally: DraftWriteTally = { events: 0, associated: 0, recipients: 0 };
  let drafts = 0;
  let truncated = 0;

  const run = await runLeasedSync(
    row,
    // `createdBy` is guaranteed by the sweep's own selection.
    { actorId: row.createdBy ?? '', trigger: 'scheduled', purpose: 'activity_pull' },
    async ({ provider, token }) => {
      const source = connectorFor(provider, token).asActivitySource?.();
      // The sweep selected on the catalog's activity flag, so a missing capability here is a wiring
      // bug rather than a provider condition — it must fail loudly, not quietly do nothing.
      if (!source) {
        throw new Error(`${provider} connector exposes no activity-source capability`);
      }
      const pulled = await source.pullActivity({
        connectionId: row.id,
        ...window,
        maxDrafts: MAX_ACTIVITY_DRAFTS,
      });
      drafts = pulled.drafts.length;
      if (pulled.truncated) {
        truncated = 1;
        console.warn(
          JSON.stringify({
            event: 'activity_pull_capped',
            integrationId: row.id,
            provider,
            maxDrafts: MAX_ACTIVITY_DRAFTS,
          }),
        );
      }
      tally = await writeEventDrafts(pulled.drafts, {
        organizationId: row.organizationId,
        userId,
        sourceSystem: source.sourceSystem,
        integrationId: row.id,
        // Poll-sourced: there is no `inbound_event` this came from.
        sourceEventId: null,
      });
      return { processed: tally.events, total: pulled.drafts.length };
    },
  );

  // A null run means another tick holds the lease — not a failure, and not work to count.
  if (run === null) return {};
  return {
    integrations: 1,
    drafts,
    events: tally.events,
    recipients: tally.recipients,
    failed: run.status === 'failed' ? 1 : 0,
    truncated,
  };
}

/** Project one person's attended meetings, which needs no lease and no provider call. */
async function projectCalendar(
  userId: string,
  source: ActivitySource,
  now: Date,
): Promise<Partial<ActivitySweepResult>> {
  const window = pullWindow(now, localDayFor(now, await timezoneFor(userId)).startsAt);
  const pulled = await source.pullActivity({
    // Not an integration; the calendar's own connection rows are the credential boundary.
    connectionId: userId,
    ...window,
    maxDrafts: MAX_ACTIVITY_DRAFTS,
  });
  if (pulled.drafts.length === 0) return { users: 1, truncated: pulled.truncated ? 1 : 0 };

  // A meeting is not org-scoped, but `event` is, so one org has to be chosen. A person's calendar
  // belongs to their personal workspace — the one org that is theirs alone — and the oldest
  // membership is the fallback when they have no personal org.
  //
  // The ordering is the whole point. An unordered `LIMIT 1` let Postgres return whichever actor row
  // it liked, so for anyone in more than one org the choice was arbitrary *and* free to change
  // between ticks. `dedupeKey` is unique per organization, so a flip does not dedupe against the
  // earlier write: the same meeting lands a second time under a different org, in an append-only log
  // that has no correction path. It also put meeting titles and every attendee's email address into
  // a workspace with no claim on them.
  const [row] = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .innerJoin(organization, eq(organization.id, actor.organizationId))
    .where(eq(actor.userId, userId))
    .orderBy(desc(organization.isPersonal), asc(actor.createdAt))
    .limit(1);
  if (!row) return { users: 1 };

  const tally = await writeEventDrafts(pulled.drafts, {
    organizationId: row.organizationId,
    userId,
    sourceSystem: source.sourceSystem,
    // Calendar is not reached through an integration, and saying so plainly is better than
    // borrowing an unrelated one.
    integrationId: null,
    sourceEventId: null,
  });
  return {
    users: 1,
    drafts: pulled.drafts.length,
    events: tally.events,
    recipients: tally.recipients,
    truncated: pulled.truncated ? 1 : 0,
  };
}

/**
 * Pull every activity source for one person, for their local day so far.
 *
 * @remarks
 * The unit the on-demand read uses, so opening the day at three in the afternoon is complete even
 * when the cron is behind. Never throws for a provider condition: each pull records its own outcome
 * durably, so a broken source degrades that source rather than the request.
 *
 * @param userId - The Hub owner to refresh.
 * @param now - The reference time.
 * @returns what the pull produced.
 */
export async function pullActivityForUser(userId: string, now: Date): Promise<ActivitySweepResult> {
  let result = EMPTY;

  const [ownActor] = await db
    .select({ id: actor.id })
    .from(actor)
    .where(eq(actor.userId, userId))
    .limit(1);

  if (ownActor) {
    const rows = await db
      .select()
      .from(integration)
      .where(
        and(
          eq(integration.createdBy, ownActor.id),
          isNull(integration.archivedAt),
          inArray(integration.provider, [...ACTIVITY_PROVIDER_IDS]),
          inArray(integration.status, ['connected', 'error']),
        ),
      );
    for (const row of rows) {
      result = merge(result, await pullIntegration(row, userId, now));
    }
  }

  const [calendar] = await db
    .select({ userId: calendarConnection.userId })
    .from(calendarConnection)
    .where(
      and(eq(calendarConnection.userId, userId), ne(calendarConnection.status, 'disconnected')),
    )
    .limit(1);
  if (calendar) {
    result = merge(result, await projectCalendar(userId, calendarActivitySource(userId), now));
  }

  return result;
}

/**
 * Pull every due activity source across every person.
 *
 * @remarks
 * Selection deliberately **includes** Gmail, unlike `sweepConnectorSync`, which excludes the
 * mail-capable providers because a mailbox is not a task list. A mailbox absolutely is activity —
 * do not "fix" this by aligning the two filters.
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 * @returns the aggregate outcome.
 */
export async function sweepActivitySources(now: Date): Promise<ActivitySweepResult> {
  let result = EMPTY;

  const candidates = await db
    .select({ row: integration, ownerUserId: actor.userId })
    .from(integration)
    .innerJoin(actor, eq(actor.id, integration.createdBy))
    .where(
      and(
        isNull(integration.archivedAt),
        inArray(integration.provider, [...ACTIVITY_PROVIDER_IDS]),
        inArray(integration.status, ['connected', 'error']),
      ),
    )
    .limit(SWEEP_BATCH_LIMIT);

  const lastRun = await lastActivityPullAt(candidates.map((c) => c.row.id));
  const dueBefore = now.getTime() - ACTIVITY_PULL_CADENCE_MINUTES * 60_000;

  for (const candidate of candidates) {
    const last = lastRun.get(candidate.row.id);
    if (last && last.getTime() > dueBefore) continue;
    // An integration whose owning actor has no Better Auth user cannot be attributed to a person,
    // and an event with no `userId` is invisible to the day it belongs to — so skip rather than
    // write a row nothing will ever read.
    if (!candidate.ownerUserId) continue;
    result = merge(result, await pullIntegration(candidate.row, candidate.ownerUserId, now));
  }

  const calendarUsers = await db
    .selectDistinct({ userId: calendarConnection.userId })
    .from(calendarConnection)
    .where(ne(calendarConnection.status, 'disconnected'))
    .limit(SWEEP_BATCH_LIMIT);

  for (const { userId } of calendarUsers) {
    result = merge(result, await projectCalendar(userId, calendarActivitySource(userId), now));
  }

  return result;
}
