import type { CalendarProviderEventType } from '@docket/types';

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
