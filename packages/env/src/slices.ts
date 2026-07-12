/**
 * `@docket/env` — environment slices (typed zod fragments).
 *
 * @remarks
 * Each slice is a plain object of `name → ZodType` so that spreading it into a
 * `createEnv({ server })` literal preserves the key types (which is what gives the
 * validated `env` object its static shape). The per-app compositions (`./api`,
 * `./web`, `./marketing`, `./admin`) spread the slices they need; `./registry`
 * re-references these same schemas so the var contract has one declaration site.
 *
 * Validation is intentionally lenient on *format* (e.g. `DATABASE_URL` is
 * `min(1)`, not a strict URL) because the local zero-external-accounts build uses
 * a `pglite:`-scheme connection string and placeholder keys — the
 * app container, not this package, decides real-vs-test-double per integration.
 */
import { z } from 'zod';

/**
 * Coerce the required string env representation of a boolean (`"true"`/`"false"`) to a real
 * boolean. There is no default: every boolean flag must be set explicitly (no hidden config
 * default — see DECISIONS "config fail-fast").
 */
const boolFromString = () => z.enum(['true', 'false']).transform((v) => v === 'true');

/** Shared across every deployable (server scope). */
export const sharedServer = {
  /**
   * Runtime mode — the ONE intentionally-defaulted var. It is framework/runtime-managed
   * (`next dev` → development, `next build` → production, the API process → development) and
   * must NOT be set in `.env` files, so a default is the correct, non-hidden behavior.
   */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Forces local test doubles when `local`/`test`, even if real keys are present. */
  APP_MODE: z.enum(['local', 'test', 'production']),
  API_URL: z.string().min(1),
  /**
   * Public origin of the product web app (sign-in + OAuth consent pages). The MCP
   * OAuth defaults derive from it (`OIDC_LOGIN_PAGE_URL = ${WEB_URL}/sign-in`), so the
   * authorization server is on in every deploy without MCP-specific configuration.
   */
  WEB_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive(),
};

/** Database (Drizzle client + migrations). */
export const dbServer = {
  DATABASE_URL: z.string().min(1),
  /** Unpooled string used for migrations; falls back to `DATABASE_URL` when absent. */
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
};

