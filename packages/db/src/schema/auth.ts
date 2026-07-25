/**
 * `@docket/db` — Better Auth tables (core + passkey + oidc/mcp oauth tables).
 *
 * @remarks
 * Owned by `@docket/db` (the single SQL owner). These mirror the Better Auth 1.6
 * drizzle schema for the enabled plugin set. Docket auth is PASSWORDLESS: the
 * {@link passkey} table (WebAuthn credentials) is the primary sign-in credential, backing
 * the always-mounted `@better-auth/passkey` 1.6.14 plugin — email/password is removed, so
 * `account.password` is only ever written by social-provider linking. Social providers
 * (Google/GitHub/Linear) and account linking reuse the core `account` table (no new
 * tables). The `oauthProvider` plugin (Docket's OAuth 2.1 / MCP authorization server) adds
 * five additive tables ({@link oauthClient}, {@link oauthAccessToken},
 * {@link oauthRefreshToken}, {@link oauthConsent}, {@link jwks}), mounted env-gated in
 * `@docket/auth`. The `twoFactor` plugin adds the {@link twoFactor} table plus a
 * `user.twoFactorEnabled` flag — used backup-codes-only for passwordless account recovery. sso /
 * scim / stripe better-auth plugins are not installed and are deliberately skipped. The drizzle property keys match Better Auth's model field
 * names (camelCase) so the adapter maps correctly; SQL column names are snake_case. IDs
 * are 26-char ULIDs (Better Auth `advanced.database.generateId` shares {@link genId}).
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';

/** The global User identity (persists past org membership); 1:1 with a Hub. */
export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    // Backs the `twoFactor` plugin (recovery/backup codes). The plugin flips this true when a
    // user enables recovery codes (`input: false` — never client-set), and gates which users get
    // a 2FA challenge. Docket uses the plugin backup-codes-only, so this is "has recovery codes".
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('user_email_uq').on(t.email)],
);

/** A Better Auth session (cookie-backed), owned by a User. */
export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('session_token_uq').on(t.token)],
);

/** A linked credential/provider account for a User (passkeys live in `passkey`). */
export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('account_user_provider_external_uq').on(t.userId, t.providerId, t.accountId)],
);

/** Short-lived verification tokens (email, etc.). */
export const verification = pgTable('verification', {
  id: text('id').primaryKey().$defaultFn(genId),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * A registered WebAuthn passkey credential for a User — the primary, passwordless
 * sign-in credential.
 *
 * @remarks
 * Backs the `@better-auth/passkey` 1.6.14 plugin (mounted in `@docket/auth`). The
 * drizzle property keys + column types mirror the plugin's `passkey` model field-for-field
 * (`name?`, `publicKey`, `userId` FK→`user.id`, `credentialID`, `counter`, `deviceType`,
 * `backedUp`, `transports?`, `createdAt?`, `aaguid?`), so the Better Auth drizzle adapter
 * maps without a `schema` override. The plugin declares `userId` and `credentialID` as
 * indexed (it scaffolds those indexes); they are mirrored here so the hand-authored schema
 * stays byte-for-byte equivalent to what the plugin's codegen would emit:
 * `userId` for per-user passkey lookups (list/exclude-credentials) and `credentialID`
 * for the authentication lookup keyed on the asserted credential id.
 */
export const passkey = pgTable(
  'passkey',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at').defaultNow(),
    aaguid: text('aaguid'),
  },
  (t) => [
    index('passkey_user_id_idx').on(t.userId),
    index('passkey_credential_id_idx').on(t.credentialID),
  ],
);

/**
 * A user's two-factor record — in Docket, the home of their **recovery / backup codes**.
 *
 * @remarks
 * Backs the Better Auth `twoFactor` plugin (mounted in `@docket/auth`), used **backup-codes-only**
 * (TOTP/OTP are not surfaced) so a passwordless passkey user can recover access after losing their
 * device. The drizzle property keys mirror the plugin's `twoFactor` model field-for-field
 * (`secret`, `backupCodes`, `userId` FK→`user.id`, `verified`); the plugin declares `secret` and
 * `userId` indexed (it scaffolds those indexes), mirrored here so the hand-authored schema stays
 * byte-for-byte equivalent to the plugin codegen. `backupCodes` holds the encrypted
 * (`storeBackupCodes: 'encrypted'`, keyed by `BETTER_AUTH_SECRET`) JSON array of remaining codes;
 * a code is removed from it when consumed. One row per user (the plugin upserts), cascading on
 * user delete like {@link passkey}.
 *
 * `backupCodesGeneratedAt` is a Docket-owned column (not part of the plugin schema) recording when
 * the codes were last (re)generated, for the Security settings surface. Docket owns generation
 * (`generateRecoveryCodes` in `@docket/auth`, behind `POST /v1/me/recovery-codes`), which sets this
 * directly on every (re)generation — deliberately NOT touched on code *consumption* (the plugin's
 * `verifyBackupCode` rewrites `backup_codes` but not this column), so it stays a true "last
 * generated" time. `defaultNow()` covers the insert.
 */
export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    backupCodesGeneratedAt: timestamp('backup_codes_generated_at').notNull().defaultNow(),
  },
  (t) => [
    index('two_factor_secret_idx').on(t.secret),
    index('two_factor_user_id_idx').on(t.userId),
  ],
);

