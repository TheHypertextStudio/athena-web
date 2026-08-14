/**
 * `@docket/api` — reconciling one person's narrated day.
 *
 * @remarks
 * {@link reconcileDay} is the single operation that makes a day current, and every caller — the cron
 * sweep, the HTTP read, the agent tool — invokes exactly this. Having one is the point: three
 * mechanisms for "make the day fresh" would drift into three answers to "what did I do", and the
 * whole feature rests on there being one.
 *
 * The sweep awaits it; the two reads reach it through {@link refreshDayInBackground}, which fires it
 * without making the reader wait. That indirection is what lets a read cause the day to be built
 * without a GET taking a lease or binding its latency to how fast Gmail answers.
 *
 * It runs in four phases, deliberately ordered cheapest-and-most-reliable first:
 *
 * 1. **Pull.** Ask every connected source for the window. Idempotent by `dedupeKey`.
 * 2. **Group.** Divide the day's events into episodes with the shared grouping, so the server and
 *    the client cannot disagree about what one story is.
 * 3. **Persist.** Upsert one row per episode, keyed `(day, episodeKey)`. These are facts, they are
 *    cheap, and they essentially cannot fail.
 * 4. **Narrate.** Fill in the sentences for episodes that have none.
 *
 * Splitting 3 from 4 is what makes a model outage survivable: narration is an expensive call to
 * something that fails on its own schedule, so a failure there degrades a day's *prose* while its
 * *record* stands, and a retry costs one call rather than the whole day. It is also why narration is
 * claimed with a conditional update — two concurrent reconciles converge on the episodes without
 * both paying for the same sentences.
 *
 * `now` is always passed in.
 */
import { activityDay, activityHighlight, db, event, hub } from '@docket/db';
import type { ActorRef, DigestStats, EntityRef } from '@docket/db';
import type { NarrationEpisode } from '@docket/agent-runtime';
import type { CanonicalEntityKind, EventDetail, EventKind, SourceSystemKind } from '@docket/types';
import { groupSubjectDayEpisodes } from '@docket/types';
import { and, asc, eq, gte, isNull, lt, or } from 'drizzle-orm';

import { getContainer } from '../../container';
import { ConflictError } from '../../error';
import {
  isFutureLocalDate,
  localDayFor,
  localDayStartOf,
  nextLocalDayStart,
} from '../../lib/activity/local-day';
import { pullActivityForUser } from '../../lib/activity/sweep';

/**
 * The most episodes narrated in one pass.
 *
 * @remarks
 * A ceiling on the prompt, not on the day. Episodes beyond it keep their `pending` narration state
 * and are picked up by the next pass, so a very busy day ends up fully narrated across a few runs
 * rather than silently truncated in one.
 */
export const MAX_NARRATED_EPISODES = 40;

/** Nominal day length, used only as the fallback when a date cannot be parsed at all. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a highlight may sit in `generating` before another pass may take it back.
 *
 * @remarks
 * Narration claims rows by flipping them to `generating`, which is what stops two concurrent passes
 * paying for the same sentences. Without a reclaim window that claim is permanent: a process killed
 * between the claim and the write leaves its rows `generating` forever, no later pass ever picks them
 * up, and the client polls a day that will never finish. Ten minutes is comfortably longer than a
 * narration call and short enough that a crash costs one cron tick, not a day.
 */
const NARRATION_RECLAIM_MS = 10 * 60 * 1000;

/** One day's worth of event columns, wide enough to group by subject. */
interface DayEventRow {
  readonly id: string;
  readonly organizationId: string;
  readonly sourceSystem: SourceSystemKind;
  readonly kind: EventKind;
  readonly occurredAt: Date;
  readonly title: string;
  readonly summary: string | null;
  readonly actor: ActorRef | null;
  readonly entity: EntityRef | null;
  readonly entityKind: CanonicalEntityKind | null;
  readonly entityAssociation: 'pending' | 'matched' | 'unmatched';
  readonly docketEntityId: string | null;
  readonly detail: EventDetail | null;
}

/** What one reconcile did. */
export interface ReconcileDayResult {
  /** The narrated day's id. */
  readonly activityDayId: string;
  /** Canonical events the day was built from. */
  readonly eventCount: number;
  /** Episodes the day now has. */
  readonly episodeCount: number;
  /** Episodes narrated by this pass (others were already narrated, or are deferred). */
  readonly narrated: number;
  /** Episodes whose narration failed; their records stand and a later pass may retry. */
  readonly narrationFailed: number;
  /** Whether the day has no activity at all. */
  readonly empty: boolean;
}

