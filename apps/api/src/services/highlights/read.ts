/**
 * `@docket/api` — reading one person's narrated day.
 *
 * @remarks
 * {@link buildHighlightsDayPayload} is the single read both the HTTP route and the agent tool go
 * through, so the app and the assistant can never drift into two answers to "what did I do".
 *
 * It **reports state and never causes work**. Making a day current is {@link reconcileDay}'s job, and
 * keeping the two apart is what stops a read from taking a lease, writing rows, or binding its own
 * latency to how fast Gmail answers today. What the payload gives a caller instead is enough to say
 * something true about freshness: the day's status, whether narration is still in flight, and how
 * each source fared.
 *
 * That last part is the connector-reliability invariant on this surface. Source health is reported as
 * a closed state the app writes its own copy for — never a provider message. A workspace policy test
 * forbids the web app from reading provider diagnostics at all, and the reason is the same one that
 * motivates the enum: a diagnostic is written for an operator, and rendering it to the person whose
 * day is incomplete tells them nothing they can act on.
 */
import {
  activityDay,
  activityHighlight,
  actor,
  calendarConnection,
  db,
  event,
  hub,
  integration,
  syncRun,
} from '@docket/db';
import type { HighlightSourceState, HighlightsDayOut, SourceSystemKind } from '@docket/types';
import { ACTIVITY_PROVIDER_IDS, PROVIDER_CATALOG } from '@docket/types';
import type { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import { ConflictError } from '../../error';
import { toStreamEventOut } from '../../routes/stream-helpers';
import { isFutureLocalDate, localDayFor, localDayStartOf } from '../../lib/activity/local-day';

/** The source systems a narrated day can draw on, and therefore must account for. */
const ACCOUNTABLE_SOURCES: readonly SourceSystemKind[] = [
  // Every polled provider carries a source badge — a capability-manifest test enforces exactly that,
  // because a canonical event with no badge could not be attributed to anything.
  ...ACTIVITY_PROVIDER_IDS.map((id) => PROVIDER_CATALOG[id].sourceSystem),
  'google_calendar',
];

/** The person's timezone, defaulting to UTC exactly as the sweeps do. */
async function timezoneFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ preferences: hub.preferences })
    .from(hub)
    .where(eq(hub.userId, userId))
    .limit(1);
  return row?.preferences.timezone ?? 'UTC';
}

/** Decide one source's state from its connection and its last successful read. */
function stateFor(input: {
  readonly connected: boolean;
  readonly disconnected: boolean;
  readonly lastReadAt: Date | null;
  readonly failing: boolean;
  readonly dayStart: Date;
}): HighlightSourceState {
  if (input.disconnected) return 'disconnected';
  if (!input.connected) return 'never_connected';
  if (input.failing) return 'failed';
  // Connected and not failing, but never read since the day began: whatever it holds for today has
  // not been looked at, so the day is not yet complete and must not claim to be.
  if (!input.lastReadAt || input.lastReadAt < input.dayStart) return 'stale';
  return 'ok';
}

/**
 * Report how each source contributed to the day.
 *
 * @remarks
 * Calendar is accounted for through its own connection rows rather than an integration, because that
 * is where it lives — the same reason its activity is projected rather than polled.
 */