/** Better Auth core + passkey + social providers (all-or-nothing pairs enforced at composition). */
export const authServer = {
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().min(1),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
  BETTER_AUTH_ALLOWED_HOSTS: z.string().optional(),
  BETTER_AUTH_COOKIE_DOMAIN: z.string().optional(),
  BETTER_AUTH_PASSKEY_RP_ID: z.string().min(1),
  BETTER_AUTH_PASSKEY_RP_NAME: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Whether Google OAuth is open to every production user; false keeps it test-user-only. */
  GOOGLE_OAUTH_PUBLIC: boolFromString(),
  /** CSV of Docket account emails allowed to link Google while public access is disabled. */
  GOOGLE_OAUTH_TEST_EMAILS: z.string().optional(),
  /**
   * Public HTTPS callback URL Docket registers with Google Calendar push-notification
   * `watch` subscriptions (`POST {this}` receives `X-Goog-*` headers at
   * `/webhooks/calendar/google`, e.g. `https://api.docket.app/webhooks/calendar/google`).
   * Explicit, no default: absent ⇒ `registerOrRenewWatches` no-ops entirely (push hints are
   * disabled, but the scheduled sweep still polls every layer, so sync keeps working).
   */
  GOOGLE_CALENDAR_WEBHOOK_URL: z.string().optional(),
  /**
   * GitHub App numeric id — the JWT `iss` used to mint short-lived installation access tokens
   * (the firehose/mirror data plane). The single GitHub App is the ONLY GitHub credential:
   * it powers sign-in (user-to-server OAuth), the issue/PR connector, and the webhook firehose
   * — there is no separate OAuth App. Absent ⇒ the GitHub connector falls back to the mock.
   */
  GITHUB_APP_ID: z.string().optional(),
  /**
   * GitHub App URL slug — builds the install URL `https://github.com/apps/<slug>/installations/new`
   * the connect flow redirects users to (self-serve install on their own account, or an org).
   */
  GITHUB_APP_SLUG: z.string().optional(),
  /**
   * GitHub App OAuth client id — the user-to-server flow that powers GitHub sign-in, the
   * "my issues" pull, and identity mapping. (A GitHub App reuses the OAuth web endpoints with
   * this `Iv…`-prefixed client id; replaces the retired OAuth-App `GITHUB_CLIENT_ID`.)
   */
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  /** GitHub App OAuth client secret — user-to-server token exchange (paired with the client id). */
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  /**
   * GitHub App private key, **base64-encoded PEM** (single line so it survives line-based `.env`
   * upserts). Signs the app JWT exchanged for 1h installation tokens. Lenient here; the
   * `@docket/integrations` resolver decodes + decides real-vs-mock.
   */
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  /** GitHub App webhook signing secret — verifies inbound `X-Hub-Signature-256` firehose events. */
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  /** Microsoft Entra app client id — Outlook sign-in/link + the Graph mail connector. */
  MICROSOFT_CLIENT_ID: z.string().optional(),
  /** Microsoft Entra app client secret. */
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  /** Entra tenant (`common` for multi-tenant; a tenant id to restrict to one directory). */
  MICROSOFT_TENANT_ID: z.string().optional(),
  /** App-level Linear webhook signing secret — verifies inbound ambient-observation events. */
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Apple **Services ID** (e.g. `com.docket.web`) — the OAuth `client_id` for "Sign in with Apple"
   * and the `sub` of the client-secret JWT. Unlike the other providers, Apple's client secret is
   * not a static string: it is a short-lived ES256 JWT minted at boot from the four `APPLE_*` vars
   * below (see `@docket/auth`'s `generateAppleClientSecret`). The provider is on iff ALL FOUR are
   * real-shaped — absent ⇒ provider hidden. Web-only (no native iOS ID-token flow).
   */
  APPLE_CLIENT_ID: z.string().optional(),
  /** Apple 10-char Team ID — the `iss` of the client-secret JWT. Paired all-or-nothing with the other `APPLE_*` vars. */
  APPLE_TEAM_ID: z.string().optional(),
  /** Apple Sign-in key id (the `.p8` key's Key ID) — the `kid` JWT header. */
  APPLE_KEY_ID: z.string().optional(),
  /**
   * Apple Sign-in private key, the `.p8` **PKCS#8 PEM**. Multiline — store with escaped `\n`
   * (or on one line); `@docket/auth` normalizes the `\n` back to real newlines before signing.
   * Signs the ES256 client-secret JWT. Lenient here (`optional`); the auth builder decides
   * real-vs-hidden via {@link isRealValue} over all four `APPLE_*` vars.
   */
  APPLE_PRIVATE_KEY: z.string().optional(),
  /** Slack app signing secret — verifies inbound Slack Events API requests (`v0=` HMAC). */
  SLACK_SIGNING_SECRET: z.string().optional(),
  /**
   * Slack app OAuth client id — powers the "Connect Slack" user-token flow (`oauth.v2.authorize`).
   * The shared hosted app's credentials; absent ⇒ Slack connect is unavailable (409 on connect-url).
   */
  SLACK_CLIENT_ID: z.string().optional(),
  /** Slack app OAuth client secret — paired with {@link authServer.SLACK_CLIENT_ID} for `oauth.v2.access`. */
  SLACK_CLIENT_SECRET: z.string().optional(),
  /**
   * Discord app **public key** (raw 32-byte Ed25519 key, hex) — verifies inbound Discord-signed
   * requests at `POST /internal/ingest/discord` (`X-Signature-Ed25519` over `timestamp + body`).
   * Absent/placeholder ⇒ the Discord observer falls back to the mock.
   */
  DISCORD_PUBLIC_KEY: z.string().optional(),
  /** Discord OAuth2 application client id — powers "Connect Discord" account linking (`identify`). */
  DISCORD_CLIENT_ID: z.string().optional(),
  /** Discord OAuth2 application client secret — paired all-or-nothing with {@link DISCORD_CLIENT_ID}. */
  DISCORD_CLIENT_SECRET: z.string().optional(),
  /**
   * Shared secret for Better Auth's `oAuthProxy` plugin — lets preview/branch deployments run the
   * social-OAuth flow through production (whose callback URL is the only one registered with the
   * provider) instead of needing their own unpredictable redirect URI registered. Must be the SAME
   * value on every environment that participates (prod + previews). Paired with
   * {@link authServer.OAUTH_PROXY_PRODUCTION_URL}; both unset ⇒ the plugin is not mounted and OAuth
   * runs directly against each environment's own (registered) callback.
   */
  OAUTH_PROXY_SECRET: z.string().optional(),
  /**
   * The production product origin `oAuthProxy` routes preview/dev OAuth through (e.g.
   * `https://app.docket.app`) — the one host whose `/api/auth/callback/*` is registered with the
   * provider. Paired with {@link authServer.OAUTH_PROXY_SECRET} (all-or-nothing).
   */
  OAUTH_PROXY_PRODUCTION_URL: z.string().optional(),
};

/** Stripe billing (server scope; publishable key is a client var). */
export const stripeServer = {
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Browser-safe Stripe key returned through `/v1/config`; stored server-side for runtime deploys. */
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  DOCKET_PRICE_LOOKUP_TEAM: z.string().optional(),
  DOCKET_PRICE_LOOKUP_TEAM_ANNUAL: z.string().optional(),
  STRIPE_PRICE_TEAM: z.string().optional(),
  STRIPE_BILLING_PORTAL_CONFIG_ID: z.string().optional(),
  BILLING_ENABLED: boolFromString(),
};

/** Remote MCP server (OAuth 2.1 RS) configuration. */
export const mcpServer = {
  MCP_ISSUER_URL: z.string().optional(),
  MCP_RESOURCE_URL: z.string().optional(),
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  OIDC_LOGIN_PAGE_URL: z.string().optional(),
  MCP_TASKS_ENABLED: boolFromString(),
  MCP_CIMD_TRUST_ALLOWLIST: z.string().optional(),
  MCP_CIMD_STRICT: boolFromString(),
  MCP_SESSION_STORE_URL: z.string().optional(),
};

/** Agent runtime (the built-in Athena runtime, backed by the Anthropic Messages API). */
export const agentServer = {
  ANTHROPIC_API_KEY: z.string().optional(),
  // Seals org-held remote-MCP credentials (AES-256-GCM). Base64, exactly 32 bytes when
  // decoded; the connect route refuses to store a credential without it.
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
  // The per-session turn budget for the agentic loop. Required at process validation so a
  // deployment can never boot into a state where an operator diagnostic reaches a request path.
  AGENT_MAX_TURNS: z.coerce.number().int().min(1).max(200),
};

/** Cron secret, observability, blob/export storage, and transactional email. */
export const opsServer = {
  CRON_SECRET: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  EXPORT_BUCKET_URL: z.string().optional(),
  EXPORT_BUCKET_TOKEN: z.string().optional(),
  /** Resend API key for production transactional email over HTTPS. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /**
   * SMTP relay host for transactional email (`SmtpMailer`). Local: Mailpit (`localhost`).
   * Absent/placeholder ⇒ the mock `CaptureMailer` is used. Lenient (`min(1)`, optional);
   * the `@docket/integrations` resolver, not this schema, decides real-vs-mock.
   */
  SMTP_HOST: z.string().min(1).optional(),
  /** SMTP port (string form; coerced/validated by the adapter). 587 STARTTLS, 465 TLS, 1025 Mailpit. */
  SMTP_PORT: z.string().min(1).optional(),
  /** Whether SMTP uses implicit TLS from the start (`"true"`/`"false"`; defaults per port). */
  SMTP_SECURE: z.string().min(1).optional(),
  /** SMTP auth username (omit for unauthenticated relays such as Mailpit). */
  SMTP_USER: z.string().min(1).optional(),
  /** SMTP auth password (omit for unauthenticated relays such as Mailpit). */
  SMTP_PASS: z.string().min(1).optional(),
  /** From-address every transactional email is sent as (`"Name <addr>"` or a bare address). */
  MAIL_FROM: z.string().min(1).optional(),
  /** HTTP SMS provider send endpoint. Absent/placeholder ⇒ the mock SMS sender is used. */
  SMS_ENDPOINT: z.string().min(1).optional(),
  /** HTTP SMS provider API key. */
  SMS_API_KEY: z.string().min(1).optional(),
  /** SMS sender number configured with the provider. */
  SMS_FROM: z.string().min(1).optional(),
  /** HTTP push provider send endpoint. Absent/placeholder ⇒ the mock push sender is used. */
  PUSH_ENDPOINT: z.string().min(1).optional(),
  /** HTTP push provider API key. */
  PUSH_API_KEY: z.string().min(1).optional(),
  /** Push provider application id/bundle id. */
  PUSH_APP_ID: z.string().min(1).optional(),
  /**
   * Dev-only operator bootstrap allowlist: comma-separated `email[:role]` (role ∈
   * support|finance|superadmin, default superadmin). In non-production, a signed-in user
   * whose email is listed is lazily granted that staff tier on first `/admin` hit — the
   * one mechanism that works under embedded PGlite (single-process), where a separate seed
   * CLI cannot open the DB while the API holds it. Ignored entirely when `APP_MODE` is
   * `production`. Lenient string here; `scripts/seed-staff.ts` + the staff guard parse it.
   */
  STAFF_BOOTSTRAP_EMAILS: z.string().optional(),
};

/** Public client vars (Next.js `NEXT_PUBLIC_*`). */
export const clientShared = {
  NEXT_PUBLIC_API_URL: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().min(1),
  /** Browser-visible mirror of `BETTER_AUTH_PASSKEY_RP_ID` for WebAuthn Signal API calls. */
  NEXT_PUBLIC_PASSKEY_RP_ID: z.string().min(1),
};

/**
 * Third-party connectors (`RealConnector`). Each provider's OAuth token / API key is
 * supplied per-connection from the stored credential (not env); these optional
 * variables only override the provider API base for self-hosted / non-public hosts
 * (e.g. GitHub Enterprise). Absent/placeholder ⇒ the provider's public API base is
 * used. Lenient (`min(1)`, optional) so the local zero-account build boots on blanks;
 * the `@docket/integrations` resolver, not this schema, decides real-vs-mock.
 */
export const connectorServer = {
  /** GitHub REST API base override (e.g. `https://ghe.example.com/api/v3`). */
  GITHUB_API_BASE: z.string().min(1).optional(),
  /** Linear GraphQL API base override (defaults to `https://api.linear.app`). */
  LINEAR_API_BASE: z.string().min(1).optional(),
  /** Google Drive REST API base override. */
  GOOGLE_DRIVE_API_BASE: z.string().min(1).optional(),
  /** Gmail REST API base override. */
  GOOGLE_GMAIL_API_BASE: z.string().min(1).optional(),
  /** Google Calendar REST API base override. */
  GOOGLE_CALENDAR_API_BASE: z.string().min(1).optional(),
  /** Google Tasks REST API base override. */
  GOOGLE_TASKS_API_BASE: z.string().min(1).optional(),
  /** Microsoft Graph API base override. */
  MICROSOFT_GRAPH_API_BASE: z.string().min(1).optional(),
};