/** The person's timezone, defaulting to UTC exactly as the digest sweep does. */
async function timezoneFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ preferences: hub.preferences })
    .from(hub)
    .where(eq(hub.userId, userId))
    .limit(1);
  return row?.preferences.timezone ?? 'UTC';
}

/** Per-source and per-kind counts for the day. */
function buildStats(rows: readonly DayEventRow[]): DigestStats {
  const bySource: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const row of rows) {
    bySource[row.sourceSystem] = (bySource[row.sourceSystem] ?? 0) + 1;
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  }
  return { total: rows.length, bySource, byKind };
}

/** Ensure the day row exists and return its id, without disturbing an existing one. */
async function ensureDayRow(userId: string, localDate: string, timezone: string): Promise<string> {
  const [claimed] = await db
    .insert(activityDay)
    .values({ userId, localDate, timezone, status: 'reconciling' })
    .onConflictDoNothing({ target: [activityDay.userId, activityDay.localDate] })
    .returning({ id: activityDay.id });
  if (claimed) return claimed.id;

  const [existing] = await db
    .select({ id: activityDay.id })
    .from(activityDay)
    .where(and(eq(activityDay.userId, userId), eq(activityDay.localDate, localDate)))
    .limit(1);
  /* v8 ignore next -- the unique index means the row exists once the insert conflicted */
  if (!existing) throw new Error('activity_day row vanished between insert and read');
  return existing.id;
}

/** Read the day's canonical events, oldest first. */
async function readDayEvents(userId: string, from: Date, to: Date): Promise<DayEventRow[]> {
  return db
    .select({
      id: event.id,
      organizationId: event.organizationId,
      sourceSystem: event.sourceSystem,
      kind: event.kind,
      occurredAt: event.occurredAt,
      title: event.title,
      summary: event.summary,
      actor: event.actor,
      entity: event.entity,
      entityKind: event.entityKind,
      entityAssociation: event.entityAssociation,
      docketEntityId: event.docketEntityId,
      detail: event.detail,
    })
    .from(event)
    .where(and(eq(event.userId, userId), gte(event.occurredAt, from), lt(event.occurredAt, to)))
    .orderBy(asc(event.occurredAt));
}

/** Project an event row onto the shared grouping contract, carrying prompt fields through. */
function toEpisodeEvent(row: DayEventRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    system: row.sourceSystem,
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    entityKind: row.entityKind,
    entityExternalId: row.entity?.externalId ?? null,
    entityDocketId: row.docketEntityId,
    actorDocketId: row.actor?.docketActorId ?? null,
    actorSource: row.actor?.source ?? null,
    actorExternalId: row.actor?.externalId ?? null,
    actorName: row.actor?.displayName ?? null,
    detail: row.detail,
    // Carried for persistence and the prompt, so neither needs a second read.
    title: row.title,
    summary: row.summary,
    entityTitle: row.entity?.title ?? null,
    entityAssociation: row.entityAssociation,
  };
}

/** Upsert one row per episode, leaving any existing narration and curation untouched. */
async function persistEpisodes(
  activityDayId: string,
  rows: readonly DayEventRow[],
  localDate: string,
): Promise<number> {
  const episodes = groupSubjectDayEpisodes(rows.map(toEpisodeEvent), localDate);
  if (episodes.length === 0) return 0;

  for (const [index, episode] of episodes.entries()) {
    const events = episode.allEvents;
    const first = events[0];
    const last = events[events.length - 1];
    /* v8 ignore next -- an episode always has at least one event */
    if (!first || !last) continue;
    await db
      .insert(activityHighlight)
      .values({
        activityDayId,
        episodeKey: episode.key,
        sort: index,
        occurredAt: new Date(first.occurredAt),
        endedAt: new Date(last.occurredAt),
        sourceSystem: first.system,
        entityKind: first.entityKind,
        docketEntityId: first.entityDocketId,
        entityAssociation: first.entityAssociation,
        subjectTitle: first.entityTitle ?? first.title,
        eventIds: events.map((e) => e.id),
        narrationState: 'pending',
      })
      // An episode that already exists is *extended*, never replaced: its narration is the person's
      // to keep or rewrite, and a later-arriving event must not silently discard their edit. Only
      // the derived facts move.
      .onConflictDoUpdate({
        target: [activityHighlight.activityDayId, activityHighlight.episodeKey],
        set: {
          sort: index,
          endedAt: new Date(last.occurredAt),
          eventIds: events.map((e) => e.id),
          entityAssociation: first.entityAssociation,
          docketEntityId: first.entityDocketId,
          subjectTitle: first.entityTitle ?? first.title,
        },
      });
  }
  return episodes.length;
}

