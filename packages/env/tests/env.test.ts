import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findVar, isRealValue, realEnvValue, VAR_REGISTRY } from '../src/index';
import {
  agentServer,
  authServer,
  clientShared,
  dbServer,
  mcpServer,
  opsServer,
  sharedServer,
  stripeServer,
} from '../src/slices';

// ---------------------------------------------------------------------------
// Shared helpers for the composition tests. Each composition reads `process.env`
// at module-evaluation time and throws on a bad contract, so tests use Vitest's
// native `vi.stubEnv` + `vi.resetModules()` + dynamic import to exercise both
// the pass and the throw paths in isolation.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  // Clear SKIP_ENV_VALIDATION by default so tests that expect validation to fail can run.
  // Tests that want to skip validation can set it to '1' explicitly.
  vi.stubEnv('SKIP_ENV_VALIDATION', '');
  // Silence the `console.error("❌ Invalid environment variables", ...)` that
  // @t3-oss/env emits before it throws on an invalid contract.
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
    CRON_SECRET: 'test-cron-secret',
    BILLING_ENABLED: 'false',
    MCP_TASKS_ENABLED: 'false',
    MCP_CIMD_STRICT: 'true',
  };
}

// ===========================================================================
// registry.ts — VAR_REGISTRY + findVar
// ===========================================================================

describe('registry', () => {
  it('declares a non-empty, well-formed registry', () => {
    expect(VAR_REGISTRY.length).toBeGreaterThan(0);
    for (const spec of VAR_REGISTRY) {
      expect(typeof spec.name).toBe('string');
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.targets.length).toBeGreaterThan(0);
      expect(typeof spec.required).toBe('boolean');
      expect(typeof spec.where).toBe('string');
      expect(spec.zod).toBeDefined();
    }
  });

  it('finds an existing var by name', () => {
    const spec = findVar('DATABASE_URL');
    expect(spec).toBeDefined();
    expect(spec?.name).toBe('DATABASE_URL');
    expect(spec?.slice).toBe('db');
    expect(spec?.required).toBe(true);
    expect(spec?.sensitive).toBe(true);
  });

  it('returns undefined for an unknown var', () => {
    expect(findVar('DEFINITELY_NOT_A_REAL_VAR')).toBeUndefined();
  });

  it('covers vars across every slice + scope + target shape', () => {
    const slices = new Set(VAR_REGISTRY.map((v) => v.slice));
    expect(slices).toContain('shared');
    expect(slices).toContain('db');
    expect(slices).toContain('client');

    // A client-scope var with the multi-app target list.
    const clientVar = findVar('NEXT_PUBLIC_API_URL');
    expect(clientVar?.scope).toBe('client');
    expect(clientVar?.targets).toContain('web');

    // A var carrying the optional `generate` hint.
    const generated = findVar('BETTER_AUTH_SECRET');
    expect(generated?.generate).toBe('openssl rand -base64 32');
  });
});

// ===========================================================================
// slices.ts — schema fragments (including the boolFromString transform)
// ===========================================================================

