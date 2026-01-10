/**
 * Environment configuration for the web app.
 *
 * Single source of truth for all environment variables.
 * All modules should import from here instead of reading process.env directly.
 *
 * Note: NEXT_PUBLIC_* variables must be accessed with literal keys
 * (e.g., process.env.NEXT_PUBLIC_API_URL) because Next.js replaces
 * them at build time via static analysis.
 *
 * @packageDocumentation
 */

/**
 * Public environment variables available in the browser.
 */
export const env = {
  /** Base URL for the API server */
  API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
} as const;