/** Build the narration input for the episodes this pass claimed. */
function toNarrationEpisodes(
  claimed: readonly {
    id: string;
    episodeKey: string;
    sourceSystem: string;
    subjectTitle: string | null;
    occurredAt: Date;
    endedAt: Date;
    eventIds: string[];
  }[],
  byId: Map<string, DayEventRow>,
): NarrationEpisode[] {
  return claimed.map((row) => ({
    key: row.episodeKey,
    provider: row.sourceSystem,
    ...(row.subjectTitle ? { subject: row.subjectTitle } : {}),
    startedAt: row.occurredAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    events: row.eventIds.flatMap((id) => {
      const found = byId.get(id);
      if (!found) return [];
      return [
        {
          kind: found.kind,
          occurredAt: found.occurredAt.toISOString(),
          title: found.title,
          ...(found.summary ? { summary: found.summary } : {}),
          ...(found.actor?.displayName ? { actor: found.actor.displayName } : {}),
        },
      ];
    }),
  }));
}

/**
 * Make one person's day current: pull, group, persist, then narrate whatever has no sentence yet.
 *
 * @remarks
 * Safe to call repeatedly and from anywhere. Provider failures are recorded by the leased sync spine
 * rather than thrown at the caller, so a broken source degrades that source and not the day.
 *
 * @param userId - The Hub owner whose day this is.
 * @param localDate - The local calendar day (`YYYY-MM-DD`), or omitted for the day `now` falls in.
 * @param now - The reference time.
 * @returns what the reconcile produced.
 */
export async function reconcileDay(
  userId: string,
  localDate: string | undefined,
  now: Date,
): Promise<ReconcileDayResult> {
  const timezone = await timezoneFor(userId);
  const today = localDayFor(now, timezone);
  const date = localDate ?? today.localDate;
  // A day that has not begun cannot be reconciled: doing so would persist an `empty` record for it.
  if (isFutureLocalDate(date, now, timezone)) {
    throw new ConflictError('That day has not happened yet.', 'validation_error');
  }
  const dayStart = localDayStartOf(date, timezone) ?? today.startsAt;
  // The next local midnight, not `start + 24h`: a local day is 23 or 25 hours long on the two DST
  // transition days a year, so a fixed duration drops an hour of work on the short one and files the
  // next day's first hour under this date on the long one.
  const nextMidnight = nextLocalDayStart(date, timezone);
  // A past day is read whole; today stops at `now`, because a day still happening has no end yet.
  const dayEnd = new Date(
    Math.min((nextMidnight ?? new Date(dayStart.getTime() + DAY_MS)).getTime(), now.getTime()),
  );

  const activityDayId = await ensureDayRow(userId, date, timezone);

  // Only the current day is worth asking providers about — a finished day cannot gain activity, and
  // polling for one would spend quota re-reading history that is already recorded.
  if (date === today.localDate) await pullActivityForUser(userId, now);

  const rows = await readDayEvents(userId, dayStart, dayEnd);
  const stats = buildStats(rows);

  if (rows.length === 0) {
    await db
      .update(activityDay)
      .set({ status: 'empty', eventCount: 0, stats, reconciledAt: now, lastError: null })
      .where(eq(activityDay.id, activityDayId));
    return {
      activityDayId,
      eventCount: 0,
      episodeCount: 0,
      narrated: 0,
      narrationFailed: 0,
      empty: true,
    };
  }

  const episodeCount = await persistEpisodes(activityDayId, rows, date);

  // Claim the un-narrated episodes atomically, so two concurrent reconciles split the work instead
  // of both paying for the same sentences. A row already `generating` is claimable again once its
  // claim has gone stale, which is what keeps a crash mid-narration from stranding it: `updatedAt` is
  // stamped by the claim itself, so it is exactly when the claim was taken. Deliberately not
  // `updatedAt`: the episode upsert above touches every row on every reconcile, so `updatedAt` would
  // be refreshed moments before this runs and no claim would ever look stale.
  const reclaimBefore = new Date(now.getTime() - NARRATION_RECLAIM_MS);
  const claimed = await db
    .update(activityHighlight)
    .set({ narrationState: 'generating', narrationClaimedAt: now })
    .where(
      and(
        eq(activityHighlight.activityDayId, activityDayId),
        or(
          eq(activityHighlight.narrationState, 'pending'),
          and(
            eq(activityHighlight.narrationState, 'generating'),
            // A claim with no timestamp predates this column, so it is by definition old enough.
            or(
              isNull(activityHighlight.narrationClaimedAt),
              lt(activityHighlight.narrationClaimedAt, reclaimBefore),
            ),
          ),
        ),
      ),
    )
    .returning({
      id: activityHighlight.id,
      episodeKey: activityHighlight.episodeKey,
      sourceSystem: activityHighlight.sourceSystem,
      subjectTitle: activityHighlight.subjectTitle,
      occurredAt: activityHighlight.occurredAt,
      endedAt: activityHighlight.endedAt,
      eventIds: activityHighlight.eventIds,
    });

  const batch = claimed.slice(0, MAX_NARRATED_EPISODES);
  // Anything over the ceiling goes back to `pending` rather than staying claimed, so the next pass
  // picks it up instead of it sitting in `generating` forever.
  for (const deferred of claimed.slice(MAX_NARRATED_EPISODES)) {
    await db
      .update(activityHighlight)
      .set({ narrationState: 'pending' })
      .where(eq(activityHighlight.id, deferred.id));
  }

  let narrated = 0;
  let narrationFailed = 0;
  if (batch.length > 0) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const dateLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(dayStart);

    try {
      const { summarizer } = getContainer();
      const { highlights } = await summarizer.narrateDay({
        dateLabel,
        episodes: toNarrationEpisodes(batch, byId),
      });
      const sentences = new Map(highlights.map((h) => [h.key, h.sentence]));
      for (const row of batch) {
        const sentence = sentences.get(row.episodeKey);
        await db
          .update(activityHighlight)
          .set(
            sentence === undefined
              ? { narrationState: 'failed' }
              : { narrationState: 'ready', narration: sentence },
          )
          .where(eq(activityHighlight.id, row.id));
        if (sentence === undefined) narrationFailed += 1;
        else narrated += 1;
      }
    } catch (err) {
      // The record stands; only the prose is missing. Marking the rows `failed` rather than leaving
      // them `generating` is what makes the state honest and the retry possible.
      narrationFailed = batch.length;
      const message = err instanceof Error ? err.message : 'narration error';
      for (const row of batch) {
        await db
          .update(activityHighlight)
          .set({ narrationState: 'failed' })
          .where(eq(activityHighlight.id, row.id));
      }
      await db
        .update(activityDay)
        .set({ lastError: message })
        .where(eq(activityDay.id, activityDayId));
    }
  }

  await db
    .update(activityDay)
    .set({
      status: 'ready',
      eventCount: rows.length,
      stats,
      reconciledAt: now,
      ...(narrationFailed === 0 ? { narratedAt: now, lastError: null } : {}),
    })
    .where(eq(activityDay.id, activityDayId));

  return {
    activityDayId,
    eventCount: rows.length,
    episodeCount,
    narrated,
    narrationFailed,
    empty: false,
  };
}

