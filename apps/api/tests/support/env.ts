/**
 * Baseline env Vitest assigns before API test modules import shared env/db/auth code.
 */
export const API_TEST_ENV = {
  DATABASE_URL: 'pglite://memory://',
  APP_MODE: 'test',
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
  BETTER_AUTH_TRUSTED_ORIGINS: 'https://docket.localhost',
  // Required by packages/auth's own type (no default derivation, unlike BETTER_AUTH_TRUSTED_ORIGINS'
  // siblings) — the auth-mock.ts factory constructs the REAL `@docket/auth` module before
  // overriding it (`importOriginal()`, spread into the mock), so oauthProvider's own async init
  // parses this as a URL on every test file that imports mcp/server.ts or server.ts, mocked or
  // not. Missing it doesn't fail any assertion directly — SKIP_ENV_VALIDATION hides the gap from
  // zod — it fails the whole process with an unhandled rejection instead.
  BETTER_AUTH_URL: 'https://api.docket.localhost',
  CRON_SECRET: 'test-cron-secret',
  // Both are required by the API's own env contract (`sharedServer`), and the host-config
  // contract reads every product host from its own variable — without WEB_URL, `apiHosts.app`
  // throws, so any code that dictates a product URL (the phone gating announcement) could not be
  // exercised at all. Tests that care about their absence stub them per-case.
  WEB_URL: 'https://docket.localhost',
  API_URL: 'https://api.docket.localhost',
  SKIP_ENV_VALIDATION: '1',
  AGENT_MAX_TURNS: '8',
  ATHENA_ASYNC_RUNNER_ENABLED: 'false',
  // Keep the test host eligible to run configured Agent suites. Tests still need to provide the
  // three Agent credentials, so unconfigured-route coverage continues to exercise the dark path.
  LINEAR_AGENT_ENABLED: 'true',
  BILLING_ENABLED: 'false',
  BILLING_RECONCILIATION_MODE: 'off',
  // Athena's receiving domain. The host contract deliberately never derives this, so without a
  // value `apiHosts.athenaMail` is undefined and every inbound-mail test
  // would exercise the "no inbox configured" branch instead of the pipeline.
  ATHENA_INBOUND_MAIL_HOST: 'inbox.athena.docket.localhost',
  // The host published briefs answer on. Nothing derives it any more — it used to fall out of
  // PUBLIC_ROOT_DOMAIN — so without a value `apiHosts.brief` is undefined and `briefUrls` would
  // skip its canonical entry in every test rather than only in the one that asks for that branch.
  PUBLIC_BRIEF_HOST: 'briefs.docket.localhost',
} as const satisfies Record<string, string>;
