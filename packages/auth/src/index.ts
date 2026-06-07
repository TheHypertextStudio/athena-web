/**
 * `@docket/auth` — the single Better Auth configuration + passkey-intent signer.
 *
 * @remarks
 * One `betterAuth()` instance, built by {@link buildAuthOptions} from the validated
 * `@docket/env/api` contract: drizzle adapter over `@docket/db` (singular table names),
 * the shared ULID `genId` as the id generator (so `user`/`session`/`account` ids line up
 * with `actor.user_id`), email/password sign-in, and `nextCookies()` LAST. A
 * `databaseHooks.user.create.after` hook performs the user→hub birth so every account
 * gets its 1:1 Hub regardless of sign-in method.
 *
 * **Env-gated plugin set (Better Auth 1.6.14).** Every optional capability mounts ONLY
 * when its credentials are present + real-shaped (`isRealValue` from `@docket/env`), so the
 * zero-account local build (placeholder/empty keys) keeps exactly today's behavior
 * (email/password + hub hook + `nextCookies`):
 * - **Social providers** — Google + GitHub + Linear (Linear is a native 1.6.14 provider,
 *   so no `genericOAuth` is needed). Each gated on `*_CLIENT_ID` **and** `*_CLIENT_SECRET`.
 *   They reuse the core `account` table (no new schema).
 * - **Account linking** — enabled automatically when ≥1 social provider mounts, with
 *   `trustedProviders` = the mounted set + `email-password` (`account.accountLinking`).
 * - **`oidcProvider`** — mounted when `OIDC_LOGIN_PAGE_URL` is real (used as `loginPage`).
 *   (1.6.14 prints a deprecation notice nudging toward the separate, not-installed
 *   `@better-auth/oauth-provider`; the in-tree `oidcProvider` still ships + works, so it
 *   is the available path here. The notice only fires when the gate is open, i.e. never in
 *   the local/test build.)
 * - **`mcp`** — mounted when both `OIDC_LOGIN_PAGE_URL` (its required `loginPage`) and
 *   `MCP_RESOURCE_URL` (its `resource`) are real. `mcp` internally constructs `oidcProvider`
 *   (reusing its schema + endpoints) and adds the OAuth 2.1 protected-resource metadata, so
 *   when MCP is enabled ONLY `mcp` is mounted (it supersedes the standalone provider). Both
 *   plugins share the three additive oauth tables in `@docket/db`
 *   (`oauth_application`/`oauth_access_token`/`oauth_consent`) and are pushed BEFORE
 *   `nextCookies()`.
 *
 * **Deliberately skipped** (documented, not forced — see DECISIONS pins): `passkey`
 * (ships separately needing `@simplewebauthn/*`, not installed — the `passkey` table + the
 * HMAC passkey-intent signer below already exist and stay as-is), `sso`/`scim` (separate
 * `@better-auth/*` packages, not installed), and the Better-Auth `stripe` plugin (not
 * installed; billing is handled via `@docket/env` `STRIPE_*` + `BILLING_ENABLED` elsewhere).
 *
 * **MCP server binding (follow-up).** Once `mcp` + `oidcProvider` are mounted (real
 * `OIDC_LOGIN_PAGE_URL` + `MCP_RESOURCE_URL`), the MCP server guard in `apps/api/src/mcp`
 * would migrate from the current Better-Auth session/bearer check to `withMcpAuth(auth, …)`
 * plus the `getMCPProtectedResourceMetadata` / `.well-known/oauth-protected-resource`
 * endpoints (all exported from `better-auth/plugins`). That wiring is intentionally out of
 * scope here so the existing guard keeps working; mounting the plugin first is the prereq.
 */
import {
  account,
  db,
  genId,
  hub,
  passkey as passkeyTable,
  session,
  user,
  verification,
} from '@docket/db';
import { env } from '@docket/env/api';
import { isRealValue } from '@docket/env';
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { mcp, oidcProvider } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';

export * from './passkey-intent';

/**
 * The subset of the validated server environment that {@link buildAuthOptions} reads to
 * decide which providers/plugins to mount.
 *
 * @remarks
 * A structural slice of `@docket/env/api`'s `ApiEnv` (not a re-export) so the builder is a
 * pure, testable function: tests pass crafted env objects to exercise both the
 * provider-present and provider-absent branches without real OAuth credentials or
 * `vi.resetModules()`.
 */
export interface AuthEnv {
  /** HMAC secret for cookies/tokens. */
  readonly BETTER_AUTH_SECRET: string;
  /** Canonical base URL of the auth server. */
  readonly BETTER_AUTH_URL: string;
  /** Comma-separated trusted origins (parsed into the `trustedOrigins` array). */
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string | undefined;
  /** Google OAuth client id (paired with secret). */
  readonly GOOGLE_CLIENT_ID?: string | undefined;
  /** Google OAuth client secret. */
  readonly GOOGLE_CLIENT_SECRET?: string | undefined;
  /** GitHub OAuth client id (paired with secret). */
  readonly GITHUB_CLIENT_ID?: string | undefined;
  /** GitHub OAuth client secret. */
  readonly GITHUB_CLIENT_SECRET?: string | undefined;
  /** Linear OAuth client id (paired with secret). */
  readonly LINEAR_CLIENT_ID?: string | undefined;
  /** Linear OAuth client secret. */
  readonly LINEAR_CLIENT_SECRET?: string | undefined;
  /** Login page path/URL for `oidcProvider` + `mcp` (their required `loginPage`). */
  readonly OIDC_LOGIN_PAGE_URL?: string | undefined;
  /** Canonical resource URL advertised by the MCP protected-resource metadata. */
  readonly MCP_RESOURCE_URL?: string | undefined;
}

