/**
 * `@docket/types` — agenda DTOs.
 *
 * @remarks
 * Agenda contexts can render Docket-owned timeboxed work and selected first-party
 * calendar events together. Calendar events remain external context unless the user
 * explicitly creates a task from them.
 */
import { z } from 'zod';

import { CalendarEventOut } from './calendar';
import { Priority } from './capability';
import {
  CalendarConnectionId,
  CalendarListId,
  DateString,
  OrganizationId,
  TaskId,
} from './primitives';

/** Query parameters for a day agenda read. */
export const AgendaQuery = z
  .object({
    date: DateString.describe('Agenda day to read.'),
    includeGoogleCalendar: z
      .boolean()
      .optional()
      .describe('Whether selected Google Calendar events should be included.'),
    connectionIds: z
      .array(CalendarConnectionId)
      .optional()
      .describe('Temporary filter to linked Google accounts.'),
    calendarIds: z
      .array(CalendarListId)
      .optional()
      .describe('Temporary filter to selected calendars.'),
  })
  .meta({ id: 'AgendaQuery', description: 'Agenda read filters.' });
/** Agenda query value. */
export type AgendaQuery = z.infer<typeof AgendaQuery>;

/** A Docket task timebox entry from the caller's daily plan. */
export const TaskTimeboxAgendaEntry = z
  .object({
    kind: z.literal('task_timebox').describe('Entry discriminator for a Docket task timebox.'),
    taskId: TaskId.describe('The timeboxed task id.'),
    organizationId: OrganizationId.describe('The organization that owns the task.'),
    title: z.string().describe('Task title.'),
    state: z.string().describe('Task workflow state.'),
    priority: Priority.describe('Task priority.'),
    startsAt: z.string().describe('Timebox start timestamp.'),
    endsAt: z.string().describe('Timebox end timestamp.'),
  })
  .meta({ id: 'TaskTimeboxAgendaEntry', description: 'A Docket task timebox in an agenda.' });
/** Task timebox agenda entry value. */
export type TaskTimeboxAgendaEntry = z.infer<typeof TaskTimeboxAgendaEntry>;

/** A selected Google Calendar event ready for agenda rendering. */
export const CalendarAgendaEventOut = z
  .object({
    kind: z
      .literal('google_calendar_event')
      .describe('Entry discriminator for a Google Calendar event.'),
    event: CalendarEventOut.describe('The cached event payload.'),
    connection: z
      .object({
        id: CalendarConnectionId.describe('Linked account id.'),
        accountEmail: z.email().nullable().describe('Linked account email.'),
        accountName: z.string().nullable().describe('Linked account display name.'),
      })
      .describe('Minimal linked-account display context.'),
    calendar: z
      .object({
        id: CalendarListId.describe('Calendar id.'),
        title: z.string().describe('Calendar title.'),
        color: z.string().nullable().describe('Calendar color.'),
        timezone: z.string().nullable().describe('Calendar timezone.'),
      })
      .describe('Minimal calendar display context.'),
  })
  .meta({ id: 'CalendarAgendaEventOut', description: 'A Google Calendar event in an agenda.' });
/** Calendar agenda event value. */
export type CalendarAgendaEventOut = z.infer<typeof CalendarAgendaEventOut>;

/** Any entry renderable in an agenda context. */
export const AgendaEntryOut = z.discriminatedUnion('kind', [
  TaskTimeboxAgendaEntry,
  CalendarAgendaEventOut,
]);
/** Agenda entry value. */
export type AgendaEntryOut = z.infer<typeof AgendaEntryOut>;

/** A day agenda combining Docket timeboxes and selected external calendar events. */
export const AgendaOut = z
  .object({
    date: DateString.describe('Agenda day echoed from the request.'),
    entries: z.array(AgendaEntryOut).describe('Agenda entries sorted by start time.'),
  })
  .meta({ id: 'AgendaOut', description: 'Combined agenda for a single day.' });
/** Combined agenda value. */
export type AgendaOut = z.infer<typeof AgendaOut>;
