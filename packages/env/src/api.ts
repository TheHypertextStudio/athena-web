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

import { reportInvalidEnv } from './env-error';
import { isRealValue } from './real-value';
import {
  agentServer,
  authServer,
  connectorServer,
  dbServer,
  hostsServer,
  mcpServer,
  opsServer,
  sharedServer,
  stripeServer,
  voiceServer,
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
    ...hostsServer,
    ...voiceServer,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: Boolean(process.env['SKIP_ENV_VALIDATION']),
  onValidationError: reportInvalidEnv,
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
 * Every user-facing host the server needs, read straight from the environment.
 *
 * @remarks
 * One value per host, each from its own variable. Nothing is derived from anything else: a host
 * that is not configured is `undefined`, and the caller decides whether that is fatal.
 *
 * `app`, `api`, and `admin` are origins. `brief` and `athenaMail` are bare hosts, because a mail
 * host has no scheme. Use `new URL(...)` where a caller needs the other form.
 */
export const apiHosts = {
  /** Origin the product answers on (`WEB_URL`). */
  app: env.WEB_URL,
  /** Origin the API answers on (`API_URL`). */
  api: env.API_URL,
  /** Origin the operator console answers on (`ADMIN_URL`). */
  admin: env.ADMIN_URL,
  /** Bare host published briefs are served from (`PUBLIC_BRIEF_HOST`). */
  brief: env.PUBLIC_BRIEF_HOST,
  /** Bare host Athena receives mail on (`ATHENA_INBOUND_MAIL_HOST`). */
  athenaMail: env.ATHENA_INBOUND_MAIL_HOST,
  /** CNAME target a workspace points a custom domain at (`CUSTOM_DOMAIN_CNAME_TARGET`). */
  customDomainTarget: env.CUSTOM_DOMAIN_CNAME_TARGET,
  /** WebAuthn relying-party id (`BETTER_AUTH_PASSKEY_RP_ID`). */
  passkeyRpId: env.BETTER_AUTH_PASSKEY_RP_ID,
  /** Address a person is told to write to (`SUPPORT_EMAIL`). */
  supportEmail: env.SUPPORT_EMAIL,
} as const;

/**
 * Read an origin that the caller cannot proceed without.
 *
 * @param value - The configured origin, or `undefined`.
 * @param name - The variable it comes from, for the error.
 * @returns The origin.
 * @throws {Error} When the variable is unset.
 */
export function requireEnvOrigin(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required but not configured.`);
  return value;
}

/**
 * Every bare host the product itself answers on.
 *
 * @remarks
 * Used to tell an incoming request apart from one arriving on a workspace's custom domain, which
 * is a routing question. `.hostname`, not `.host`: a request's `Host` header is compared without
 * a port, and `localhost:3000` would never match.
 */
export const OWN_HOSTS: readonly string[] = [apiHosts.app, apiHosts.api, apiHosts.admin]
  .filter((value): value is string => value !== undefined)
  .map((origin) => new URL(origin).hostname)
  .concat([apiHosts.brief, apiHosts.athenaMail].filter((v): v is string => v !== undefined));

/**
 * Whether a hostname is one Docket itself serves.
 *
 * @param host - A bare hostname.
 * @returns `true` when the host is one of the product's own.
 */
export function isOwnHost(host: string): boolean {
  return OWN_HOSTS.includes(host);
}

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
    if (
      !e.STRIPE_PRICE_DOCKET_PRO &&
      !e.DOCKET_PRICE_LOOKUP_DOCKET_PRO &&
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- one-release configuration compatibility
      !e.STRIPE_PRICE_TEAM &&
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- one-release configuration compatibility
      !e.DOCKET_PRICE_LOOKUP_TEAM
    ) {
      fail(
        'BILLING_ENABLED=true requires STRIPE_PRICE_DOCKET_PRO or DOCKET_PRICE_LOOKUP_DOCKET_PRO.',
      );
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

  if (e.ATHENA_ASYNC_RUNNER_ENABLED && e.APP_MODE === 'production') {
    if (!e.CLOUDFLARE_ATHENA_RUNNER_URL) {
      fail('ATHENA_ASYNC_RUNNER_ENABLED=true requires CLOUDFLARE_ATHENA_RUNNER_URL.');
    }
    if (!e.CLOUDFLARE_TO_DOCKET_HMAC_SECRET || !e.DOCKET_TO_CLOUDFLARE_HMAC_SECRET) {
      fail('ATHENA_ASYNC_RUNNER_ENABLED=true requires both directional HMAC secrets.');
    }
    if (e.CLOUDFLARE_TO_DOCKET_HMAC_SECRET === e.DOCKET_TO_CLOUDFLARE_HMAC_SECRET) {
      fail('Cloudflare execution HMAC secrets must be distinct.');
    }
  }

  if (e.APP_MODE === 'production') {
    // A domain cutover moves several variables, and the dangerous state is the half-applied one:
    // `WEB_URL` on the new apex while `ADMIN_URL` or `API_URL` still answer on the old. That
    // deploy looks healthy and quietly keeps a user-facing host on the domain GEN-25 requires
    // Docket to leave. Refusing to boot turns it into a deploy failure instead.

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
