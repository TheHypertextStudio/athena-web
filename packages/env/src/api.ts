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

import { isRealValue } from './real-value';
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

const rawEnv = createEnv({
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

const stripSlash = (url: string): string => url.replace(/\/$/, '');

/**
 * The validated, fail-fast server environment for the Hono API, with the MCP OAuth
 * URLs resolved to their documented defaults.
 *
 * @remarks
 * The MCP authorization/resource server is core functionality and MUST be on in every
 * deploy — never gated behind deploy-specific env. The three *mechanically derivable*
 * URLs therefore default from the required base config (the registry documents each):
 *
 * - `MCP_ISSUER_URL`      ⇒ `API_URL` (the AS and RS share the API origin)
 * - `MCP_RESOURCE_URL`    ⇒ `${API_URL}/mcp` (the one canonical RS route)
 * - `OIDC_LOGIN_PAGE_URL` ⇒ `${WEB_URL}/sign-in` (the product sign-in route)
 *
 * Setting a var overrides its derivation (e.g. a non-standard sign-in route).
 * `MCP_ALLOWED_ORIGINS` is deliberately NOT derived: it is the /mcp DNS-rebinding
 * security allowlist, a distinct semantic from any other origin list — it stays
 * explicit per environment. The conditional spreads keep `SKIP_ENV_VALIDATION` runs
 * (tests) faithful: absent base config derives nothing, so unconfigured-branch tests
 * still exercise those paths.
 */
export const env: typeof rawEnv = {
  ...rawEnv,
  ...(rawEnv.API_URL
    ? {
        MCP_ISSUER_URL: rawEnv.MCP_ISSUER_URL ?? stripSlash(rawEnv.API_URL),
        MCP_RESOURCE_URL: rawEnv.MCP_RESOURCE_URL ?? `${stripSlash(rawEnv.API_URL)}/mcp`,
      }
    : {}),
  ...(rawEnv.WEB_URL
    ? { OIDC_LOGIN_PAGE_URL: rawEnv.OIDC_LOGIN_PAGE_URL ?? `${stripSlash(rawEnv.WEB_URL)}/sign-in` }
    : {}),
};

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

  if (e.APP_MODE === 'production') {
    for (const [name, value] of Object.entries(e)) {
      if (typeof value === 'string' && !isRealValue(value)) {
        fail(`${name} must not contain an empty or placeholder value.`);
      }
    }
    for (const name of ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_WEBHOOK_SECRET']) {
      const value = e[name as keyof typeof e];
      if (typeof value !== 'string' || !isRealValue(value)) {
        fail(`${name} is required for the production Linear integration.`);
      }
    }
  }
}

if (!process.env['SKIP_ENV_VALIDATION']) {
  assertCrossFieldRules(env);
}

/** The inferred type of the validated API environment. */
export type ApiEnv = typeof env;
