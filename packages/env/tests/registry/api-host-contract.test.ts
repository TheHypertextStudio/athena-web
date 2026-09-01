/**
 * The API's host contract: one variable per host, and nothing derived from anything else.
 *
 * @remarks
 * This replaces a suite that asserted the opposite — that an unset host would be *derived* from
 * `PUBLIC_ROOT_DOMAIN`. That derivation is gone, and these tests exist to keep it gone: a silent
 * fallback is how a half-applied domain change ships a hostname nobody configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    ADMIN_GOOGLE_SSO_ENABLED: 'false',
    WORK_LOCATION_PROJECTION_ENABLED: 'false',
    LINEAR_AGENT_ENABLED: 'false',
    AGENT_MAX_TURNS: '24',
    ATHENA_ASYNC_RUNNER_ENABLED: 'false',
    CRON_SECRET: 'test-cron-secret',
    BILLING_ENABLED: 'false',
    BILLING_RECONCILIATION_MODE: 'off',
    MCP_TASKS_ENABLED: 'false',
  };
}

/** `validApiEnv` in production mode, which is what the async-runner rules key off. */
function productionBase(): Record<string, string> {
  return {
    ...validApiEnv(),
    APP_MODE: 'production',
    LINEAR_CLIENT_ID: 'linear-client-id',
    LINEAR_CLIENT_SECRET: 'linear-client-secret',
    LINEAR_WEBHOOK_SECRET: 'linear-webhook-secret',
  };
}

function stubAll(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  // CI sets SKIP_ENV_VALIDATION, which short-circuits the cross-field rules these tests assert.
  vi.stubEnv('SKIP_ENV_VALIDATION', '');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
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
    // The Athena receiving domain has no MX records unless someone published them, so a
    // derived value would be a hostname that silently accepts no mail.
    stubAll(validApiEnv());
    const { apiHosts } = await import('../../src/api');

    expect(apiHosts.athenaMail).toBeUndefined();
    expect(apiHosts.brief).toBeUndefined();
  });

  it('collects the product’s own hosts so routing can tell them from a workspace domain', async () => {
    stubAll({
      ...validApiEnv(),
      WEB_URL: 'https://docket.example',
      API_URL: 'https://api.docket.example',
      PUBLIC_BRIEF_HOST: 'briefs.docket.example',
    });
    const { isOwnHost } = await import('../../src/api');

    expect(isOwnHost('docket.example')).toBe(true);
    expect(isOwnHost('api.docket.example')).toBe(true);
    expect(isOwnHost('briefs.docket.example')).toBe(true);
    expect(isOwnHost('example.com')).toBe(false);
  });

  it('names the variable when an origin the caller needs is unset', async () => {
    stubAll(validApiEnv());
    const { requireEnvOrigin } = await import('../../src/api');

    expect(requireEnvOrigin('https://docket.example', 'WEB_URL')).toBe('https://docket.example');
    expect(() => requireEnvOrigin(undefined, 'WEB_URL')).toThrow(/WEB_URL/);
  });
});

/*
 * These have nothing to do with hosts — they are the paired-credential rules `api.ts` enforces at
 * import. They live here because this is the suite that composes the module under stubbed env.
 */
describe('paired-credential cross-field rules', () => {
  it('rejects a half-configured OAuth proxy', async () => {
    // Half-configured silently disables the proxy, so preview OAuth fails at the provider with
    // an unregistered-redirect error rather than at boot with a readable message.
    stubAll({ ...validApiEnv(), OAUTH_PROXY_SECRET: 'proxy-secret' });
    await expect(import('../../src/api')).rejects.toThrow(
      'OAUTH_PROXY_SECRET and OAUTH_PROXY_PRODUCTION_URL must be set together.',
    );
  });

  it('accepts a fully configured OAuth proxy', async () => {
    stubAll({
      ...validApiEnv(),
      OAUTH_PROXY_SECRET: 'proxy-secret',
      OAUTH_PROXY_PRODUCTION_URL: 'https://docket.example',
    });
    const mod = await import('../../src/api');
    expect(mod.env.OAUTH_PROXY_PRODUCTION_URL).toBe('https://docket.example');
  });

  it('requires a runner URL when async execution is enabled in production', async () => {
    stubAll({ ...productionBase(), ATHENA_ASYNC_RUNNER_ENABLED: 'true' });
    await expect(import('../../src/api')).rejects.toThrow(
      'ATHENA_ASYNC_RUNNER_ENABLED=true requires CLOUDFLARE_ATHENA_RUNNER_URL.',
    );
  });

  it('requires both directional HMAC secrets when async execution is enabled', async () => {
    // One secret present is the dangerous shape: dispatch signs, callbacks cannot be verified.
    stubAll({
      ...productionBase(),
      ATHENA_ASYNC_RUNNER_ENABLED: 'true',
      CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example.com',
      DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret-long-enough',
    });
    await expect(import('../../src/api')).rejects.toThrow(
      'ATHENA_ASYNC_RUNNER_ENABLED=true requires both directional HMAC secrets.',
    );
  });

  it('rejects two identical directional HMAC secrets', async () => {
    stubAll({
      ...productionBase(),
      ATHENA_ASYNC_RUNNER_ENABLED: 'true',
      CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example.com',
      DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'same-secret-on-both-directions-long',
      CLOUDFLARE_TO_DOCKET_HMAC_SECRET: 'same-secret-on-both-directions-long',
    });
    await expect(import('../../src/api')).rejects.toThrow(
      'Cloudflare execution HMAC secrets must be distinct.',
    );
  });
});
