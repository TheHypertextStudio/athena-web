/**
 * Environment configuration for the web app.
 *
 * Single source of truth for all environment variables.
 * All modules should import from here instead of reading process.env directly.
 *
 * @packageDocumentation
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Public environment variables available in the browser.
 */
export const env = {
  /** Base URL for the API server */
  API_URL: requireEnv('NEXT_PUBLIC_API_URL'),
} as const;
