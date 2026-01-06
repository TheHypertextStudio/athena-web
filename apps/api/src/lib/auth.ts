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

/**
 * Build social providers config from validated env config objects.
 */
function buildSocialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};

  if (env.googleOAuth) {
    providers['google'] = {
      clientId: env.googleOAuth.clientId,
      clientSecret: env.googleOAuth.clientSecret,
    };
  }

  if (env.appleOAuth) {
    providers['apple'] = {
      clientId: env.appleOAuth.clientId,
      clientSecret: env.appleOAuth.clientSecret,
    };
  }

  if (env.microsoftOAuth) {
    providers['microsoft'] = {
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

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },

  socialProviders: buildSocialProviders(),

  plugins: [
    passkey({
      rpName: 'Athena',
      rpID: new URL(env.BETTER_AUTH_URL).hostname,
      origin: env.BETTER_AUTH_URL,
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

  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
  },
});

/**
 * Auth type exports for client usage.
 */
export type Auth = typeof auth;
