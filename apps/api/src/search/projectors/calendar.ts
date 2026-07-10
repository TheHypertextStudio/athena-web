import { baseRankFor } from '../rank';
import { calendarEventRoute } from '../routes';
import {
  cleanText,
  preloadedProjector,
  searchDocumentId,
  type SearchDocumentDraft,
  sourceUpdatedAt,
} from '../types';

interface CalendarEventRow {
  id: string;
  userId: string;
  calendarId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  htmlLink?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  allDayStartDate?: string | null;
  allDayEndDate?: string | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
  archivedAt?: Date | null;
}

/** Projects calendar events into user-private search documents. */
export const calendarEventSearchProjector = preloadedProjector<CalendarEventRow>(
  'calendar_event',
  (row): SearchDocumentDraft => ({
    id: searchDocumentId('calendar_event', row.userId, row.id),
    organizationId: null,
    userId: row.userId,
    kind: 'calendar_event',
    family: 'content',
    sourceTable: 'calendar_event',
    entityId: row.id,
    subjectKind: null,
    subjectId: null,
    sourceSystem: 'google_calendar',
    externalUrl: row.htmlLink ?? null,
    title: row.title,
    summary: cleanText(row.location) ?? cleanText(row.description),
    body: cleanText(row.description),
    facet: {
      calendarId: row.calendarId,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      allDayStartDate: row.allDayStartDate ?? null,
      allDayEndDate: row.allDayEndDate ?? null,
    },
    route: calendarEventRoute(row.id),
    visibility: { mode: 'user_private' },
    baseRank: baseRankFor('calendar_event'),
    occurredAt: row.startsAt ?? null,
    sourceUpdatedAt: sourceUpdatedAt(row),
    archivedAt: row.archivedAt ?? null,
  }),
);

/** Search projectors registered for calendar sources. */
export const calendarSearchProjectors = [calendarEventSearchProjector];