/**
 * Parse `BETTER_AUTH_TRUSTED_ORIGINS` (comma list) into a trimmed, empties-dropped array.
 *
 * @param raw - The raw env value, or `undefined`/empty when unset.
 * @returns the trusted-origin list (empty when unset).
 */
function parseTrustedOrigins(raw: string | undefined): string[] {
  return (
    raw
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

/**
 * Build the Better Auth options from the validated environment, mounting each optional
 * social provider / plugin ONLY when its credentials are real-shaped (`isRealValue`).
 *
 * @remarks
 * Pure (no module-level side effects beyond reading the passed `e`), so both the
 * provider-present and provider-absent branches are unit-testable directly. With local
 * placeholders every gate is closed → the returned options equal the historical
 * email/password-only config (plus the hub hook and `nextCookies()`), which is why the
 * existing tests stay green. `nextCookies()` is always pushed LAST.
 *
 * @param e - The validated server env slice (see {@link AuthEnv}).
 * @returns the fully-assembled `BetterAuthOptions` ready for `betterAuth()`.
 */
export function buildAuthOptions(e: AuthEnv): BetterAuthOptions {
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
  const trustedProviders: string[] = ['email-password'];

  if (isRealValue(e.GOOGLE_CLIENT_ID) && isRealValue(e.GOOGLE_CLIENT_SECRET)) {
    socialProviders.google = { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET };
    trustedProviders.push('google');
  }
  if (isRealValue(e.GITHUB_CLIENT_ID) && isRealValue(e.GITHUB_CLIENT_SECRET)) {
    socialProviders.github = { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET };
    trustedProviders.push('github');
  }
  if (isRealValue(e.LINEAR_CLIENT_ID) && isRealValue(e.LINEAR_CLIENT_SECRET)) {
    socialProviders.linear = { clientId: e.LINEAR_CLIENT_ID, clientSecret: e.LINEAR_CLIENT_SECRET };
    trustedProviders.push('linear');
  }

  const hasSocial = Object.keys(socialProviders).length > 0;

  const plugins: BetterAuthPlugin[] = [];
  if (isRealValue(e.OIDC_LOGIN_PAGE_URL)) {
    if (isRealValue(e.MCP_RESOURCE_URL)) {
      // `mcp` internally constructs `oidcProvider` (reuses its schema + endpoints) and adds
      // the OAuth 2.1 protected-resource metadata, so mounting `mcp` alone gives the full
      // OIDC-provider behavior plus MCP — without referencing the deprecated `oidcProvider`
      // symbol. The shared oauth tables in `@docket/db` back both.
      plugins.push(mcp({ loginPage: e.OIDC_LOGIN_PAGE_URL, resource: e.MCP_RESOURCE_URL }));
    } else {
      // OIDC-provider only (no MCP resource): the standalone `oidcProvider` is the available
      // implementation. It is flagged `@deprecated` in 1.6.14 in favor of the separate
      // `@better-auth/oauth-provider`, which is NOT installed — and adding it would risk the
      // pinned better-call@1.3.5 / drizzle tree (a documented guardrail). The in-tree plugin
      // still ships and works, so this suppression is intentional and scoped to this line.
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- successor pkg not installed; see remarks
      plugins.push(oidcProvider({ loginPage: e.OIDC_LOGIN_PAGE_URL }));
    }
  }
  // nextCookies() MUST be last.
  plugins.push(nextCookies());

  return {
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.BETTER_AUTH_URL,
    trustedOrigins: parseTrustedOrigins(e.BETTER_AUTH_TRUSTED_ORIGINS),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification, passkey: passkeyTable },
    }),
    advanced: {
      database: {
        // Share the repo-wide ULID generator so auth ids are 26-char text ULIDs.
        generateId: () => genId(),
      },
    },
    emailAndPassword: { enabled: true },
    ...(hasSocial
      ? { socialProviders, account: { accountLinking: { enabled: true, trustedProviders } } }
      : {}),
    plugins,
    databaseHooks: {
      user: {
        create: {
          // The user→hub birth: every new account gets its 1:1 personal Hub.
          after: async (createdUser) => {
            await db.insert(hub).values({ userId: createdUser.id });
          },
        },
      },
    },
  };
}

/** The configured Better Auth instance (handler, server API, plugins). */
export const auth = betterAuth(buildAuthOptions(env));

/** The inferred type of the configured Better Auth instance. */
export type Auth = typeof auth;
