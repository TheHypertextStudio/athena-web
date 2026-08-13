/**
 * `@docket/api` — meetings as activity, projected from Docket's own calendar tables.
 *
 * @remarks
 * An {@link ActivitySource} that issues no provider request at all, and that is the right shape
 * rather than a shortcut. Calendar does not live in `integration`: it has its own
 * `calendar_connection` with its own credentials, its own per-calendar sync tokens, its own leases
 * and its own honest `lastError`. A provider-backed activity pull would therefore need a *second*
 * credential path and a *second* record of what has already been seen — two sources of truth for the
 * same question, which is precisely the drift the connector-reliability invariant exists to prevent.
 *
 * Everything an attendance episode needs is already in `calendar_item`: the window, the title, the
 * link, the attendees and their responses, and the recurrence instance key. Re-fetching it from
 * Google would spend quota to receive bytes Docket already holds, and would add a failure mode the
 * calendar sweep already reports.
 *
 * What is projected is deliberately narrow, because the log is append-only and cannot be corrected:
 * a meeting the person **accepted** and whose time has **elapsed**, with at least one other person
 * invited. That is not the same claim as "they were in the room", and nothing here pretends it is —
 * see `event_kind.meeting_attended`.
 */
import { calendarConnection, calendarItem, calendarLayer, db } from '@docket/db';
import type { CalendarEventAttendee } from '@docket/db';
import type { ActivityPullInput, ActivityPullResult, ActivitySource } from '@docket/integrations';
import type { EventDraft } from '@docket/integrations';
import { and, eq, gte, isNotNull, lt, ne, sql } from 'drizzle-orm';

/** Response statuses that mean the person said yes. */
const ACCEPTED = new Set(['accepted']);

/** The person's own attendee entry, when the provider marked one. */
function selfAttendee(
  attendees: readonly CalendarEventAttendee[],
): CalendarEventAttendee | undefined {
  return attendees.find((a) => a.self === true);
}

/**
 * Whether an elapsed calendar entry is worth recording as something the person did.
 *
 * @remarks
 * Requires a positive acceptance rather than merely the absence of a decline: a meeting somebody
 * never responded to is not evidence they attended it. Solo entries are excluded because a block
 * held on one's own calendar is a plan, not a meeting — and the planned-versus-actual work that
 * would give those meaning is deliberately out of scope for now.
 */
function isAttended(attendees: readonly CalendarEventAttendee[]): boolean {
  const own = selfAttendee(attendees);
  if (!own || !ACCEPTED.has((own.responseStatus ?? '').toLowerCase())) return false;
  return attendees.length > 1;
}

/** Minutes between two instants, floored at zero. */
function minutesBetween(startsAt: Date, endsAt: Date): number {
  return Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000));
}

/**
 * Build the activity source for one person's calendars.
 *
 * @param userId - The Hub owner whose calendars are projected.
 * @returns an {@link ActivitySource} that reads Docket's own tables.
 */
export function calendarActivitySource(userId: string): ActivitySource {
  return {
    sourceSystem: 'google_calendar',
    async pullActivity(input: ActivityPullInput): Promise<ActivityPullResult> {
      const since = new Date(input.since);
      const until = new Date(input.until);
      const rows = await db
        .select({
          externalEventId: calendarItem.externalEventId,
          recurrenceInstanceKey: calendarItem.recurrenceInstanceKey,
          recurringEventId: calendarItem.recurringEventId,
          title: calendarItem.title,
          htmlLink: calendarItem.htmlLink,
          startsAt: calendarItem.startsAt,
          endsAt: calendarItem.endsAt,
          organizer: calendarItem.organizer,
          attendees: calendarItem.attendees,
        })
        .from(calendarItem)
        .innerJoin(calendarLayer, eq(calendarLayer.id, calendarItem.layerId))
        .innerJoin(calendarConnection, eq(calendarConnection.id, calendarItem.connectionId))
        .where(
          and(
            eq(calendarItem.userId, userId),
            eq(calendarItem.kind, 'event'),
            eq(calendarItem.status, 'confirmed'),
            isNotNull(calendarItem.externalEventId),
            isNotNull(calendarItem.startsAt),
            isNotNull(calendarItem.endsAt),
            // A calendar the person has switched off is not part of their day.
            eq(calendarLayer.selected, true),
            ne(calendarConnection.status, 'disconnected'),
            // The meeting has to have started inside the window and finished before its end —
            // "elapsed" is the whole claim, so an in-progress meeting is not yet activity.
            gte(calendarItem.startsAt, since),
            lt(calendarItem.endsAt, until),
          ),
        )
        .orderBy(sql`${calendarItem.startsAt} asc`)
        .limit(input.maxDrafts + 1);

      const drafts: EventDraft[] = [];
      for (const row of rows.slice(0, input.maxDrafts)) {
        const { externalEventId, startsAt, endsAt } = row;
        /* v8 ignore next -- the query already requires all three to be non-null */
        if (!externalEventId || !startsAt || !endsAt) continue;
        const attendees = row.attendees;
        if (!isAttended(attendees)) continue;

        const organizerEmail = row.organizer?.email ?? null;
        // A recurring series repeats one external id, so the instance has to key on its own
        // occurrence or every week of a standing meeting would collapse into a single episode.
        const instance = row.recurrenceInstanceKey ?? startsAt.toISOString();
        drafts.push({
          kind: 'meeting_attended',
          // The episode is placed when the meeting *started*, which is where a person looks for it.
          occurredAt: startsAt.toISOString(),
          title: row.title,
          ...(row.htmlLink ? { permalink: row.htmlLink } : {}),
          entity: {
            kind: 'calendar_event',
            externalId: externalEventId,
            title: row.title,
            ...(row.htmlLink ? { url: row.htmlLink } : {}),
          },
          // Everyone else who was invited, so narration can name the people rather than count them.
          participants: attendees.flatMap((a) => {
            if (a.self === true) return [];
            const email = a.email;
            if (typeof email !== 'string' || email === '') return [];
            return [
              {
                externalId: email,
                ...(a.displayName ? { displayName: a.displayName } : {}),
                email,
              },
            ];
          }),
          detail: {
            schema: 'google_calendar.meeting',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMinutes: minutesBetween(startsAt, endsAt),
            attendeeCount: attendees.length,
            organizerEmail,
            recurring: row.recurringEventId !== null,
          },
          externalId: externalEventId,
          dedupeKey: `gcal:attended:${externalEventId}:${instance}`,
        });
      }

      return { drafts, truncated: rows.length > input.maxDrafts };
    },
  };
}
