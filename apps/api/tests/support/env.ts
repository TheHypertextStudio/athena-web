/**
 * Baseline env Vitest assigns before API test modules import shared env/db/auth code.
 */
export const API_TEST_ENV = {
  DATABASE_URL: 'pglite://memory://',
  APP_MODE: 'test',
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
  BETTER_AUTH_TRUSTED_ORIGINS: 'https://docket.localhost',
  CRON_SECRET: 'test-cron-secret',
  SKIP_ENV_VALIDATION: '1',
  AGENT_MAX_TURNS: '8',
} as const satisfies Record<string, string>;
