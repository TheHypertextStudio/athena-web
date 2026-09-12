/**
 * The dev hostnames a checkout serves, and the env values that name them.
 *
 * @remarks
 * This module is the only place in the repository that knows the shape of a local dev host. It
 * exists because that knowledge used to live in five places at once — the checked-in env file,
 * `scripts/portless-env.ts`, `apps/api/src/dev-env.ts`, `scripts/dev-stack.sh`, and a launch
 * config — each with its own hand-written list of variables to keep in step. Two of those lists
 * had already drifted apart, and a drifted list does not fail as a config error: it fails as
 * `Invalid origin`, a dropped session cookie, a passkey `CHALLENGE_NOT_FOUND`, or a 404 on a route
 * that exists, hours later and in a different subsystem.
 */

/** The dev domain every local host hangs off. Portless prefixes it; nothing else does. */
export const DEV_DOMAIN = 'docket.localhost';

/**
 * Env vars that name a dev host, either as a URL or as a bare hostname.
 *
 * @remarks
 * Enumerated rather than pattern-matched over the whole environment: a blanket
 * "rewrite anything containing docket.localhost" would also rewrite secrets, allow-lists meant to
 * stay canonical, and anything a future variable happens to embed. Adding a variable here is a
 * deliberate statement that it names *this stack's* host.
 *
 * This is the superset of the two lists it replaces. `MCP_ISSUER_URL`, `MCP_RESOURCE_URL`,
 * `MCP_ALLOWED_ORIGINS` and `OIDC_LOGIN_PAGE_URL` were missing from the copy in
 * `apps/api/src/dev-env.ts`, so a restarted API in a worktree issued MCP tokens for the canonical
 * origin and sent OIDC logins to another checkout's sign-in page.
 */
export const HOST_BEARING_VARS: readonly string[] = [
  'API_URL',
  'WEB_URL',
  'APP_URL',
  'ADMIN_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_APP_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'BETTER_AUTH_ALLOWED_HOSTS',
  'BETTER_AUTH_PASSKEY_RP_ID',
  'NEXT_PUBLIC_PASSKEY_RP_ID',
  'MCP_ISSUER_URL',
  'MCP_RESOURCE_URL',
  'MCP_ALLOWED_ORIGINS',
  'OIDC_LOGIN_PAGE_URL',
];

/**
 * Host-bearing vars that must **not** be prefixed, and why.
 *
 * @remarks
 * `BETTER_AUTH_COOKIE_DOMAIN` has to name a domain that is a parent of *every* host in the stack,
 * because the API writes the session cookie and the web app reads it. Portless prefixes each app
 * independently — `<prefix>.docket.localhost` for the web app, `<prefix>.api.docket.localhost` for
 * the API — which makes them **siblings**, not parent and child. Prefixing the cookie domain
 * therefore produces a domain the API is not allowed to set a cookie for, the browser drops the
 * `Set-Cookie` silently, and sign-up ends with no session and no error: the passkey ceremony
 * succeeds, and the app simply never leaves `/sign-up`.
 *
 * `docket.localhost` is the only shared parent, and it is already what the canonical value says,
 * so the correct action is to leave it alone. Listed explicitly rather than merely omitted from
 * {@link HOST_BEARING_VARS}, so that the next person to notice it is missing reads this first.
 *
 * The **passkey relying-party id** is the same rule, and getting it wrong is what made passkeys
 * fail in a worktree for months. A relying-party id has to be a registrable suffix of every origin
 * the ceremony touches, and the app and the API are siblings under the prefix, so
 * `<prefix>.docket.localhost` excludes the API. `scripts/dev-stack.sh` always set the shared parent
 * and its passkey ceremony worked; the portless launcher prefixed it and its ceremony failed with
 * `CHALLENGE_NOT_FOUND`. The two paths disagreeing on this one value is the drift that cost the
 * afternoons, and it is why these names are enumerated here rather than left to whoever edits the
 * list next.
 */
export const DELIBERATELY_UNPREFIXED: readonly string[] = [
  'BETTER_AUTH_COOKIE_DOMAIN',
  'BETTER_AUTH_PASSKEY_RP_ID',
  'NEXT_PUBLIC_PASSKEY_RP_ID',
];

/**
 * Convert a Portless service name to its unprefixed host.
 *
 * `docket` owns `docket.localhost`; sibling services use names such as `api.docket` and own
 * `api.docket.localhost`.
 *
 * @param serviceName - A package's configured `portless.name`.
 * @returns The canonical host, or `undefined` for a name outside the `docket` family.
 */
export function canonicalServiceHost(serviceName: string): string | undefined {
  if (serviceName === 'docket') return DEV_DOMAIN;
  if (!serviceName.endsWith('.docket')) return undefined;
  const subdomain = serviceName.slice(0, -'.docket'.length);
  return subdomain.length > 0 ? `${subdomain}.${DEV_DOMAIN}` : undefined;
}

/**
 * Read the branch hostname prefix out of a service's `PORTLESS_URL`.
 *
 * @param raw - The URL Portless assigned to the current service.
 * @param serviceName - The package's configured `portless.name`.
 * @returns The prefix (e.g. `feature-x`), or `undefined` on the service's canonical host.
 */
export function portlessPrefix(
  raw: string | undefined,
  serviceName: string | undefined,
): string | undefined {
  if (!raw || !serviceName) return undefined;

  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return undefined;
  }

  const serviceHost = canonicalServiceHost(serviceName);
  if (!serviceHost || host === serviceHost) return undefined;
  if (!host.endsWith(`.${serviceHost}`)) return undefined;

  // `feature-x.api.docket.localhost` minus `.api.docket.localhost` leaves `feature-x`.
  const prefix = host.slice(0, -(serviceHost.length + 1)).split('.')[0];
  return prefix === undefined || prefix === '' ? undefined : prefix;
}

/**
 * Insert the prefix in front of every `*.docket.localhost` host in a value.
 *
 * @param value - An env value: a URL, a bare hostname, or a comma-separated list of either.
 * @param prefix - The portless prefix.
 * @returns The value with each dev host prefixed, and everything else untouched.
 */
export function prefixDevHosts(value: string, prefix: string): string {
  // Matches the host portion only — the optional sub-name plus the domain — so a path, a port, or
  // a scheme is carried through unchanged, and an already-prefixed host is left alone.
  return value.replace(
    new RegExp(String.raw`(^|[/@,\s])((?:[\w-]+\.)*)${DEV_DOMAIN.replace('.', '\\.')}`, 'g'),
    (match, lead: string, subNames: string) =>
      subNames.startsWith(`${prefix}.`) ? match : `${lead}${prefix}.${subNames}${DEV_DOMAIN}`,
  );
}

/** A mutable env bag, as `process.env` is. */
export type EnvBag = Record<string, string | undefined>;

/**
 * Rewrite an env bag so every dev host names the stack this checkout is serving.
 *
 * @param env - The bag to correct in place, normally `process.env`.
 * @param prefix - The portless prefix, from {@link portlessPrefix}.
 * @returns The names of the variables that changed, for logging.
 */
export function applyDevHostPrefix(env: EnvBag, prefix: string): readonly string[] {
  const changed: string[] = [];
  for (const name of HOST_BEARING_VARS) {
    if (DELIBERATELY_UNPREFIXED.includes(name)) continue;
    const current = env[name];
    if (!current) continue;
    const next = prefixDevHosts(current, prefix);
    if (next === current) continue;
    env[name] = next;
    changed.push(name);
  }
  return changed;
}
