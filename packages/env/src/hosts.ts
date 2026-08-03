/**
 * `@docket/env/hosts` — the one place a user-facing host is resolved from configuration.
 *
 * @remarks
 * **Why this module exists.** Docket is moving off the shared studio apex it launched on, onto
 * its own (GEN-25), and two features that have not been built yet each need a host of their own:
 * publishable briefs need a default host plus per-workspace custom domains, and Athena's
 * inbox needs a receiving host that is interim today and final later. Left to themselves,
 * each of those would hard-code a hostname, and the cutover would become a code change in
 * three places instead of an environment change in one. Every consumer therefore asks this
 * module, and this module reads configuration.
 *
 * **The shape of the contract.** Exactly one variable is authoritative — the apex Docket
 * owns ({@link HostEnvSource.rootDomain}, from `PUBLIC_ROOT_DOMAIN` / `NEXT_PUBLIC_ROOT_DOMAIN`).
 * Every other host either comes from its own explicit variable or is *derived* from that apex
 * by a documented rule. Setting the apex alone is enough to move the whole product; setting a
 * specific variable overrides just that host, which is what the staged cutover in
 * `docs/engineering/domain-cutover.md` needs.
 *
 * **No literal hostname appears here.** A legacy-apex string in production source is exactly
 * what GEN-25 forbids, so the isolation check ({@link assertHostConfigIsolated}) is expressed
 * structurally — every user-facing host must sit at or under the configured apex — rather than
 * as a denylist of yesterday's domain. The literal lives only in
 * `packages/env/tests/hosts/legacy-host-policy.test.ts`, which is the test that bans it.
 *
 * **Purity.** No schema, no `createEnv`, and no framework import, for the same reason
 * `./real-value` has none: scripts and the browser must be able to resolve a host without
 * triggering the fail-fast composition. Callers pass their own values in.
 *
 * @see {@link ./custom-domain} for per-workspace custom domains, which build on this.
 */

/**
 * A user-facing host role Docket can resolve.
 *
 * @remarks
 * `athena-mail` is the odd one out and deliberately so: it is a *mail* host (it needs MX
 * records, not a TLS certificate), it is the one host GEN-25 permits to stay off the product
 * apex during the interim, and it is never derived — see {@link resolveHostConfig}.
 */
export type HostRole = 'app' | 'api' | 'admin' | 'brief' | 'athena-mail';

/** Every {@link HostRole}, in the order a human would want them listed. */
export const HOST_ROLES: readonly HostRole[] = ['app', 'api', 'admin', 'brief', 'athena-mail'];

/**
 * The web-serving roles, i.e. every role except the mail host.
 *
 * @remarks
 * These are the hosts that must be isolated onto the product apex and must answer over HTTPS.
 */
export const WEB_HOST_ROLES: readonly HostRole[] = ['app', 'api', 'admin', 'brief'];

/** Subdomain used for the API when `API_URL` is not set explicitly. */
export const DEFAULT_API_SUBDOMAIN = 'api';
/** Subdomain used for the operator back-office when `ADMIN_URL` is not set explicitly. */
export const DEFAULT_ADMIN_SUBDOMAIN = 'admin';
/** Subdomain that serves slug-based published briefs when no brief host is set explicitly. */
export const DEFAULT_BRIEF_SUBDOMAIN = 'briefs';
/** Local part of the support address when no support address is set explicitly. */
export const DEFAULT_SUPPORT_MAILBOX = 'support';

/**
 * Raw configuration this module reads, already extracted from the caller's environment.
 *
 * @remarks
 * Named fields rather than a `process.env` record on purpose. Next.js only inlines
 * `process.env.NEXT_PUBLIC_*` when it can see the literal key at the access site, so the
 * browser caller must do its own literal reads — {@link browserHostConfig} is that caller.
 * Every field is optional so a script can resolve a partial config without throwing.
 */
