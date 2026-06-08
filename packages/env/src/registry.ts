/**
 * `@docket/env/registry` — the single typed contract of every environment variable.
 *
 * @remarks
 * `VAR_REGISTRY` is the one declaration site for the var → {slice, scope, targets,
 * required, where-hint, sensitivity} metadata. The per-app `createEnv` compositions
 * derive their *validated* shape from the slice schemas in `./slices`; this registry
 * re-references those same `ZodType`s so `pnpm env:check` and the future bootstrap
 * prompt can validate + explain each var (with its `where` hint) without importing a
 * composition (which would fail-fast on the first missing var).
 */
import type { z } from 'zod';

import {
  agentServer,
  authServer,
  clientShared,
  connectorServer,
  dbServer,
  mcpServer,
  opsServer,
  sharedServer,
  stripeServer,
} from './slices';

/** The logical group a var belongs to (mirrors the slice files). */
export type Slice =
  | 'shared'
  | 'db'
  | 'auth'
  | 'stripe'
  | 'mcp'
  | 'agent'
  | 'ops'
  | 'connector'
  | 'client';
/** Whether a var is server-only or a public client var. */
export type Scope = 'server' | 'client';
/** Which deployable surface(s) consume a var. */
export type Target = 'api' | 'web' | 'marketing' | 'admin';

/** Metadata for one environment variable — drives validation hints + bootstrap prompts. */
export interface VarSpec {
  readonly name: string;
  readonly slice: Slice;
  readonly scope: Scope;
  readonly targets: readonly Target[];
  readonly required: boolean;
  readonly zod: z.ZodType;
  /** Human hint: where to obtain/generate this value. Printed by `pnpm env:check`. */
  readonly where: string;
  readonly sensitive?: boolean;
  /** Optional shell snippet to generate the value (used by the bootstrap prompt). */
  readonly generate?: string;
}

const APP: readonly Target[] = ['web', 'marketing', 'admin'];
const ALL: readonly Target[] = ['api', 'web', 'marketing', 'admin'];

