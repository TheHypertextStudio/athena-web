import { docketVitest } from '../../tooling/vitest/preset';

// Trust spine: 100% coverage — a silent gap here is a security/data-integrity bug.
export default docketVitest({
  coverageThreshold: 100,
  env: {
    APP_MODE: 'test',
    API_URL: 'http://localhost:4000',
    WEB_URL: 'http://localhost:3000',
    PORT: '4000',
    DATABASE_URL: 'pglite://memory',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    BETTER_AUTH_URL: 'http://localhost:4000',
    BETTER_AUTH_PASSKEY_RP_ID: 'localhost',
    BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
    BETTER_AUTH_TRUSTED_ORIGINS: 'http://a.example.com, http://b.example.com ,',
    GOOGLE_OAUTH_PUBLIC: 'false',
    ADMIN_GOOGLE_SSO_ENABLED: 'false',
    CRON_SECRET: 'test-cron-secret',
    BILLING_ENABLED: 'false',
    BILLING_RECONCILIATION_MODE: 'off',
    WORK_LOCATION_PROJECTION_ENABLED: 'false',
    MCP_TASKS_ENABLED: 'false',
    // Required by `@docket/env/api`, which the builder reaches through `backup-codes.ts`. They
    // live here rather than at the top of one test file so ANY test importing the builder gets a
    // bootable env — a per-file copy is what made adding a second such file fail.
    AGENT_MAX_TURNS: '8',
    ATHENA_ASYNC_RUNNER_ENABLED: 'false',
    LINEAR_AGENT_ENABLED: 'false',
  },
});
