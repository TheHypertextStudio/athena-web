/**
 * `@docket/env/api` — server-side validated environment for the Hono API.
 *
 * @remarks
 * Imported at the very top of `apps/api` so the process refuses to boot with an
 * invalid contract (fail-fast 12-factor). Composes every server slice plus the
 * cross-field rules that a flat per-var schema cannot express. The only delta to
 * production is the *values* — the shape and validation are identical everywhere.
 */
import { createEnv } from '@t3-oss/env-core';

import {
  agentServer,
  authServer,
  connectorServer,
  dbServer,
  mcpServer,
  opsServer,
  sharedServer,
  stripeServer,
} from './slices';

/** The validated, fail-fast server environment for the Hono API. */
export const env = createEnv({
  server: {
    ...sharedServer,
    ...dbServer,
    ...authServer,
    ...stripeServer,
    ...mcpServer,
    ...agentServer,
    ...opsServer,
    ...connectorServer,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: Boolean(process.env['SKIP_ENV_VALIDATION']),
});

/**
 * Cross-field invariants that a per-var schema cannot express. Runs at module load
 * so a misconfigured contract fails fast, the same as a missing required var.
 *
 * @throws {Error} when a paired/conditional var group is half-configured.
 */
function assertCrossFieldRules(e: typeof env): void {
  const fail = (msg: string): never => {
    throw new Error(`Invalid environment (cross-field): ${msg}`);
  };

  if (e.BILLING_ENABLED) {
    if (!e.STRIPE_SECRET_KEY) fail('BILLING_ENABLED=true requires STRIPE_SECRET_KEY.');
    if (!e.STRIPE_PRICE_TEAM && !e.DOCKET_PRICE_LOOKUP_TEAM) {
      fail('BILLING_ENABLED=true requires STRIPE_PRICE_TEAM or DOCKET_PRICE_LOOKUP_TEAM.');
    }
  }

  if (Boolean(e.EXPORT_BUCKET_URL) !== Boolean(e.EXPORT_BUCKET_TOKEN)) {
    fail('EXPORT_BUCKET_URL and EXPORT_BUCKET_TOKEN must be set together.');
  }

  // oAuthProxy needs BOTH the shared secret and the production URL to route preview OAuth through
  // prod; half-configured would silently disable the proxy or fail the OAuth flow at runtime.
  if (Boolean(e.OAUTH_PROXY_SECRET) !== Boolean(e.OAUTH_PROXY_PRODUCTION_URL)) {
    fail('OAUTH_PROXY_SECRET and OAUTH_PROXY_PRODUCTION_URL must be set together.');
  }

  if (e.MCP_TASKS_ENABLED && !e.MCP_SESSION_STORE_URL) {
    fail('MCP_TASKS_ENABLED=true requires MCP_SESSION_STORE_URL.');
  }
}

if (!process.env['SKIP_ENV_VALIDATION']) {
  assertCrossFieldRules(env);
}

/** The inferred type of the validated API environment. */
export type ApiEnv = typeof env;
