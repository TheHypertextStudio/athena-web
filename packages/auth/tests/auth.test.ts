import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Env MUST be set before importing `../src/index` (which pulls in `@docket/env/api` and the
// Better Auth config at module load). Every required var is set explicitly — the env
// contract has no hidden defaults. `pglite://memory` gives a fresh in-process Postgres;
// `BETTER_AUTH_TRUSTED_ORIGINS` exercises the parse branch.
process.env['APP_MODE'] = 'test';
process.env['API_URL'] = 'http://localhost:4000';
process.env['PORT'] = '4000';
process.env['DATABASE_URL'] = 'pglite://memory';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-at-least-32-characters-long';
process.env['BETTER_AUTH_URL'] = 'http://localhost:4000';
process.env['BETTER_AUTH_PASSKEY_RP_ID'] = 'localhost';
process.env['BETTER_AUTH_PASSKEY_RP_NAME'] = 'Docket';
process.env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'http://a.example.com, http://b.example.com ,';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['BILLING_ENABLED'] = 'false';
process.env['MCP_TASKS_ENABLED'] = 'false';
process.env['MCP_CIMD_STRICT'] = 'true';

const SECRET = 'test-secret-at-least-32-characters-long';

/** Recompute the package's `payload.signature` shape for a hand-crafted payload. */
function forgeToken(payload: unknown): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payloadB64).digest().toString('base64url');
  return `${payloadB64}.${sig}`;
}

describe('passkey intent', () => {
  it('round-trips a signed intent (sign → verify happy path)', async () => {
    const { signPasskeyIntent, verifyPasskeyIntent } = await import('../src/index');

    const token = signPasskeyIntent({ name: 'Ada', email: 'ada@example.com' });
    const intent = verifyPasskeyIntent(token);
    expect(intent.name).toBe('Ada');
    expect(intent.email).toBe('ada@example.com');
    expect(typeof intent.nonce).toBe('string');
    expect(typeof intent.exp).toBe('number');
  });

  it('rejects a malformed token (missing signature segment)', async () => {
    const { verifyPasskeyIntent } = await import('../src/index');
    expect(() => verifyPasskeyIntent('only-one-segment')).toThrow('malformed token');
    expect(() => verifyPasskeyIntent('')).toThrow('malformed token');
  });

  it('rejects a tampered signature of equal length', async () => {
    const { signPasskeyIntent, verifyPasskeyIntent } = await import('../src/index');
    const token = signPasskeyIntent({ name: 'Ada', email: 'ada@example.com' });
    const [payloadB64] = token.split('.');
    // Swap in a valid signature computed over a *different* payload: it is still a
    // 43-char base64url SHA-256 digest (equal length) but mismatched (hits timingSafeEqual).
    const wrongSig = forgeToken({ tampered: true }).split('.')[1]!;
    expect(() => verifyPasskeyIntent(`${payloadB64}.${wrongSig}`)).toThrow('invalid signature');
  });

  it('rejects a signature of differing length', async () => {
    const { signPasskeyIntent, verifyPasskeyIntent } = await import('../src/index');
    const token = signPasskeyIntent({ name: 'Ada', email: 'ada@example.com' });
    const [payloadB64] = token.split('.');
    expect(() => verifyPasskeyIntent(`${payloadB64}.short`)).toThrow('invalid signature');
  });

  it('rejects an expired token (valid signature, past exp)', async () => {
    const { verifyPasskeyIntent } = await import('../src/index');
    const token = forgeToken({
      name: 'Ada',
      email: 'ada@example.com',
      nonce: 'n',
      exp: Date.now() - 1000,
    });
    expect(() => verifyPasskeyIntent(token)).toThrow('expired');
  });

  it('rejects a non-numeric exp (valid signature)', async () => {
    const { verifyPasskeyIntent } = await import('../src/index');
    const token = forgeToken({ name: 'Ada', email: 'ada@example.com', nonce: 'n', exp: 'soon' });
    expect(() => verifyPasskeyIntent(token)).toThrow('expired');
  });
});

