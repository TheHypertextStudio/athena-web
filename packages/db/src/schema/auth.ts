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
 * tables). The `oidcProvider` + `mcp` plugins share three additive oauth tables
 * ({@link oauthApplication}, {@link oauthAccessToken}, {@link oauthConsent}), mounted
 * env-gated in `@docket/auth`. The `twoFactor` plugin adds the {@link twoFactor} table plus a
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
 * An OAuth/OIDC client application registered with Docket as an OpenID Provider.
 *
 * @remarks
 * Shared by the Better Auth `oidcProvider` + `mcp` plugins (mounted env-gated in
 * `@docket/auth`). `clientId` is unique because the access-token + consent tables
 * reference it as their foreign key target. `userId` is the optional registering owner
 * (cascades from `user`). Mirrors the plugins' `oauthApplication` model exactly.
 */
export const oauthApplication = pgTable(
  'oauth_application',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    name: text('name').notNull(),
    icon: text('icon'),
    metadata: text('metadata'),
    clientId: text('client_id').notNull().unique('oauth_application_client_id_uq'),
    clientSecret: text('client_secret'),
    redirectUrls: text('redirect_urls').notNull(),
    type: text('type').notNull(),
    disabled: boolean('disabled').default(false),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('oauth_application_user_id_idx').on(t.userId)],
);

/**
 * An OAuth/OIDC access + refresh token pair issued to an {@link oauthApplication}.
 *
 * @remarks
 * Used by the `oidcProvider` + `mcp` plugins for bearer/token flows. `accessToken` and
 * `refreshToken` are each unique; `clientId` references {@link oauthApplication.clientId}
 * (its unique column) and `userId` references the resource owner. Mirrors the plugins'
 * `oauthAccessToken` model exactly.
 */
export const oauthAccessToken = pgTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at').notNull(),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('oauth_access_token_access_token_uq').on(t.accessToken),
    uniqueIndex('oauth_access_token_refresh_token_uq').on(t.refreshToken),
    index('oauth_access_token_client_id_idx').on(t.clientId),
    index('oauth_access_token_user_id_idx').on(t.userId),
  ],
);

/**
 * A user's recorded consent grant for an {@link oauthApplication}'s requested scopes.
 *
 * @remarks
 * Written by the `oidcProvider` consent screen so a returning user skips re-prompting.
 * `clientId` references {@link oauthApplication.clientId}; `userId` references the
 * consenting `user`. Mirrors the plugins' `oauthConsent` model exactly.
 */
export const oauthConsent = pgTable(
  'oauth_consent',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    consentGiven: boolean('consent_given').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('oauth_consent_client_id_idx').on(t.clientId),
    index('oauth_consent_user_id_idx').on(t.userId),
  ],
);

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
