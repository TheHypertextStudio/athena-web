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
import { isRealValue } from '@docket/env';
import { type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { mcp, oidcProvider } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';

import { verifyPasskeyIntent } from './passkey-intent';

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
  readonly BETTER_AUTH_PASSKEY_RP_ID: string;
  readonly BETTER_AUTH_PASSKEY_RP_NAME: string;
  readonly GOOGLE_CLIENT_ID?: string | undefined;
  readonly GOOGLE_CLIENT_SECRET?: string | undefined;
  readonly GITHUB_CLIENT_ID?: string | undefined;
  readonly GITHUB_CLIENT_SECRET?: string | undefined;
  readonly LINEAR_CLIENT_ID?: string | undefined;
  readonly LINEAR_CLIENT_SECRET?: string | undefined;
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

/**
 * Build the Better Auth options from the validated environment, mounting each optional
 * social provider / plugin ONLY when its credentials are real-shaped.
 *
 * @remarks
 * Pure (no module-level side effects): both the provider-present and provider-absent
 * branches are unit-testable directly. `nextCookies()` is always pushed LAST.
 *
 * @param e - The validated server env slice (see {@link AuthEnv}).
 */
export function buildAuthOptions(e: AuthEnv): BetterAuthOptions {
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
  const trustedProviders: string[] = [];

  if (isRealValue(e.GOOGLE_CLIENT_ID) && isRealValue(e.GOOGLE_CLIENT_SECRET)) {
    socialProviders.google = {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
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
      scope: ['user:email', 'repo'],
    };
    trustedProviders.push('github');
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
    trustedProviders.push('linear');
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
      database: { generateId: () => genId() },
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
