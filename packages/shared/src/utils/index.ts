/**
 * Utility functions for Project Athena.
 *
 * @packageDocumentation
 */

/**
 * Generate a random UUID v4.
 *
 * @returns A random UUID string
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Sleep for a specified number of milliseconds.
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a value is defined (not null or undefined).
 *
 * @param value - Value to check
 * @returns True if value is defined
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Assert that a value is defined, throwing an error if not.
 *
 * @param value - Value to check
 * @param message - Error message if assertion fails
 * @returns The value if defined
 * @throws Error if value is null or undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message = 'Expected value to be defined',
): T {
  if (!isDefined(value)) {
    throw new Error(message);
  }
  return value;
}

/**
 * Safely parse JSON, returning undefined on failure.
 *
 * @param json - JSON string to parse
 * @returns Parsed value or undefined
 */
export function safeParseJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Format a date as ISO 8601 string.
 *
 * @param date - Date to format
 * @returns ISO 8601 formatted string
 */
export function formatISODate(date: Date): string {
  return date.toISOString();
}

/**
 * Get the start of a day in UTC.
 *
 * @param date - Reference date
 * @returns Date at start of day (00:00:00.000 UTC)
 */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of a day in UTC.
 *
 * @param date - Reference date
 * @returns Date at end of day (23:59:59.999 UTC)
 */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Omit specified keys from an object.
 *
 * @param obj - Source object
 * @param keys - Keys to omit
 * @returns New object without the specified keys
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete result[key];
  }
  return result as Omit<T, K>;
}

/**
 * Pick specified keys from an object.
 *
 * @param obj - Source object
 * @param keys - Keys to pick
 * @returns New object with only the specified keys
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}