export interface HostEnvSource {
  /** `PUBLIC_ROOT_DOMAIN` / `NEXT_PUBLIC_ROOT_DOMAIN` — the apex Docket owns, e.g. `docket.place`. */
  readonly rootDomain?: string | undefined;
  /** `WEB_URL` / `NEXT_PUBLIC_APP_URL` — the product web app origin. */
  readonly appUrl?: string | undefined;
  /** `API_URL` / `NEXT_PUBLIC_API_URL` — the Hono API origin. */
  readonly apiUrl?: string | undefined;
  /** `ADMIN_URL` — the operator back-office origin. */
  readonly adminUrl?: string | undefined;
  /** `PUBLIC_BRIEF_HOST` / `NEXT_PUBLIC_BRIEF_HOST` — the host serving slug-based published briefs. */
  readonly briefHost?: string | undefined;
  /** `ATHENA_INBOUND_MAIL_HOST` — the domain Athena receives mail on. Never derived. */
  readonly athenaInboundMailHost?: string | undefined;
  /** `CUSTOM_DOMAIN_CNAME_TARGET` — what a workspace's verified custom domain points at. */
  readonly customDomainTarget?: string | undefined;
  /** `BETTER_AUTH_PASSKEY_RP_ID` / `NEXT_PUBLIC_PASSKEY_RP_ID` — the WebAuthn relying-party id. */
  readonly passkeyRpId?: string | undefined;
  /** `SUPPORT_EMAIL` / `NEXT_PUBLIC_SUPPORT_EMAIL` — the address the legal pages publish. */
  readonly supportEmail?: string | undefined;
}

/** One resolved host, with everything a caller needs and nothing it has to re-parse. */
export interface ResolvedHost {
  /** The role this host serves. */
  readonly role: HostRole;
  /**
   * The bare hostname, lowercased, with no scheme, port, path, or trailing dot.
   *
   * @remarks
   * This — never {@link ResolvedHost.origin} — is what a cookie `Domain`, a WebAuthn RP id,
   * a DNS record, or a TLS SAN comparison wants. A port in any of those is a bug.
   */
  readonly host: string;
  /** The full origin, e.g. `https://api.docket.place` or `http://api.docket.localhost:1355`. */
  readonly origin: string;
}

/** The fully resolved host contract for one deployment. */
export interface HostConfig {
  /**
   * The registrable apex Docket owns, e.g. `docket.place`.
   *
   * @remarks
   * `undefined` only when neither `PUBLIC_ROOT_DOMAIN` nor an app URL was supplied — a state a
   * real deployment cannot reach (both `WEB_URL` and `NEXT_PUBLIC_APP_URL` are required vars),
   * but that a script constructing a partial config legitimately can.
   */
  readonly rootDomain: string | undefined;
  /** Every role's resolved host. `athena-mail` is absent until it is configured. */
  readonly hosts: Readonly<Partial<Record<HostRole, ResolvedHost>>>;
  /** The WebAuthn relying-party id. Defaults to the apex — see the warning in {@link resolveHostConfig}. */
  readonly passkeyRpId: string | undefined;
  /** The support address the privacy and terms pages publish. */
  readonly supportEmail: string | undefined;
  /** The host a workspace's verified custom domain must `CNAME` to in order to serve. */
  readonly customDomainTarget: string | undefined;
}

/** Hosts that are always addressed over plain HTTP because they are local development names. */
function isLocalHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';
}

/**
 * Reduce a URL, an authority, or a bare hostname to its lowercased hostname and port.
 *
 * @remarks
 * Accepts every shape configuration realistically carries — `https://docket.place/`,
 * `docket.place:1355`, `Docket.Place.` — because requiring one shape just moves the parsing
 * into every caller. A value with no recognisable host yields `undefined` rather than a
 * partially-parsed guess.
 *
 * @param value - A URL, `host[:port]` authority, or bare hostname.
 * @returns The hostname and optional port, or `undefined` when nothing usable was supplied.
 */
export function parseHost(
  value: string | undefined | null,
): { host: string; port: number | undefined } | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  // `new URL` needs a scheme; adding a placeholder one is cheaper and safer than a regex that
  // has to re-implement IPv6 bracket syntax and userinfo stripping.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0) return undefined;
  const port = url.port === '' ? undefined : Number(url.port);
  return { host, port };
}

