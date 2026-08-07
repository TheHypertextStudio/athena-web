/**
 * The API's host contract: one variable per host, and nothing derived from anything else.
 *
 * @remarks
 * This replaces a suite that asserted the opposite — that an unset host would be *derived* from
 * `PUBLIC_ROOT_DOMAIN`. That derivation is gone, and these tests exist to keep it gone: a silent
 * fallback is how a half-applied domain change ships a hostname nobody configured.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The minimum a `@docket/env/api` import needs to compose without throwing. */
function validApiEnv(): Record<string, string> {
  return {
    APP_MODE: 'test',
    API_URL: 'http://localhost:4000',
    WEB_URL: 'http://localhost:3000',
    PORT: '4000',
    DATABASE_URL: 'pglite://.data/docket',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:4000',
    BETTER_AUTH_PASSKEY_RP_ID: 'localhost',
    BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
    GOOGLE_OAUTH_PUBLIC: 'false',
    AGENT_MAX_TURNS: '24',
    ATHENA_ASYNC_RUNNER_ENABLED: 'false',
    CRON_SECRET: 'test-cron-secret',
    BILLING_ENABLED: 'false',
    MCP_TASKS_ENABLED: 'false',
    MCP_CIMD_STRICT: 'true',
  };
}

function stubAll(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('apiHosts', () => {
  it('reads each host from its own variable', async () => {
    stubAll({
      ...validApiEnv(),
      WEB_URL: 'https://docket.example',
      API_URL: 'https://api.docket.example',
      ADMIN_URL: 'https://admin.docket.example',
      PUBLIC_BRIEF_HOST: 'briefs.docket.example',
      ATHENA_INBOUND_MAIL_HOST: 'inbox.athena.example.test',
    });
    const { apiHosts } = await import('../../src/api');

    expect(apiHosts.app).toBe('https://docket.example');
    expect(apiHosts.api).toBe('https://api.docket.example');
    expect(apiHosts.admin).toBe('https://admin.docket.example');
    expect(apiHosts.brief).toBe('briefs.docket.example');
    expect(apiHosts.athenaMail).toBe('inbox.athena.example.test');
  });

  it('leaves an unconfigured host undefined rather than inventing one', async () => {
    // ACH-23: the Athena receiving domain has no MX records unless someone published them, so a
    // derived value would be a hostname that silently accepts no mail.
    stubAll(validApiEnv());
    const { apiHosts } = await import('../../src/api');

    expect(apiHosts.athenaMail).toBeUndefined();
    expect(apiHosts.brief).toBeUndefined();
  });

  it('collects the product’s own hosts for the custom-domain reservation', async () => {
    stubAll({
      ...validApiEnv(),
      WEB_URL: 'https://docket.example',
      API_URL: 'https://api.docket.example',
      PUBLIC_BRIEF_HOST: 'briefs.docket.example',
    });
    const { isOwnHost, RESERVED_HOSTS } = await import('../../src/api');

    expect(isOwnHost('docket.example')).toBe(true);
    expect(isOwnHost('api.docket.example')).toBe(true);
    expect(isOwnHost('briefs.docket.example')).toBe(true);
    expect(isOwnHost('example.com')).toBe(false);
    expect(RESERVED_HOSTS.apex).toBe('docket.example');
  });
});