/**
 * An OAuth 2.1 client application registered with Docket as an OAuth/OIDC provider.
 *
 * @remarks
 * Backs the Better Auth `oauthProvider` plugin (mounted env-gated in `@docket/auth`) — the
 * successor to the deprecated `mcp()`/`oidcProvider()` pair this table used to serve (see
 * `oauth_client_deprecated` for that generation's data, kept for one release as a rollback
 * window). `clientId` is unique because the token/consent tables reference it as their
 * foreign key target; `userId` is the optional registering owner (cascades from `user`).
 * Captured field-for-field from the plugin's own `@better-auth/cli generate` output (not
 * hand-transcribed from docs), including which fields the plugin models as native Postgres
 * arrays (`scopes`, `redirectUris`, `contacts`, …) rather than joined strings.
 */
export const oauthClient = pgTable(
  'oauth_client',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    clientId: text('client_id').notNull().unique('oauth_client_client_id_uq'),
    clientSecret: text('client_secret'),
    disabled: boolean('disabled').default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    public: boolean('public'),
    type: text('type'),
    requirePKCE: boolean('require_pkce'),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata'),
  },
  (t) => [index('oauth_client_user_id_idx').on(t.userId)],
);

/**
 * An OAuth refresh token issued to an {@link oauthClient}.
 *
 * @remarks
 * The `oauthProvider` plugin models refresh tokens as their own table — unlike the
 * deprecated `mcp()`/`oidcProvider()` pair, whose refresh token lived as a field directly on
 * the access-token row. `revoked` is a soft-revoke timestamp (the row survives revocation
 * for audit/introspection), not a delete. Mirrors the plugin's `oauthRefreshToken` model
 * exactly.
 */
export const oauthRefreshToken = pgTable(
  'oauth_refresh_token',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    token: text('token').notNull().unique('oauth_refresh_token_token_uq'),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at'),
    revoked: timestamp('revoked'),
    authTime: timestamp('auth_time'),
    scopes: text('scopes').array().notNull(),
  },
  (t) => [
    index('oauth_refresh_token_client_id_idx').on(t.clientId),
    index('oauth_refresh_token_session_id_idx').on(t.sessionId),
    index('oauth_refresh_token_user_id_idx').on(t.userId),
  ],
);

/**
 * An OAuth access token issued to an {@link oauthClient}, optionally tied to the
 * {@link oauthRefreshToken} that minted it.
 *
 * @remarks
 * Mirrors the `oauthProvider` plugin's `oauthAccessToken` model exactly. `token` is
 * nullable: with the `jwt` plugin mounted (Docket's configuration — `oauthProvider`
 * requires it unless `disableJwtPlugin` is set, which Docket does not set), the default
 * access token is a self-contained, locally-JWT-verifiable token that is never written
 * here at all; only an opaque-token issuance gets a row with `token` set.
 */
export const oauthAccessToken = pgTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    token: text('token').unique('oauth_access_token_token_uq'),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id, {
      onDelete: 'cascade',
    }),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at'),
    scopes: text('scopes').array().notNull(),
  },
  (t) => [
    index('oauth_access_token_client_id_idx').on(t.clientId),
    index('oauth_access_token_session_id_idx').on(t.sessionId),
    index('oauth_access_token_user_id_idx').on(t.userId),
    index('oauth_access_token_refresh_id_idx').on(t.refreshId),
  ],
);

/**
 * A user's recorded consent grant for an {@link oauthClient}'s requested scopes.
 *
 * @remarks
 * Written by the `oauthProvider` plugin's consent flow so a returning user with the same
 * (client, scope) combination skips re-prompting. Mirrors the plugin's `oauthConsent` model
 * exactly — notably `userId` is nullable (a `referenceId`-only grant, e.g. an
 * organization-scoped consent, is possible) and `scopes` is a native array, not the
 * space-joined string the deprecated plugins used.
 */
export const oauthConsent = pgTable(
  'oauth_consent',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('oauth_consent_client_id_idx').on(t.clientId),
    index('oauth_consent_user_id_idx').on(t.userId),
  ],
);

/**
 * Signing keypairs for Better Auth's `jwt` plugin.
 *
 * @remarks
 * New table this migration introduces — Docket's previous `mcp()`/`oidcProvider()`
 * configuration never issued JWTs, so nothing existed here before. The `oauthProvider`
 * plugin requires the `jwt` plugin (Docket does not set `disableJwtPlugin`) to issue and
 * locally verify JWT-formatted OAuth access/id tokens. Docket never reads or writes this
 * table directly — only Better Auth does, for key rotation and its `/jwks` discovery
 * endpoint. Mirrors the plugin's `jwks` model exactly.
 */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey().$defaultFn(genId),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull(),
  expiresAt: timestamp('expires_at'),
});

/**
 * Better Auth's request rate-limit counter (one row per limiter key).
 *
 * @remarks
 * Backs `rateLimit.storage: 'database'` in `@docket/auth` so the auth rate limits (global +
 * the per-path `customRules` on sign-in / sign-up / consent / recovery) hold across serverless
 * instances rather than living in each instance's memory. Better Auth's rate-limiter reads/writes
 * this model by its `key` field; `lastRequest` is an epoch-ms bigint. The plugin manages all
 * rows — Docket never writes here directly.
 */
export const rateLimit = pgTable(
  'rate_limit',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    key: text('key'),
    count: integer('count'),
    lastRequest: bigint('last_request', { mode: 'number' }),
  },
  (t) => [index('rate_limit_key_idx').on(t.key)],
);
