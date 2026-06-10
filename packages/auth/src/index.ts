/**
 * `@docket/auth` — the single Better Auth configuration + passkey-intent signer.
 *
 * @remarks
 * One `betterAuth()` instance, built by {@link buildAuthOptions} from the validated
 * `@docket/env/api` contract: drizzle adapter over `@docket/db` (singular table names),
 * the shared ULID `genId` as the id generator (so `user`/`session`/`account` ids line up
 * with `actor.user_id`), and `nextCookies()` LAST. A `databaseHooks.user.create.after`
 * hook performs the user→hub birth so every account gets its 1:1 Hub regardless of
 * sign-in method.
 *
 * **Passwordless: passkey is the primary credential.** Docket has NO email/password
 * sign-in (`emailAndPassword` is removed). The `@better-auth/passkey` 1.6.14 plugin is
 * ALWAYS mounted (its RP id/name come from the required `BETTER_AUTH_PASSKEY_RP_*` env
 * vars) and configured for passkey-first onboarding: `registration.requireSession: false`
 * with a {@link resolvePasskeyUser} hook. A new user signs UP with only a passkey — no
 * prior session — by carrying their name/email through the WebAuthn ceremony as the
 * HMAC-signed `context` token from {@link signPasskeyIntent}; `resolveUser` verifies it
 * and creates (or finds) the `user` via Better Auth's internal adapter, which fires the
 * `databaseHooks.user.create.after` Hub-birth exactly once. The passkey credential is then
 * written against that user (FK `passkey.user_id → user.id`) and a session is issued on
 * the subsequent authentication. Because passkey replaces credentials, `email-password` is
 * no longer a trusted account-linking provider.
 *
 * **Env-gated plugin set (Better Auth 1.6.14).** Every OPTIONAL capability (social /
 * oidc / mcp) mounts ONLY when its credentials are present + real-shaped (`isRealValue`
 * from `@docket/env`), so the zero-account local build (placeholder/empty keys) reduces to
 * exactly: passkey (always) + hub hook + `nextCookies`:
 * - **Social providers** — Google + GitHub + Linear (Linear is a native 1.6.14 provider,
 *   so no `genericOAuth` is needed). Each gated on `*_CLIENT_ID` **and** `*_CLIENT_SECRET`.
 *   They reuse the core `account` table (no new schema).
 * - **Account linking** — enabled automatically when ≥1 social provider mounts, with
 *   `trustedProviders` = the mounted social set (`account.accountLinking`). There is no
 *   `email-password` provider to trust (Docket is passwordless).
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
 * **Deliberately skipped** (documented, not forced — see DECISIONS pins): `sso`/`scim`
 * (separate `@better-auth/*` packages, not installed — SSO/SAML is a tracked later task),
 * and the Better-Auth `stripe` plugin (not installed; billing is handled via `@docket/env`
 * `STRIPE_*` + `BILLING_ENABLED` elsewhere).
 *
 * **MCP server binding (follow-up).** Once `mcp` + `oidcProvider` are mounted (real
 * `OIDC_LOGIN_PAGE_URL` + `MCP_RESOURCE_URL`), the MCP server guard in `apps/api/src/mcp`
 * would migrate from the current Better-Auth session/bearer check to `withMcpAuth(auth, …)`
 * plus the `getMCPProtectedResourceMetadata` / `.well-known/oauth-protected-resource`
 * endpoints (all exported from `better-auth/plugins`). That wiring is intentionally out of
 * scope here so the existing guard keeps working; mounting the plugin first is the prereq.
 */
import { passkey } from '@better-auth/passkey';
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

import { verifyPasskeyIntent } from './passkey-intent';

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
  /** WebAuthn relying-party id (the registrable domain; `docket.localhost` in dev). */
  readonly BETTER_AUTH_PASSKEY_RP_ID: string;
  /** WebAuthn relying-party display name (e.g. `Docket`). */
  readonly BETTER_AUTH_PASSKEY_RP_NAME: string;
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
 * The minimal Better Auth internal-adapter surface {@link resolvePasskeyUser} needs to
 * find-or-create the signing-up user.
 *
 * @remarks
 * A structural slice of Better Auth's `ctx.context.internalAdapter` (NOT a re-export) so
 * the resolver is a pure, directly unit-testable function: tests pass a tiny fake adapter
 * to exercise both the existing-user and new-user branches without booting a full WebAuthn
 * endpoint context. Going through `internalAdapter.createUser` (rather than a raw
 * `db.insert`) is what fires `databaseHooks.user.create.after`, so the user→hub birth holds
 * for passwordless passkey sign-up exactly as it does for every other path.
 */
export interface PasskeyUserAdapter {
  /** Look up an existing user by email (returns `{ user }` or `null`). */
  findUserByEmail(email: string): Promise<{ user: { id: string; name: string } } | null>;
  /** Create a user (fires the create hooks, incl. the hub-birth) and return it. */
  createUser(data: {
    name: string;
    email: string;
    emailVerified: boolean;
  }): Promise<{ id: string; name: string }>;
}

