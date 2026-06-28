/**
 * Calendar sync route serializers.
 *
 * @packageDocumentation
 */

import type {
  Calendar as ApiCalendar,
  CalendarConnection as ApiCalendarConnection,
  SyncResult as ApiSyncResult,
} from '@athena/types/openapi/calendar-sync';
import type {
  CalendarConnection,
  SyncedCalendar,
  SyncResult,
} from '../../services/calendar-sync/types.js';

type SyncResultData = Omit<ApiSyncResult, 'success'>;

export const toCalendar = (calendar: SyncedCalendar): ApiCalendar => ({
  id: calendar.id,
  externalId: calendar.externalId,
  name: calendar.name,
  color: calendar.color ?? null,
  isPrimary: calendar.isPrimary,
  canEdit: calendar.canEdit,
  syncEnabled: calendar.syncEnabled,
  syncDirection: calendar.syncDirection,
});

export const toCalendarConnection = (
  connection: CalendarConnection,
): ApiCalendarConnection => ({
  id: connection.id,
  provider: connection.provider,
  syncEnabled: connection.syncEnabled,
  lastSyncAt: connection.lastSyncAt ?? null,
  lastSyncStatus: connection.lastSyncStatus ?? null,
  lastSyncError: connection.lastSyncError ?? null,
  accountLabel: connection.accountLabel ?? null,
  accountEmail: connection.accountEmail ?? null,
  accountColor: connection.accountColor ?? null,
  isPrimary: connection.isPrimary,
  displayOrder: connection.displayOrder,
  calendars: connection.calendars.map((calendar) => toCalendar(calendar)),
  createdAt: connection.createdAt,
});

export const toSyncResultData = (result: SyncResult): SyncResultData => ({
  eventsCreated: result.eventsCreated,
  eventsUpdated: result.eventsUpdated,
  eventsDeleted: result.eventsDeleted,
  errors: result.errors,
  syncedAt: result.syncedAt,
});
