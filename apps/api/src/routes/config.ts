/**
 * `@docket/api` — public client-config router (mounted at `/v1/config`).
 *
 * @remarks
 * The single source the web app reads its runtime configuration from, so the client never mirrors
 * server setup into parallel `NEXT_PUBLIC_*` flags. Availability is **derived from the real server
 * credentials**: a provider is offered iff its OAuth client id + secret are configured (the same
 * truth {@link configuredSocialProviders} feeds into Better Auth), and a connector is offered iff
 * the grant that funds it is configured. Public (no session) — it carries nothing secret, and the
 * sign-in page needs it before anyone is authenticated.
 */
import {
  type AuthEnv,
  canUseGoogleOAuth,
  configuredSocialProviders,
  type SocialProvider,
} from '@docket/auth';
import {
  CONNECTOR_PROVIDER_IDS,
  connectorIdentityProvider,
} from '@docket/connections/provider-catalog-contract';
import {
  PublicConfigOut,
  type SignInProvider,
} from '@docket/identity-access/public-config-contract';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { env } from '../env';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';

/**
 * The connector keys each configured social provider unlocks.
 *
 * @remarks
 * One Google grant funds every Google product connector; GitHub/Linear fund their own. Mirrors the
 * connector → social mapping (`socialProviderId`) in the other direction.
 */
const CONNECTORS_BY_PROVIDER: Partial<Record<SocialProvider, readonly string[]>> = {
  ...CONNECTOR_PROVIDER_IDS.reduce<Partial<Record<SocialProvider, string[]>>>((acc, provider) => {
    const identityProvider = connectorIdentityProvider(provider);
    acc[identityProvider] = [...(acc[identityProvider] ?? []), provider];
    return acc;
  }, {}),
};

/** Keep dormant Better Auth providers out of the public active-provider contract. */
function isPublicSignInProvider(provider: SocialProvider): provider is SignInProvider {
  return (
    provider === 'google' ||
    provider === 'github' ||
    provider === 'linear' ||
    provider === 'notion' ||
    provider === 'apple'
  );
}

/** Resolve the browser-safe Google server client ID under the same gate that offers Google sign-in. */
export function resolveGoogleServerClientId(
  authEnv: Pick<
    AuthEnv,
    'APP_MODE' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_OAUTH_PUBLIC' | 'GOOGLE_OAUTH_TEST_EMAILS'
  >,
  oauthProviders: readonly SignInProvider[],
): string | null {
  return oauthProviders.includes('google') && canUseGoogleOAuth(authEnv, null)
    ? (authEnv.GOOGLE_CLIENT_ID ?? null)
    : null;
}

/** Resolve the native Apple app identifier only when the Apple provider is fully configured. */
export function resolveAppleAppClientId(
  authEnv: Pick<AuthEnv, 'APPLE_APP_CLIENT_ID'>,
  oauthProviders: readonly SignInProvider[],
): string | null {
  return oauthProviders.includes('apple') ? (authEnv.APPLE_APP_CLIENT_ID ?? null) : null;
}

/** Expose the previous passkey RP only while it names a distinct migration source. */
export function resolveLegacyPasskeyRpId(
  authEnv: Pick<AuthEnv, 'BETTER_AUTH_PASSKEY_RP_ID' | 'BETTER_AUTH_PASSKEY_LEGACY_RP_ID'>,
): string | null {
  const legacy = authEnv.BETTER_AUTH_PASSKEY_LEGACY_RP_ID;
  return legacy && legacy !== authEnv.BETTER_AUTH_PASSKEY_RP_ID ? legacy : null;
}

const config = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    operationId: 'getPublicConfig',
    tag: 'Config',
    summary: 'Get public client config',
    narrative: {
      purpose:
        'Return the non-secret deployment settings a client needs before it asks a person to sign in.',
      behavior: [
        'The response lists a social provider only when the server has the credentials required to use it.',
        'Connector availability comes from the same configured provider grants used by the runtime. One Google grant can expose Gmail, Calendar, and Google Tasks.',
        'The response reports the deployment mode, passkey relying-party identifiers, and the configured MCP URL. A nullable value means the client must not assume that capability is configured.',
      ],
      constraints: [
        'The response contains no provider secret, session data, tenant data, or user data.',
        'Clients should read this operation before rendering sign-in and connector choices instead of mirroring server configuration in build-time flags.',
      ],
    },
    access: { kind: 'public' },
    success: [
      {
        kind: 'json',
        status: 200,
        schema: PublicConfigOut,
        description: 'The current non-secret client configuration for this Docket deployment.',
      },
    ],
    errors: ['not_acceptable', 'internal'],
    conditionalRead: true,
    conditionalWrite: false,
    idempotency: false,
    related: ['listOrganizations'],
  }),
  (c) => {
    const oauthProviders = configuredSocialProviders(env).filter(isPublicSignInProvider);
    const connectors = oauthProviders.flatMap((p) => CONNECTORS_BY_PROVIDER[p] ?? []);
    return ok(c, PublicConfigOut, {
      appMode: env.APP_MODE,
      oauthProviders,
      appleAppClientId: resolveAppleAppClientId(env, oauthProviders),
      passkeyRpId: env.BETTER_AUTH_PASSKEY_RP_ID,
      legacyPasskeyRpId: resolveLegacyPasskeyRpId(env),
      googleOAuthPublic: env.GOOGLE_OAUTH_PUBLIC,
      googleServerClientId: resolveGoogleServerClientId(env, oauthProviders),
      adminGoogleSso: env.ADMIN_GOOGLE_SSO_ENABLED && oauthProviders.includes('google'),
      stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
      connectors,
      mcpUrl: env.MCP_RESOURCE_URL ?? null,
    });
  },
);

export default config;
