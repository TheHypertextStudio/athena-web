/**
 * Timezone Utility Functions
 *
 * Pure utility functions for timezone conversion and formatting.
 * Uses native Intl API for timezone support without external dependencies.
 */

// =============================================================================
// Time Formatting
// =============================================================================

/**
 * Formats a Date to a time string in the specified timezone.
 *
 * @param date - The date to format
 * @param timezone - IANA timezone identifier (e.g., "America/New_York")
 * @returns Formatted time string (e.g., "9:30 AM")
 *
 * @example
 * ```ts
 * formatTimeInTimezone(new Date(), 'America/New_York') // "9:30 AM"
 * ```
 */
export function formatTimeInTimezone(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
}

/**
 * Formats a Date to a full datetime string in the specified timezone.
 *
 * @param date - The date to format
 * @param timezone - IANA timezone identifier
 * @param options - Additional formatting options
 * @returns Formatted datetime string
 */
export function formatDateTimeInTimezone(
  date: Date,
  timezone: string,
  options?: {
    includeDate?: boolean;
    includeSeconds?: boolean;
    includeTimezone?: boolean;
  },
): string {
  const { includeDate = true, includeSeconds = false, includeTimezone = false } = options ?? {};

  const formatOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  };

  if (includeDate) {
    formatOptions.weekday = 'short';
    formatOptions.month = 'short';
    formatOptions.day = 'numeric';
  }

  if (includeSeconds) {
    formatOptions.second = '2-digit';
  }

  if (includeTimezone) {
    formatOptions.timeZoneName = 'short';
  }

  return date.toLocaleString('en-US', formatOptions);
}

/**
 * Formats an hour number to a display string in the specified timezone.
 *
 * @param hour - Hour in 24-hour format (0-23)
 * @param timezone - IANA timezone identifier
 * @returns Formatted hour string (e.g., "9 AM", "12 PM")
 */
export function formatHourInTimezone(hour: number, timezone: string): string {
  // Create a date with the specified hour in local time
  const date = new Date();
  date.setHours(hour, 0, 0, 0);

  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    hour12: true,
    timeZone: timezone,
  });
}

// =============================================================================
// Time Parsing
// =============================================================================

/**
 * Parses a time string and creates a Date in the specified timezone.
 *
 * @param timeStr - Time string in HH:MM or H:MM AM/PM format
 * @param baseDate - The date to use (time will be set on this date)
 * @param timezone - IANA timezone identifier for interpretation
 * @returns Date object in UTC that represents the specified time in the timezone
 *
 * @example
 * ```ts
 * // Parse "9:30 AM" on Jan 1, 2024 in New York timezone
 * const date = parseTimeInTimezone('9:30 AM', new Date('2024-01-01'), 'America/New_York');
 * // Returns a Date that when displayed in EST shows 9:30 AM
 * ```
 */
