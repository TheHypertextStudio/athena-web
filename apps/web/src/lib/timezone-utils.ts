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

// Note: For a comprehensive timezone list with regions, see COMMON_TIMEZONES
// in components/settings/account/preferences-actions.tsx
