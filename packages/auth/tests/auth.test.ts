import { generateKeyPairSync } from 'node:crypto';
import { resolve } from 'node:path';

import type { Mailer, OutboundMessage } from '@docket/mail';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-secret-at-least-32-characters-long';

/** The verified-intent identifier prefix (kept in sync with `src/signup-intent.ts`). */
const INTENT_PREFIX = 'signup-intent:';

/** A capturing {@link Mailer}: records every send so tests can read the emitted code. */
const sentEmails: OutboundMessage[] = [];
const captureMailer: Mailer = {
  send: async (message) => {
    sentEmails.push(message);
  },
};
/** The dependency bundle every `buildAuthOptions` test call passes. */
const MAILER_DEPS = { mailer: captureMailer } as const;

beforeEach(() => {
  sentEmails.length = 0;
});

describe('resolvePasskeyUser (verified-intent sign-up resolver)', () => {
  const FUTURE = new Date(Date.now() + 60_000);

  /**
   * An in-memory stand-in for the adapter slice {@link resolvePasskeyUser} needs. Seeds one
   * verified-intent row (identifier → `{name,email}`) and optional existing users; records
   * `createUser` calls and which intent identifiers were consumed.
   */
  function fakeAdapter(opts?: {
    intents?: Record<string, { value: { name: string; email: string }; expiresAt?: Date }>;
    users?: { id: string; name: string; email: string; accounts?: string[]; passkeys?: number }[];
  }) {
    const intents = new Map(
      Object.entries(opts?.intents ?? {}).map(([id, r]) => [
        id,
        { value: JSON.stringify(r.value), expiresAt: r.expiresAt ?? FUTURE },
      ]),
    );
    const users = new Map((opts?.users ?? []).map((u) => [u.email, u]));
    const created: { name: string; email: string; emailVerified: boolean }[] = [];
    const consumed: string[] = [];
    return {
      created,
      consumed,
      adapter: {
        findVerificationValue: async (id: string) => intents.get(id) ?? null,
        deleteVerificationByIdentifier: async (id: string) => {
          consumed.push(id);
          intents.delete(id);
        },
        findUserByEmail: async (email: string) => {
          const u = users.get(email);
          return u
            ? {
                user: { id: u.id, name: u.name },
                accounts: (u.accounts ?? []).map((providerId) => ({ providerId })),
              }
            : null;
        },
        countPasskeys: async (userId: string) =>
          [...users.values()].find((u) => u.id === userId)?.passkeys ?? 0,
        createUser: async (data: { name: string; email: string; emailVerified: boolean }) => {
          created.push(data);
          const u = { id: `user_${created.length}`, name: data.name, email: data.email };
          users.set(data.email, u);
          return { id: u.id, name: u.name };
        },
      },
    };
  }

  it('rejects an absent or non-intent-prefixed context (cannot smuggle another identifier)', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const { adapter } = fakeAdapter();
    await expect(resolvePasskeyUser(adapter, null)).rejects.toThrow('context is required');
    await expect(resolvePasskeyUser(adapter, 'signup-code:victim@example.com')).rejects.toThrow(
      'invalid registration context',
    );
  });

  it('rejects a missing or expired intent', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const missing = fakeAdapter();
    await expect(resolvePasskeyUser(missing.adapter, `${INTENT_PREFIX}nope`)).rejects.toThrow(
      'invalid or expired',
    );

    const expired = fakeAdapter({
      intents: {
        [`${INTENT_PREFIX}old`]: {
          value: { name: 'Ada', email: 'ada@example.com' },
          expiresAt: new Date(Date.now() - 1000),
        },
      },
    });
    await expect(resolvePasskeyUser(expired.adapter, `${INTENT_PREFIX}old`)).rejects.toThrow(
      'invalid or expired',
    );
    expect(expired.consumed).toContain(`${INTENT_PREFIX}old`); // expired intent is cleaned up
  });

  it('creates a new user for a proven email and consumes the intent (single use)', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const id = `${INTENT_PREFIX}abc`;
    const { adapter, created, consumed } = fakeAdapter({
      intents: { [id]: { value: { name: 'Grace', email: 'new@example.com' } } },
    });

    const resolved = await resolvePasskeyUser(adapter, id);

    expect(resolved).toEqual({ id: 'user_1', name: 'Grace' });
    expect(created).toEqual([{ name: 'Grace', email: 'new@example.com', emailVerified: true }]);
    expect(consumed).toContain(id); // intent consumed → cannot be replayed
  });

  it('REJECTS attaching to an existing account that has a passkey (closes ATO)', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const id = `${INTENT_PREFIX}atk`;
    const { adapter, created } = fakeAdapter({
      intents: { [id]: { value: { name: 'Mallory', email: 'victim@example.com' } } },
      users: [{ id: 'victim-1', name: 'Victim', email: 'victim@example.com', passkeys: 1 }],
    });

    await expect(resolvePasskeyUser(adapter, id)).rejects.toThrow('already exists');
    expect(created).toEqual([]); // no credential grafted onto the victim
  });

  it('REJECTS attaching to an existing account that has a linked social account', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const id = `${INTENT_PREFIX}soc`;
    const { adapter } = fakeAdapter({
      intents: { [id]: { value: { name: 'Mallory', email: 'g@example.com' } } },
      users: [{ id: 'g-1', name: 'Googler', email: 'g@example.com', accounts: ['google'] }],
    });
    await expect(resolvePasskeyUser(adapter, id)).rejects.toThrow('already exists');
  });

  it('RESUMES an abandoned sign-up (existing user with no credential yet)', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const id = `${INTENT_PREFIX}resume`;
    const { adapter, created } = fakeAdapter({
      intents: { [id]: { value: { name: 'Ada', email: 'ada@example.com' } } },
      users: [{ id: 'ada-1', name: 'Ada', email: 'ada@example.com', passkeys: 0 }],
    });

    const resolved = await resolvePasskeyUser(adapter, id);

    expect(resolved).toEqual({ id: 'ada-1', name: 'Ada' });
    expect(created).toEqual([]); // resumed, not duplicated
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
    // Passwordless sign-up runs `resolvePasskeyUser` against the LIVE internal adapter after a
    // verified-intent has been minted; it creates the user via the adapter, which fires
    // `databaseHooks.user.create.after` → the 1:1 hub birth. This is the same code path the passkey
    // plugin invokes during the pre-session WebAuthn registration ceremony.
    const { auth, resolvePasskeyUser } = await import('../src/index');
    const { db, hub, passkey, user } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');

    const ctx = await auth.$context;
    // Mint the verified-intent row the way `/sign-up/verify-code` would.
    const intentId = `${INTENT_PREFIX}${Math.random().toString(36).slice(2)}`;
    await ctx.internalAdapter.createVerificationValue({
      identifier: intentId,
      value: JSON.stringify({ name: 'Grace', email: 'grace@example.com' }),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const resolved = await resolvePasskeyUser(
      {
        findVerificationValue: (id) => ctx.internalAdapter.findVerificationValue(id),
        deleteVerificationByIdentifier: (id) =>
          ctx.internalAdapter.deleteVerificationByIdentifier(id),
        findUserByEmail: (email, options) => ctx.internalAdapter.findUserByEmail(email, options),
        createUser: (data) => ctx.internalAdapter.createUser(data),
        countPasskeys: async (userId) =>
          (await db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)))
            .length,
      },
      intentId,
    );

    const users = await db.select().from(user).where(eq(user.email, 'grace@example.com'));
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe(resolved.id);
    expect(users[0]!.emailVerified).toBe(true);

    const hubs = await db.select().from(hub).where(eq(hub.userId, resolved.id));
    expect(hubs).toHaveLength(1);

    // The intent is single-use: it was consumed, so a replay resolves to nothing.
    await expect(resolvePasskeyUserReplay(intentId)).rejects.toThrow('invalid or expired');
    async function resolvePasskeyUserReplay(id: string) {
      return resolvePasskeyUser(
        {
          findVerificationValue: (vid) => ctx.internalAdapter.findVerificationValue(vid),
          deleteVerificationByIdentifier: (vid) =>
            ctx.internalAdapter.deleteVerificationByIdentifier(vid),
          findUserByEmail: (email, options) => ctx.internalAdapter.findUserByEmail(email, options),
          createUser: (data) => ctx.internalAdapter.createUser(data),
          countPasskeys: async () => 0,
        },
        id,
      );
    }
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

  /**
   * Build a live auth instance whose mailer is the capturing test mailer, so the emitted sign-up
   * code can be read out of `sentEmails`. Shares the migrated `@docket/db`, so verification rows and
   * users land in the same database `resolvePasskeyUser` reads.
   */
  async function testAuthWithCapture() {
    const { buildAuthOptions } = await import('../src/index');
    const { betterAuth } = await import('better-auth');
    const instance = betterAuth(
      buildAuthOptions(
        {
          BETTER_AUTH_SECRET: SECRET,
          BETTER_AUTH_URL: 'http://localhost:4000',
          BETTER_AUTH_PASSKEY_RP_ID: 'localhost',
          BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
          BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:4000',
        },
        MAILER_DEPS,
      ),
    );
    const post = (path: string, body: unknown): Promise<Response> =>
      instance.handler(
        new Request(`http://localhost:4000/api/auth${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:4000',
          },
          body: JSON.stringify(body),
        }),
      );
    return { instance, post };
  }

  /** Build the live-adapter slice `resolvePasskeyUser` needs (internal adapter + a db-backed count). */
  async function liveResolveAdapter(
    instance: Awaited<ReturnType<typeof testAuthWithCapture>>['instance'],
  ) {
    const ctx = await instance.$context;
    const { db, passkey } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');
    return {
      findVerificationValue: (id: string) => ctx.internalAdapter.findVerificationValue(id),
      deleteVerificationByIdentifier: (id: string) =>
        ctx.internalAdapter.deleteVerificationByIdentifier(id),
      findUserByEmail: (email: string, options?: { includeAccounts: boolean }) =>
        ctx.internalAdapter.findUserByEmail(email, options),
      createUser: (data: { name: string; email: string; emailVerified: boolean }) =>
        ctx.internalAdapter.createUser(data),
      countPasskeys: async (userId: string) =>
        (await db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)))
          .length,
    };
  }

  it('sign-up challenge: request-code emails a code, wrong code fails, right code mints a single-use intent that creates the account', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const { db, user } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');
    const { instance, post } = await testAuthWithCapture();

    const email = 'newbie@example.com';
    const requested = await post('/sign-up/request-code', { name: 'Newbie', email });
    expect(requested.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(email);
    const code = /\b(\d{6})\b/.exec(sentEmails[0]!.text ?? '')?.[1];
    expect(code).toBeDefined();

    // A wrong code is rejected (use a definitely-different 6-digit value).
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const badVerify = await post('/sign-up/verify-code', { email, code: wrong });
    expect(badVerify.status).not.toBe(200);

    // The correct code mints a verified-intent token.
    const verified = await post('/sign-up/verify-code', { email, code });
    expect(verified.status).toBe(200);
    const { intent } = (await verified.json()) as { intent: string };
    expect(intent.startsWith('signup-intent:')).toBe(true);

    // The intent resolves to a freshly-created, verified user (+ its hub via the create hook).
    const adapter = await liveResolveAdapter(instance);
    const resolved = await resolvePasskeyUser(adapter, intent);
    const users = await db.select().from(user).where(eq(user.email, email));
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe(resolved.id);
    expect(users[0]!.emailVerified).toBe(true);

    // The intent is single-use: a replay is rejected (no second account).
    await expect(resolvePasskeyUser(adapter, intent)).rejects.toThrow('invalid or expired');
  });

  it('sign-up challenge: even a fully-verified code cannot graft a passkey onto an existing account that has one (ATO closed end-to-end)', async () => {
    const { resolvePasskeyUser } = await import('../src/index');
    const { db, passkey, user } = await import('@docket/db');
    const { instance, post } = await testAuthWithCapture();

    // A pre-existing victim account WITH a passkey credential.
    const email = 'victim-e2e@example.com';
    const [victim] = await db
      .insert(user)
      .values({ name: 'Victim', email, emailVerified: true })
      .returning();
    await db.insert(passkey).values({
      userId: victim!.id,
      publicKey: 'pk',
      credentialID: 'cred-e2e',
      counter: 0,
      deviceType: 'platform',
      backedUp: true,
    });

    // The attacker completes the challenge (as if they controlled the inbox) and gets a real intent.
    await post('/sign-up/request-code', { name: 'Mallory', email });
    const code = /\b(\d{6})\b/.exec(sentEmails.at(-1)?.text ?? '')?.[1];
    const verified = await post('/sign-up/verify-code', { email, code: code! });
    const { intent } = (await verified.json()) as { intent: string };

    // Registration still refuses to bind the new passkey to the victim's existing account.
    const adapter = await liveResolveAdapter(instance);
    await expect(resolvePasskeyUser(adapter, intent)).rejects.toThrow('already exists');

    // The victim still has exactly their original single passkey — nothing grafted.
    const creds = await db.select().from(passkey);
    expect(creds.filter((c) => c.userId === victim!.id)).toHaveLength(1);
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

  it('mounts passkey + twoFactor + recoveryChallenge + mcp + nextCookies with placeholder env (passwordless baseline)', async () => {
    // The live `auth` is built from the test env (optional SOCIAL gates unset) → no social
    // providers/account-linking. The MCP AS/RS is core functionality, not deploy-specific
    // config (see `@docket/env/api`'s derivation doc): it auto-derives from API_URL + WEB_URL,
    // both of which are always required, so `mcp` (which bundles oidcProvider) is always on.
    const { auth } = await import('../src/index');
    expect(auth.options.socialProviders).toBeUndefined();
    expect(auth.options.account).toBeUndefined();
    const ids = (auth.options.plugins ?? []).map((p) => p.id);
    expect(ids).toEqual([
      'passkey',
      'two-factor',
      'recovery-challenge',
      'signup-challenge',
      'mcp',
      'next-cookies',
    ]);
  });

  // Runs LAST: it resets the module registry, which would orphan the migrated
  // `@docket/db` proxy used by the tests above.
  it('defaults trustedOrigins to [] when BETTER_AUTH_TRUSTED_ORIGINS is unset', async () => {
    // Re-import with the env var removed so the optional-chain (`?.`) / nullish
    // (`?? []`) fallback branch of `parseTrustedOrigins` is exercised on the live `auth`.
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', undefined);
    vi.resetModules();
    try {
      const { auth } = await import('../src/index');
      expect(auth.options.trustedOrigins).toEqual([]);
    } finally {
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

  /** The four durable Apple credentials, with a real throwaway P-256 key so the JWT actually signs. */
  const APPLE_ENV = {
    APPLE_CLIENT_ID: 'com.docket.web',
    APPLE_TEAM_ID: 'ABCDE12345',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
  } as const;

  it('mounts passkey + twoFactor + recoveryChallenge + nextCookies when no optional gated vars are real (== baseline)', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv, MAILER_DEPS);
    expect(opts.socialProviders).toBeUndefined();
    expect(opts.account).toBeUndefined();
    expect((opts.plugins ?? []).map((p) => p.id)).toEqual([
      'passkey',
      'two-factor',
      'recovery-challenge',
      'signup-challenge',
      'next-cookies',
    ]);
    // Passwordless: no email/password sign-in.
    expect(opts.emailAndPassword).toBeUndefined();
  });

  it('configures passkey for passwordless (pre-session) registration', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv, MAILER_DEPS);
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

  it("passkey's resolveUser wiring consumes the verified intent from ctx.context.internalAdapter", async () => {
    // Invoke the configured `resolveUser` arrow directly so its forwarding into
    // `resolvePasskeyUser` is exercised end-to-end: a proven-email intent resolved against the
    // fake internal adapter creates the user and round-trips the resolved id.
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv, MAILER_DEPS);
    const pk = (opts.plugins ?? []).find((p) => p.id === 'passkey');
    type ResolveUser = (args: {
      ctx: { context: { internalAdapter: unknown } };
      context: string;
    }) => Promise<{ id: string; name: string }>;
    const registration = (pk as { options?: { registration?: { resolveUser?: ResolveUser } } })
      .options?.registration;
    if (!registration?.resolveUser) {
      throw new Error('passkey registration resolver was not configured');
    }

    const intentId = `${INTENT_PREFIX}wired`;
    const created: { name: string; email: string }[] = [];
    const internalAdapter = {
      findVerificationValue: async (id: string) =>
        id === intentId
          ? {
              value: JSON.stringify({ name: 'Wired', email: 'wired@example.com' }),
              expiresAt: new Date(Date.now() + 60_000),
            }
          : null,
      deleteVerificationByIdentifier: async () => undefined,
      findUserByEmail: async () => null,
      createUser: async (data: { name: string; email: string; emailVerified: boolean }) => {
        created.push({ name: data.name, email: data.email });
        return { id: 'wired-1', name: data.name };
      },
    };

    const resolved = await registration.resolveUser({
      ctx: { context: { internalAdapter } },
      context: intentId,
    });

    expect(resolved).toEqual({ id: 'wired-1', name: 'Wired' });
    expect(created).toEqual([{ name: 'Wired', email: 'wired@example.com' }]);
  });

  it('configures database-backed rate limiting with tightened rules on sensitive auth paths', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv, MAILER_DEPS);
    expect(opts.rateLimit?.storage).toBe('database');
    expect(opts.rateLimit?.max).toBeGreaterThan(0);
    // Sensitive surfaces get their own tighter ceilings.
    const rules = opts.rateLimit?.customRules ?? {};
    expect(rules['/sign-in/passkey']).toEqual({ window: 60, max: 20 });
    expect(rules['/mcp/token']).toEqual({ window: 60, max: 30 });
  });

  it('configures change-email to send the confirmation to the CURRENT address, not the new one', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv, MAILER_DEPS);
    expect(opts.user?.changeEmail?.enabled).toBe(true);
    // Better Auth also requires `emailVerification.sendVerificationEmail` configured as a gate,
    // even though every Docket user is created emailVerified — see the comment in auth-builder.
    expect(typeof opts.emailVerification?.sendVerificationEmail).toBe('function');

    const sendConfirmation = opts.user?.changeEmail?.sendChangeEmailConfirmation as (
      data: { user: { email: string; name: string }; newEmail: string; url: string; token: string },
      request?: Request,
    ) => Promise<void>;
    await sendConfirmation({
      user: { email: 'old@example.com', name: 'Ada' },
      newEmail: 'new@example.com',
      url: 'https://api.docket.localhost/api/auth/verify-email?token=abc',
      token: 'abc',
    });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.to).toBe('old@example.com');
    expect(sentEmails[0]?.html).toContain('new@example.com');
  });

  it('configures twoFactor backup-codes-only for passwordless account recovery', async () => {
    // The recovery-codes feature rides the twoFactor plugin, but used backup-codes-only: passkey
    // users must be able to enable/manage codes without a password (`allowPasswordless`), there is
    // no TOTP verify step (`skipVerificationOnEnable`), TOTP is disabled, and codes are encrypted
    // at rest. Also assert the recovery-challenge bridge is mounted alongside it.
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv, MAILER_DEPS);
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
    const opts = buildAuthOptions(
      {
        ...baseEnv,
        GOOGLE_CLIENT_ID: 'goog-id',
        // GOOGLE_CLIENT_SECRET missing → provider must NOT mount
        GITHUB_APP_CLIENT_SECRET: 'gh-secret',
        // GITHUB_APP_CLIENT_ID missing → provider must NOT mount
      },
      MAILER_DEPS,
    );
    expect(opts.socialProviders).toBeUndefined();
    expect(opts.account).toBeUndefined();
  });

  it('treats placeholder-shaped values as not-real (isRealValue gate)', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(
      {
        ...baseEnv,
        GOOGLE_CLIENT_ID: 'your-google-id',
        GOOGLE_CLIENT_SECRET: 'changeme',
        OIDC_LOGIN_PAGE_URL: '',
      },
      MAILER_DEPS,
    );
    expect(opts.socialProviders).toBeUndefined();
    // Still just the baseline: passkey + recovery-codes pair + nextCookies.
    expect((opts.plugins ?? []).map((p) => p.id)).toEqual([
      'passkey',
      'two-factor',
      'recovery-challenge',
      'signup-challenge',
      'next-cookies',
    ]);
  });

  it('mounts Google + GitHub + Linear + account linking when all pairs are real', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(
      {
        ...baseEnv,
        GOOGLE_CLIENT_ID: 'goog-id',
        GOOGLE_CLIENT_SECRET: 'goog-secret',
        GITHUB_APP_CLIENT_ID: 'gh-id',
        GITHUB_APP_CLIENT_SECRET: 'gh-secret',
        LINEAR_CLIENT_ID: 'lin-id',
        LINEAR_CLIENT_SECRET: 'lin-secret',
      },
      MAILER_DEPS,
    );
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

  it('mounts Discord with the identify scope as a trusted linking provider when its pair is real', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(
      {
        ...baseEnv,
        DISCORD_CLIENT_ID: 'disc-id',
        DISCORD_CLIENT_SECRET: 'disc-secret',
      },
      MAILER_DEPS,
    );
    expect(Object.keys(opts.socialProviders ?? {})).toEqual(['discord']);
    expect(opts.socialProviders?.discord).toEqual({
      clientId: 'disc-id',
      clientSecret: 'disc-secret',
      // Only `identify` — enough to map a mentioned snowflake to this user; no message/guild scopes.
      scope: ['identify'],
    });
    expect(opts.account?.accountLinking?.trustedProviders).toEqual(['discord']);
  });

  it('mounts Microsoft (Outlook) when its pair is real, defaulting tenantId to common', async () => {
    const { buildAuthOptions, configuredSocialProviders } = await import('../src/index');
    const env = {
      ...baseEnv,
      MICROSOFT_CLIENT_ID: 'ms-id',
      MICROSOFT_CLIENT_SECRET: 'ms-secret',
    };
    // The gating truth `/v1/config` reads to decide whether `outlook` surfaces as a connector —
    // a dropped or misspelled provider key here would silently keep Outlook dormant forever
    // even once an operator configures real production credentials.
    expect(configuredSocialProviders(env)).toEqual(['microsoft']);
    const opts = buildAuthOptions(env, MAILER_DEPS);
    expect(Object.keys(opts.socialProviders ?? {})).toEqual(['microsoft']);
    expect(opts.socialProviders?.microsoft).toMatchObject({
      clientId: 'ms-id',
      clientSecret: 'ms-secret',
      tenantId: 'common',
    });
  });

  it('does not mount Microsoft when only one of the pair is real', async () => {
    const { configuredSocialProviders } = await import('../src/index');
    expect(configuredSocialProviders({ ...baseEnv, MICROSOFT_CLIENT_ID: 'ms-id' })).toEqual([]);
  });

  it('mounts Apple (with a minted client-secret JWT) + adds appleid.apple.com to trustedOrigins when all four APPLE_* are real', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions({ ...baseEnv, ...APPLE_ENV }, MAILER_DEPS);
    expect(Object.keys(opts.socialProviders ?? {})).toEqual(['apple']);
    // `socialProviders.apple` is the config-object-or-thunk union — narrow to the object form by
    // ruling out `undefined`/the thunk (no cast) before reading the minted credentials.
    const apple = opts.socialProviders?.apple;
    if (apple === undefined || typeof apple === 'function') {
      throw new Error('expected an Apple provider config object');
    }
    // The client id is the Services ID; the secret is a freshly minted 3-segment ES256 JWT.
    expect(apple.clientId).toBe('com.docket.web');
    expect(apple.clientSecret?.split('.')).toHaveLength(3);
    // Apple's form_post callback origin must be trusted (baseEnv sets no other trusted origins).
    expect(opts.trustedOrigins).toEqual(['https://appleid.apple.com']);
    // Apple is a trusted account-linking provider like the other social providers.
    expect(opts.account?.accountLinking?.trustedProviders).toEqual(['apple']);
  });

  it('does NOT mount Apple (and does not add its origin) when any APPLE_* var is missing', async () => {
    const { buildAuthOptions } = await import('../src/index');
    // Missing the private key → provider off, appleid.apple.com NOT trusted.
    const opts = buildAuthOptions(
      { ...baseEnv, ...APPLE_ENV, APPLE_PRIVATE_KEY: undefined },
      MAILER_DEPS,
    );
    expect(opts.socialProviders).toBeUndefined();
    expect(opts.trustedOrigins).not.toContain('https://appleid.apple.com');
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

    it('reports apple only when ALL FOUR durable APPLE_* vars are real (not a single pair)', async () => {
      const { configuredSocialProviders } = await import('../src/index');
      // All four present → apple is available.
      expect(configuredSocialProviders({ ...baseEnv, ...APPLE_ENV })).toEqual(['apple']);
      // Drop the key id → not available (unlike the other providers, apple needs all four).
      expect(
        configuredSocialProviders({ ...baseEnv, ...APPLE_ENV, APPLE_KEY_ID: undefined }),
      ).toEqual([]);
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
        Object.keys(buildAuthOptions(full, MAILER_DEPS).socialProviders ?? {}).sort(),
      );
    });
  });

  it('mounts oidcProvider (before nextCookies) when OIDC_LOGIN_PAGE_URL is real but MCP_RESOURCE_URL is not', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let opts!: ReturnType<typeof buildAuthOptions>;
    try {
      opts = buildAuthOptions(
        {
          ...baseEnv,
          OIDC_LOGIN_PAGE_URL: 'https://docket.example/sign-in',
        },
        MAILER_DEPS,
      );
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
      'signup-challenge',
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
    const opts = buildAuthOptions(
      {
        ...baseEnv,
        OIDC_LOGIN_PAGE_URL: 'https://docket.example/sign-in',
        MCP_RESOURCE_URL: 'https://docket.example/mcp',
      },
      MAILER_DEPS,
    );
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).toEqual([
      'passkey',
      'two-factor',
      'recovery-challenge',
      'signup-challenge',
      'mcp',
      'next-cookies',
    ]);
    expect(ids).not.toContain('oidc-provider');
    expect(ids[ids.length - 1]).toBe('next-cookies');
  });

  it('mounts oAuthProxy (before nextCookies) only when both OAUTH_PROXY_* are real', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(
      {
        ...baseEnv,
        OAUTH_PROXY_SECRET: 'oauth-proxy-shared-secret',
        OAUTH_PROXY_PRODUCTION_URL: 'https://app.docket.example',
      },
      MAILER_DEPS,
    );
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).toContain('oauth-proxy');
    expect(ids[ids.length - 1]).toBe('next-cookies');
  });

  it('does NOT mount oAuthProxy when the pair is absent or half-configured', async () => {
    const { buildAuthOptions } = await import('../src/index');
    // Absent (the local placeholder env).
    expect((buildAuthOptions(baseEnv, MAILER_DEPS).plugins ?? []).map((p) => p.id)).not.toContain(
      'oauth-proxy',
    );
    // Secret without URL → not mounted (the contract also rejects this pair at env validation).
    const half = buildAuthOptions(
      { ...baseEnv, OAUTH_PROXY_SECRET: 'only-the-secret' },
      MAILER_DEPS,
    );
    expect((half.plugins ?? []).map((p) => p.id)).not.toContain('oauth-proxy');
  });

  it('uses a static baseURL string + no proxy-header trust when BETTER_AUTH_ALLOWED_HOSTS is unset', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(baseEnv, MAILER_DEPS);
    expect(opts.baseURL).toBe('http://localhost:3000');
    expect(opts.advanced?.trustedProxyHeaders).toBeUndefined();
  });

  it('switches to dynamic baseURL + proxy-header trust when BETTER_AUTH_ALLOWED_HOSTS is set', async () => {
    const { buildAuthOptions } = await import('../src/index');
    const opts = buildAuthOptions(
      {
        ...baseEnv,
        // Trimmed/empties-dropped CSV (reuses parseTrustedOrigins).
        BETTER_AUTH_ALLOWED_HOSTS: 'usedocket.app, docket.hypertext.studio , *.vercel.app,',
      },
      MAILER_DEPS,
    );
    expect(opts.baseURL).toEqual({
      allowedHosts: ['usedocket.app', 'docket.hypertext.studio', '*.vercel.app'],
      fallback: 'http://localhost:3000',
      protocol: 'auto',
    });
    expect(opts.advanced?.trustedProxyHeaders).toBe(true);
  });
});
