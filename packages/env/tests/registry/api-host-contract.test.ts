/**
 * Composition tests for the API's host contract and the cross-field rules guarding it.
 *
 * @remarks
 * Two things are proved here, and both are about a deploy that *looks* fine:
 *
 * - **`apiHostConfig` resolves from the same variables the process validated**, so a feature
 *   asking "where do published briefs live?" gets an answer that follows `PUBLIC_ROOT_DOMAIN`
 *   rather than a hostname somebody typed into a route file.
 * - **A half-applied domain cutover refuses to boot.** Moving `WEB_URL` but not `ADMIN_URL` is
 *   the realistic mistake; without this the deploy succeeds and a user-facing host stays on the
 *   domain GEN-25 requires Docket to leave.
 *
 * It also covers the paired-credential failures that had no test: the OAuth-proxy pair and the
 * two Cloudflare-runner requirements. Each of those is a rule whose *failure* branch is the
 * whole point — an untested `fail()` is a rule nobody has ever seen fire.
 *
 * Same harness as `env.test.ts`: the composition reads `process.env` at module-evaluation time
 * and throws on a bad contract, so each case stubs the environment, resets the module registry,
 * and dynamically imports.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('SKIP_ENV_VALIDATION', '');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A complete, valid API environment — every required var explicitly set (no hidden defaults). */
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

/** The extra variables a production composition needs before any other rule is reached. */
function productionBase(): Record<string, string> {
  return {
    ...validApiEnv(),
    APP_MODE: 'production',
    LINEAR_CLIENT_ID: 'linear-client-id',
    LINEAR_CLIENT_SECRET: 'linear-client-secret',
    LINEAR_WEBHOOK_SECRET: 'linear-webhook-secret',
  };
}

/** Stub every entry of `env` for the duration of one test. */
function stubAll(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

describe('apiHostConfig', () => {
  it('derives every host from the apex when only PUBLIC_ROOT_DOMAIN is set', async () => {
    stubAll({
      ...validApiEnv(),
      PUBLIC_ROOT_DOMAIN: 'docket.example',
      WEB_URL: 'https://docket.example',
      API_URL: 'https://api.docket.example',
    });
    const { apiHostConfig } = await import('../../src/api');

    expect(apiHostConfig.rootDomain).toBe('docket.example');
    expect(apiHostConfig.hosts.brief?.host).toBe('briefs.docket.example');
    expect(apiHostConfig.hosts.admin?.host).toBe('admin.docket.example');
    expect(apiHostConfig.customDomainTarget).toBe('briefs.docket.example');
    expect(apiHostConfig.supportEmail).toBe('support@docket.example');
  });

  it('reads the Athena inbound-mail host from configuration and never invents one', async () => {
    // ACH-23: the interim receiving domain is a value, so the final domain replaces it without
    // a code change. Unset means unset — a derived host would have no MX records.
    stubAll(validApiEnv());
    const unset = await import('../../src/api');
    expect(unset.apiHostConfig.hosts['athena-mail']).toBeUndefined();

    vi.resetModules();
    stubAll({ ...validApiEnv(), ATHENA_INBOUND_MAIL_HOST: 'inbox.athena.example.test' });
    const configured = await import('../../src/api');
    expect(configured.apiHostConfig.hosts['athena-mail']?.host).toBe('inbox.athena.example.test');
  });

  it('lets explicit variables override the derived hosts', async () => {
    stubAll({
      ...validApiEnv(),
      PUBLIC_ROOT_DOMAIN: 'docket.example',
      ADMIN_URL: 'https://ops.docket.example',
      PUBLIC_BRIEF_HOST: 'read.docket.example',
      CUSTOM_DOMAIN_CNAME_TARGET: 'edge.docket.example',
      SUPPORT_EMAIL: 'hello@docket.example',
    });
    const { apiHostConfig } = await import('../../src/api');

    expect(apiHostConfig.hosts.admin?.host).toBe('ops.docket.example');
    expect(apiHostConfig.hosts.brief?.host).toBe('read.docket.example');
    expect(apiHostConfig.customDomainTarget).toBe('edge.docket.example');
    expect(apiHostConfig.supportEmail).toBe('hello@docket.example');
  });
});

describe('production host isolation', () => {
  it('boots when every user-facing host sits on the apex', async () => {
    stubAll({
      ...productionBase(),
      PUBLIC_ROOT_DOMAIN: 'docket.example',
      WEB_URL: 'https://docket.example',
      API_URL: 'https://api.docket.example',
      ADMIN_URL: 'https://admin.docket.example',
    });
    const mod = await import('../../src/api');
    expect(mod.apiHostConfig.rootDomain).toBe('docket.example');
  });

  it('refuses to boot on a half-applied cutover', async () => {
    // The realistic mistake: the apex and the web app moved, the back-office did not.
    stubAll({
      ...productionBase(),
      PUBLIC_ROOT_DOMAIN: 'docket.example',
      WEB_URL: 'https://docket.example',
      API_URL: 'https://api.docket.example',
      ADMIN_URL: 'https://docket-admin.legacy.test',
    });
    await expect(import('../../src/api')).rejects.toThrow(/admin=docket-admin\.legacy\.test/);
  });

  it('permits the Athena inbound-mail host to stay off the apex', async () => {
    // GEN-25's one stated exception, and the only one.
    stubAll({
      ...productionBase(),
      PUBLIC_ROOT_DOMAIN: 'docket.example',
      WEB_URL: 'https://docket.example',
      API_URL: 'https://api.docket.example',
      ADMIN_URL: 'https://admin.docket.example',
      ATHENA_INBOUND_MAIL_HOST: 'inbox.athena.legacy.test',
    });
    const mod = await import('../../src/api');
    expect(mod.apiHostConfig.hosts['athena-mail']?.host).toBe('inbox.athena.legacy.test');
  });

  it('does not run in non-production modes', async () => {
    // Local and preview deploys legitimately mix hosts (a branch subdomain, a tunnel), and a
    // developer stack must not be blocked by a rule that exists for the production cutover.
    stubAll({
      ...validApiEnv(),
      PUBLIC_ROOT_DOMAIN: 'docket.example',
      ADMIN_URL: 'https://docket-admin.legacy.test',
    });
    const mod = await import('../../src/api');
    expect(mod.env.APP_MODE).toBe('test');
  });
});

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
});
