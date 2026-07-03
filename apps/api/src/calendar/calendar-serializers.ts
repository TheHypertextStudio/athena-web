/**
 * `@docket/api` — layered-calendar serializers.
 *
 * @remarks
 * Serializers for the provider-agnostic `calendar_layer`/`calendar_item` tables. The
 * legacy `calendar_connection`/`calendar_list`/`calendar_event` serializers stay in
 * `./routes/calendar-shared.ts` (not duplicated here) — those tables and this pair are
 * kept in sync by dual-writes during the migration window (see `google-calendar-sync.ts`
 * and the `me-calendar.ts` layer-visibility routes).
 */
import type { calendarItem, calendarItemTaskLink, calendarLayer } from '@docket/db';
import {
  CalendarItemKind,
  type CalendarItemLinkedTaskOut,
  CalendarItemStatus,
  CalendarItemSyncState,
  type CalendarItemOut,
  CalendarItemTaskRole,
  type CalendarItemTaskLinkOut,
  CalendarLayerSourceKind,
  type CalendarLayerOut,
  CalendarProvider,
} from '@docket/types';
import type { z } from 'zod';

import { defaultItemPermissionsForKind } from './calendar-permissions';

type CalendarLayerRow = typeof calendarLayer.$inferSelect;
type CalendarItemRow = typeof calendarItem.$inferSelect;
type CalendarItemTaskLinkRow = typeof calendarItemTaskLink.$inferSelect;

/**
 * Serialize one calendar layer row.
 *
 * @remarks
 * Never exposes provider push-notification internals (`syncToken`, `watchChannelId`,
 * `watchResourceId`, `watchToken`) — those are sync-engine bookkeeping, not client state.
 */
export function toCalendarLayerOut(row: CalendarLayerRow): z.input<typeof CalendarLayerOut> {
  return {
    id: row.id,
    connectionId: row.connectionId,
    provider: CalendarProvider.nullable().parse(row.provider),
    sourceKind: CalendarLayerSourceKind.parse(row.sourceKind),
    externalLayerId: row.externalLayerId,
    title: row.title,
    description: row.description,
    timezone: row.timezone,
    color: row.color,
    accessRole: row.accessRole,
    primary: row.primary,
    selected: row.selected,
    visibleByDefault: row.visibleByDefault,
    editableCore: row.editableCore,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    watchExpiresAt: row.watchExpiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Serialize one calendar item row.
 *
 * @remarks
 * `permissions` is read from the row's own `permissions` jsonb snapshot when present;
 * when it is `null` (native/derived kinds never carry an adapter snapshot, and
 * provider-bound items may not have one yet) it falls back to the conservative
 * kind-based default from `calendar-permissions.ts`. Callers that have layer/connection
 * context (the read service) should resolve the full permission via
 * {@link resolveItemPermissions} first and pass it through on the row so this fallback
 * never has to guess.
 */
export function toCalendarItemOut(
  row: CalendarItemRow,
  options: { linkedTasks: readonly z.input<typeof CalendarItemLinkedTaskOut>[] },
): z.input<typeof CalendarItemOut> {
  const kind = CalendarItemKind.parse(row.kind);
  const permissions = row.permissions ?? defaultItemPermissionsForKind(kind);
  return {
    id: row.id,
    layerId: row.layerId,
    connectionId: row.connectionId,
    kind,
    provider: CalendarProvider.nullable().parse(row.provider),
    externalCalendarId: row.externalCalendarId,
    externalEventId: row.externalEventId,
    recurringEventId: row.recurringEventId,
    recurrenceInstanceKey: row.recurrenceInstanceKey,
    status: CalendarItemStatus.parse(row.status),
    title: row.title,
    description: row.description,
    location: row.location,
    htmlLink: row.htmlLink,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    allDayStartDate: row.allDayStartDate,
    allDayEndDate: row.allDayEndDate,
    timezone: row.timezone,
    organizer: row.organizer,
    attendees: row.attendees,
    permissions,
    syncState: CalendarItemSyncState.parse(row.syncState),
    hasConflict: row.conflict !== null,
    updatedExternalAt: row.updatedExternalAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    linkedTasks: [...options.linkedTasks],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Serialize one calendar item ↔ task link row. */
export function toCalendarItemTaskLinkOut(
  row: CalendarItemTaskLinkRow,
): z.input<typeof CalendarItemTaskLinkOut> {
  return {
    calendarItemId: row.calendarItemId,
    taskId: row.taskId,
    organizationId: row.organizationId,
    role: CalendarItemTaskRole.parse(row.role),
    sort: row.sort,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
