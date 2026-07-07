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
    CRON_SECRET: 'test-cron-secret',
    BILLING_ENABLED: 'false',
    MCP_TASKS_ENABLED: 'false',
    MCP_CIMD_STRICT: 'true',
  },
});
