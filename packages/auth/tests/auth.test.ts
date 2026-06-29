import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Env MUST be set before importing `../src/index` (which pulls in `@docket/env/api` and the
// Better Auth config at module load). Every required var is set explicitly — the env
// contract has no hidden defaults. `pglite://memory` gives a fresh in-process Postgres;
// `BETTER_AUTH_TRUSTED_ORIGINS` exercises the parse branch. The passkey RP vars are
// required (the plugin is always mounted) and used as the WebAuthn relying-party identity.
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

describe('resolvePasskeyUser (passwordless sign-up resolver)', () => {
  /**
   * A tiny in-memory stand-in for Better Auth's internal-adapter slice. Records every
   * `createUser` call so the test can assert the new-user branch fires (and the hub-birth
   * hook would run, since the live wiring routes creation through this same method).
   */
  function fakeAdapter(seed?: { id: string; name: string; email: string }) {
    const users = new Map<string, { id: string; name: string; email: string }>();
    if (seed) users.set(seed.email, seed);
    const created: { name: string; email: string; emailVerified: boolean }[] = [];
    return {
      created,
      adapter: {
        findUserByEmail: async (email: string) => {
          const u = users.get(email);
          return u ? { user: { id: u.id, name: u.name } } : null;
        },
        createUser: async (data: { name: string; email: string; emailVerified: boolean }) => {
          created.push(data);
          const u = { id: `user_${created.length}`, name: data.name, email: data.email };
          users.set(data.email, u);
          return { id: u.id, name: u.name };
        },
      },
    };
  }

  it('throws when no registration context is supplied', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const { adapter } = fakeAdapter();
    await expect(resolvePasskeyUser(adapter, null)).rejects.toThrow('context is required');
    await expect(resolvePasskeyUser(adapter, undefined)).rejects.toThrow('context is required');
    await expect(resolvePasskeyUser(adapter, '')).rejects.toThrow('context is required');
  });

  it('propagates intent-verification failure (tampered/expired token)', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const { adapter } = fakeAdapter();
    await expect(resolvePasskeyUser(adapter, 'not-a-valid-token')).rejects.toThrow('malformed');
  });

  it('creates a new user (new email) — fires the create path exactly once', async () => {
    const { resolvePasskeyUser, signPasskeyIntent } = await import('../src/index');
    const { adapter, created } = fakeAdapter();
    const token = signPasskeyIntent({ name: 'Grace', email: 'new@example.com' });

    const resolved = await resolvePasskeyUser(adapter, token);

    expect(resolved.name).toBe('Grace');
    expect(resolved.id).toBe('user_1');
    expect(created).toEqual([{ name: 'Grace', email: 'new@example.com', emailVerified: true }]);
  });

  it('reuses an existing user (same email) without creating a duplicate', async () => {
    const { resolvePasskeyUser, signPasskeyIntent } = await import('../src/index');
    const { adapter, created } = fakeAdapter({
      id: 'existing-1',
      name: 'Existing',
      email: 'dup@example.com',
    });
    const token = signPasskeyIntent({ name: 'Ignored', email: 'dup@example.com' });

    const resolved = await resolvePasskeyUser(adapter, token);

    expect(resolved).toEqual({ id: 'existing-1', name: 'Existing' });
    expect(created).toEqual([]); // no createUser call → no second hub
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

  it('is passwordless: no emailAndPassword and passkey endpoints are mounted', async () => {
    const { auth } = await import('../src/index');
    // Email/password sign-in is removed.
    expect(auth.options.emailAndPassword).toBeUndefined();
    // The passkey plugin exposes its registration/authentication endpoints at runtime.
    // (`buildAuthOptions` returns the widened `BetterAuthOptions`, so these endpoints are
    // present on the live `auth.api` but not in its static type — assert at runtime.)
    const api = auth.api as Record<string, unknown>;
    expect(typeof api['generatePasskeyRegistrationOptions']).toBe('function');
    expect(typeof api['verifyPasskeyAuthentication']).toBe('function');
  });

  it('births a 1:1 hub on passwordless passkey sign-up (resolvePasskeyUser → create hook)', async () => {
    // Passwordless sign-up runs `resolvePasskeyUser` against the LIVE internal adapter; it
    // creates the user via the adapter, which fires `databaseHooks.user.create.after` →
    // the 1:1 hub birth. This is the same code path the passkey plugin invokes during the
    // pre-session WebAuthn registration ceremony.
    const { auth, resolvePasskeyUser, signPasskeyIntent } = await import('../src/index');
    const { db, hub, user } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');

    const ctx = await auth.$context;
    const token = signPasskeyIntent({ name: 'Grace', email: 'grace@example.com' });
    const resolved = await resolvePasskeyUser(ctx.internalAdapter, token);

    const users = await db.select().from(user).where(eq(user.email, 'grace@example.com'));
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe(resolved.id);
    expect(users[0]!.emailVerified).toBe(true);

    const hubs = await db.select().from(hub).where(eq(hub.userId, resolved.id));
    expect(hubs).toHaveLength(1);
  });

  it('getRecoveryCodeStatus: null when no codes, count + generatedAt when present', async () => {
    // Validates the recovery-code status path end-to-end — including the load-bearing assumption
    // that the encryption key is `BETTER_AUTH_SECRET` — by storing codes exactly as the twoFactor
    // plugin does (`storeBackupCodes: 'encrypted'`) and reading the count + timestamp back.
    const { getRecoveryCodeStatus } = await import('../src/index');
    const { db, twoFactor, user } = await import('@docket/db');
    const { symmetricEncrypt } = await import('better-auth/crypto');

    // No twoFactor row → null (distinguishes "never generated" from "0 left").
    expect(await getRecoveryCodeStatus('no-such-user')).toBeNull();

    const [u] = await db.insert(user).values({ name: 'Rec', email: 'rec@example.com' }).returning();
    const codes = ['aaaaa-bbbbb', 'ccccc-ddddd', 'eeeee-fffff'];
    const encrypted = await symmetricEncrypt({ key: SECRET, data: JSON.stringify(codes) });
    await db.insert(twoFactor).values({ secret: 'x', backupCodes: encrypted, userId: u!.id });

    const status = await getRecoveryCodeStatus(u!.id);
    expect(status?.remaining).toBe(3);
    // `backup_codes_generated_at` defaults to now() on insert → a parseable ISO instant.
    expect(Number.isNaN(Date.parse(status?.generatedAt ?? ''))).toBe(false);
  });

  it('recovery: generateRecoveryCodes → recoveryChallenge → verifyBackupCode, session-less, end-to-end', async () => {
    // Proves two seams at once: (a) Docket-owned `generateRecoveryCodes` writes codes the plugin's
    // `verifyBackupCode` can consume (byte-compatible encryption), and (b) the recovery-challenge
    // bridge mints exactly the `two_factor` cookie that `verifyBackupCode` reads back. Driven
    // through the live `auth.handler` (HTTP) with NO session — the locked-out path — so a
    // better-auth upgrade that changes the cookie/verification shape fails here loudly.
    const { auth, generateRecoveryCodes } = await import('../src/index');
    const { db, user } = await import('@docket/db');

    const email = 'locked-out@example.com';
    const [u] = await db.insert(user).values({ name: 'Locked', email }).returning();
    const codes = await generateRecoveryCodes(u!.id);

    const post = (path: string, body: unknown, cookie?: string): Promise<Response> =>
      auth.handler(
        new Request(`http://localhost:4000/api/auth${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:4000',
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(body),
        }),
      );

    // 1) Arm the challenge with no session → a signed challenge cookie is set.
    const armed = await post('/two-factor/recovery-challenge', { email });
    expect(armed.status).toBe(200);
    const cookie = armed.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    expect(cookie).not.toBe('');

    // 2) Verify one of the GENERATED codes with that cookie (still no session) → a session issues.
    const verified = await post('/two-factor/verify-backup-code', { code: codes[0] }, cookie);
    expect(verified.status).toBe(200);
    expect(verified.headers.getSetCookie().some((c) => c.includes('session'))).toBe(true);

    // 3) The consumed code (and now-cleared challenge) can't be replayed.
    const replay = await post('/two-factor/verify-backup-code', { code: codes[0] }, cookie);
    expect(replay.status).not.toBe(200);
  });

  it('generateRecoveryCodes: creates a set, enables 2FA, stamps generatedAt; regenerate replaces + advances', async () => {
    const { generateRecoveryCodes, getRecoveryCodeStatus } = await import('../src/index');
    const { db, twoFactor, user } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');

    const [u] = await db.insert(user).values({ name: 'Gen', email: 'gen@example.com' }).returning();

    const first = await generateRecoveryCodes(u!.id);
    expect(first).toHaveLength(10);
    expect(first.every((c) => /^[a-zA-Z0-9]{5}-[a-zA-Z0-9]{5}$/.test(c))).toBe(true);
    const [urow] = await db
      .select({ tfe: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, u!.id));
    expect(urow!.tfe).toBe(true);
    expect((await getRecoveryCodeStatus(u!.id))?.remaining).toBe(10);

    // Backdate, then regenerate → fresh set, one row, generatedAt jumps to now.
    await db
      .update(twoFactor)
      .set({ backupCodesGeneratedAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(twoFactor.userId, u!.id));
    const second = await generateRecoveryCodes(u!.id);
    expect(second).not.toEqual(first);
    const rows = await db
      .select({ id: twoFactor.id })
      .from(twoFactor)
      .where(eq(twoFactor.userId, u!.id));
    expect(rows).toHaveLength(1);
    const status = await getRecoveryCodeStatus(u!.id);
    expect(status?.remaining).toBe(10);
    expect(Date.parse(status?.generatedAt ?? '')).toBeGreaterThan(
      Date.parse('2020-01-01T00:00:00.000Z'),
    );
  });

  it('mounts passkey + twoFactor + recoveryChallenge + nextCookies with placeholder env (passwordless baseline)', async () => {
    // The live `auth` is built from the test env (optional gated vars unset) → every
    // OPTIONAL gate is closed. This pins the zero-account local build to passkey + the
    // always-on recovery-codes pair (twoFactor + recoveryChallenge) + nextCookies, with no
    // social/oidc/mcp and no account-linking.
    const { auth } = await import('../src/index');
    expect(auth.options.socialProviders).toBeUndefined();
    expect(auth.options.account).toBeUndefined();
    const ids = (auth.options.plugins ?? []).map((p) => p.id);
    expect(ids).toEqual(['passkey', 'two-factor', 'recovery-challenge', 'next-cookies']);
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
  /** A minimal env: every OPTIONAL gate closed (mirrors the local passwordless build). */
  const baseEnv = {
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_PASSKEY_RP_ID: 'localhost',
    BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
  } as const;

  it('mounts passkey + twoFactor + recoveryChallenge + nextCookies when no optional gated vars are real (== baseline)', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv);
    expect(opts.socialProviders).toBeUndefined();
    expect(opts.account).toBeUndefined();
    expect((opts.plugins ?? []).map((p) => p.id)).toEqual([
      'passkey',
      'two-factor',
      'recovery-challenge',
      'next-cookies',
    ]);
    // Passwordless: no email/password sign-in.
    expect(opts.emailAndPassword).toBeUndefined();
  });

  it('configures passkey for passwordless (pre-session) registration', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv);
    const pk = (opts.plugins ?? []).find((p) => p.id === 'passkey');
    expect(pk).toBeDefined();
    // The plugin records its received options under `.options` — assert passkey-first config.
    const pkOptions = (pk as { options?: Record<string, unknown> }).options ?? {};
    expect(pkOptions['rpID']).toBe('localhost');
    expect(pkOptions['rpName']).toBe('Docket');
    const registration = pkOptions['registration'] as Record<string, unknown> | undefined;
    expect(registration?.['requireSession']).toBe(false);
    expect(typeof registration?.['resolveUser']).toBe('function');
  });

  it("passkey's resolveUser wiring forwards ctx.context.internalAdapter + context", async () => {
    // Invoke the configured `resolveUser` arrow directly so its forwarding to
    // `resolvePasskeyUser(ctx.context.internalAdapter, context)` is exercised end-to-end:
    // a fresh email creates the user via the fake adapter and round-trips the resolved id.
    const { buildAuthOptions, signPasskeyIntent } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv);
    const pk = (opts.plugins ?? []).find((p) => p.id === 'passkey');
    const registration = (pk as { options?: { registration?: unknown } }).options?.registration as {
      resolveUser: (args: {
        ctx: { context: { internalAdapter: unknown } };
        context: string;
      }) => Promise<{ id: string; name: string }>;
    };

    const created: { name: string; email: string }[] = [];
    const internalAdapter = {
      findUserByEmail: async () => null,
      createUser: async (data: { name: string; email: string; emailVerified: boolean }) => {
        created.push({ name: data.name, email: data.email });
        return { id: 'wired-1', name: data.name };
      },
    };

    const token = signPasskeyIntent({ name: 'Wired', email: 'wired@example.com' });
    const resolved = await registration.resolveUser({
      ctx: { context: { internalAdapter } },
      context: token,
    });

    expect(resolved).toEqual({ id: 'wired-1', name: 'Wired' });
    expect(created).toEqual([{ name: 'Wired', email: 'wired@example.com' }]);
  });

  it('configures twoFactor backup-codes-only for passwordless account recovery', async () => {
    // The recovery-codes feature rides the twoFactor plugin, but used backup-codes-only: passkey
    // users must be able to enable/manage codes without a password (`allowPasswordless`), there is
    // no TOTP verify step (`skipVerificationOnEnable`), TOTP is disabled, and codes are encrypted
    // at rest. Also assert the recovery-challenge bridge is mounted alongside it.
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv);
    const tf = (opts.plugins ?? []).find((p) => p.id === 'two-factor');
    expect(tf).toBeDefined();
    const tfOptions = (tf as { options?: Record<string, unknown> }).options ?? {};
    expect(tfOptions['allowPasswordless']).toBe(true);
    expect(tfOptions['skipVerificationOnEnable']).toBe(true);
    expect((tfOptions['totpOptions'] as { disable?: boolean } | undefined)?.disable).toBe(true);
    expect(
      (tfOptions['backupCodeOptions'] as { storeBackupCodes?: string } | undefined)
        ?.storeBackupCodes,
    ).toBe('encrypted');
    // No OTP delivery configured ⇒ recovery code is the only second factor.
    expect(tfOptions['otpOptions']).toBeUndefined();

    expect((opts.plugins ?? []).map((p) => p.id)).toContain('recovery-challenge');
  });

  it('ignores half-configured social pairs (id without secret)', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      GOOGLE_CLIENT_ID: 'goog-id',
      // GOOGLE_CLIENT_SECRET missing → provider must NOT mount
      GITHUB_APP_CLIENT_SECRET: 'gh-secret',
      // GITHUB_APP_CLIENT_ID missing → provider must NOT mount
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
    // Still just the baseline: passkey + recovery-codes pair + nextCookies.
    expect((opts.plugins ?? []).map((p) => p.id)).toEqual([
      'passkey',
      'two-factor',
      'recovery-challenge',
      'next-cookies',
    ]);
  });

  it('mounts Google + GitHub + Linear + account linking when all pairs are real', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      GOOGLE_CLIENT_ID: 'goog-id',
      GOOGLE_CLIENT_SECRET: 'goog-secret',
      GITHUB_APP_CLIENT_ID: 'gh-id',
      GITHUB_APP_CLIENT_SECRET: 'gh-secret',
      LINEAR_CLIENT_ID: 'lin-id',
      LINEAR_CLIENT_SECRET: 'lin-secret',
    });
    expect(Object.keys(opts.socialProviders ?? {}).sort()).toEqual(['github', 'google', 'linear']);
    expect(opts.socialProviders?.google).toEqual({
      clientId: 'goog-id',
      clientSecret: 'goog-secret',
      // Read-WRITE `tasks` (two-way sync), plus offline access + account chooser for multi-account.
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://mail.google.com/',
      ],
      accessType: 'offline',
      prompt: 'select_account consent',
    });
    expect(opts.socialProviders?.github).toEqual({
      clientId: 'gh-id',
      clientSecret: 'gh-secret',
      // Sign-in only needs the email; repo access comes from installing the GitHub App, not a scope.
      scope: ['user:email'],
    });
    expect(opts.socialProviders?.linear).toEqual({
      clientId: 'lin-id',
      clientSecret: 'lin-secret',
      // The Linear connector needs `read` to query the GraphQL API.
      scope: ['read'],
    });
    expect(opts.account?.accountLinking?.enabled).toBe(true);
    // Passwordless: `email-password` is NOT a trusted linking provider — only social ones.
    expect((opts.account?.accountLinking?.trustedProviders as string[]).sort()).toEqual([
      'github',
      'google',
      'linear',
    ]);
  });

  describe('configuredSocialProviders (shared availability truth)', () => {
    it('is empty when no provider pair is real (matches the passkey-only baseline)', async () => {
      const { configuredSocialProviders } = await import('../src/index');
      expect(configuredSocialProviders(baseEnv)).toEqual([]);
    });

    it('lists only providers whose id AND secret are both real-shaped', async () => {
      const { configuredSocialProviders } = await import('../src/index');
      const providers = configuredSocialProviders({
        ...baseEnv,
        GOOGLE_CLIENT_ID: 'goog-id',
        GOOGLE_CLIENT_SECRET: 'goog-secret',
        // Half-configured GitHub (id only) and placeholder Linear must NOT appear.
        GITHUB_APP_CLIENT_ID: 'gh-id',
        LINEAR_CLIENT_ID: 'your-linear-id',
        LINEAR_CLIENT_SECRET: 'changeme',
      });
      expect(providers).toEqual(['google']);
    });

    it('agrees with the providers buildAuthOptions actually mounts', async () => {
      const { configuredSocialProviders, buildAuthOptions } = await import('../src/index');
      const full = {
        ...baseEnv,
        GOOGLE_CLIENT_ID: 'goog-id',
        GOOGLE_CLIENT_SECRET: 'goog-secret',
        GITHUB_APP_CLIENT_ID: 'gh-id',
        GITHUB_APP_CLIENT_SECRET: 'gh-secret',
        LINEAR_CLIENT_ID: 'lin-id',
        LINEAR_CLIENT_SECRET: 'lin-secret',
      };
      expect(configuredSocialProviders(full).sort()).toEqual(
        Object.keys(buildAuthOptions(full).socialProviders ?? {}).sort(),
      );
    });
  });

  it('mounts oidcProvider (before nextCookies) when OIDC_LOGIN_PAGE_URL is real but MCP_RESOURCE_URL is not', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let opts!: ReturnType<typeof buildAuthOptions>;
    try {
      opts = buildAuthOptions({
        ...baseEnv,
        OIDC_LOGIN_PAGE_URL: 'https://docket.example/sign-in',
      });
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
    // passkey + oidcProvider + nextCookies (no mcp).
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).toEqual([
      'passkey',
      'two-factor',
      'recovery-challenge',
      'oidc-provider',
      'next-cookies',
    ]);
    expect(ids).not.toContain('mcp');
    // nextCookies MUST remain last.
    expect(ids[ids.length - 1]).toBe('next-cookies');
  });

  it('mounts mcp ONLY (before nextCookies) when both OIDC + MCP_RESOURCE_URL are real', async () => {
    // `mcp` internally bundles `oidcProvider`, so the standalone provider is NOT mounted
    // separately — passkey + mcp + nextCookies is the full set.
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      OIDC_LOGIN_PAGE_URL: 'https://docket.example/sign-in',
      MCP_RESOURCE_URL: 'https://docket.example/mcp',
    });
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).toEqual(['passkey', 'two-factor', 'recovery-challenge', 'mcp', 'next-cookies']);
    expect(ids).not.toContain('oidc-provider');
    expect(ids[ids.length - 1]).toBe('next-cookies');
  });

  it('mounts oAuthProxy (before nextCookies) only when both OAUTH_PROXY_* are real', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      OAUTH_PROXY_SECRET: 'oauth-proxy-shared-secret',
      OAUTH_PROXY_PRODUCTION_URL: 'https://app.docket.example',
    });
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).toContain('oauth-proxy');
    expect(ids[ids.length - 1]).toBe('next-cookies');
  });

  it('does NOT mount oAuthProxy when the pair is absent or half-configured', async () => {
    const { buildAuthOptions } = await import('../src/index');
    // Absent (the local placeholder env).
    expect((buildAuthOptions(baseEnv).plugins ?? []).map((p) => p.id)).not.toContain('oauth-proxy');
    // Secret without URL → not mounted (the contract also rejects this pair at env validation).
    const half = buildAuthOptions({ ...baseEnv, OAUTH_PROXY_SECRET: 'only-the-secret' });
    expect((half.plugins ?? []).map((p) => p.id)).not.toContain('oauth-proxy');
  });

  it('uses a static baseURL string + no proxy-header trust when BETTER_AUTH_ALLOWED_HOSTS is unset', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv);
    expect(opts.baseURL).toBe('http://localhost:3000');
    expect(opts.advanced?.trustedProxyHeaders).toBeUndefined();
  });

  it('switches to dynamic baseURL + proxy-header trust when BETTER_AUTH_ALLOWED_HOSTS is set', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({
      ...baseEnv,
      // Trimmed/empties-dropped CSV (reuses parseTrustedOrigins).
      BETTER_AUTH_ALLOWED_HOSTS: 'usedocket.app, docket.hypertext.studio , *.vercel.app,',
    });
    expect(opts.baseURL).toEqual({
      allowedHosts: ['usedocket.app', 'docket.hypertext.studio', '*.vercel.app'],
      fallback: 'http://localhost:3000',
      protocol: 'auto',
    });
    expect(opts.advanced?.trustedProxyHeaders).toBe(true);
  });
});
