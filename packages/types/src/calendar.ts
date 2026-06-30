/**
 * `@docket/types` — first-party Calendar DTOs.
 *
 * @remarks
 * Calendar is user-scoped: one Docket account can link multiple Google accounts, each
 * account exposes selectable calendars, and selected events can appear in any agenda
 * context without becoming imported integration tasks.
 */
import { z } from 'zod';

import {
  CalendarConnectionId,
  CalendarEventId,
  CalendarListId,
  DateString,
  OrganizationId,
  TeamId,
} from './primitives';

/** Calendar providers supported by the first-party Calendar domain. */
export const CalendarProvider = z.enum(['google']);
/** Calendar provider value. */
export type CalendarProvider = z.infer<typeof CalendarProvider>;

/** Connection lifecycle for one linked external calendar account. */
export const CalendarConnectionStatus = z.enum(['connected', 'error', 'disconnected']);
/** Calendar connection status value. */
export type CalendarConnectionStatus = z.infer<typeof CalendarConnectionStatus>;

/** A linked Google account that contributes calendars to the user's agenda. */
export const CalendarConnectionOut = z
  .object({
    id: CalendarConnectionId.describe('Calendar connection id.'),
    provider: CalendarProvider.describe("Calendar provider; currently always 'google'."),
    externalAccountId: z.string().describe("Provider account id, e.g. Google's stable `sub`."),
    accountEmail: z.email().nullable().describe('Display email for the linked account.'),
    accountName: z.string().nullable().describe('Display name for the linked account.'),
    accountPictureUrl: z.url().nullable().describe('Avatar URL for the linked account.'),
    status: CalendarConnectionStatus.describe('Current sync/connectivity status.'),
    calendarsTotal: z.number().int().nonnegative().describe('Number of calendars discovered.'),
    calendarsEnabled: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of calendars selected for agenda visibility.'),
    lastSyncedAt: z.string().nullable().describe('Most recent successful sync timestamp.'),
    lastError: z.string().nullable().describe('Most recent sync/connectivity error, if any.'),
    createdAt: z.string().describe('Connection creation timestamp.'),
    updatedAt: z.string().describe('Connection update timestamp.'),
  })
  .meta({ id: 'CalendarConnectionOut', description: 'A linked Google Calendar account.' });
/** Linked calendar-account value. */
export type CalendarConnectionOut = z.infer<typeof CalendarConnectionOut>;

/** A selectable calendar under one linked account. */
export const CalendarListOut = z
  .object({
    id: CalendarListId.describe('Calendar list id.'),
    connectionId: CalendarConnectionId.describe('Owning calendar connection id.'),
    externalCalendarId: z.string().describe('Provider calendar id, e.g. `primary`.'),
    title: z.string().describe('Calendar display title.'),
    description: z.string().nullable().describe('Provider calendar description.'),
    timezone: z.string().nullable().describe('Calendar timezone id, when Google provides one.'),
    color: z.string().nullable().describe('Calendar color from the provider, usually hex.'),
    accessRole: z.string().nullable().describe('Provider access role for this calendar.'),
    primary: z.boolean().describe('Whether this is the primary calendar for the account.'),
    selected: z.boolean().describe('Whether this calendar appears in agenda contexts by default.'),
    visibleByDefault: z
      .boolean()
      .describe('Whether the global default visibility includes this calendar.'),
    lastSyncedAt: z.string().nullable().describe('Most recent successful event sync timestamp.'),
    lastError: z.string().nullable().describe('Most recent calendar-specific sync error, if any.'),
    updatedAt: z.string().describe('Calendar configuration update timestamp.'),
  })
  .meta({ id: 'CalendarListOut', description: 'A selectable Google calendar.' });
/** Selectable calendar value. */
export type CalendarListOut = z.infer<typeof CalendarListOut>;

/** Organizer details copied from a Google Calendar event. */
export const CalendarEventOrganizer = z
  .object({
    email: z.string().nullable().optional().describe('Organizer email, if available.'),
    displayName: z.string().nullable().optional().describe('Organizer display name, if available.'),
    self: z.boolean().optional().describe('Whether the organizer is the linked account.'),
  })
  .meta({ id: 'CalendarEventOrganizer', description: 'Google Calendar event organizer.' });
/** Calendar event organizer value. */
export type CalendarEventOrganizer = z.infer<typeof CalendarEventOrganizer>;

/** Attendee details copied from a Google Calendar event. */
export const CalendarEventAttendee = z
  .object({
    email: z.string().nullable().optional().describe('Attendee email, if available.'),
    displayName: z.string().nullable().optional().describe('Attendee display name, if available.'),
    responseStatus: z.string().nullable().optional().describe('Provider response status.'),
    optional: z.boolean().optional().describe('Whether the attendee is optional.'),
    self: z.boolean().optional().describe('Whether the attendee is the linked account.'),
  })
  .meta({ id: 'CalendarEventAttendee', description: 'Google Calendar event attendee.' });
