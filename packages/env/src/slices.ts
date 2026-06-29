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
 * `@docket/boundaries` resolver, not this package, decides real-vs-mock per port.
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
  /** Forces the mock adapters when `local`/`test`, even if real keys are present (boundaries.md). */
  APP_MODE: z.enum(['local', 'test', 'production']),
  API_URL: z.string().min(1),
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
  BETTER_AUTH_PASSKEY_RP_ID: z.string().min(1),
  BETTER_AUTH_PASSKEY_RP_NAME: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
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
   * `@docket/boundaries` resolver decodes + decides real-vs-mock.
   */
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  /** GitHub App webhook signing secret — verifies inbound `X-Hub-Signature-256` firehose events. */
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  /** App-level Linear webhook signing secret — verifies inbound ambient-observation events. */
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
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
};

/** Cron secret, observability, blob/export storage, transactional email (SMTP). */
export const opsServer = {
  CRON_SECRET: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  EXPORT_BUCKET_URL: z.string().optional(),
  EXPORT_BUCKET_TOKEN: z.string().optional(),
  /**
   * SMTP relay host for transactional email (`SmtpMailer`). Local: Mailpit (`localhost`).
   * Absent/placeholder ⇒ the mock `CaptureMailer` is used. Lenient (`min(1)`, optional);
   * the `@docket/boundaries` resolver, not this schema, decides real-vs-mock.
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
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
};

/**
 * Third-party connectors (`RealConnector`). Each provider's OAuth token / API key is
 * supplied per-connection from the stored credential (not env); these optional
 * variables only override the provider API base for self-hosted / non-public hosts
 * (e.g. GitHub Enterprise). Absent/placeholder ⇒ the provider's public API base is
 * used. Lenient (`min(1)`, optional) so the local zero-account build boots on blanks;
 * the `@docket/boundaries` resolver, not this schema, decides real-vs-mock.
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
};
