import type { NotificationChannelPreference } from '../schemas';
import { lockedPreference } from '../policy';
import { defaultNotificationChannelPreference } from './defaults';
import type {
  NotificationPreferenceAllowsChannelInput,
  NotificationQuietHoursSettings,
} from './types';

const weekdayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Resolves whether user preferences allow one category/channel pair. */
export function notificationPreferenceAllowsChannel({
  category,
  channel,
  organizationId,
  preferences,
}: NotificationPreferenceAllowsChannelInput): boolean {
  if (lockedPreference(category)) return true;

  const categoryPreference = preferences?.categories?.[category];
  const organizationPreference = organizationId
    ? preferences?.organizations?.[organizationId]?.[category]
    : undefined;
  const merged = mergeChannelPreferences(
    defaultNotificationChannelPreference(category),
    categoryPreference,
    organizationPreference,
  );

  return merged[channel] === true;
}

/** Returns true when the provided instant falls inside the user's quiet-hours window. */
export function notificationQuietHoursActive(
  quietHours: NotificationQuietHoursSettings | null | undefined,
  timezone: string,
  now: Date,
): boolean {
  if (!quietHours?.enabled) return false;

  const local = localClockParts(now, timezone);
  const currentMinutes = minutesSinceMidnight(local.time);
  const startMinutes = minutesSinceMidnight(quietHours.start);
  const endMinutes = minutesSinceMidnight(quietHours.end);
  const today = weekdayName(local.weekday);
  const yesterday = weekdayName(local.weekday + 6);

  if (startMinutes === endMinutes) return quietHours.days.includes(today);

  if (startMinutes < endMinutes) {
    return (
      quietHours.days.includes(today) &&
      currentMinutes >= startMinutes &&
      currentMinutes < endMinutes
    );
  }

  return (
    (quietHours.days.includes(today) && currentMinutes >= startMinutes) ||
    (quietHours.days.includes(yesterday) && currentMinutes < endMinutes)
  );
}

function mergeChannelPreferences(
  ...preferences: readonly (NotificationChannelPreference | undefined)[]
): NotificationChannelPreference {
  return preferences.reduce<NotificationChannelPreference>(
    (merged, preference) => ({ ...merged, ...preference }),
    {},
  );
}

function weekdayName(index: number): (typeof weekdayNames)[number] {
  return weekdayNames[((index % 7) + 7) % 7] ?? 'sun';
}

function localClockParts(
  now: Date,
  timezone: string,
): { readonly weekday: number; readonly time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekdayText = parts.find((part) => part.type === 'weekday')?.value.toLowerCase();
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const weekday = weekdayNames.findIndex((name) => weekdayText?.startsWith(name));

  return {
    weekday: weekday >= 0 ? weekday : 0,
    time: `${hour}:${minute}`,
  };
}

function minutesSinceMidnight(time: string): number {
  const [hour = '0', minute = '0'] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}
