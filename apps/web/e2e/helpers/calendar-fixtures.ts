/**
 * Typed calendar fixtures shared by the browser-level calendar contracts.
 *
 * @remarks
 * Calendar dates stay runtime-relative for the legacy account flows, while the fluid scheduling
 * contract can opt into explicit UTC dates when exact pointer geometry matters.
 */
import {
  CalendarConnectionId,
  CalendarItemId,
  type CalendarItemOut,
  CalendarLayerId,
  type CalendarLayerOut,
  TaskId,
} from '@docket/types';

/** Stable ids used by the deterministic calendar route fixtures. */
export const CALENDAR_IDS = {
  googleConnection: CalendarConnectionId.parse('8CNV2AHRZ6ENW3BJS08FPX4CKT'),
  googleReadOnlyLayer: CalendarLayerId.parse('9FNV2AHRZ6ENW3BJS08FPX4CKT'),
  googleWritableLayer: CalendarLayerId.parse('AJNV2AHRZ6ENW3BJS08FPX4CKT'),
  nativeLayer: CalendarLayerId.parse('BNNV2AHRZ6ENW3BJS08FPX4CKT'),
  readOnlyEvent: CalendarItemId.parse('CRNV2AHRZ6ENW3BJS08FPX4CKT'),
  writableEvent: CalendarItemId.parse('DVNV2AHRZ6ENW3BJS08FPX4CKT'),
  conflictEvent: CalendarItemId.parse('EYNV2AHRZ6ENW3BJS08FPX4CKT'),
  taskLinkItem: CalendarItemId.parse('G4PV2AHRZ6ENW3BJS08FPX4CKT'),
  createdTask: TaskId.parse('H7PV2AHRZ6ENW3BJS08FPX4CKT'),
  existingTask: TaskId.parse('EHSV2AHRZ6ENW3BJS08FPX4CKT'),
  existingNativeItem: CalendarItemId.parse('89SV2AHRZ6ENW3BJS08FPX4CKT'),
  createdNativeItem: CalendarItemId.parse('BDSV2AHRZ6ENW3BJS08FPX4CKT'),
} as const;

/** Shift a bare ISO calendar date without involving the host timezone. */
export function shiftDate(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/** Today's bare date in the Node host timezone, matching the default browser context. */
export function todayDate(): string {
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** An exact instant at a local wall time on today's host-local date. */
export function todayAt(hour: number, minute = 0): string {
  const instant = new Date();
  instant.setHours(hour, minute, 0, 0);
  return instant.toISOString();
}

/** An exact UTC instant for a bare date and wall-clock minute. */
export function utcAt(date: string, hour: number, minute = 0): string {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

/** A calendar layer fixture with safe native defaults. */
export function makeCalendarLayer(
  overrides: Partial<CalendarLayerOut> & { id: string },
): CalendarLayerOut {
  return {
    connectionId: null,
    provider: null,
    sourceKind: 'native_blocks',
    externalLayerId: null,
    title: 'Layer',
    description: null,
    timezone: null,
    color: '#16a34a',
    accessRole: null,
    primary: false,
    selected: true,
    visibleByDefault: true,
    editableCore: true,
    lastSyncedAt: null,
    lastError: null,
    watchExpiresAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A normalized timed calendar item fixture with editable native defaults. */
export function makeCalendarItem(
  overrides: Partial<CalendarItemOut> & { id: string },
): CalendarItemOut {
  return {
    layerId: CALENDAR_IDS.nativeLayer,
    connectionId: null,
    kind: 'native_block',
    provider: null,
    externalCalendarId: null,
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Item',
    description: null,
    location: null,
    htmlLink: null,
    startsAt: todayAt(9),
    endsAt: todayAt(10),
    allDayStartDate: null,
    allDayEndDate: null,
    timezone: null,
    organizer: null,
    attendees: [],
    permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
    syncState: 'clean',
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}