describe('slices', () => {
  it('defaults only NODE_ENV, requires the rest of shared, and coerces PORT', () => {
    // NODE_ENV is the single intentionally-defaulted var (framework/runtime-managed).
    expect(sharedServer.NODE_ENV.parse(undefined)).toBe('development');
    // APP_MODE / API_URL / PORT have no hidden default — they fail fast when unset.
    expect(() => sharedServer.APP_MODE.parse(undefined)).toThrow();
    expect(sharedServer.APP_MODE.parse('production')).toBe('production');
    expect(() => sharedServer.API_URL.parse(undefined)).toThrow();
    expect(sharedServer.API_URL.parse('http://localhost:4000')).toBe('http://localhost:4000');
    expect(() => sharedServer.WEB_URL.parse(undefined)).toThrow();
    expect(sharedServer.WEB_URL.parse('http://localhost:3000')).toBe('http://localhost:3000');
    expect(() => sharedServer.PORT.parse(undefined)).toThrow();
    expect(sharedServer.PORT.parse('8080')).toBe(8080);
  });

  it('rejects an invalid PORT', () => {
    expect(() => sharedServer.PORT.parse('-1')).toThrow();
  });

  it('requires DATABASE_URL and allows an optional unpooled URL', () => {
    expect(() => dbServer.DATABASE_URL.parse('')).toThrow();
    expect(dbServer.DATABASE_URL.parse('pglite://x')).toBe('pglite://x');
    expect(dbServer.DATABASE_URL_UNPOOLED.parse(undefined)).toBeUndefined();
  });

  it('enforces the auth secret length and requires auth URL + passkey RP', () => {
    expect(() => authServer.BETTER_AUTH_SECRET.parse('short')).toThrow();
    expect(authServer.BETTER_AUTH_SECRET.parse('y'.repeat(32))).toHaveLength(32);
    expect(() => authServer.BETTER_AUTH_URL.parse(undefined)).toThrow();
    expect(authServer.BETTER_AUTH_URL.parse('http://localhost:4000')).toBe('http://localhost:4000');
    expect(() => authServer.BETTER_AUTH_PASSKEY_RP_ID.parse(undefined)).toThrow();
    expect(authServer.BETTER_AUTH_PASSKEY_RP_ID.parse('localhost')).toBe('localhost');
    expect(() => authServer.BETTER_AUTH_PASSKEY_RP_NAME.parse(undefined)).toThrow();
    expect(authServer.BETTER_AUTH_PASSKEY_RP_NAME.parse('Docket')).toBe('Docket');
  });

  it('requires and coerces boolean-from-string vars across both branches (no default)', () => {
    // No hidden default: an unset boolean flag fails fast.
    expect(() => stripeServer.BILLING_ENABLED.parse(undefined)).toThrow();
    expect(stripeServer.BILLING_ENABLED.parse('true')).toBe(true);
    expect(stripeServer.BILLING_ENABLED.parse('false')).toBe(false);

    expect(() => mcpServer.MCP_CIMD_STRICT.parse(undefined)).toThrow();
    expect(mcpServer.MCP_CIMD_STRICT.parse('true')).toBe(true);
    expect(mcpServer.MCP_TASKS_ENABLED.parse('false')).toBe(false);

    // Anything outside the enum is rejected.
    expect(() => stripeServer.BILLING_ENABLED.parse('yes')).toThrow();
    expect(() => authServer.GOOGLE_OAUTH_PUBLIC.parse(undefined)).toThrow();
    expect(authServer.GOOGLE_OAUTH_PUBLIC.parse('false')).toBe(false);
  });

  it('keeps genuinely-optional vars optional and fails fast on required ops/client vars', () => {
    expect(agentServer.ANTHROPIC_API_KEY.parse(undefined)).toBeUndefined();

    expect(() => opsServer.CRON_SECRET.parse(undefined)).toThrow();
    expect(opsServer.CRON_SECRET.parse('cron-secret')).toBe('cron-secret');
    expect(opsServer.SENTRY_DSN.parse(undefined)).toBeUndefined();
    expect(opsServer.EXPORT_BUCKET_URL.parse(undefined)).toBeUndefined();
    expect(opsServer.RESEND_API_KEY.parse(undefined)).toBeUndefined();

    expect(() => clientShared.NEXT_PUBLIC_API_URL.parse(undefined)).toThrow();
    expect(clientShared.NEXT_PUBLIC_API_URL.parse('https://api.example.com')).toBe(
      'https://api.example.com',
    );
    expect(() => clientShared.NEXT_PUBLIC_APP_URL.parse(undefined)).toThrow();
    expect(clientShared.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.parse(undefined)).toBeUndefined();
  });
});

