/**
 * `@docket/api` — Google Calendar polling sync.
 *
 * @remarks
 * The first-party Calendar domain is user-scoped, so sync starts from the caller's linked
 * Better Auth Google accounts, discovers CalendarList resources, then caches selected
 * events for agenda reads and task attachment provenance.
 */
import { auth } from '@docket/auth';
import { account, calendarConnection, calendarEvent, calendarList, db } from '@docket/db';
import type { CalendarSyncResultOut } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { decodeIdTokenClaims } from '../lib/id-token';

interface GoogleCalendarListItem {
  id?: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListItem[];
}

interface GoogleEventDate {
  dateTime?: string;
  date?: string;
}

interface GoogleEventPerson {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  optional?: boolean;
  self?: boolean;
}

interface GoogleCalendarEventResource {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventDate;
  end?: GoogleEventDate;
  organizer?: GoogleEventPerson;
  attendees?: GoogleEventPerson[];
  updated?: string;
  etag?: string;
  recurringEventId?: string;
}

interface GoogleEventsResponse {
  items?: GoogleCalendarEventResource[];
}

type FetchJson = <T>(url: string, accessToken: string) => Promise<T>;

const googleCalendarBase = 'https://www.googleapis.com/calendar/v3';

async function defaultFetchJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Calendar request failed (${res.status})`);
  return (await res.json()) as T;
}

function windowBounds(now = new Date()): { timeMin: string; timeMax: string } {
  const min = new Date(now);
  min.setUTCDate(min.getUTCDate() - 30);
  const max = new Date(now);
  max.setUTCDate(max.getUTCDate() + 180);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

async function upsertConnection(input: {
  userId: string;
  externalAccountId: string;
  accountEmail: string | null;
  accountName: string | null;
  accountPictureUrl: string | null;
}): Promise<string> {
  const existing = await db
    .select({ id: calendarConnection.id })
    .from(calendarConnection)
    .where(
      and(
        eq(calendarConnection.userId, input.userId),
        eq(calendarConnection.provider, 'google'),
        eq(calendarConnection.externalAccountId, input.externalAccountId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    const updated = await db
      .update(calendarConnection)
      .set({
        accountEmail: input.accountEmail,
        accountName: input.accountName,
        accountPictureUrl: input.accountPictureUrl,
        status: 'connected',
        lastSyncedAt: new Date(),
        lastError: null,
      })
      .where(eq(calendarConnection.id, existing[0].id))
      .returning({ id: calendarConnection.id });
    const row = updated[0];
    if (!row) throw new Error('calendar connection update returned no row');
    return row.id;
  }
  const inserted = await db
    .insert(calendarConnection)
    .values({
      userId: input.userId,
      externalAccountId: input.externalAccountId,
      accountEmail: input.accountEmail,
      accountName: input.accountName,
      accountPictureUrl: input.accountPictureUrl,
      status: 'connected',
      lastSyncedAt: new Date(),
    })
    .returning({ id: calendarConnection.id });
  const row = inserted[0];
  if (!row) throw new Error('calendar connection insert returned no row');
  return row.id;
}

async function upsertCalendar(input: {
  userId: string;
  connectionId: string;
  item: GoogleCalendarListItem;
}): Promise<{ id: string; selected: boolean }> {
  const externalCalendarId = input.item.id;
  if (!externalCalendarId) throw new Error('Google Calendar list item missing id');
  const existing = await db
    .select({ id: calendarList.id, selected: calendarList.selected })
    .from(calendarList)
    .where(
      and(
        eq(calendarList.connectionId, input.connectionId),
        eq(calendarList.externalCalendarId, externalCalendarId),
      ),
    )
    .limit(1);
  const values = {
    title: input.item.summary ?? externalCalendarId,
    description: input.item.description ?? null,
    timezone: input.item.timeZone ?? null,
    color: input.item.backgroundColor ?? null,
    accessRole: input.item.accessRole ?? null,
    primary: input.item.primary ?? false,
    lastSyncedAt: new Date(),
    lastError: null,
  };
  if (existing[0]) {
    await db.update(calendarList).set(values).where(eq(calendarList.id, existing[0].id));
    return existing[0];
  }
  const inserted = await db
    .insert(calendarList)
    .values({
      userId: input.userId,
      connectionId: input.connectionId,
      externalCalendarId,
      ...values,
      selected: true,
      visibleByDefault: true,
    })
    .returning({ id: calendarList.id, selected: calendarList.selected });
  const row = inserted[0];
  if (!row) throw new Error('calendar list insert returned no row');
  return row;
}

async function upsertEvent(input: {
  userId: string;
  connectionId: string;
  calendarId: string;
  externalCalendarId: string;
  event: GoogleCalendarEventResource;
}): Promise<'created' | 'updated' | 'deleted' | 'skipped'> {
  const externalEventId = input.event.id;
  if (!externalEventId) return 'skipped';
  const existing = await db
    .select({ id: calendarEvent.id })
    .from(calendarEvent)
    .where(
      and(
        eq(calendarEvent.calendarId, input.calendarId),
        eq(calendarEvent.externalEventId, externalEventId),
      ),
    )
    .limit(1);

  if (input.event.status === 'cancelled') {
    if (existing[0]) {
      await db
        .update(calendarEvent)
        .set({ archivedAt: new Date(), status: 'cancelled' })
        .where(eq(calendarEvent.id, existing[0].id));
      return 'deleted';
    }
    return 'skipped';
  }

  const values = {
    status: input.event.status ?? 'confirmed',
    title: input.event.summary ?? '(no title)',
    description: input.event.description ?? null,
    location: input.event.location ?? null,
    htmlLink: input.event.htmlLink ?? null,
    startsAt: input.event.start?.dateTime ? new Date(input.event.start.dateTime) : null,
    endsAt: input.event.end?.dateTime ? new Date(input.event.end.dateTime) : null,
    allDayStartDate: input.event.start?.date ?? null,
    allDayEndDate: input.event.end?.date ?? null,
    organizer: input.event.organizer ?? null,
    attendees: input.event.attendees ?? [],
    updatedExternalAt: input.event.updated ? new Date(input.event.updated) : null,
    etag: input.event.etag ?? null,
    recurringEventId: input.event.recurringEventId ?? null,
    archivedAt: null,
  };

  if (existing[0]) {
    await db.update(calendarEvent).set(values).where(eq(calendarEvent.id, existing[0].id));
    return 'updated';
  }
  await db.insert(calendarEvent).values({
    userId: input.userId,
    connectionId: input.connectionId,
    calendarId: input.calendarId,
    externalCalendarId: input.externalCalendarId,
    externalEventId,
    ...values,
  });
  return 'created';
}

/** Sync linked Google Calendar accounts/calendars/events for one user. */
export async function syncGoogleCalendars(
  userId: string,
  fetchJson: FetchJson = defaultFetchJson,
): Promise<z.input<typeof CalendarSyncResultOut>> {
  const googleAccounts = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'google')));
  const counts = {
    connections: 0,
    calendars: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    eventsDeleted: 0,
    errors: [] as string[],
    // Layered-calendar counters: this sync path only maintains the legacy
    // calendar_list/calendar_event tables, so it never touches layers/items/writes.
    layers: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsArchived: 0,
    writesApplied: 0,
    writesPending: 0,
    conflicts: 0,
  };
  const { timeMin, timeMax } = windowBounds();

  for (const linked of googleAccounts) {
    try {
      const token = await auth.api.getAccessToken({
        body: { providerId: 'google', userId, accountId: linked.accountId },
      });
      if (!token.accessToken) throw new Error('Google account needs reauthorization');
      const claims = decodeIdTokenClaims(linked.idToken);
      const connectionId = await upsertConnection({
        userId,
        externalAccountId: linked.accountId,
        accountEmail: claims.email ?? null,
        accountName: claims.name ?? null,
        accountPictureUrl: claims.picture ?? null,
      });
      counts.connections += 1;

      const list = await fetchJson<GoogleCalendarListResponse>(
        `${googleCalendarBase}/users/me/calendarList`,
        token.accessToken,
      );
      for (const item of list.items ?? []) {
        const cal = await upsertCalendar({ userId, connectionId, item });
        counts.calendars += 1;
        if (!cal.selected || !item.id) continue;
        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '2500',
          timeMin,
          timeMax,
        });
        const events = await fetchJson<GoogleEventsResponse>(
          `${googleCalendarBase}/calendars/${encodeURIComponent(item.id)}/events?${params.toString()}`,
          token.accessToken,
        );
        for (const event of events.items ?? []) {
          const outcome = await upsertEvent({
            userId,
            connectionId,
            calendarId: cal.id,
            externalCalendarId: item.id,
            event,
          });
          if (outcome === 'created') counts.eventsCreated += 1;
          else if (outcome === 'updated') counts.eventsUpdated += 1;
          else if (outcome === 'deleted') counts.eventsDeleted += 1;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google Calendar sync failed';
      counts.errors.push(`${linked.accountId}: ${message}`);
    }
  }

  return counts;
}
