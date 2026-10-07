import type {
  CalendarItemKind,
  CalendarProviderEventType,
} from '@docket/planning/calendar-contract';

const GOOGLE_PROVIDER_EVENT_TYPES = {
  default: 'default',
  outOfOffice: 'out_of_office',
  focusTime: 'focus_time',
  workingLocation: 'working_location',
  birthday: 'birthday',
  fromGmail: 'from_gmail',
} as const satisfies Record<string, CalendarProviderEventType>;

/**
 * Normalize a provider event's semantic type without inferring meaning from user-visible content.
 *
 * @param providerRaw - Provider response snapshot persisted with the calendar item.
 * @returns A recognized semantic type, or `null` when the provider omitted or added an unknown type.
 */
export function normalizeCalendarProviderEventType(
  providerRaw: Record<string, unknown> | null,
): CalendarProviderEventType | null {
  const eventType = providerRaw?.['eventType'];
  return typeof eventType === 'string' && eventType in GOOGLE_PROVIDER_EVENT_TYPES
    ? GOOGLE_PROVIDER_EVENT_TYPES[eventType as keyof typeof GOOGLE_PROVIDER_EVENT_TYPES]
    : null;
}

/**
 * Preserve provider availability independently of timed versus all-day presentation.
 *
 * @param kind - Imported events use their provider metadata; native commitments remain busy.
 * @param providerRaw - Stored Google event data, never returned to clients.
 * @returns Whether this item reserves calendar capacity.
 */
export function calendarItemBlocksTime(
  kind: CalendarItemKind,
  providerRaw: Record<string, unknown> | null,
): boolean {
  if (kind === 'availability_block') return false;
  if (kind !== 'provider_event') return true;
  // Google defaults transparency to opaque. All-day bounds alone never imply availability.
  // https://developers.google.com/workspace/calendar/api/v3/reference/events#resource
  return (
    normalizeCalendarProviderEventType(providerRaw) !== 'working_location' &&
    providerRaw?.['transparency'] !== 'transparent'
  );
}
