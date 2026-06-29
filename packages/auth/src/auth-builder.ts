import { passkey } from '@better-auth/passkey';
import {
  account,
  db,
  genId,
  hub,
  passkey as passkeyTable,
  session,
  twoFactor as twoFactorTable,
  user,
  verification,
} from '@docket/db';
import { isRealValue } from '@docket/env';
import { type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { mcp, oAuthProxy, oidcProvider, twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';

import { verifyPasskeyIntent } from './passkey-intent';
import { recoveryChallenge } from './recovery-challenge';

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
  readonly BETTER_AUTH_PASSKEY_RP_ID: string;
  readonly BETTER_AUTH_PASSKEY_RP_NAME: string;
  readonly GOOGLE_CLIENT_ID?: string | undefined;
  readonly GOOGLE_CLIENT_SECRET?: string | undefined;
  readonly GITHUB_APP_CLIENT_ID?: string | undefined;
  readonly GITHUB_APP_CLIENT_SECRET?: string | undefined;
  readonly LINEAR_CLIENT_ID?: string | undefined;
  readonly LINEAR_CLIENT_SECRET?: string | undefined;
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

/**
 * The minimal Better Auth internal-adapter surface {@link resolvePasskeyUser} needs to
 * find-or-create the signing-up user.
 *
 * @remarks
 * A structural slice of Better Auth's `ctx.context.internalAdapter` so the resolver is
 * a pure, directly unit-testable function.
 */
export interface PasskeyUserAdapter {
  findUserByEmail(email: string): Promise<{ user: { id: string; name: string } } | null>;
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
 * Verifies the HMAC-signed intent `context`, then find-or-creates that user. Wired into
 * `@better-auth/passkey` as `registration.resolveUser` (only invoked when there is no
 * session and `requireSession: false`). Going through `internalAdapter.createUser` fires
 * the hub-birth hook.
 *
 * @param adapter - The Better Auth internal-adapter slice.
 * @param context - The signed passkey-intent token from the registration request.
 * @throws {Error} when `context` is absent, or the intent token is malformed/expired.
 */
export async function resolvePasskeyUser(
  adapter: PasskeyUserAdapter,
  context: string | null | undefined,
): Promise<{ id: string; name: string }> {
  if (!context) throw new Error('passkey sign-up: registration context is required');
  const intent = verifyPasskeyIntent(context);

  const existing = await adapter.findUserByEmail(intent.email);
  if (existing?.user) return { id: existing.user.id, name: existing.user.name };

  const created = await adapter.createUser({
    name: intent.name,
    email: intent.email,
    emailVerified: true,
  });
  return { id: created.id, name: created.name };
}

/** A social provider a user can sign in / link an account with. */
export type SocialProvider = 'google' | 'github' | 'linear';

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
export function buildAuthOptions(e: AuthEnv): BetterAuthOptions {
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

  const hasSocial = Object.keys(socialProviders).length > 0;

  const plugins: BetterAuthPlugin[] = [
    passkey({
      rpID: e.BETTER_AUTH_PASSKEY_RP_ID,
      rpName: e.BETTER_AUTH_PASSKEY_RP_NAME,
      registration: {
        requireSession: false,
        resolveUser: ({ ctx, context }) => resolvePasskeyUser(ctx.context.internalAdapter, context),
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

  return {
    secret: e.BETTER_AUTH_SECRET,
    baseURL: dynamicBaseURL
      ? { allowedHosts, fallback: e.BETTER_AUTH_URL, protocol: 'auto' }
      : e.BETTER_AUTH_URL,
    trustedOrigins: parseTrustedOrigins(e.BETTER_AUTH_TRUSTED_ORIGINS),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user,
        session,
        account,
        verification,
        passkey: passkeyTable,
        twoFactor: twoFactorTable,
      },
    }),
    advanced: {
      database: { generateId: () => genId() },
      // The auth handler sits behind the Next rewrite proxy, so the browser-facing host
      // only reaches it via `x-forwarded-host` — which the dynamic resolver honors ONLY
      // when proxy headers are trusted. Safe here: hosts are still allowlist-validated.
      ...(dynamicBaseURL ? { trustedProxyHeaders: true } : {}),
    },
    ...(hasSocial
      ? { socialProviders, account: { accountLinking: { enabled: true, trustedProviders } } }
      : {}),
    plugins,
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