/**
 * Days currently being reconciled by this process, keyed `userId:localDate`.
 *
 * @remarks
 * In-process only, and deliberately so: it is not a lock, and correctness does not depend on it —
 * `ensureDayRow` upserts and the narration claim is atomic, so two workers racing is already safe.
 * What this prevents is waste. The client polls every four seconds while narration is in flight, and
 * without it each poll would start another reconcile of the same day.
 */
const refreshing = new Set<string>();

/**
 * Bring a day up to date behind a read, without making the reader wait for it.
 *
 * @remarks
 * Reads report state and cause no work — that separation is what stops a GET taking a lease, writing
 * rows, and binding its latency to how fast Gmail answers. But something has to build the day, and
 * until this existed the only production caller of {@link reconcileDay} was the digest sweep, which
 * selects Hubs with `digest.enabled = 'true'`. For everyone else the poll kept writing events that
 * nothing ever grouped, and every surface reported `pending` forever.
 *
 * Firing it from the read makes the cost proportional to use rather than to user count: a day is
 * built because somebody looked, not because a cron narrated it for an account nobody opened. The
 * caller is told nothing about it and awaits nothing; the response describes the day as it stands,
 * and the client already re-reads while `generating`.
 *
 * Failures are logged and swallowed. A refresh that could not run is a stale day, which the payload
 * can already say honestly — it is not a reason to fail the read that triggered it.
 *
 * @param userId - The Hub owner whose day to refresh.
 * @param localDate - The local calendar day (`YYYY-MM-DD`).
 * @param now - The reference time.
 */
export function refreshDayInBackground(userId: string, localDate: string, now: Date): void {
  const key = `${userId}:${localDate}`;
  if (refreshing.has(key)) return;
  refreshing.add(key);
  void reconcileDay(userId, localDate, now)
    .catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          event: 'activity_background_refresh_failed',
          localDate,
          message: err instanceof Error ? err.message : 'unknown',
        }),
      );
    })
    .finally(() => refreshing.delete(key));
}