/** Calendar event attendee value. */
export type CalendarEventAttendee = z.infer<typeof CalendarEventAttendee>;

/** Cached Google Calendar event, normalized for agenda use and task attachment provenance. */
export const CalendarEventOut = z
  .object({
    id: CalendarEventId.describe('Calendar event id.'),
    connectionId: CalendarConnectionId.describe('Owning linked Google account.'),
    calendarId: CalendarListId.describe('Owning selected calendar row.'),
    externalCalendarId: z.string().describe('Provider calendar id.'),
    externalEventId: z.string().describe('Provider event id.'),
    status: z.string().describe('Provider event status, e.g. confirmed/cancelled.'),
    title: z.string().describe('Event summary/title.'),
    description: z.string().nullable().describe('Event description/body, if present.'),
    location: z.string().nullable().describe('Event location, if present.'),
    htmlLink: z.url().nullable().describe('Provider deep link to the event.'),
    startsAt: z.string().nullable().describe('Timed event start timestamp; null for all-day.'),
    endsAt: z.string().nullable().describe('Timed event end timestamp; null for all-day.'),
    allDayStartDate: DateString.nullable().describe('All-day start date; null for timed events.'),
    allDayEndDate: DateString.nullable().describe(
      'All-day exclusive end date; null for timed events.',
    ),
    organizer: CalendarEventOrganizer.nullable().describe('Event organizer details.'),
    attendees: z.array(CalendarEventAttendee).describe('Event attendees copied from Google.'),
    updatedExternalAt: z.string().nullable().describe('Provider updated timestamp, if present.'),
    createdAt: z.string().describe('Local creation timestamp.'),
    updatedAt: z.string().describe('Local update timestamp.'),
  })
  .refine(
    (v) =>
      (v.startsAt !== null && v.endsAt !== null) ||
      (v.allDayStartDate !== null && v.allDayEndDate !== null),
    {
      path: ['startsAt'],
      message: 'A calendar event requires either timed bounds or all-day date bounds',
    },
  )
  .meta({ id: 'CalendarEventOut', description: 'A cached Google Calendar event.' });
/** Calendar event value. */
export type CalendarEventOut = z.infer<typeof CalendarEventOut>;

/** Result of syncing linked Google accounts/calendars/events. */
export const CalendarSyncResultOut = z
  .object({
    connections: z.number().int().nonnegative().describe('Linked accounts processed.'),
    calendars: z.number().int().nonnegative().describe('Calendars processed.'),
    eventsCreated: z.number().int().nonnegative().describe('Events inserted locally.'),
    eventsUpdated: z.number().int().nonnegative().describe('Events updated locally.'),
    eventsDeleted: z.number().int().nonnegative().describe('Events removed or archived locally.'),
    errors: z.array(z.string()).describe('Non-fatal per-account or per-calendar sync errors.'),
  })
  .meta({ id: 'CalendarSyncResultOut', description: 'Google Calendar sync summary.' });
/** Calendar sync result value. */
export type CalendarSyncResultOut = z.infer<typeof CalendarSyncResultOut>;

/** Body for updating selected/default visibility of calendars. */
export const CalendarListUpdate = z
  .object({
    selected: z.boolean().optional().describe('Whether the calendar appears in agenda contexts.'),
    visibleByDefault: z
      .boolean()
      .optional()
      .describe('Whether the global default visibility includes the calendar.'),
  })
  .refine((v) => v.selected !== undefined || v.visibleByDefault !== undefined, {
    path: ['selected'],
    message: 'At least one calendar visibility field is required',
  })
  .meta({ id: 'CalendarListUpdate', description: 'Update Google Calendar visibility settings.' });
/** Calendar visibility update body value. */
export type CalendarListUpdate = z.infer<typeof CalendarListUpdate>;

/** Response containing all linked calendar accounts and calendars. */
export const CalendarSettingsOut = z
  .object({
    connections: z.array(CalendarConnectionOut).describe('Linked Google Calendar accounts.'),
    calendars: z.array(CalendarListOut).describe('Calendars across every linked account.'),
  })
  .meta({ id: 'CalendarSettingsOut', description: 'User-scoped Google Calendar settings.' });
/** Calendar settings value. */
export type CalendarSettingsOut = z.infer<typeof CalendarSettingsOut>;

/** Body for creating a task from one Google Calendar event. */
export const CalendarEventCreateTask = z
  .object({
    organizationId: OrganizationId.optional().describe(
      'Target organization for the created task; omitted uses the caller personal/default workspace.',
    ),
    teamId: TeamId.optional().describe('Target team for the task; omitted uses the default team.'),
    title: z
      .string()
      .min(1)
      .optional()
      .describe('Task title override; omitted derives from the event title.'),
    note: z.string().optional().describe('Optional note/comment for the created task.'),
  })
  .meta({
    id: 'CalendarEventCreateTask',
    description: 'Create a Docket task from a calendar event.',
  });
/** Calendar-event task creation body value. */
export type CalendarEventCreateTask = z.infer<typeof CalendarEventCreateTask>;
