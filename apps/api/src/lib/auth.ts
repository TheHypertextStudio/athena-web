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

  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET && {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }),
    ...(env.APPLE_CLIENT_ID &&
      env.APPLE_CLIENT_SECRET && {
        apple: {
          clientId: env.APPLE_CLIENT_ID,
          clientSecret: env.APPLE_CLIENT_SECRET,
        },
      }),
    ...(env.MICROSOFT_CLIENT_ID &&
      env.MICROSOFT_CLIENT_SECRET && {
        microsoft: {
          clientId: env.MICROSOFT_CLIENT_ID,
          clientSecret: env.MICROSOFT_CLIENT_SECRET,
        },
      }),
  },

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
    generateId: () => crypto.randomUUID(),
  },
});

/**
 * Auth type exports for client usage.
 */
export type Auth = typeof auth;