/**
 * The registrable apex of one of **Docket's own** hosts — its last two labels.
 *
 * @remarks
 * Deliberately naive: it is the last two labels, with no public-suffix list. That is exactly
 * right for the hosts Docket configures for itself (`docket.example.studio` → `example.studio`,
 * `api.docket.place` → `docket.place`, `docket.localhost` → `docket.localhost`) and exactly wrong
 * for a user-supplied domain under a multi-label suffix (`shop.example.co.uk` → `co.uk`). It is
 * therefore never applied to a custom domain: `./custom-domain` verifies the exact host a
 * workspace supplied and never computes its apex. Set `PUBLIC_ROOT_DOMAIN` explicitly if Docket
 * ever sits under such a suffix.
 *
 * @param host - A bare hostname.
 * @returns The last two labels, or the host itself when it has fewer than two.
 */
export function apexOf(host: string): string {
  const labels = host.split('.');
  return labels.length <= 2 ? host : labels.slice(-2).join('.');
}

/** Build the origin for a host, choosing the scheme local development actually serves. */
function originOf(host: string, port: number | undefined): string {
  const scheme = isLocalHost(host) ? 'http' : 'https';
  return port === undefined ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
}

/** Resolve one role from an explicit value, falling back to a subdomain of the apex. */
function resolveOne(
  role: HostRole,
  configured: string | undefined,
  derivedHost: string | undefined,
): ResolvedHost | undefined {
  const explicit = parseHost(configured);
  if (explicit) {
    return { role, host: explicit.host, origin: originOf(explicit.host, explicit.port) };
  }
  if (derivedHost === undefined) return undefined;
  return { role, host: derivedHost, origin: originOf(derivedHost, undefined) };
}

/**
 * Resolve the whole host contract from configuration.
 *
 * @remarks
 * The derivation rules, in full:
 *
 * | Role          | Explicit variable                           | Derived when unset            |
 * | ------------- | ------------------------------------------- | ----------------------------- |
 * | apex          | `PUBLIC_ROOT_DOMAIN`                        | {@link apexOf} the app URL    |
 * | `app`         | `WEB_URL` / `NEXT_PUBLIC_APP_URL`           | the apex itself               |
 * | `api`         | `API_URL` / `NEXT_PUBLIC_API_URL`           | `api.<apex>`                  |
 * | `admin`       | `ADMIN_URL`                                 | `admin.<apex>`                |
 * | `brief`       | `PUBLIC_BRIEF_HOST` / `NEXT_PUBLIC_BRIEF_HOST` | `briefs.<apex>`            |
 * | `athena-mail` | `ATHENA_INBOUND_MAIL_HOST`                  | **never** — stays absent      |
 *
 * `athena-mail` is never derived because a derived value would be a claim that a host accepts
 * mail. It does not: accepting mail requires MX records at a provider that has verified the
 * domain (ACH-22). Silently pointing Athena's inbox at `mail.<apex>` because nobody set the
 * variable would make every inbound message bounce while the config looked healthy. Absent is
 * the honest answer, and callers handle it — that is what {@link requireHost} is for.
 *
 * `passkeyRpId` defaults to the apex, which is correct for a fresh deployment and **dangerous
 * for an existing one**: a WebAuthn credential is bound to the RP id it was created under, so
 * changing this value makes every existing passkey unusable and, in a passkey-only product,
 * locks users out. Production pins `BETTER_AUTH_PASSKEY_RP_ID` explicitly and changes it only
 * via the ordered migration in `docs/engineering/domain-cutover.md` §5.
 *
 * @param source - Values read from the caller's environment.
 * @returns The resolved contract; roles with nothing to resolve from are absent.
 *
 * @example
 * ```ts
 * const config = resolveHostConfig({ rootDomain: 'docket.place' });
 * config.hosts.api?.origin; // 'https://api.docket.place'  (derived)
 * ```
 */
