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
  BETTER_AUTH_PASSKEY_RP_ID: z.string().min(1),
  BETTER_AUTH_PASSKEY_RP_NAME: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
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

/** Agent runtime (Athena / Anthropic). Endpoint↔key paired at composition. */
export const agentServer = {
  ATHENA_AGENT_ENDPOINT: z.string().optional(),
  ATHENA_AGENT_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
};

/** Cron secret, observability, blob/export storage. */
export const opsServer = {
  CRON_SECRET: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  EXPORT_BUCKET_URL: z.string().optional(),
  EXPORT_BUCKET_TOKEN: z.string().optional(),
};

/** Public client vars (Next.js `NEXT_PUBLIC_*`). */
export const clientShared = {
  NEXT_PUBLIC_API_URL: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
};