export function parseTimeInTimezone(timeStr: string, baseDate: Date, timezone: string): Date {
  // Parse the time string
  const { hours, minutes } = parseTimeString(timeStr);

  // Get the date components in the target timezone
  const year = getDatePartInTimezone(baseDate, 'year', timezone);
  const month = getDatePartInTimezone(baseDate, 'month', timezone);
  const day = getDatePartInTimezone(baseDate, 'day', timezone);

  // Create a date string that represents the desired time in the target timezone
  // Then convert it to UTC
  const dateStr = `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

  // Use the formatter to get the UTC offset for this datetime in the target timezone
  const offset = getTimezoneOffsetMinutes(timezone, new Date(dateStr));

  // Create the date by adjusting for the timezone offset
  const utcDate = new Date(dateStr);
  utcDate.setMinutes(utcDate.getMinutes() + offset + utcDate.getTimezoneOffset());

  return utcDate;
}

/**
 * Parses a time string into hours and minutes.
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const normalized = timeStr.trim().toUpperCase();

  // Try parsing "9:30 AM" format
  const amPmMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(normalized);
  if (amPmMatch?.[1] && amPmMatch[2] && amPmMatch[3]) {
    let hours = parseInt(amPmMatch[1], 10);
    const minutes = parseInt(amPmMatch[2], 10);
    const isPM = amPmMatch[3] === 'PM';

    if (hours === 12) {
      hours = isPM ? 12 : 0;
    } else if (isPM) {
      hours += 12;
    }

    return { hours, minutes };
  }

  // Try parsing "09:30" or "9:30" format (24-hour)
  const militaryMatch = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (militaryMatch?.[1] && militaryMatch[2]) {
    return {
      hours: parseInt(militaryMatch[1], 10),
      minutes: parseInt(militaryMatch[2], 10),
    };
  }

  throw new Error(`Invalid time format: ${timeStr}`);
}

// =============================================================================
// Timezone Information
// =============================================================================

/**
 * Gets the timezone offset in minutes for a given timezone at a specific time.
 * Positive values mean the timezone is behind UTC (e.g., +300 for EST).
 *
 * @param timezone - IANA timezone identifier
 * @param date - The date to check (DST may affect the offset)
 * @returns Offset in minutes from UTC
 */
export function getTimezoneOffsetMinutes(timezone: string, date: Date = new Date()): number {
  // Get the time in UTC
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  // Get the time in the target timezone
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));

  return (utcDate.getTime() - tzDate.getTime()) / 60000;
}

/**
 * Gets the timezone abbreviation (e.g., "EST", "PST", "GMT").
 *
 * @param timezone - IANA timezone identifier
 * @param date - The date to check (affects DST abbreviation)
 * @returns Timezone abbreviation
 */
export function getTimezoneAbbreviation(timezone: string, date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  });

  const parts = formatter.formatToParts(date);
  const tzPart = parts.find((part) => part.type === 'timeZoneName');

  return tzPart?.value ?? timezone;
}

/**
 * Gets the timezone offset as a formatted string (e.g., "-05:00", "+05:30").
 *
 * @param timezone - IANA timezone identifier
 * @param date - The date to check
 * @returns Formatted offset string
 */
export function getTimezoneOffsetString(timezone: string, date: Date = new Date()): string {
  const offsetMinutes = getTimezoneOffsetMinutes(timezone, date);
  const sign = offsetMinutes <= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;

  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Gets a formatted display string for a timezone (e.g., "EST (UTC-05:00)").
 *
 * @param timezone - IANA timezone identifier
 * @param date - The date to check
 * @returns Display string
 */
export function getTimezoneDisplayString(timezone: string, date: Date = new Date()): string {
  const abbrev = getTimezoneAbbreviation(timezone, date);
  const offset = getTimezoneOffsetString(timezone, date);

  // If abbreviation is the full timezone name, just show with offset
  if (abbrev === timezone || abbrev.includes('/')) {
    return `${timezone} (UTC${offset})`;
  }

  return `${abbrev} (UTC${offset})`;
}

/**
 * Gets timezone info including offset string and current time display.
 * Useful for timezone selector UIs.
 *
 * @param timezone - IANA timezone identifier
 * @param now - Reference date (defaults to current time)
 * @returns Object with offset string, current time, and offset in minutes
 */
export function getTimezoneInfo(
  timezone: string,
  now: Date = new Date(),
): { offset: string; time: string; offsetMinutes: number } {
  try {
    const time = formatTimeInTimezone(now, timezone);
    const offsetMinutes = -getTimezoneOffsetMinutes(timezone, now); // Negate for conventional display
    const absMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absMinutes / 60);
    const mins = absMinutes % 60;
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const offset =
      mins > 0
        ? `UTC${sign}${String(hours)}:${mins.toString().padStart(2, '0')}`
        : `UTC${sign}${String(hours)}`;

    return { offset, time, offsetMinutes };
  } catch {
    return { offset: 'UTC', time: '--:--', offsetMinutes: 0 };
  }
}

// =============================================================================
// Date Component Extraction
// =============================================================================

/**
 * Gets a specific date component in the specified timezone.
 */
export function getDatePartInTimezone(
  date: Date,
  part: 'year' | 'month' | 'day' | 'hour' | 'minute',
  timezone: string,
): number {
  const options: Intl.DateTimeFormatOptions = { timeZone: timezone };

  switch (part) {
    case 'year':
      options.year = 'numeric';
      break;
    case 'month':
      options.month = 'numeric';
      break;
    case 'day':
      options.day = 'numeric';
      break;
    case 'hour':
      options.hour = 'numeric';
      options.hour12 = false;
      break;
    case 'minute':
      options.minute = 'numeric';
      break;
  }

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const formatted = formatter.format(date);

  return parseInt(formatted, 10);
}

/**
 * Gets the hour of day (0-23) for a date in the specified timezone.
 */
export function getHourInTimezone(date: Date, timezone: string): number {
  return getDatePartInTimezone(date, 'hour', timezone);
}

/**
 * Gets the minutes (0-59) for a date in the specified timezone.
 */
export function getMinutesInTimezone(date: Date, timezone: string): number {
  return getDatePartInTimezone(date, 'minute', timezone);
}

// =============================================================================
// Timezone Validation
// =============================================================================

/**
 * Checks if a timezone identifier is valid.
 *
 * @param timezone - Timezone identifier to validate
 * @returns True if valid IANA timezone
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Common Timezone List
// =============================================================================

/**
 * Timezone entry with human-readable label and region grouping.
 */
export interface TimezoneEntry {
  value: string;
  label: string;
  region: string;
}

/**
 * Region ordering for timezone dropdowns.
 */
export const REGION_ORDER = [
  'UTC',
  'Americas',
  'Europe',
  'Africa',
  'Middle East',
  'Asia',
  'Oceania',
] as const;

/**
 * Common timezones grouped by region.
 * Comprehensive list covering major cities and time zones.
 */
export const COMMON_TIMEZONES: TimezoneEntry[] = [
  // UTC
  { value: 'UTC', label: 'UTC', region: 'UTC' },

  // Americas - North
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)', region: 'Americas' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)', region: 'Americas' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)', region: 'Americas' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)', region: 'Americas' },
  { value: 'America/Anchorage', label: 'Alaska Time', region: 'Americas' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time', region: 'Americas' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)', region: 'Americas' },
  { value: 'America/Toronto', label: 'Toronto', region: 'Americas' },
  { value: 'America/Vancouver', label: 'Vancouver', region: 'Americas' },

  // Americas - Central & South
  { value: 'America/Mexico_City', label: 'Mexico City', region: 'Americas' },
  { value: 'America/Bogota', label: 'Bogota', region: 'Americas' },
  { value: 'America/Lima', label: 'Lima', region: 'Americas' },
  { value: 'America/Santiago', label: 'Santiago', region: 'Americas' },
  { value: 'America/Sao_Paulo', label: 'Sao Paulo', region: 'Americas' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires', region: 'Americas' },
  { value: 'America/Caracas', label: 'Caracas', region: 'Americas' },

  // Europe
  { value: 'Europe/London', label: 'London (GMT/BST)', region: 'Europe' },
  { value: 'Europe/Dublin', label: 'Dublin', region: 'Europe' },
  { value: 'Europe/Paris', label: 'Paris', region: 'Europe' },
  { value: 'Europe/Berlin', label: 'Berlin', region: 'Europe' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam', region: 'Europe' },
  { value: 'Europe/Brussels', label: 'Brussels', region: 'Europe' },
  { value: 'Europe/Madrid', label: 'Madrid', region: 'Europe' },
  { value: 'Europe/Rome', label: 'Rome', region: 'Europe' },
  { value: 'Europe/Zurich', label: 'Zurich', region: 'Europe' },
  { value: 'Europe/Stockholm', label: 'Stockholm', region: 'Europe' },
  { value: 'Europe/Oslo', label: 'Oslo', region: 'Europe' },
  { value: 'Europe/Helsinki', label: 'Helsinki', region: 'Europe' },
  { value: 'Europe/Warsaw', label: 'Warsaw', region: 'Europe' },
  { value: 'Europe/Prague', label: 'Prague', region: 'Europe' },
  { value: 'Europe/Vienna', label: 'Vienna', region: 'Europe' },
  { value: 'Europe/Athens', label: 'Athens', region: 'Europe' },
  { value: 'Europe/Istanbul', label: 'Istanbul', region: 'Europe' },
  { value: 'Europe/Moscow', label: 'Moscow', region: 'Europe' },
  { value: 'Europe/Kyiv', label: 'Kyiv', region: 'Europe' },

  // Africa
  { value: 'Africa/Cairo', label: 'Cairo', region: 'Africa' },
  { value: 'Africa/Lagos', label: 'Lagos', region: 'Africa' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg', region: 'Africa' },
  { value: 'Africa/Nairobi', label: 'Nairobi', region: 'Africa' },
  { value: 'Africa/Casablanca', label: 'Casablanca', region: 'Africa' },
  { value: 'Africa/Accra', label: 'Accra', region: 'Africa' },
  { value: 'Africa/Addis_Ababa', label: 'Addis Ababa', region: 'Africa' },
  { value: 'Africa/Algiers', label: 'Algiers', region: 'Africa' },
  { value: 'Africa/Tunis', label: 'Tunis', region: 'Africa' },
  { value: 'Africa/Dar_es_Salaam', label: 'Dar es Salaam', region: 'Africa' },

  // Middle East
  { value: 'Asia/Dubai', label: 'Dubai', region: 'Middle East' },
  { value: 'Asia/Riyadh', label: 'Riyadh', region: 'Middle East' },
  { value: 'Asia/Jerusalem', label: 'Jerusalem', region: 'Middle East' },
  { value: 'Asia/Tehran', label: 'Tehran', region: 'Middle East' },
  { value: 'Asia/Baghdad', label: 'Baghdad', region: 'Middle East' },
  { value: 'Asia/Kuwait', label: 'Kuwait', region: 'Middle East' },
  { value: 'Asia/Qatar', label: 'Doha', region: 'Middle East' },

  // Asia - South
  { value: 'Asia/Kolkata', label: 'India (IST)', region: 'Asia' },
  { value: 'Asia/Mumbai', label: 'Mumbai', region: 'Asia' },
  { value: 'Asia/Karachi', label: 'Karachi', region: 'Asia' },
  { value: 'Asia/Dhaka', label: 'Dhaka', region: 'Asia' },
  { value: 'Asia/Colombo', label: 'Colombo', region: 'Asia' },
  { value: 'Asia/Kathmandu', label: 'Kathmandu', region: 'Asia' },

  // Asia - Southeast
  { value: 'Asia/Singapore', label: 'Singapore', region: 'Asia' },
  { value: 'Asia/Bangkok', label: 'Bangkok', region: 'Asia' },
  { value: 'Asia/Jakarta', label: 'Jakarta', region: 'Asia' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City', region: 'Asia' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur', region: 'Asia' },
  { value: 'Asia/Manila', label: 'Manila', region: 'Asia' },

  // Asia - East
  { value: 'Asia/Shanghai', label: 'China (CST)', region: 'Asia' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong', region: 'Asia' },
  { value: 'Asia/Taipei', label: 'Taipei', region: 'Asia' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', region: 'Asia' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)', region: 'Asia' },

  // Oceania
  { value: 'Australia/Sydney', label: 'Sydney (AEST)', region: 'Oceania' },
  { value: 'Australia/Melbourne', label: 'Melbourne', region: 'Oceania' },
  { value: 'Australia/Brisbane', label: 'Brisbane (no DST)', region: 'Oceania' },
  { value: 'Australia/Perth', label: 'Perth (AWST)', region: 'Oceania' },
  { value: 'Australia/Adelaide', label: 'Adelaide', region: 'Oceania' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)', region: 'Oceania' },
  { value: 'Pacific/Fiji', label: 'Fiji', region: 'Oceania' },
  { value: 'Pacific/Guam', label: 'Guam', region: 'Oceania' },
];