export function resolveHostConfig(source: HostEnvSource): HostConfig {
  const app = parseHost(source.appUrl);
  const explicitRoot = parseHost(source.rootDomain);
  const rootDomain = explicitRoot?.host ?? (app ? apexOf(app.host) : undefined);

  const under = (subdomain: string): string | undefined =>
    rootDomain === undefined ? undefined : `${subdomain}.${rootDomain}`;

  const hosts: Partial<Record<HostRole, ResolvedHost>> = {};
  const assign = (role: HostRole, resolved: ResolvedHost | undefined): void => {
    if (resolved) hosts[role] = resolved;
  };

  assign('app', resolveOne('app', source.appUrl, rootDomain));
  assign('api', resolveOne('api', source.apiUrl, under(DEFAULT_API_SUBDOMAIN)));
  assign('admin', resolveOne('admin', source.adminUrl, under(DEFAULT_ADMIN_SUBDOMAIN)));
  assign('brief', resolveOne('brief', source.briefHost, under(DEFAULT_BRIEF_SUBDOMAIN)));
  assign('athena-mail', resolveOne('athena-mail', source.athenaInboundMailHost, undefined));

  const supportConfigured = source.supportEmail?.trim();
  const supportEmail =
    supportConfigured !== undefined && supportConfigured.length > 0
      ? supportConfigured.toLowerCase()
      : rootDomain === undefined
        ? undefined
        : `${DEFAULT_SUPPORT_MAILBOX}@${rootDomain}`;

  return {
    rootDomain,
    hosts,
    passkeyRpId: parseHost(source.passkeyRpId)?.host ?? rootDomain,
    supportEmail,
    customDomainTarget: parseHost(source.customDomainTarget)?.host ?? hosts.brief?.host,
  };
}

/**
 * The resolved host for a role, or `undefined` when nothing is configured for it.
 *
 * @param config - A resolved contract.
 * @param role - The role to look up.
 * @returns The resolved host, or `undefined`.
 */
export function resolveHost(config: HostConfig, role: HostRole): ResolvedHost | undefined {
  return config.hosts[role];
}

/** The environment variable a caller should be told to set when a role has no host. */
const ROLE_VARIABLE: Readonly<Record<HostRole, string>> = {
  app: 'WEB_URL (or NEXT_PUBLIC_APP_URL in the browser)',
  api: 'API_URL (or NEXT_PUBLIC_API_URL in the browser)',
  admin: 'ADMIN_URL',
  brief: 'PUBLIC_BRIEF_HOST',
  'athena-mail': 'ATHENA_INBOUND_MAIL_HOST',
};

/**
 * The resolved host for a role, failing loudly and by name when it is unconfigured.
 *
 * @remarks
 * For a feature that cannot proceed without a host — serving a published brief, addressing
 * Athena's inbox — this is the call to make. The thrown message names the variable to set and
 * the fallback apex that would have derived it, because "host not configured" on its own costs
 * an operator a search through three packages.
 *
 * @param config - A resolved contract.
 * @param role - The role that must be present.
 * @returns The resolved host.
 * @throws {Error} When the role has no host and none could be derived.
 */
export function requireHost(config: HostConfig, role: HostRole): ResolvedHost {
  const resolved = config.hosts[role];
  if (resolved) return resolved;
  throw new Error(
    `No host is configured for the "${role}" role. Set ${ROLE_VARIABLE[role]}` +
      (role === 'athena-mail'
        ? ' — it is never derived, because a derived mail host would have no MX records and every inbound message would bounce.'
        : ', or set PUBLIC_ROOT_DOMAIN so it can be derived from the product apex.'),
  );
}

/**
 * The origin for a role, failing the same way {@link requireHost} does.
 *
 * @param config - A resolved contract.
 * @param role - The role to build an origin for.
 * @returns The origin, e.g. `https://briefs.docket.place`.
 * @throws {Error} When the role has no host.
 */
export function requireOrigin(config: HostConfig, role: HostRole): string {
  return requireHost(config, role).origin;
}

/**
 * Whether `host` is `apex` itself or a subdomain of it.
 *
 * @remarks
 * Compares whole labels, so `notdocket.place` is not under `docket.place` — a suffix test
 * would say it is, and that is the bug that lets an attacker-controlled lookalike pass an
 * isolation check.
 *
 * @param host - The hostname to test.
 * @param apex - The apex to test against.
 * @returns `true` when `host` sits at or under `apex`.
 */
