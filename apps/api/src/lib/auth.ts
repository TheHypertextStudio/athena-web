/**
 * Better Auth configuration.
 *
 * @packageDocumentation
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { passkey } from '@better-auth/passkey';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { env } from './env.js';
import { eq } from 'drizzle-orm';
import { accounts } from '../db/schema/auth.js';
import { logger } from './logger.js';

/**
 * Build social providers config from validated env config objects.
 */
function buildSocialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};

  if (env.googleOAuth) {
    providers.google = {
      clientId: env.googleOAuth.clientId,
      clientSecret: env.googleOAuth.clientSecret,
    };
  }

  if (env.appleOAuth) {
    providers.apple = {
      clientId: env.appleOAuth.clientId,
      clientSecret: env.appleOAuth.clientSecret,
    };
  }

  if (env.microsoftOAuth) {
    providers.microsoft = {
      clientId: env.microsoftOAuth.clientId,
      clientSecret: env.microsoftOAuth.clientSecret,
    };
  }

  return providers;
}

/**
 * Configured Better Auth instance.
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
    },
  }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  trustedOrigins: [env.FRONTEND_URL],

  socialProviders: buildSocialProviders(),

  plugins: [
    passkey({
      rpName: 'Athena',
      // rpID is the hostname where the passkey is registered (e.g., localhost, athena.app)
      rpID: new URL(env.FRONTEND_URL).hostname,
      // origin must match where the WebAuthn ceremony happens (the frontend)
      origin: env.FRONTEND_URL,
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  user: {
    additionalFields: {},
  },

  account: {
    accountLinking: {
      enabled: true,
      // Google, Apple, Microsoft are trusted providers - they verify emails
      trustedProviders: ['google', 'apple', 'microsoft'],
      // Don't allow linking accounts with different emails by default (security)
      allowDifferentEmails: false,
      // Prevent users from unlinking all accounts (must have at least one sign-in method)
      allowUnlinkingAll: false,
    },
  },

  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
  },

  databaseHooks: {
    session: {
      create: {
        /**
         * Before creating a session, check if Google sign-in is disabled for this account.
         * This prevents users whose Google accounts have been flagged by RISC from signing in.
         */
        before: async (session) => {
          // Get the account that's being used to create this session
          // We need to check if this is a Google sign-in and if it's disabled
          const [account] = await db
            .select({
              googleSignInDisabled: accounts.googleSignInDisabled,
              providerId: accounts.providerId,
            })
            .from(accounts)
            .where(eq(accounts.userId, session.userId))
            .limit(1);

          // If this is a Google account and sign-in is disabled, reject
          if (account?.providerId === 'google' && account.googleSignInDisabled) {
            logger.warn(
              { userId: session.userId },
              '[Auth] Blocked sign-in attempt for disabled Google account',
            );
            // Return false to prevent session creation
            return false;
          }

          // Return the session wrapped in { data } as expected by Better Auth
          return { data: session };
        },
      },
    },
  },
});

/**
 * Auth type exports for client usage.
 */
export type Auth = typeof auth;