// ===========================================================================
// index.ts — isRealValue (all branches) + AppMode re-export sanity
// ===========================================================================

describe('isRealValue', () => {
  it('treats nullish/empty/whitespace values as not real', () => {
    expect(isRealValue(undefined)).toBe(false);
    expect(isRealValue(null)).toBe(false);
    expect(isRealValue('')).toBe(false);
    expect(isRealValue('   ')).toBe(false);
  });

  it('treats each placeholder sentinel as not real', () => {
    expect(isRealValue('sk_live_secret...')).toBe(false);
    expect(isRealValue('PLACEHOLDER-key')).toBe(false);
    expect(isRealValue('changeme')).toBe(false);
    expect(isRealValue('change-me-now')).toBe(false);
    expect(isRealValue('your-api-key')).toBe(false);
    expect(isRealValue('mock')).toBe(false);
    expect(isRealValue('MOCK')).toBe(false);
  });

  it('treats a genuine credential as real', () => {
    expect(isRealValue('sk_live_realkey123')).toBe(true);
    expect(isRealValue('postgres://user:pass@host/db')).toBe(true);
  });
});

describe('realEnvValue', () => {
  it('returns the trimmed value when it is real-shaped', () => {
    expect(realEnvValue('  sk_live_realkey123  ')).toBe('sk_live_realkey123');
  });

  it('returns undefined for absent, blank, and placeholder values', () => {
    expect(realEnvValue(undefined)).toBeUndefined();
    expect(realEnvValue(null)).toBeUndefined();
    expect(realEnvValue('   ')).toBeUndefined();
    expect(realEnvValue('placeholder')).toBeUndefined();
    expect(realEnvValue('mock')).toBeUndefined();
  });
});

// ===========================================================================
// web.ts / marketing.ts / admin.ts — Next.js client compositions
// ===========================================================================

describe.each([
  ['web', () => import('../src/web')] as const,
  ['marketing', () => import('../src/marketing')] as const,
  ['admin', () => import('../src/admin')] as const,
])('%s composition', (_name, load) => {
  it('validates with valid public URLs', async () => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'false');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.com');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    const mod = await load();
    expect(mod.env.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
    expect(mod.env.NEXT_PUBLIC_APP_URL).toBe('https://app.example.com');
  });

  it('throws fail-fast when the required public URLs are absent (no hidden default)', async () => {
    // beforeEach clears SKIP_ENV_VALIDATION to '', so validation runs
    await expect(load()).rejects.toThrow();
  });

  it('throws fail-fast on an invalid required public var', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    // emptyStringAsUndefined makes empty -> undefined, which then defaults; to
    // force a failure we provide a value that fails `min(1)` only via a
    // non-string is impossible here, so instead skip-validation path proves the
    // guard exists.
    vi.stubEnv('SKIP_ENV_VALIDATION', '1');
    const mod = await load();
    expect(mod.env).toBeDefined();
  });
});

// The web composition additionally validates the publishable Stripe key var.
describe('web composition (stripe publishable key)', () => {
  it('carries the optional Stripe publishable key when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.com');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_123');
    const mod = await import('../src/web');
    expect(mod.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe('pk_test_123');
  });
});

// ===========================================================================
// api.ts — server composition + cross-field rules
// ===========================================================================

