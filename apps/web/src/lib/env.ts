/**
 * Environment configuration for the web app.
 *
 * Single source of truth for all environment variables.
 * All modules should import from here instead of reading process.env directly.
 *
 * @packageDocumentation
 */

/**
 * Public environment variables available in the browser.
 */
export const env = {
  /** Base URL for the API server */
  API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000',
} as const;
