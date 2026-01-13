/**
 * Authentication schema for Better Auth.
 *
 * @packageDocumentation
 */

import { pgTable, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

/**
 * Users table - core user data.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  /** When a security alert was triggered via RISC event. */
  securityAlertAt: timestamp('security_alert_at'),
});

/**
 * Sessions table - active user sessions.
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  /** Last time this session was used for an authenticated request */
  lastActiveAt: timestamp('last_active_at').notNull().defaultNow(),
});

/**
 * Accounts table - OAuth provider accounts linked to users.
 */
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // RISC (Cross-Account Protection) fields
  /** Whether Google sign-in is disabled due to RISC account-disabled event. */
  googleSignInDisabled: boolean('google_sign_in_disabled').default(false),
  /** When OAuth tokens were revoked via RISC event. */
  tokensRevokedAt: timestamp('tokens_revoked_at'),
  /** Whether user needs to change credentials due to RISC event. */
  credentialChangeRequired: boolean('credential_change_required').default(false),
});

/**
 * Verifications table - email verification and password reset tokens.
 */
export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Passkeys table - WebAuthn credentials.
 * Field names must match BetterAuth's expected schema (camelCase).
 */
export const passkeys = pgTable('passkeys', {
  id: text('id').primaryKey(),
  name: text('name'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  credentialID: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  deviceType: text('device_type'),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: text('transports'),
  aaguid: text('aaguid'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Backup codes table - recovery codes for account access.
 * Each user can have multiple backup codes.
 * Codes are stored hashed for security.
 */
export const backupCodes = pgTable('backup_codes', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Hashed backup code */
  codeHash: text('code_hash').notNull(),
  /** Whether this code has been used */
  usedAt: timestamp('used_at'),
  /** When this code was generated */
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
