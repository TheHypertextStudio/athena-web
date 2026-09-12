/**
 * Check that the host-bearing environment describes one coherent stack, and say so when it does
 * not.
 *
 * @remarks
 * This is the part that pays for the rest of the package. A disagreement between two of these
 * values never announces itself as a configuration problem: the app boots, pages render, and then
 * a request is rejected as `Invalid origin`, or the browser silently drops a `Set-Cookie` and
 * sign-up ends with no session and no error, or a passkey ceremony fails with
 * `CHALLENGE_NOT_FOUND`, or the web app calls a different checkout's API and shows data nobody
 * created. Each of those has been diagnosed as an auth bug more than once.
 *
 * Every check below names the two values that disagree and the symptom their disagreement
 * produces, so the diagnosis is the message rather than an afternoon.
 */
import type { EnvBag } from './hosts';

/** One disagreement between host-bearing values. */
export interface TopologyFinding {
  /** The variables involved, in the order the problem reads. */
  readonly variables: readonly string[];
  /** What disagrees, with the offending values. */
  readonly problem: string;
  /** The symptom this produces at runtime, so it can be recognised from the outside. */
  readonly consequence: string;
}

function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function list(value: string | undefined): readonly string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Whether `suffix` is the host itself or a dot-separated parent of it. */
function isRegistrableSuffix(suffix: string, hostname: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function checkBrowserServerAgreement(env: EnvBag): readonly TopologyFinding[] {
  const pairs: readonly (readonly [string, string])[] = [
    ['API_URL', 'NEXT_PUBLIC_API_URL'],
    ['APP_URL', 'NEXT_PUBLIC_APP_URL'],
    ['BETTER_AUTH_PASSKEY_RP_ID', 'NEXT_PUBLIC_PASSKEY_RP_ID'],
  ];
  const findings: TopologyFinding[] = [];
  for (const [server, browser] of pairs) {
    const a = env[server];
    const b = env[browser];
    if (!a || !b || a === b) continue;
    findings.push({
      variables: [server, browser],
      problem: `${server}="${a}" but ${browser}="${b}"`,
      consequence:
        'the server and the browser address different stacks, so requests that work server-side fail in the page',
    });
  }
  return findings;
}

function checkPasskeyRelyingParty(env: EnvBag): readonly TopologyFinding[] {
  const rpId = env['BETTER_AUTH_PASSKEY_RP_ID'];
  if (!rpId) return [];
  const findings: TopologyFinding[] = [];
  for (const name of ['APP_URL', 'API_URL'] as const) {
    const hostname = hostnameOf(env[name]);
    if (!hostname || isRegistrableSuffix(rpId, hostname)) continue;
    findings.push({
      variables: ['BETTER_AUTH_PASSKEY_RP_ID', name],
      problem: `relying-party id "${rpId}" is not a registrable suffix of ${name}'s host "${hostname}"`,
      consequence:
        'the browser refuses the passkey ceremony, which surfaces as CHALLENGE_NOT_FOUND or a sign-up that never leaves the form',
    });
  }
  return findings;
}

function checkCookieDomain(env: EnvBag): readonly TopologyFinding[] {
  const domain = env['BETTER_AUTH_COOKIE_DOMAIN'];
  if (!domain) return [];
  const findings: TopologyFinding[] = [];
  for (const name of ['APP_URL', 'API_URL'] as const) {
    const hostname = hostnameOf(env[name]);
    if (!hostname || isRegistrableSuffix(domain, hostname)) continue;
    findings.push({
      variables: ['BETTER_AUTH_COOKIE_DOMAIN', name],
      problem: `cookie domain "${domain}" is not a parent of ${name}'s host "${hostname}"`,
      consequence:
        'the API cannot set a cookie the app can read, so the browser drops Set-Cookie silently and the session never exists',
    });
  }
  return findings;
}

function checkTrustedOrigins(env: EnvBag): readonly TopologyFinding[] {
  const appOrigin = originOf(env['APP_URL']);
  const trusted = list(env['BETTER_AUTH_TRUSTED_ORIGINS']);
  if (!appOrigin || trusted.length === 0) return [];
  if (trusted.some((entry) => originOf(entry) === appOrigin)) return [];
  return [
    {
      variables: ['BETTER_AUTH_TRUSTED_ORIGINS', 'APP_URL'],
      problem: `APP_URL's origin "${appOrigin}" is absent from BETTER_AUTH_TRUSTED_ORIGINS="${trusted.join(',')}"`,
      consequence: 'the API rejects the app\'s requests with "Invalid origin"',
    },
  ];
}

function checkAllowedHosts(env: EnvBag): readonly TopologyFinding[] {
  const allowed = list(env['BETTER_AUTH_ALLOWED_HOSTS']);
  if (allowed.length === 0) return [];
  const findings: TopologyFinding[] = [];
  for (const name of ['APP_URL', 'API_URL'] as const) {
    const host = hostOf(env[name]);
    if (!host || allowed.includes(host)) continue;
    findings.push({
      variables: ['BETTER_AUTH_ALLOWED_HOSTS', name],
      problem: `${name}'s host "${host}" is absent from BETTER_AUTH_ALLOWED_HOSTS="${allowed.join(',')}"`,
      consequence: 'the API resolves its base URL to a host it is not serving, so auth routes 404',
    });
  }
  return findings;
}

function checkDerivedUrls(env: EnvBag): readonly TopologyFinding[] {
  const findings: TopologyFinding[] = [];

  const authHost = hostOf(env['BETTER_AUTH_URL']);
  const apiHost = hostOf(env['API_URL']);
  if (authHost && apiHost && authHost !== apiHost) {
    findings.push({
      variables: ['BETTER_AUTH_URL', 'API_URL'],
      problem: `BETTER_AUTH_URL is on "${authHost}" but API_URL is on "${apiHost}"`,
      consequence: 'auth callbacks return to a host the API is not listening on',
    });
  }

  const appOrigin = originOf(env['APP_URL']);
  const loginOrigin = originOf(env['OIDC_LOGIN_PAGE_URL']);
  if (appOrigin && loginOrigin && appOrigin !== loginOrigin) {
    findings.push({
      variables: ['OIDC_LOGIN_PAGE_URL', 'APP_URL'],
      problem: `OIDC_LOGIN_PAGE_URL is on "${loginOrigin}" but the app is on "${appOrigin}"`,
      consequence: "an OIDC authorize request hands the person to another checkout's sign-in page",
    });
  }

  const mcpOrigins = list(env['MCP_ALLOWED_ORIGINS']);
  if (appOrigin && mcpOrigins.length > 0 && !mcpOrigins.some((o) => originOf(o) === appOrigin)) {
    findings.push({
      variables: ['MCP_ALLOWED_ORIGINS', 'APP_URL'],
      problem: `the app origin "${appOrigin}" is absent from MCP_ALLOWED_ORIGINS="${mcpOrigins.join(',')}"`,
      consequence: 'the MCP surface refuses the app as a cross-origin caller',
    });
  }

  return findings;
}

const CHECKS: readonly ((env: EnvBag) => readonly TopologyFinding[])[] = [
  checkBrowserServerAgreement,
  checkPasskeyRelyingParty,
  checkCookieDomain,
  checkTrustedOrigins,
  checkAllowedHosts,
  checkDerivedUrls,
];

/**
 * Find every disagreement in a host-bearing environment.
 *
 * @param env - The environment to inspect, normally `process.env`.
 * @returns One finding per disagreement, empty when the environment is coherent.
 */
export function checkDevTopology(env: EnvBag): readonly TopologyFinding[] {
  return CHECKS.flatMap((check) => check(env));
}

/** Render findings as a message that names each disagreement and what it will cause. */
export function formatTopologyFindings(findings: readonly TopologyFinding[]): string {
  const lines = findings.map((finding) => `  - ${finding.problem}\n    → ${finding.consequence}`);
  return [
    `The development environment describes ${findings.length === 1 ? 'a stack that contradicts itself' : 'more than one stack at once'}:`,
    ...lines,
    '',
    'Every *.docket.localhost host resolves to 127.0.0.1, so a mismatch here does not fail as a',
    'configuration error — it fails later as broken authentication. Run `pnpm dev:doctor` for the',
    'topology this checkout should be using.',
  ].join('\n');
}

/**
 * Throw when the host-bearing environment contradicts itself.
 *
 * @param env - The environment to inspect.
 * @throws When any check finds a disagreement, with every finding named in the message.
 */
export function assertDevTopology(env: EnvBag): void {
  const findings = checkDevTopology(env);
  if (findings.length === 0) return;
  throw new Error(formatTopologyFindings(findings));
}