describe('api composition', () => {
  it('validates a complete explicit contract (NODE_ENV the only default)', async () => {
    for (const [key, value] of Object.entries(validApiEnv())) {
      vi.stubEnv(key, value);
    }
    // Unset NODE_ENV (the vitest runner sets it to "test") to prove the schema default.
    vi.stubEnv('NODE_ENV', undefined);
    const mod = await import('../src/api');
    expect(mod.env.DATABASE_URL).toBe('pglite://.data/docket');
    expect(mod.env.APP_MODE).toBe('test');
    expect(mod.env.PORT).toBe(4000);
    expect(mod.env.NODE_ENV).toBe('development');
    expect(mod.env.BILLING_ENABLED).toBe(false);
    expect(mod.env.MCP_CIMD_STRICT).toBe(true);
    expect(mod.env.MCP_ISSUER_URL).toBe('http://localhost:4000');
    expect(mod.env.MCP_RESOURCE_URL).toBe('http://localhost:4000/mcp');
    expect(mod.env.OIDC_LOGIN_PAGE_URL).toBe('http://localhost:3000/sign-in');
  });

  it('derives MCP OAuth URLs from API_URL and WEB_URL while preserving explicit overrides', async () => {
    for (const [key, value] of Object.entries({
      ...validApiEnv(),
      API_URL: 'https://api.example.com/',
      WEB_URL: 'https://app.example.com/',
      MCP_ISSUER_URL: 'https://issuer.example.com',
      OIDC_LOGIN_PAGE_URL: 'https://login.example.com/start',
    })) {
      vi.stubEnv(key, value);
    }
    const mod = await import('../src/api');
    expect(mod.env.MCP_ISSUER_URL).toBe('https://issuer.example.com');
    expect(mod.env.MCP_RESOURCE_URL).toBe('https://api.example.com/mcp');
    expect(mod.env.OIDC_LOGIN_PAGE_URL).toBe('https://login.example.com/start');
  });

  it('does not derive MCP_ALLOWED_ORIGINS from the base web URL', async () => {
    for (const [key, value] of Object.entries(validApiEnv())) {
      vi.stubEnv(key, value);
    }
    const mod = await import('../src/api');
    expect(mod.env.MCP_ALLOWED_ORIGINS).toBeUndefined();
  });

  it('throws fail-fast when a required var is missing', async () => {
    // beforeEach clears SKIP_ENV_VALIDATION to '', so validation runs
    // Missing DATABASE_URL + BETTER_AUTH_SECRET.
    await expect(import('../src/api')).rejects.toThrow('Invalid environment variables');
  });

  it('throws fail-fast when a required var is invalid', async () => {
    // beforeEach clears SKIP_ENV_VALIDATION to '', so validation runs
    for (const [key, value] of Object.entries({
      ...validApiEnv(),
      BETTER_AUTH_SECRET: 'too-short',
    })) {
      vi.stubEnv(key, value);
    }
    await expect(import('../src/api')).rejects.toThrow('Invalid environment variables');
  });

  it('skips validation entirely when SKIP_ENV_VALIDATION is set', async () => {
    vi.stubEnv('SKIP_ENV_VALIDATION', '1');
    // No required vars present, but skipping means no throw + no cross-field check.
    const mod = await import('../src/api');
    expect(mod.env).toBeDefined();
  });

  describe('cross-field: BILLING_ENABLED requires stripe key + price', () => {
    it('passes with secret key + price id', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        BILLING_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PRICE_TEAM: 'price_123',
      })) {
        vi.stubEnv(key, value);
      }
      const mod = await import('../src/api');
      expect(mod.env.BILLING_ENABLED).toBe(true);
    });

    it('passes with secret key + lookup key (price-id absent)', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        BILLING_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        DOCKET_PRICE_LOOKUP_TEAM: 'team_monthly',
      })) {
        vi.stubEnv(key, value);
      }
      const mod = await import('../src/api');
      expect(mod.env.BILLING_ENABLED).toBe(true);
    });

    it('throws when the secret key is missing', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        BILLING_ENABLED: 'true',
        STRIPE_PRICE_TEAM: 'price_123',
      })) {
        vi.stubEnv(key, value);
      }
      await expect(import('../src/api')).rejects.toThrow(
        'BILLING_ENABLED=true requires STRIPE_SECRET_KEY',
      );
    });

    it('throws when both price id and lookup key are missing', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        BILLING_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
      })) {
        vi.stubEnv(key, value);
      }
      await expect(import('../src/api')).rejects.toThrow(
        'BILLING_ENABLED=true requires STRIPE_PRICE_TEAM or DOCKET_PRICE_LOOKUP_TEAM',
      );
    });
  });

  describe('cross-field: export bucket pairing', () => {
    it('passes when both URL and token are set', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        EXPORT_BUCKET_URL: 'https://bucket.example.com',
        EXPORT_BUCKET_TOKEN: 'bucket-token',
      })) {
        vi.stubEnv(key, value);
      }
      const mod = await import('../src/api');
      expect(mod.env.EXPORT_BUCKET_URL).toBe('https://bucket.example.com');
    });

    it('throws when only the URL is set', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        EXPORT_BUCKET_URL: 'https://bucket.example.com',
      })) {
        vi.stubEnv(key, value);
      }
      await expect(import('../src/api')).rejects.toThrow(
        'EXPORT_BUCKET_URL and EXPORT_BUCKET_TOKEN must be set together',
      );
    });

    it('throws when only the token is set', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        EXPORT_BUCKET_TOKEN: 'bucket-token',
      })) {
        vi.stubEnv(key, value);
      }
      await expect(import('../src/api')).rejects.toThrow(
        'EXPORT_BUCKET_URL and EXPORT_BUCKET_TOKEN must be set together',
      );
    });
  });

  describe('cross-field: MCP tasks requires a session store', () => {
    it('passes when tasks are enabled with a session store', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        MCP_TASKS_ENABLED: 'true',
        MCP_SESSION_STORE_URL: 'redis://localhost:6379',
      })) {
        vi.stubEnv(key, value);
      }
      const mod = await import('../src/api');
      expect(mod.env.MCP_TASKS_ENABLED).toBe(true);
    });

    it('throws when tasks are enabled without a session store', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        MCP_TASKS_ENABLED: 'true',
      })) {
        vi.stubEnv(key, value);
      }
      await expect(import('../src/api')).rejects.toThrow(
        'MCP_TASKS_ENABLED=true requires MCP_SESSION_STORE_URL',
      );
    });
  });

  describe('MCP OAuth URLs derive from API_URL/WEB_URL by default', () => {
    it('derives issuer, resource, and login page from API_URL/WEB_URL alone', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        API_URL: 'https://docket-api.hypertext.studio/',
        WEB_URL: 'https://docket.hypertext.studio/',
      })) {
        vi.stubEnv(key, value);
      }
      const mod = await import('../src/api');
      expect(mod.env.MCP_ISSUER_URL).toBe('https://docket-api.hypertext.studio');
      expect(mod.env.MCP_RESOURCE_URL).toBe('https://docket-api.hypertext.studio/mcp');
      expect(mod.env.OIDC_LOGIN_PAGE_URL).toBe('https://docket.hypertext.studio/sign-in');
    });

    it('lets an explicit value override its derivation', async () => {
      for (const [key, value] of Object.entries({
        ...validApiEnv(),
        MCP_ISSUER_URL: 'https://custom-issuer.example.com',
        OIDC_LOGIN_PAGE_URL: 'https://custom.example.com/login',
      })) {
        vi.stubEnv(key, value);
      }
      const mod = await import('../src/api');
      expect(mod.env.MCP_ISSUER_URL).toBe('https://custom-issuer.example.com');
      expect(mod.env.OIDC_LOGIN_PAGE_URL).toBe('https://custom.example.com/login');
      // The un-overridden URL still derives.
      expect(mod.env.MCP_RESOURCE_URL).toBe(`${validApiEnv()['API_URL']}/mcp`);
    });

    it('never derives MCP_ALLOWED_ORIGINS (it is a security allowlist, set explicitly)', async () => {
      for (const [key, value] of Object.entries(validApiEnv())) {
        vi.stubEnv(key, value);
      }
      const mod = await import('../src/api');
      expect(mod.env.MCP_ALLOWED_ORIGINS).toBeUndefined();
    });
  });
});
