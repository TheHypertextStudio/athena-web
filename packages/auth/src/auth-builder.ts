import { passkey } from '@better-auth/passkey';
import {
  account,
  db,
  genId,
  hub,
  oauthAccessToken,
  oauthApplication,
  oauthConsent,
  passkey as passkeyTable,
  rateLimit as rateLimitTable,
  session,
  twoFactor as twoFactorTable,
  user,
  verification,
} from '@docket/db';
import { isRealValue } from '@docket/env';
import type { Mailer } from '@docket/boundaries';
import { type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { mcp, oAuthProxy, oidcProvider, twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';

import { generateAppleClientSecret, type AppleClientSecretInput } from './apple-secret';
import { recoveryChallenge } from './recovery-challenge';
import { signupChallenge } from './signup-challenge';
import { INTENT_IDENTIFIER_PREFIX, type SignupIntent } from './signup-intent';

/** The external dependencies {@link buildAuthOptions} injects into email-sending auth flows. */
export interface AuthDeps {
  /** The mailer the sign-up verification (and future change-email) flows send through. */
  readonly mailer: Mailer;
  /**
   * Non-production only: echo the sign-up code in the `/sign-up/request-code` response so e2e tests
   * can complete the flow without reading the capture mailer's outbox. Never set in production.
   */
  readonly devEchoSignupCode?: boolean;
}

/**
 * The subset of the validated server environment that {@link buildAuthOptions} reads to
 * decide which providers/plugins to mount.
 *
 * @remarks
 * A structural slice of `@docket/env/api`'s `ApiEnv` (not a re-export) so the builder is
 * a pure, testable function: tests pass crafted env objects to exercise both the
 * provider-present and provider-absent branches.
 */
export interface AuthEnv {
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_URL: string;
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string | undefined;
  readonly BETTER_AUTH_ALLOWED_HOSTS?: string;
  readonly BETTER_AUTH_COOKIE_DOMAIN?: string | undefined;
  readonly BETTER_AUTH_PASSKEY_RP_ID: string;
  readonly BETTER_AUTH_PASSKEY_RP_NAME: string;
  readonly GOOGLE_CLIENT_ID?: string | undefined;
  readonly GOOGLE_CLIENT_SECRET?: string | undefined;
  readonly GITHUB_APP_CLIENT_ID?: string | undefined;
  readonly GITHUB_APP_CLIENT_SECRET?: string | undefined;
  readonly LINEAR_CLIENT_ID?: string | undefined;
  readonly LINEAR_CLIENT_SECRET?: string | undefined;
  readonly DISCORD_CLIENT_ID?: string | undefined;
  readonly DISCORD_CLIENT_SECRET?: string | undefined;
  readonly APPLE_CLIENT_ID?: string | undefined;
  readonly APPLE_TEAM_ID?: string | undefined;
  readonly APPLE_KEY_ID?: string | undefined;
  readonly APPLE_PRIVATE_KEY?: string | undefined;
  readonly OAUTH_PROXY_SECRET?: string | undefined;
  readonly OAUTH_PROXY_PRODUCTION_URL?: string | undefined;
  readonly OIDC_LOGIN_PAGE_URL?: string | undefined;
  readonly MCP_RESOURCE_URL?: string | undefined;
}

/** Parse `BETTER_AUTH_TRUSTED_ORIGINS` (comma list) into a trimmed, empties-dropped array. */
export function parseTrustedOrigins(raw: string | undefined): string[] {
  return (
    raw
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

/** A pending `verification` row as {@link resolvePasskeyUser} reads it. */
interface VerificationRow {
  readonly value: string;
  readonly expiresAt: Date;
}

/**
 * The minimal Better Auth internal-adapter surface {@link resolvePasskeyUser} needs to consume a
 * verified-intent and find-or-resume the signing-up user.
 *
 * @remarks
 * A structural slice of Better Auth's `ctx.context.internalAdapter` (plus a `countPasskeys` helper
 * the wiring backs with a direct query) so the resolver is a pure, directly unit-testable function.
 */
export interface PasskeyUserAdapter {
  findVerificationValue(identifier: string): Promise<VerificationRow | null>;
  deleteVerificationByIdentifier(identifier: string): Promise<void>;
  findUserByEmail(
    email: string,
    options?: { includeAccounts: boolean },
  ): Promise<{
    user: { id: string; name: string };
    accounts?: readonly { providerId: string }[];
  } | null>;
  countPasskeys(userId: string): Promise<number>;
  createUser(data: {
    name: string;
    email: string;
    emailVerified: boolean;
  }): Promise<{ id: string; name: string }>;
}

/**
 * Resolve the user a passkey is being registered for during passwordless sign-up.
 *
 * @remarks
 * Wired into `@better-auth/passkey` as `registration.resolveUser` (invoked with no session, since
 * `requireSession: false`). The `context` is the single-use verified-intent minted by the
 * {@link signupChallenge} plugin *after* the caller proved inbox ownership — so a passkey can only
 * ever be bound to an email the caller controls. The intent is consumed here (single use). Behavior
 * once the proven email is known:
 *
 * - **No account for the email** → create it (`emailVerified: true` — now genuinely verified) and
 *   attach the passkey. Going through `internalAdapter.createUser` fires the hub-birth hook.
 * - **Account exists with a passkey or a linked social account** → reject: this is a returning user
 *   who should sign in / recover, not sign up again. Never graft a new credential onto it.
 * - **Account exists with no credential yet** (an abandoned sign-up whose ceremony was cancelled
 *   after the user row was created) → resume by returning it, so a retry can attach the passkey.
 *
 * @param adapter - The Better Auth internal-adapter slice (+ `countPasskeys`).
 * @param context - The verified-intent identifier from the registration request.
 * @throws {Error} when `context` is absent/malformed, or the intent is invalid/expired, or an
 * account with a credential already exists for the proven email.
 */
export async function resolvePasskeyUser(
  adapter: PasskeyUserAdapter,
  context: string | null | undefined,
): Promise<{ id: string; name: string }> {
  if (!context) throw new Error('passkey sign-up: registration context is required');
  if (!context.startsWith(INTENT_IDENTIFIER_PREFIX)) {
    throw new Error('passkey sign-up: invalid registration context');
  }
  const row = await adapter.findVerificationValue(context);
  if (!row || row.expiresAt < new Date()) {
    if (row) await adapter.deleteVerificationByIdentifier(context);
    throw new Error('passkey sign-up: registration intent is invalid or expired');
  }
  // Single use: consume the intent up front, whatever the outcome below.
  await adapter.deleteVerificationByIdentifier(context);
  const intent = JSON.parse(row.value) as SignupIntent;

  const existing = await adapter.findUserByEmail(intent.email, { includeAccounts: true });
  if (existing?.user) {
    const hasSocial = (existing.accounts?.length ?? 0) > 0;
    const hasPasskey = (await adapter.countPasskeys(existing.user.id)) > 0;
    if (hasSocial || hasPasskey) {
      throw new Error('passkey sign-up: an account already exists for this email');
    }
    return { id: existing.user.id, name: existing.user.name };
  }

  const created = await adapter.createUser({
    name: intent.name,
    email: intent.email,
    emailVerified: true,
  });
  return { id: created.id, name: created.name };
}

/** A social provider a user can sign in / link an account with. */
export type SocialProvider = 'google' | 'github' | 'linear' | 'apple' | 'discord';

/**
 * The four durable Apple credentials when ALL are real-shaped, else `undefined`.
 *
 * @remarks
 * Apple's client secret is minted from these (see {@link generateAppleClientSecret}), so — unlike
 * the single id+secret pair the other providers use — "configured" means ALL FOUR are present.
 * Returning the typed object (rather than a boolean) both narrows the values to `string` for the
 * caller and is the single truth {@link configuredSocialProviders} and {@link buildAuthOptions}
 * consult (so provider availability and the minted secret never disagree).
 */
function resolveAppleCredentials({
  APPLE_CLIENT_ID,
  APPLE_TEAM_ID,
  APPLE_KEY_ID,
  APPLE_PRIVATE_KEY,
}: AuthEnv): AppleClientSecretInput | undefined {
  if (
    isRealValue(APPLE_CLIENT_ID) &&
    isRealValue(APPLE_TEAM_ID) &&
    isRealValue(APPLE_KEY_ID) &&
    isRealValue(APPLE_PRIVATE_KEY)
  ) {
    return {
      clientId: APPLE_CLIENT_ID,
      teamId: APPLE_TEAM_ID,
      keyId: APPLE_KEY_ID,
      privateKey: APPLE_PRIVATE_KEY,
    };
  }
  return undefined;
}

/**
 * The social providers whose OAuth credentials are actually configured in this environment.
 *
 * @remarks
 * The single source of truth for "which providers are available": a provider is on iff BOTH its
 * client id and secret are real-shaped values ({@link isRealValue}). Both {@link buildAuthOptions}
 * (to decide which providers to mount) and the public `/v1/config` endpoint (to tell the client
 * what to offer) derive availability from this — so the client never needs a parallel build-time
 * flag like `NEXT_PUBLIC_OAUTH_GOOGLE` that can drift from the real credentials.
 *
 * @param e - The validated server env slice (see {@link AuthEnv}).
 */
export function configuredSocialProviders(e: AuthEnv): SocialProvider[] {
  const providers: SocialProvider[] = [];
  if (isRealValue(e.GOOGLE_CLIENT_ID) && isRealValue(e.GOOGLE_CLIENT_SECRET))
    providers.push('google');
  if (isRealValue(e.GITHUB_APP_CLIENT_ID) && isRealValue(e.GITHUB_APP_CLIENT_SECRET))
    providers.push('github');
  if (isRealValue(e.LINEAR_CLIENT_ID) && isRealValue(e.LINEAR_CLIENT_SECRET))
    providers.push('linear');
  if (isRealValue(e.DISCORD_CLIENT_ID) && isRealValue(e.DISCORD_CLIENT_SECRET))
    providers.push('discord');
  if (resolveAppleCredentials(e) !== undefined) providers.push('apple');
  return providers;
}

/**
 * Build the Better Auth options from the validated environment, mounting each optional
 * social provider / plugin ONLY when its credentials are real-shaped.
 *
 * @remarks
 * Pure (no module-level side effects): both the provider-present and provider-absent
 * branches are unit-testable directly. Provider availability is the same set
 * {@link configuredSocialProviders} reports. `nextCookies()` is always pushed LAST.
 *
 * @param e - The validated server env slice (see {@link AuthEnv}).
 */
/**
 * How long a session stays valid without any activity (30 days). Chosen deliberately for a
 * passkey-first app: re-authentication is a cheap Face ID / Touch ID tap, so a long idle window
 * trades little security for markedly less friction. Overrides Better Auth's 7-day default.
 */
const SESSION_EXPIRES_IN_S = 60 * 60 * 24 * 30;

/**
 * How often an active session's expiry slides forward (1 day). A session used within any 24-hour
 * window keeps renewing; `updatedAt`/`expiresAt` move but `createdAt` does not, so the custom
 * `requireFreshSession` step-up gate (which reads `createdAt`) is unaffected by sliding refresh.
 */
const SESSION_UPDATE_AGE_S = 60 * 60 * 24;

/**
 * How long a session is considered "fresh" for Better Auth's own fresh-session middleware (5
 * minutes). Kept in lockstep with the app-level `requireFreshSession` window in
 * `apps/api/src/routes/me-account.ts` / `me-recovery.ts` so high-risk actions demand a recent
 * re-auth consistently on both the framework and application gates.
 */
const SESSION_FRESH_AGE_S = 60 * 5;

/**
 * Build the Better Auth configuration from the validated environment + injected boundaries.
 *
 * @remarks
 * Mounts each social provider iff its credentials are real-shaped (see {@link isRealValue}),
 * pushing it onto `trustedProviders` for account linking. This is the single place the auth
 * instance's shape is assembled — `apps/api` passes the result straight into `betterAuth()`.
 *
 * @param e - The validated auth-relevant environment slice.
 * @param deps - Injected boundaries (mailer, db, etc.) the auth instance needs.
 * @returns the assembled Better Auth options.
 */
export function buildAuthOptions(e: AuthEnv, deps: AuthDeps): BetterAuthOptions {
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
  const trustedProviders: string[] = [...configuredSocialProviders(e)];

  if (isRealValue(e.GOOGLE_CLIENT_ID) && isRealValue(e.GOOGLE_CLIENT_SECRET)) {
    socialProviders.google = {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      // `tasks` (read-WRITE, not `tasks.readonly`) is required for two-way Google Tasks sync —
      // the connector's `pushTask` 403s without it. (Existing Google-linked users predating this
      // scope must re-consent; they surface as `error`/needs-reauth, never silently.)
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://mail.google.com/',
      ],
      // `offline` returns a refresh token so background syncs run while nobody is signed in;
      // `select_account consent` shows the account chooser so a user can link a DIFFERENT Google
      // account each time (multi-account) and Google re-issues a refresh token on each grant.
      accessType: 'offline',
      prompt: 'select_account consent',
    };
  }
  if (isRealValue(e.GITHUB_APP_CLIENT_ID) && isRealValue(e.GITHUB_APP_CLIENT_SECRET)) {
    // Sign-in runs on the GitHub App's user-to-server OAuth (a GitHub App reuses the OAuth web
    // endpoints with its `Iv…` client id). Only `user:email` is requested — repo access is NOT a
    // sign-in scope: it comes from installing the App (Issues/PRs permission), so the scary `repo`
    // scope the retired OAuth App needed is gone.
    socialProviders.github = {
      clientId: e.GITHUB_APP_CLIENT_ID,
      clientSecret: e.GITHUB_APP_CLIENT_SECRET,
      scope: ['user:email'],
    };
  }
  if (isRealValue(e.LINEAR_CLIENT_ID) && isRealValue(e.LINEAR_CLIENT_SECRET)) {
    // `read` is required for the Linear connector to query the GraphQL API — without it the
    // grant carries no scope and every connector call 400s. (Existing Linear-linked users
    // predating this scope must re-consent; they surface as `error`/needs-reauth, not silent.)
    socialProviders.linear = {
      clientId: e.LINEAR_CLIENT_ID,
      clientSecret: e.LINEAR_CLIENT_SECRET,
      scope: ['read'],
    };
  }
  if (isRealValue(e.DISCORD_CLIENT_ID) && isRealValue(e.DISCORD_CLIENT_SECRET)) {
    // `identify` returns the user's Discord id + username via /users/@me — enough to map a
    // mentioned snowflake to this Docket user. No message/guild scopes: reading messages is the
    // relay bot's job (a separate bot token), not this user-linking grant.
    socialProviders.discord = {
      clientId: e.DISCORD_CLIENT_ID,
      clientSecret: e.DISCORD_CLIENT_SECRET,
      scope: ['identify'],
    };
  }
  const appleCreds = resolveAppleCredentials(e);
  if (appleCreds !== undefined) {
    // Apple's client secret is a short-lived ES256 JWT minted from the .p8 key at boot (not a
    // static env string) — see `generateAppleClientSecret`.
    socialProviders.apple = {
      clientId: appleCreds.clientId,
      clientSecret: generateAppleClientSecret(appleCreds),
    };
  }

  const hasSocial = Object.keys(socialProviders).length > 0;

  const plugins: BetterAuthPlugin[] = [
    passkey({
      rpID: e.BETTER_AUTH_PASSKEY_RP_ID,
      rpName: e.BETTER_AUTH_PASSKEY_RP_NAME,
      registration: {
        requireSession: false,
        resolveUser: ({ ctx, context }) =>
          resolvePasskeyUser(
            {
              findVerificationValue: (id) => ctx.context.internalAdapter.findVerificationValue(id),
              deleteVerificationByIdentifier: (id) =>
                ctx.context.internalAdapter.deleteVerificationByIdentifier(id),
              findUserByEmail: (email, options) =>
                ctx.context.internalAdapter.findUserByEmail(email, options),
              createUser: (data) => ctx.context.internalAdapter.createUser(data),
              countPasskeys: async (userId) => {
                const rows = await db
                  .select({ id: passkeyTable.id })
                  .from(passkeyTable)
                  .where(eq(passkeyTable.userId, userId));
                return rows.length;
              },
            },
            context,
          ),
      },
    }),
    // Account recovery codes (backup codes). Configured backup-codes-only for this passwordless,
    // passkey-first app: `allowPasswordless` lets passkey users enable/manage codes without a
    // password; `skipVerificationOnEnable` enables immediately (no TOTP verify step); TOTP is
    // disabled and OTP is never configured, so the only second factor is the recovery code, stored
    // encrypted at rest (keyed by `BETTER_AUTH_SECRET`). See the recovery bridge below.
    twoFactor({
      issuer: e.BETTER_AUTH_PASSKEY_RP_NAME,
      allowPasswordless: true,
      skipVerificationOnEnable: true,
      totpOptions: { disable: true },
      backupCodeOptions: { storeBackupCodes: 'encrypted' },
    }),
    // Bridges the locked-out recovery case (no passkey ⇒ no session ⇒ no `two_factor` challenge
    // cookie). Mints that cookie from an email so the unmodified `verifyBackupCode` can run.
    recoveryChallenge(),
    // Email-verification challenge that gates passwordless sign-up: proves inbox ownership and
    // mints the single-use intent `resolvePasskeyUser` consumes, so a passkey is never bound to an
    // unverified email. Closes the pre-registration account-takeover (audit CRITICAL-1/HIGH-2).
    signupChallenge({
      mailer: deps.mailer,
      ...(deps.devEchoSignupCode ? { devEchoCode: true } : {}),
    }),
  ];

  if (isRealValue(e.OIDC_LOGIN_PAGE_URL)) {
    if (isRealValue(e.MCP_RESOURCE_URL)) {
      let consentPage: string | undefined;
      try {
        consentPage = new URL('/oauth/authorize', new URL(e.OIDC_LOGIN_PAGE_URL).origin).toString();
      } catch {
        consentPage = undefined;
      }
      plugins.push(
        mcp({
          loginPage: e.OIDC_LOGIN_PAGE_URL,
          resource: e.MCP_RESOURCE_URL,
          oidcConfig: {
            loginPage: e.OIDC_LOGIN_PAGE_URL,
            scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
            defaultScope: 'work:read',
            accessTokenExpiresIn: 60 * 15,
            refreshTokenExpiresIn: 60 * 60 * 24 * 30,
            ...(consentPage ? { consentPage } : {}),
          },
        }),
      );
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- successor pkg not installed; see remarks in index.ts
      plugins.push(oidcProvider({ loginPage: e.OIDC_LOGIN_PAGE_URL }));
    }
  }
  // oAuthProxy lets preview/branch deployments run social OAuth through production: only prod's
  // callback URL is registered with the provider, and previews (whose URL can't be pre-registered)
  // proxy the flow through it. Mounted only when BOTH the shared secret and the production URL are
  // configured — unset (local/first-setup) ⇒ OAuth runs directly against the env's own callback.
  if (isRealValue(e.OAUTH_PROXY_SECRET) && isRealValue(e.OAUTH_PROXY_PRODUCTION_URL)) {
    plugins.push(
      oAuthProxy({ productionURL: e.OAUTH_PROXY_PRODUCTION_URL, secret: e.OAUTH_PROXY_SECRET }),
    );
  }
  plugins.push(nextCookies());

  // When `BETTER_AUTH_ALLOWED_HOSTS` lists one or more host patterns, switch `baseURL` to
  // Better Auth's dynamic config: the per-request base URL is derived from the incoming
  // request host (validated against this allowlist), so one instance serves preview
  // deployments (`*.vercel.app`) and multiple custom domains. `BETTER_AUTH_URL` stays the
  // `fallback` for unmatched/header-less requests. Unset ⇒ the static-string behavior is
  // byte-identical to before (no proxy-header trust). See the dynamic-base-url guide.
  const allowedHosts = parseTrustedOrigins(e.BETTER_AUTH_ALLOWED_HOSTS);
  const dynamicBaseURL = allowedHosts.length > 0;

  // `BETTER_AUTH_COOKIE_DOMAIN`, when set, scopes session cookies to a shared parent domain so a
  // cookie written by one subdomain is readable by its siblings. This is required wherever the
  // browser and the auth handler answer on DIFFERENT hosts: locally the `oAuthProxy` social flow
  // relays the callback through `api.docket.localhost` and writes the session there, but the app
  // runs on `docket.localhost` — host-only cookies would be invisible to it. Setting the domain to
  // `docket.localhost` shares the cookie across the whole `*.docket.localhost` family (app, api,
  // admin). Unset ⇒ host-only cookies (the same-origin production default). See
  // `docs/local-development.md` (Tunnels & local OAuth).
  const cookieDomain = isRealValue(e.BETTER_AUTH_COOKIE_DOMAIN)
    ? e.BETTER_AUTH_COOKIE_DOMAIN
    : undefined;

  // Apple posts its OAuth callback (form_post) from `appleid.apple.com`, so that origin must be
  // trusted or Better Auth rejects the callback. Added ONLY when Apple is configured — unset ⇒ the
  // trusted-origins list is byte-identical to the CSV env value.
  const trustedOrigins = parseTrustedOrigins(e.BETTER_AUTH_TRUSTED_ORIGINS);
  if (appleCreds !== undefined) trustedOrigins.push('https://appleid.apple.com');

  return {
    secret: e.BETTER_AUTH_SECRET,
    baseURL: dynamicBaseURL
      ? { allowedHosts, fallback: e.BETTER_AUTH_URL, protocol: 'auto' }
      : e.BETTER_AUTH_URL,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user,
        session,
        account,
        verification,
        passkey: passkeyTable,
        twoFactor: twoFactorTable,
        rateLimit: rateLimitTable,
        // The mcp()/oidcProvider OAuth AS models — without these, dynamic client
        // registration and token issuance 500 at the adapter layer.
        oauthApplication,
        oauthAccessToken,
        oauthConsent,
      },
    }),
    // Brute-force / abuse protection. Better Auth enables the limiter in production only (dev/test
    // stay unthrottled); `storage: 'database'` (the `rate_limit` table) keeps counters consistent
    // across serverless instances rather than per-process memory. The global `max` is a generous
    // ceiling; `customRules` tighten the sensitive auth surfaces. The sign-up + recovery challenge
    // plugins layer their own per-path `rateLimit` arrays on top (request-code / verify-code /
    // recovery-challenge / verify-backup-code).
    rateLimit: {
      storage: 'database',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/passkey': { window: 60, max: 20 },
        '/passkey/verify-authentication': { window: 60, max: 20 },
        '/oauth2/consent': { window: 60, max: 20 },
        '/mcp/token': { window: 60, max: 30 },
      },
    },
    advanced: {
      database: { generateId: () => genId() },
      // The auth handler sits behind the Next rewrite proxy, so the browser-facing host
      // only reaches it via `x-forwarded-host` — which the dynamic resolver honors ONLY
      // when proxy headers are trusted. Safe here: hosts are still allowlist-validated.
      ...(dynamicBaseURL ? { trustedProxyHeaders: true } : {}),
      ...(cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } : {}),
    },
    ...(hasSocial
      ? { socialProviders, account: { accountLinking: { enabled: true, trustedProviders } } }
      : {}),
    plugins,
    session: {
      expiresIn: SESSION_EXPIRES_IN_S,
      updateAge: SESSION_UPDATE_AGE_S,
      freshAge: SESSION_FRESH_AGE_S,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (createdUser) => {
            await db.insert(hub).values({ userId: createdUser.id });
          },
        },
      },
    },
  };
}
