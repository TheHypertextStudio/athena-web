/**
 * API version middleware for header-based versioning.
 *
 * Uses the Accept-Version header to determine API version.
 * Format: Accept-Version: 1 or Accept-Version: 2024-01-01
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';

export interface VersionContext {
  apiVersion: string;
  apiVersionDate: Date | null;
}

/**
 * Supported API versions.
 * Add new versions here as they're released.
 */
export const API_VERSIONS = {
  V1: '1',
  CURRENT: '1',
} as const;

export type ApiVersion = (typeof API_VERSIONS)[keyof typeof API_VERSIONS];

/**
 * Parse the Accept-Version header value.
 * Supports numeric versions (1, 2) or date-based versions (2024-01-01).
 */
function parseVersion(headerValue: string | undefined): {
  version: string;
  versionDate: Date | null;
} {
  if (!headerValue) {
    return { version: API_VERSIONS.CURRENT, versionDate: null };
  }

  const trimmed = headerValue.trim();

  // Try parsing as a date (YYYY-MM-DD format)
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(trimmed);
  if (dateMatch) {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return { version: trimmed, versionDate: date };
    }
  }

  // Treat as numeric version
  return { version: trimmed, versionDate: null };
}

/**
 * Check if a version is supported.
 */
export function isVersionSupported(version: string): boolean {
  const supportedVersions = Object.values(API_VERSIONS);
  return supportedVersions.includes(version as ApiVersion);
}

/**
 * Middleware that extracts and validates API version from headers.
 *
 * Sets:
 * - apiVersion: The requested API version string
 * - apiVersionDate: Date object if date-based version was used
 *
 * Response headers:
 * - X-API-Version: The version being used
 * - X-API-Deprecated: Warning if using deprecated version
 */
export async function versionMiddleware(c: Context, next: Next): Promise<void> {
  const acceptVersion = c.req.header('Accept-Version');
  const { version, versionDate } = parseVersion(acceptVersion);

  // Store version info in context
  c.set('apiVersion', version);
  c.set('apiVersionDate', versionDate);

  // Set response header to indicate version being used
  c.header('X-API-Version', version);

  // Warn if using a non-current version (for future use when we have multiple versions)
  if (version !== API_VERSIONS.CURRENT && isVersionSupported(version)) {
    c.header(
      'X-API-Deprecated',
      `Version ${version} is deprecated. Please migrate to version ${API_VERSIONS.CURRENT}.`,
    );
  }

  await next();
}

/**
 * Get the API version from context.
 */
export function getApiVersion(c: Context): string {
  return (c.get('apiVersion') as string) || API_VERSIONS.CURRENT;
}

/**
 * Check if request is using a specific version or later.
 * Useful for conditional logic based on version.
 */
export function isVersionAtLeast(c: Context, minVersion: string): boolean {
  const currentVersion = getApiVersion(c);

  // For numeric versions, compare as numbers
  const currentNum = parseInt(currentVersion, 10);
  const minNum = parseInt(minVersion, 10);

  if (!isNaN(currentNum) && !isNaN(minNum)) {
    return currentNum >= minNum;
  }

  // For date-based versions, compare as dates
  const currentDate = new Date(currentVersion);
  const minDate = new Date(minVersion);

  if (!isNaN(currentDate.getTime()) && !isNaN(minDate.getTime())) {
    return currentDate >= minDate;
  }

  // Fall back to string comparison
  return currentVersion >= minVersion;
}