async function readSourceHealth(
  userId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<z.input<typeof HighlightsDayOut>['sources']> {
  const [ownActors, counts, calendars] = await Promise.all([
    db.select({ id: actor.id }).from(actor).where(eq(actor.userId, userId)),
    db
      .select({ system: event.sourceSystem, id: event.id })
      .from(event)
      .where(
        and(
          eq(event.userId, userId),
          gte(event.occurredAt, dayStart),
          lt(event.occurredAt, dayEnd),
        ),
      ),
    db
      .select({ status: calendarConnection.status, lastSyncedAt: calendarConnection.lastSyncedAt })
      .from(calendarConnection)
      .where(eq(calendarConnection.userId, userId)),
  ]);

  const eventCounts = new Map<string, number>();
  for (const row of counts) eventCounts.set(row.system, (eventCounts.get(row.system) ?? 0) + 1);

  const actorIds = ownActors.map((row) => row.id);
  const integrations =
    actorIds.length === 0
      ? []
      : await db
          .select({
            provider: integration.provider,
            status: integration.status,
            id: integration.id,
          })
          .from(integration)
          .where(
            and(
              inArray(integration.createdBy, actorIds),
              isNull(integration.archivedAt),
              inArray(integration.provider, [...ACTIVITY_PROVIDER_IDS]),
            ),
          );

  // The last *successful* activity read per integration. A failed run is not a read, and counting it
  // as one is exactly how a stale day would come to look fresh.
  const lastReads = new Map<string, Date>();
  if (integrations.length > 0) {
    const runs = await db
      .select({ integrationId: syncRun.integrationId, finishedAt: syncRun.finishedAt })
      .from(syncRun)
      .where(
        and(
          inArray(
            syncRun.integrationId,
            integrations.map((row) => row.id),
          ),
          eq(syncRun.purpose, 'activity_pull'),
          eq(syncRun.status, 'succeeded'),
        ),
      )
      .orderBy(desc(syncRun.finishedAt));
    for (const run of runs) {
      if (run.finishedAt && !lastReads.has(run.integrationId)) {
        lastReads.set(run.integrationId, run.finishedAt);
      }
    }
  }

  return ACCOUNTABLE_SOURCES.map((system) => {
    const eventCount = eventCounts.get(system) ?? 0;

    if (system === 'google_calendar') {
      const live = calendars.filter((row) => row.status !== 'disconnected');
      return {
        system,
        state: stateFor({
          connected: live.length > 0,
          disconnected: calendars.length > 0 && live.length === 0,
          // Calendar activity is projected from already-synced rows, so its freshness is the
          // calendar sync's, not an activity run's.
          lastReadAt: live.reduce<Date | null>(
            (latest, row) =>
              row.lastSyncedAt && (!latest || row.lastSyncedAt > latest)
                ? row.lastSyncedAt
                : latest,
            null,
          ),
          failing: false,
          dayStart,
        }),
        lastReadAt:
          live
            .reduce<Date | null>(
              (latest, row) =>
                row.lastSyncedAt && (!latest || row.lastSyncedAt > latest)
                  ? row.lastSyncedAt
                  : latest,
              null,
            )
            ?.toISOString() ?? null,
        eventCount,
      };
    }

    const matching = integrations.filter(
      (row) =>
        PROVIDER_CATALOG[row.provider as (typeof ACTIVITY_PROVIDER_IDS)[number]].sourceSystem ===
        system,
    );
    const lastReadAt = matching.reduce<Date | null>((latest, row) => {
      const at = lastReads.get(row.id);
      return at && (!latest || at > latest) ? at : latest;
    }, null);
    return {
      system,
      state: stateFor({
        connected: matching.length > 0,
        disconnected: matching.some((row) => row.status === 'disconnected'),
        lastReadAt,
        failing: matching.length > 0 && matching.every((row) => row.status === 'error'),
        dayStart,
      }),
      lastReadAt: lastReadAt?.toISOString() ?? null,
      eventCount,
    };
  });
}

/** Hydrate the events one highlight narrates, so a surface can show its evidence. */
async function readHighlightEvents(
  eventIds: readonly string[],
): Promise<Map<string, z.input<typeof HighlightsDayOut>['highlights'][number]['events'][number]>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(event)
    .where(inArray(event.id, [...eventIds]))
    .orderBy(asc(event.occurredAt));
  return new Map(rows.map((row) => [row.id, toStreamEventOut(row, null)]));
}

/**
 * Read one person's narrated day.
 *
 * @remarks
 * Pure read. A day nobody has reconciled yet comes back `pending` with no highlights, which is the
 * honest answer — and distinguishable from `empty`, which means the day really had nothing in it.
 *
 * @param userId - The Hub owner whose day this is.
 * @param localDate - The local calendar day (`YYYY-MM-DD`), or omitted for the day `now` falls in.
 * @param now - The reference time.
 * @returns the day, its highlights, and how each source fared.
 */
export async function buildHighlightsDayPayload(
  userId: string,
  localDate: string | undefined,
  now: Date,
): Promise<z.input<typeof HighlightsDayOut>> {
  const timezone = await timezoneFor(userId);
  const today = localDayFor(now, timezone);
  const date = localDate ?? today.localDate;
  // Refused here rather than in each caller: an empty answer for a day that has not begun would read
  // as "nothing happened", and every caller wants the refusal.
  if (isFutureLocalDate(date, now, timezone)) {
    throw new ConflictError('That day has not happened yet.', 'validation_error');
  }
  const dayStart = localDayStartOf(date, timezone) ?? today.startsAt;
  const dayEnd = new Date(Math.min(dayStart.getTime() + 24 * 60 * 60 * 1000, now.getTime()));

  const [[day], sources] = await Promise.all([
    db
      .select()
      .from(activityDay)
      .where(and(eq(activityDay.userId, userId), eq(activityDay.localDate, date)))
      .limit(1),
    readSourceHealth(userId, dayStart, dayEnd),
  ]);

  if (!day) {
    return {
      date,
      timezone,
      status: 'pending',
      generating: false,
      eventCount: 0,
      reconciledAt: null,
      highlights: [],
      sources,
    };
  }

  const rows = await db
    .select()
    .from(activityHighlight)
    .where(eq(activityHighlight.activityDayId, day.id))
    .orderBy(asc(activityHighlight.sort));

  const eventsById = await readHighlightEvents(rows.flatMap((row) => row.eventIds));

  return {
    date,
    timezone,
    status: day.status,
    generating: rows.some((row) => row.narrationState === 'generating'),
    eventCount: day.eventCount,
    reconciledAt: day.reconciledAt?.toISOString() ?? null,
    highlights: rows.map((row) => ({
      id: row.id,
      episodeKey: row.episodeKey,
      sort: row.sort,
      occurredAt: row.occurredAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      system: row.sourceSystem,
      entityKind: row.entityKind,
      docketEntityId: row.docketEntityId,
      association: row.entityAssociation,
      subjectTitle: row.subjectTitle,
      narration: {
        state: row.narrationState,
        // The person's rewrite wins when there is one — that is what makes it theirs.
        text: row.editedNarration ?? row.narration,
        edited: row.editedNarration !== null,
      },
      kept: row.kept,
      curatedAt: row.curatedAt?.toISOString() ?? null,
      events: row.eventIds.flatMap((id) => {
        const found = eventsById.get(id);
        return found ? [found] : [];
      }),
    })),
    sources,
  };
}