/**
 * Resolve the `user` a passkey is being registered for during passwordless (pre-session)
 * sign-up: verify the HMAC-signed intent `context`, then find-or-create that user.
 *
 * @remarks
 * Wired into the `@better-auth/passkey` plugin as `registration.resolveUser` (only invoked
 * when there is no session and `requireSession: false`). The `context` is the opaque token
 * minted by {@link signPasskeyIntent} carrying the new account's `{name,email}`;
 * {@link verifyPasskeyIntent} rejects it if missing, tampered, or expired — so an attacker
 * cannot forge an arbitrary identity. An existing user (same email) re-uses their row (a
 * second passkey for an account created out-of-band); a new email creates the user via the
 * internal adapter, firing the hub-birth hook. The returned `id` becomes the FK owner of
 * the about-to-be-written `passkey` credential.
 *
 * @param adapter - The Better Auth internal-adapter slice (see {@link PasskeyUserAdapter}).
 * @param context - The signed passkey-intent token from the registration request.
 * @returns the `{ id, name }` of the resolved (existing or freshly-born) user.
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
    // The email is carried inside a server-signed, short-lived intent and bound to a
    // completed WebAuthn ceremony, so it is treated as verified (mirrors magic-link).
    emailVerified: true,
  });
  return { id: created.id, name: created.name };
}

/**
 * Build the Better Auth options from the validated environment, mounting each optional
 * social provider / plugin ONLY when its credentials are real-shaped (`isRealValue`).
 *
 * @remarks
 * Pure (no module-level side effects beyond reading the passed `e`), so both the
 * provider-present and provider-absent branches are unit-testable directly. With local
 * placeholders every OPTIONAL gate is closed → the returned options reduce to the
 * passwordless baseline: the always-on passkey plugin + the hub hook + `nextCookies()`
 * (no email/password). `nextCookies()` is always pushed LAST.
 *
 * @param e - The validated server env slice (see {@link AuthEnv}).
 * @returns the fully-assembled `BetterAuthOptions` ready for `betterAuth()`.
 */
export function buildAuthOptions(e: AuthEnv): BetterAuthOptions {
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
  // Passwordless: there is no `email-password` credential provider, so it is NOT a trusted
  // account-linking provider. Linking trusts only the mounted social providers.
  const trustedProviders: string[] = [];

  if (isRealValue(e.GOOGLE_CLIENT_ID) && isRealValue(e.GOOGLE_CLIENT_SECRET)) {
    socialProviders.google = {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      // Connector data-read scopes so the stored token can back Calendar, Tasks,
      // Drive, and Gmail connectors without a separate OAuth grant flow.
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/tasks.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://mail.google.com/',
      ],
    };
    trustedProviders.push('google');
  }
  if (isRealValue(e.GITHUB_CLIENT_ID) && isRealValue(e.GITHUB_CLIENT_SECRET)) {
    socialProviders.github = {
      clientId: e.GITHUB_CLIENT_ID,
      clientSecret: e.GITHUB_CLIENT_SECRET,
      // `repo` grants read access to issues and PRs on private + public repos,
      // which the GitHub connector needs for importWork().
      scope: ['user:email', 'repo'],
    };
    trustedProviders.push('github');
  }
  if (isRealValue(e.LINEAR_CLIENT_ID) && isRealValue(e.LINEAR_CLIENT_SECRET)) {
    socialProviders.linear = { clientId: e.LINEAR_CLIENT_ID, clientSecret: e.LINEAR_CLIENT_SECRET };
    trustedProviders.push('linear');
  }

  const hasSocial = Object.keys(socialProviders).length > 0;

  const plugins: BetterAuthPlugin[] = [
    // Passkey is the primary, passwordless credential — ALWAYS mounted (not env-gated).
    // `requireSession: false` + `resolveUser` enable passkey-first sign-UP with no prior
    // session: the new account's name/email ride in as the signed `context` token and
    // `resolvePasskeyUser` find-or-creates the user (firing the hub-birth hook) before the
    // credential is written against it.
    passkey({
      rpID: e.BETTER_AUTH_PASSKEY_RP_ID,
      rpName: e.BETTER_AUTH_PASSKEY_RP_NAME,
      registration: {
        requireSession: false,
        resolveUser: ({ ctx, context }) => resolvePasskeyUser(ctx.context.internalAdapter, context),
      },
    }),
  ];
  if (isRealValue(e.OIDC_LOGIN_PAGE_URL)) {
    if (isRealValue(e.MCP_RESOURCE_URL)) {
      // `mcp` internally constructs `oidcProvider` (reuses its schema + endpoints) and adds
      // the OAuth 2.1 protected-resource metadata, so mounting `mcp` alone gives the full
      // OIDC-provider behavior plus MCP — without referencing the deprecated `oidcProvider`
      // symbol. The shared oauth tables in `@docket/db` back both.
      // Derive the consent page URL from the login page's origin so no extra env var is needed.
      // When an authenticated user's MCP client requests scopes, Better Auth redirects to this
      // URL with consent_code, client_id, and scope params (authorize.mjs §consentPage branch).
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
    // No `emailAndPassword`: Docket is passwordless (passkey-first). Sign-in is via the
    // passkey plugin or an env-gated social provider; email/password is intentionally off.
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