export function isUnderApex(host: string, apex: string): boolean {
  return host === apex || host.endsWith(`.${apex}`);
}

/**
 * Assert that every web-serving host sits on the product apex.
 *
 * @remarks
 * This is GEN-25 ("no user-facing Docket or Athena web URL may remain under the studio apex")
 * expressed as an invariant instead of a denylist. A denylist would have to name the old domain
 * in production source, which is the very thing the requirement forbids and the policy test
 * bans; and it would only ever catch the one domain someone remembered to write down. Requiring
 * every web host to sit under the configured apex catches a half-applied cutover — the case that
 * actually happens, where `WEB_URL` moved and `ADMIN_URL` did not.
 *
 * The mail host is exempt by design: GEN-25's single stated exception is the interim Athena
 * receiving domain, which may legitimately sit off the apex until the final domain lands.
 *
 * @param config - A resolved contract.
 * @throws {Error} When the apex is unset, or any web host sits outside it.
 */
export function assertHostConfigIsolated(config: HostConfig): void {
  if (config.rootDomain === undefined) {
    throw new Error(
      'Host isolation cannot be checked: no product apex is configured. Set PUBLIC_ROOT_DOMAIN.',
    );
  }
  const apex = config.rootDomain;
  const strays = WEB_HOST_ROLES.map((role) => config.hosts[role]).filter(
    (resolved): resolved is ResolvedHost =>
      resolved !== undefined && !isUnderApex(resolved.host, apex),
  );
  if (strays.length > 0) {
    const detail = strays.map((s) => `${s.role}=${s.host}`).join(', ');
    throw new Error(
      `Host isolation failed: ${detail} ${strays.length === 1 ? 'is' : 'are'} not under the ` +
        `configured apex "${apex}". Every user-facing Docket host must sit on the product ` +
        'domain (GEN-25); the Athena inbound-mail host is the only permitted exception.',
    );
  }
}

/**
 * Resolve the host contract from the browser-visible environment.
 *
 * @remarks
 * Every read is a literal `process.env['NEXT_PUBLIC_…']` because that is the only form Next.js
 * statically inlines into the client bundle; a computed key would resolve to `undefined` in the
 * browser. This is the entry point any web/admin module should use — it is why no component
 * needs to know a hostname.
 *
 * @returns The resolved contract as the browser sees it.
 *
 * @example
 * ```ts
 * // apps/web/src/lib/support-contact.ts
 * const SUPPORT_EMAIL = requireSupportEmail(browserHostConfig());
 * ```
 */
export function browserHostConfig(): HostConfig {
  return resolveHostConfig({
    rootDomain: process.env['NEXT_PUBLIC_ROOT_DOMAIN'],
    appUrl: process.env['NEXT_PUBLIC_APP_URL'],
    apiUrl: process.env['NEXT_PUBLIC_API_URL'],
    briefHost: process.env['NEXT_PUBLIC_BRIEF_HOST'],
    passkeyRpId: process.env['NEXT_PUBLIC_PASSKEY_RP_ID'],
    supportEmail: process.env['NEXT_PUBLIC_SUPPORT_EMAIL'],
  });
}

/**
 * The published support address, failing loudly and by name when it cannot be resolved.
 *
 * @remarks
 * The privacy and terms pages print this address, so an empty value would ship a broken
 * `mailto:` to every visitor. Failing the build instead is the house "config fail-fast" rule,
 * and it cannot fire in a real deployment: `NEXT_PUBLIC_APP_URL` is a required client variable,
 * and its apex derives the address.
 *
 * @param config - A resolved contract.
 * @returns The support address, e.g. `support@docket.place`.
 * @throws {Error} When neither an explicit address nor an apex is configured.
 */
export function requireSupportEmail(config: HostConfig): string {
  if (config.supportEmail === undefined) {
    throw new Error(
      'No support address is configured. Set NEXT_PUBLIC_SUPPORT_EMAIL, or set ' +
        'NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_ROOT_DOMAIN so the address can be derived from the ' +
        'product apex.',
    );
  }
  return config.supportEmail;
}
