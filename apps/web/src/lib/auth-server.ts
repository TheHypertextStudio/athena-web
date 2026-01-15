/**
 * Server-side Better Auth configuration.
 *
 * This runs on the Next.js server and handles OAuth callbacks,
 * session management, and passkey authentication.
 *
 * @packageDocumentation
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { passkey } from '@better-auth/passkey';
import { oauthProvider } from '@better-auth/oauth-provider';
import { jwt, lastLoginMethod, oAuthProxy } from 'better-auth/plugins';
import { db } from './db';
import * as schema from './auth-schema';
import { ALL_MCP_SCOPES, expandScopes } from './oauth-scopes';

interface SocialProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectURI: string;
}

/**
 * Get the base URL for auth.
 * Uses BETTER_AUTH_URL in production, VERCEL_URL for preview deployments,
 * and falls back to localhost:3000 in development.
 */
function getBaseURL(): string {
  if (process.env.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

const baseURL = getBaseURL();

/**
 * Production URL for OAuth callbacks.
 * This is the stable URL registered with OAuth providers (Google, Apple, etc.).
 * Used by oAuthProxy to route callbacks from preview deployments.
 */
const productionURL = process.env.BETTER_AUTH_URL ?? baseURL;

/**
 * Build social providers config from environment variables.
 * Each provider includes a redirectURI pointing to the production URL
 * for use with the oAuthProxy plugin.
 */
function buildSocialProviders(): Record<string, SocialProviderConfig> {
  const providers: Record<string, SocialProviderConfig> = {};

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (googleClientId && googleClientSecret) {
    providers.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectURI: `${productionURL}/api/auth/callback/google`,
    };
  }

  const appleClientId = process.env.APPLE_CLIENT_ID;
  const appleClientSecret = process.env.APPLE_CLIENT_SECRET;
  if (appleClientId && appleClientSecret) {
    providers.apple = {
      clientId: appleClientId,
      clientSecret: appleClientSecret,
      redirectURI: `${productionURL}/api/auth/callback/apple`,
    };
  }

  const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
  const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (microsoftClientId && microsoftClientSecret) {
    providers.microsoft = {
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
      redirectURI: `${productionURL}/api/auth/callback/microsoft`,
    };
  }

  return providers;
}

/**
 * Configured Better Auth instance for Next.js.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      passkey: schema.passkeys,
      // OAuth Provider tables
      jwks: schema.jwks,
      oauthClient: schema.oauthClients,
      oauthRefreshToken: schema.oauthRefreshTokens,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthConsent: schema.oauthConsents,
    },
  }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,

  socialProviders: buildSocialProviders(),

  plugins: [
    passkey({
      rpName: 'Athena',
      rpID: new URL(baseURL).hostname,
      origin: baseURL,
    }),
    lastLoginMethod({
      storeInDatabase: true,
    }),
    oAuthProxy({
      productionURL,
    }),
    // JWT plugin - required for signing OAuth access tokens and id tokens
    jwt(),
    // OAuth 2.1 Provider - enables Athena to issue tokens to third-party clients
    oauthProvider({
      loginPage: '/sign-in',
      consentPage: '/oauth/consent',
      scopes: ['openid', 'profile', 'email', 'offline_access', ...ALL_MCP_SCOPES],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      validAudiences: [baseURL, `${baseURL}/mcp`],
      accessTokenExpiresIn: 60 * 60, // 1 hour
      refreshTokenExpiresIn: 60 * 60 * 24 * 30, // 30 days
      idTokenExpiresIn: 60 * 60 * 10, // 10 hours
      cachedTrustedClients: new Set([]),
      customAccessTokenClaims: ({ user, scopes }) => {
        if (!user) return {};
        return {
          'athena:user_id': user.id,
          'athena:scopes': expandScopes(scopes),
        };
      },
      customUserInfoClaims: () => ({}),
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    // Required for OAuth Provider plugin
    storeSessionInDatabase: true,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});

export type Auth = typeof auth;
