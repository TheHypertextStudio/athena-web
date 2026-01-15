/**
 * Authentication schema for Better Auth.
 *
 * @packageDocumentation
 */

import { pgTable, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';

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
  /** The last authentication method used (e.g., 'google', 'apple', 'passkey'). */
  lastLoginMethod: text('last_login_method'),
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

// ============================================================================
// OAuth 2.1 Provider Tables
// These tables enable Athena to act as an OAuth provider for MCP clients
// ============================================================================

/**
 * JWKS table - stores JWT signing keys for OAuth access/id tokens.
 */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull(),
  expiresAt: timestamp('expires_at'),
});

/**
 * OAuth clients table - registered OAuth applications (MCP agents, third-party apps).
 */
export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  /** Unique client identifier used in OAuth flows */
  clientId: text('client_id').notNull().unique(),
  /** Hashed client secret (null for public clients) */
  clientSecret: text('client_secret'),
  /** Whether this client is disabled */
  disabled: boolean('disabled').default(false),
  /** Whether this client can skip user consent (trusted first-party apps) */
  skipConsent: boolean('skip_consent').default(false),
  /** Whether this client can trigger end-session via id_token */
  enableEndSession: boolean('enable_end_session').default(false),
  /** Allowed scopes for this client */
  scopes: text('scopes').array(),
  /** User who owns this client (for user-registered apps) */
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Reference ID for organization-owned clients */
  referenceId: text('reference_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  // Client metadata for consent UI
  /** Display name of the client */
  name: text('name'),
  /** Website URI */
  uri: text('uri'),
  /** Icon/logo URL */
  icon: text('icon'),
  /** Contact emails */
  contacts: text('contacts').array(),
  /** Terms of Service URL */
  tos: text('tos'),
  /** Privacy Policy URL */
  policy: text('policy'),
  /** Software identifier (same across versions) */
  softwareId: text('software_id'),
  /** Software version */
  softwareVersion: text('software_version'),
  /** Signed JWT containing software metadata */
  softwareStatement: text('software_statement'),
  /** Allowed redirect URIs for OAuth callbacks */
  redirectUris: text('redirect_uris').array().notNull(),
  /** Allowed post-logout redirect URIs */
  postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
  /** Token endpoint auth method: 'none', 'client_secret_basic', 'client_secret_post' */
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  /** Supported grant types: 'authorization_code', 'client_credentials', 'refresh_token' */
  grantTypes: text('grant_types').array(),
  /** Supported response types: 'code' */
  responseTypes: text('response_types').array(),
  /** Whether this is a public client (no client_secret) */
  public: boolean('public').default(false),
  /** Client type: 'web', 'native', 'user-agent-based' */
  type: text('type'),
  /** Additional metadata as JSON */
  metadata: jsonb('metadata'),
});

/**
 * OAuth refresh tokens table - issued refresh tokens for token renewal.
 */
export const oauthRefreshTokens = pgTable('oauth_refresh_tokens', {
  id: text('id').primaryKey(),
  /** Hashed refresh token value */
  token: text('token').notNull(),
  /** The OAuth client this token was issued to */
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  /** The session this token is tied to (if any) */
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  /** The user this token was issued for */
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Reference ID (for organization-scoped tokens) */
  referenceId: text('reference_id'),
  /** When this token expires */
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  /** When this token was revoked (null if active) */
  revoked: timestamp('revoked'),
  /** Scopes granted to this token */
  scopes: text('scopes').array().notNull(),
});

/**
 * OAuth access tokens table - issued access tokens (opaque tokens only, JWTs are not stored).
 */
export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  id: text('id').primaryKey(),
  /** Hashed access token value (null for JWT tokens) */
  token: text('token').unique(),
  /** The OAuth client this token was issued to */
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  /** The session this token is tied to (if any) */
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  /** The user this token was issued for (null for client_credentials) */
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Reference ID (for organization-scoped tokens) */
  referenceId: text('reference_id'),
  /** The refresh token this access token was issued from */
  refreshId: text('refresh_id').references(() => oauthRefreshTokens.id, { onDelete: 'cascade' }),
  /** When this token expires */
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  /** Scopes granted to this token */
  scopes: text('scopes').array().notNull(),
});

/**
 * OAuth consent table - user consent records per client.
 */
export const oauthConsents = pgTable('oauth_consents', {
  id: text('id').primaryKey(),
  /** The OAuth client the user consented to */
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  /** The user who gave consent */
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Reference ID (for organization-scoped consent) */
  referenceId: text('reference_id'),
  /** Scopes the user consented to */
  scopes: text('scopes').array().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
