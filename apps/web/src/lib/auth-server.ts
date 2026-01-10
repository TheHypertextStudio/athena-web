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
import { db } from './db';
import * as schema from './auth-schema';

/**
 * Get the base URL for auth.
 * In production, use NEXTAUTH_URL or VERCEL_URL.
 * In development, use localhost:3000.
 */
function getBaseURL(): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

const baseURL = getBaseURL();

/**
 * Build social providers config from environment variables.
 */
function buildSocialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (googleClientId && googleClientSecret) {
    providers['google'] = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    };
  }

  const appleClientId = process.env.APPLE_CLIENT_ID;
  const appleClientSecret = process.env.APPLE_CLIENT_SECRET;
  if (appleClientId && appleClientSecret) {
    providers['apple'] = {
      clientId: appleClientId,
      clientSecret: appleClientSecret,
    };
  }

  const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
  const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (microsoftClientId && microsoftClientSecret) {
    providers['microsoft'] = {
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
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
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
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