/** The single declaration of every environment variable Docket reads. */
export const VAR_REGISTRY: readonly VarSpec[] = [
  // shared
  {
    name: 'NODE_ENV',
    slice: 'shared',
    scope: 'server',
    targets: ALL,
    required: false,
    zod: sharedServer.NODE_ENV,
    where: 'development | test | production',
  },
  {
    name: 'APP_MODE',
    slice: 'shared',
    scope: 'server',
    targets: ALL,
    required: true,
    zod: sharedServer.APP_MODE,
    where: 'local | test | production — local/test force the mock boundary adapters',
  },
  {
    name: 'API_URL',
    slice: 'shared',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: sharedServer.API_URL,
    where: 'Public base URL of the Hono API',
  },
  {
    name: 'PORT',
    slice: 'shared',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: sharedServer.PORT,
    where: 'API listen port (default 3000)',
  },

  // db
  {
    name: 'DATABASE_URL',
    slice: 'db',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: dbServer.DATABASE_URL,
    where:
      'Postgres pooled URL. Local zero-account build: a pglite path e.g. pglite://.data/docket. Prod: Neon pooled URL.',
    sensitive: true,
  },
  {
    name: 'DATABASE_URL_UNPOOLED',
    slice: 'db',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: dbServer.DATABASE_URL_UNPOOLED,
    where: 'Unpooled URL used for migrations (falls back to DATABASE_URL).',
    sensitive: true,
  },

  // auth
  {
    name: 'BETTER_AUTH_SECRET',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: authServer.BETTER_AUTH_SECRET,
    where: 'openssl rand -base64 32 (≥32 chars)',
    sensitive: true,
    generate: 'openssl rand -base64 32',
  },
  {
    name: 'BETTER_AUTH_URL',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: authServer.BETTER_AUTH_URL,
    where: 'Base URL Better Auth issues cookies/redirects for',
  },
  {
    name: 'BETTER_AUTH_TRUSTED_ORIGINS',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: authServer.BETTER_AUTH_TRUSTED_ORIGINS,
    where: 'CSV of trusted browser origins for CORS + cookies',
  },
  {
    name: 'BETTER_AUTH_PASSKEY_RP_ID',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: authServer.BETTER_AUTH_PASSKEY_RP_ID,
    where: 'WebAuthn relying-party id (the registrable domain; localhost in dev)',
  },
  {
    name: 'BETTER_AUTH_PASSKEY_RP_NAME',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: authServer.BETTER_AUTH_PASSKEY_RP_NAME,
    where: "WebAuthn relying-party display name (default 'Docket')",
  },
  {
    name: 'GOOGLE_CLIENT_ID',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: authServer.GOOGLE_CLIENT_ID,
    where: 'Google Cloud OAuth client id (absent → provider hidden)',
  },
  {
    name: 'GOOGLE_CLIENT_SECRET',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: authServer.GOOGLE_CLIENT_SECRET,
    where: 'Google Cloud OAuth client secret',
    sensitive: true,
  },
  {
    name: 'GITHUB_CLIENT_ID',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: authServer.GITHUB_CLIENT_ID,
    where: 'GitHub OAuth app client id (absent → provider hidden)',
  },
  {
    name: 'GITHUB_CLIENT_SECRET',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: authServer.GITHUB_CLIENT_SECRET,
    where: 'GitHub OAuth app client secret',
    sensitive: true,
  },
  {
    name: 'LINEAR_CLIENT_ID',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: authServer.LINEAR_CLIENT_ID,
    where: 'Linear OAuth2 application client id (genericOAuth)',
  },
  {
    name: 'LINEAR_CLIENT_SECRET',
    slice: 'auth',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: authServer.LINEAR_CLIENT_SECRET,
    where: 'Linear OAuth2 application client secret',
    sensitive: true,
  },

  // stripe
  {
    name: 'STRIPE_SECRET_KEY',
    slice: 'stripe',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: stripeServer.STRIPE_SECRET_KEY,
    where: 'Stripe secret key (sk_...) — required when BILLING_ENABLED=true',
    sensitive: true,
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    slice: 'stripe',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: stripeServer.STRIPE_WEBHOOK_SECRET,
    where: 'Stripe webhook signing secret (whsec_...) from `stripe listen`',
    sensitive: true,
  },
  {
    name: 'DOCKET_PRICE_LOOKUP_TEAM',
    slice: 'stripe',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: stripeServer.DOCKET_PRICE_LOOKUP_TEAM,
    where: 'Stripe price lookup_key for the Team plan',
  },
  {
    name: 'DOCKET_PRICE_LOOKUP_TEAM_ANNUAL',
    slice: 'stripe',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: stripeServer.DOCKET_PRICE_LOOKUP_TEAM_ANNUAL,
    where: 'Stripe price lookup_key for the annual Team plan',
  },
  {
    name: 'STRIPE_PRICE_TEAM',
    slice: 'stripe',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: stripeServer.STRIPE_PRICE_TEAM,
    where: 'Stripe price id (price_...) — alternative to the lookup key',
  },
  {
    name: 'STRIPE_BILLING_PORTAL_CONFIG_ID',
    slice: 'stripe',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: stripeServer.STRIPE_BILLING_PORTAL_CONFIG_ID,
    where: 'Stripe billing portal configuration id',
  },
  {
    name: 'BILLING_ENABLED',
    slice: 'stripe',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: stripeServer.BILLING_ENABLED,
    where: 'true|false — gate that requires the Stripe keys when on (default false)',
  },

  // mcp
  {
    name: 'MCP_ISSUER_URL',
    slice: 'mcp',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: mcpServer.MCP_ISSUER_URL,
    where: 'OAuth issuer URL for the MCP server (defaults to API_URL)',
  },
  {
    name: 'MCP_RESOURCE_URL',
    slice: 'mcp',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: mcpServer.MCP_RESOURCE_URL,
    where: 'Canonical MCP resource URL (defaults to ${API_URL}/mcp)',
  },
  {
    name: 'MCP_ALLOWED_ORIGINS',
    slice: 'mcp',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: mcpServer.MCP_ALLOWED_ORIGINS,
    where: 'CSV of allowed Origins for the /mcp endpoint (DNS-rebinding guard)',
  },
  {
    name: 'OIDC_LOGIN_PAGE_URL',
    slice: 'mcp',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: mcpServer.OIDC_LOGIN_PAGE_URL,
    where: 'Login page URL the OIDC provider redirects to',
  },
  {
    name: 'MCP_TASKS_ENABLED',
    slice: 'mcp',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: mcpServer.MCP_TASKS_ENABLED,
    where: 'true|false — enable the MCP Tasks utility (requires MCP_SESSION_STORE_URL)',
  },
  {
    name: 'MCP_CIMD_TRUST_ALLOWLIST',
    slice: 'mcp',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: mcpServer.MCP_CIMD_TRUST_ALLOWLIST,
    where: 'CSV of trusted client-id metadata document origins',
  },
  {
    name: 'MCP_CIMD_STRICT',
    slice: 'mcp',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: mcpServer.MCP_CIMD_STRICT,
    where: 'true|false — strict CIMD validation (default true)',
  },
  {
    name: 'MCP_SESSION_STORE_URL',
    slice: 'mcp',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: mcpServer.MCP_SESSION_STORE_URL,
    where: 'Backing store URL for resumable MCP sessions',
  },

  // agent
  {
    name: 'ANTHROPIC_API_KEY',
    slice: 'agent',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: agentServer.ANTHROPIC_API_KEY,
    where: 'Anthropic API key for the built-in Athena runtime',
    sensitive: true,
  },

  // ops
  {
    name: 'CRON_SECRET',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: true,
    zod: opsServer.CRON_SECRET,
    where: 'Shared secret guarding the cron endpoints',
    sensitive: true,
    generate: 'openssl rand -hex 24',
  },
  {
    name: 'SENTRY_DSN',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.SENTRY_DSN,
    where: 'Sentry DSN (absent → error reporting disabled)',
  },
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.BLOB_READ_WRITE_TOKEN,
    where: 'Vercel Blob read/write token for export artifacts',
    sensitive: true,
  },
  {
    name: 'EXPORT_BUCKET_URL',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.EXPORT_BUCKET_URL,
    where: 'S3-compatible bucket URL for exports (paired with token)',
  },
  {
    name: 'EXPORT_BUCKET_TOKEN',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.EXPORT_BUCKET_TOKEN,
    where: 'Bucket access token for exports',
    sensitive: true,
  },
  {
    name: 'SMTP_HOST',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.SMTP_HOST,
    where:
      'SMTP relay host for transactional email. Local: localhost (Mailpit). Absent → mock CaptureMailer.',
  },
  {
    name: 'SMTP_PORT',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.SMTP_PORT,
    where: 'SMTP port (587 STARTTLS, 465 implicit TLS, 1025 Mailpit). Defaults to 587 when absent.',
  },
  {
    name: 'SMTP_SECURE',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.SMTP_SECURE,
    where: 'true|false — implicit TLS from connect. Defaults to true only on port 465.',
  },
  {
    name: 'SMTP_USER',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.SMTP_USER,
    where: 'SMTP auth username (omit for unauthenticated relays such as Mailpit).',
  },
  {
    name: 'SMTP_PASS',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.SMTP_PASS,
    where: 'SMTP auth password (omit for unauthenticated relays such as Mailpit).',
    sensitive: true,
  },
  {
    name: 'MAIL_FROM',
    slice: 'ops',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: opsServer.MAIL_FROM,
    where: 'From-address for transactional email, e.g. "Docket <no-reply@docket.dev>".',
  },

  // connector (per-provider API-base overrides; the OAuth token is per-connection, not env)
  {
    name: 'GITHUB_API_BASE',
    slice: 'connector',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: connectorServer.GITHUB_API_BASE,
    where:
      'GitHub REST API base override for self-hosted/Enterprise (e.g. https://ghe.example.com/api/v3). Absent ⇒ https://api.github.com',
  },
  {
    name: 'LINEAR_API_BASE',
    slice: 'connector',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: connectorServer.LINEAR_API_BASE,
    where: 'Linear GraphQL API base override. Absent ⇒ https://api.linear.app',
  },
  {
    name: 'GOOGLE_DRIVE_API_BASE',
    slice: 'connector',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: connectorServer.GOOGLE_DRIVE_API_BASE,
    where: 'Google Drive REST API base override. Absent ⇒ https://www.googleapis.com/drive/v3',
  },
  {
    name: 'GOOGLE_GMAIL_API_BASE',
    slice: 'connector',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: connectorServer.GOOGLE_GMAIL_API_BASE,
    where: 'Gmail REST API base override. Absent ⇒ https://gmail.googleapis.com/gmail/v1',
  },
  {
    name: 'GOOGLE_CALENDAR_API_BASE',
    slice: 'connector',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: connectorServer.GOOGLE_CALENDAR_API_BASE,
    where:
      'Google Calendar REST API base override. Absent ⇒ https://www.googleapis.com/calendar/v3',
  },
  {
    name: 'GOOGLE_TASKS_API_BASE',
    slice: 'connector',
    scope: 'server',
    targets: ['api'],
    required: false,
    zod: connectorServer.GOOGLE_TASKS_API_BASE,
    where: 'Google Tasks REST API base override. Absent ⇒ https://tasks.googleapis.com/tasks/v1',
  },

  // client
  {
    name: 'NEXT_PUBLIC_API_URL',
    slice: 'client',
    scope: 'client',
    targets: APP,
    required: true,
    zod: clientShared.NEXT_PUBLIC_API_URL,
    where: 'Public API base URL exposed to the browser',
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    slice: 'client',
    scope: 'client',
    targets: APP,
    required: true,
    zod: clientShared.NEXT_PUBLIC_APP_URL,
    where: 'Public web app base URL exposed to the browser',
  },
  {
    name: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    slice: 'client',
    scope: 'client',
    targets: APP,
    required: false,
    zod: clientShared.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    where: 'Stripe publishable key (pk_...) for embedded Checkout',
  },
] as const;

/** Look up a single var spec by name. */
export function findVar(name: string): VarSpec | undefined {
  return VAR_REGISTRY.find((v) => v.name === name);
}