describe('auth config', () => {
  beforeAll(async () => {
    // Migrate the lazy `@docket/db` proxy's underlying PGlite instance so the
    // Better Auth drizzle adapter + the user→hub hook have real tables to write.
    const { db } = await import('@docket/db');
    await migrate(db as never, {
      migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
    });
  });

  it('builds a Better Auth instance', async () => {
    const { auth } = await import('../src/index');
    expect(typeof auth.handler).toBe('function');
    expect(auth.api).toBeDefined();
  });

  it('parses BETTER_AUTH_TRUSTED_ORIGINS (trimmed, empties dropped)', async () => {
    const { auth } = await import('../src/index');
    expect(auth.options.trustedOrigins).toEqual(['http://a.example.com', 'http://b.example.com']);
  });

  it('births a 1:1 hub for every new user via databaseHooks.user.create.after', async () => {
    const { auth } = await import('../src/index');
    const { db, hub } = await import('@docket/db');

    const res = await auth.api.signUpEmail({
      body: { name: 'Grace', email: 'grace@example.com', password: 'password-1234' },
    });
    expect(res.user.email).toBe('grace@example.com');

    const hubs = await db.select().from(hub);
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.userId).toBe(res.user.id);
  });

  it('mounts NO social providers / oidc / mcp plugins with placeholder env (today-behavior)', async () => {
    // The live `auth` is built from the test env (gated vars unset) → every gate is
    // closed. This pins the zero-account local build to email/password + nextCookies.
    const { auth } = await import('../src/index');
    expect(auth.options.socialProviders).toBeUndefined();
    expect(auth.options.account).toBeUndefined();
    // Exactly one plugin (nextCookies); no oidc-provider / mcp.
    expect(auth.options.plugins).toHaveLength(1);
  });

  // Runs LAST: it resets the module registry, which would orphan the migrated
  // `@docket/db` proxy used by the tests above.
  it('defaults trustedOrigins to [] when BETTER_AUTH_TRUSTED_ORIGINS is unset', async () => {
    // Re-import with the env var removed so the optional-chain (`?.`) / nullish
    // (`?? []`) fallback branch of `parseTrustedOrigins` is exercised on the live `auth`.
    const prev = process.env['BETTER_AUTH_TRUSTED_ORIGINS'];
    delete process.env['BETTER_AUTH_TRUSTED_ORIGINS'];
    vi.resetModules();
    try {
      const { auth } = await import('../src/index');
      expect(auth.options.trustedOrigins).toEqual([]);
    } finally {
      if (prev !== undefined) process.env['BETTER_AUTH_TRUSTED_ORIGINS'] = prev;
      vi.resetModules();
    }
  });
});

describe('buildAuthOptions env-gating', () => {
  /** A minimal placeholder env: every optional gate closed (mirrors the local build). */
  const baseEnv = {
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: 'http://localhost:3000',
  } as const;

  it('mounts nothing optional when no gated vars are real (== today)', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv);
    expect(opts.socialProviders).toBeUndefined();
    expect(opts.account).toBeUndefined();
    expect(opts.plugins).toHaveLength(1); // nextCookies only
    expect(opts.emailAndPassword).toEqual({ enabled: true });
  });

  it('ignores half-configured social pairs (id without secret)', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      GOOGLE_CLIENT_ID: 'goog-id',
      // GOOGLE_CLIENT_SECRET missing → provider must NOT mount
      GITHUB_CLIENT_SECRET: 'gh-secret',
      // GITHUB_CLIENT_ID missing → provider must NOT mount
    });
    expect(opts.socialProviders).toBeUndefined();
    expect(opts.account).toBeUndefined();
  });

  it('treats placeholder-shaped values as not-real (isRealValue gate)', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      GOOGLE_CLIENT_ID: 'your-google-id',
      GOOGLE_CLIENT_SECRET: 'changeme',
      OIDC_LOGIN_PAGE_URL: '',
    });
    expect(opts.socialProviders).toBeUndefined();
    expect(opts.plugins).toHaveLength(1);
  });

  it('mounts Google + GitHub + Linear + account linking when all pairs are real', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      GOOGLE_CLIENT_ID: 'goog-id',
      GOOGLE_CLIENT_SECRET: 'goog-secret',
      GITHUB_CLIENT_ID: 'gh-id',
      GITHUB_CLIENT_SECRET: 'gh-secret',
      LINEAR_CLIENT_ID: 'lin-id',
      LINEAR_CLIENT_SECRET: 'lin-secret',
    });
    expect(Object.keys(opts.socialProviders ?? {}).sort()).toEqual(['github', 'google', 'linear']);
    expect(opts.socialProviders?.google).toEqual({
      clientId: 'goog-id',
      clientSecret: 'goog-secret',
    });
    expect(opts.socialProviders?.github).toEqual({ clientId: 'gh-id', clientSecret: 'gh-secret' });
    expect(opts.socialProviders?.linear).toEqual({
      clientId: 'lin-id',
      clientSecret: 'lin-secret',
    });
    expect(opts.account?.accountLinking?.enabled).toBe(true);
    expect((opts.account?.accountLinking?.trustedProviders as string[]).sort()).toEqual([
      'email-password',
      'github',
      'google',
      'linear',
    ]);
  });

  it('mounts oidcProvider (before nextCookies) when OIDC_LOGIN_PAGE_URL is real but MCP_RESOURCE_URL is not', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      OIDC_LOGIN_PAGE_URL: 'https://docket.example/sign-in',
    });
    // oidcProvider + nextCookies (no mcp).
    expect(opts.plugins).toHaveLength(2);
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).toContain('oidc-provider');
    expect(ids).not.toContain('mcp');
    // nextCookies MUST remain last.
    expect(ids[ids.length - 1]).toBe('next-cookies');
  });

  it('mounts mcp ONLY (before nextCookies) when both OIDC + MCP_RESOURCE_URL are real', async () => {
    // `mcp` internally bundles `oidcProvider`, so the standalone provider is NOT mounted
    // separately — mcp + nextCookies is the full set.
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      OIDC_LOGIN_PAGE_URL: 'https://docket.example/sign-in',
      MCP_RESOURCE_URL: 'https://docket.example/mcp',
    });
    expect(opts.plugins).toHaveLength(2);
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).toContain('mcp');
    expect(ids).not.toContain('oidc-provider');
    expect(ids[ids.length - 1]).toBe('next-cookies');
  });
});
