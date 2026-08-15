/**
 * Re-point the dev environment at the hostnames portless is actually serving.
 *
 * @remarks
 * ## The problem
 *
 * `.env.local` pins every URL to the canonical dev hosts — `https://docket.localhost`,
 * `https://api.docket.localhost`, `docket.localhost` for the auth cookie domain and the passkey
 * relying-party id. That is correct on a plain checkout, where portless serves exactly those.
 *
 * In a **git worktree** it is wrong. Portless derives its hostname prefix from the branch name, so
 * a worktree on `claude/menu-compliance-audit-8c5bd7` is served at
 * `https://menu-compliance-audit-8c5bd7.docket.localhost` while the environment still claims
 * `https://docket.localhost`. Nothing crashes — the pages render — but every host-sensitive
 * subsystem quietly fails:
 *
 * - the web app calls `NEXT_PUBLIC_API_URL`, which points at another worktree's API (or nothing)
 * - Better Auth rejects the request origin, because the real one is not in
 *   `BETTER_AUTH_TRUSTED_ORIGINS` / `BETTER_AUTH_ALLOWED_HOSTS`
 * - the session cookie is scoped to a domain the browser is not on
 * - the passkey ceremony fails, because the relying-party id is not a registrable suffix of the
 *   origin the browser is actually at
 *
 * The visible symptom is a 502 on sign-in, or `dev-session.ts` reporting "sign-up never reached
 * onboarding". Both read as broken auth rather than as broken configuration, which is why this
 * kept getting worked around instead of fixed.
 *
 * ## The fix
 *
 * Portless already tells each child process where it is, in `PORTLESS_URL`. This derives the
 * prefix from that one value and rewrites every env var that names a dev host, so the environment
 * describes the stack that is actually running. It is a pure host-level transform:
 *
 * ```
 * PORTLESS_URL=https://feature-x.docket.localhost
 *   https://api.docket.localhost  →  https://feature-x.api.docket.localhost
 *   docket.localhost              →  feature-x.docket.localhost
 * ```
 *
 * No branch name appears anywhere in the repo, and a plain checkout — where `PORTLESS_URL` has no
 * prefix — is a no-op, so this changes nothing outside a worktree.
 *
 * ## Usage
 *
 * Every app wraps its own `dev:app` with this, so the corrected env exists before the real dev
 * server's first tick — `next dev` reads `NEXT_PUBLIC_*` on startup, so a preload inside the
 * server process would be too late for the web and admin apps, and one mechanism for all three
 * beats two:
 *
 * ```jsonc
 * "dev:app": "tsx ../../scripts/portless-env.ts next dev"
 * "dev:app": "tsx ../../scripts/portless-env.ts tsx watch --import ./src/dev-env.ts src/server.ts"
 * ```
 *
 * The exported functions stay available for a process that would rather correct its own env in
 * place, but nothing in the repo does that: `apps/api` cannot import across its `rootDir`, which
 * is the constraint that settled the launcher form.
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The dev domain every local host hangs off. Portless prefixes it; nothing else does. */
const DEV_DOMAIN = 'docket.localhost';

/**
 * Env vars that name a dev host, either as a URL or as a bare hostname.
 *
 * @remarks
 * Enumerated rather than pattern-matched over the whole environment: a blanket
 * "rewrite anything containing docket.localhost" would also rewrite secrets, allow-lists meant to
 * stay canonical, and anything a future variable happens to embed. Adding a variable here is a
 * deliberate statement that it names *this stack's* host.
 */
const HOST_BEARING_VARS: readonly string[] = [
  'API_URL',
  'WEB_URL',
  'APP_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_APP_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'BETTER_AUTH_ALLOWED_HOSTS',
  'BETTER_AUTH_PASSKEY_RP_ID',
  'NEXT_PUBLIC_PASSKEY_RP_ID',
  'MCP_ISSUER_URL',
  'MCP_RESOURCE_URL',
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
 */
const DELIBERATELY_UNPREFIXED: readonly string[] = ['BETTER_AUTH_COOKIE_DOMAIN'];

/**
 * Read the portless hostname prefix out of `PORTLESS_URL`.
 *
 * @returns The prefix (e.g. `feature-x`), or `undefined` on a plain checkout where portless serves
 *   the bare domain and there is nothing to rewrite.
 */
export function portlessPrefix(): string | undefined {
  const raw = process.env['PORTLESS_URL'];
  if (!raw) return undefined;

  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return undefined;
  }

  if (!host.endsWith(DEV_DOMAIN)) return undefined;
  // `feature-x.docket.localhost` → `feature-x.`; `api.docket.localhost` → `api.`; `docket.localhost` → ``.
  const lead = host.slice(0, host.length - DEV_DOMAIN.length);
  if (lead === '') return undefined;

  // Portless publishes one app per sub-name (`docket`, `api.docket`, `admin.docket`) and puts the
  // branch prefix in front of all of them, so the prefix is the first label and the rest is the
  // app's own sub-name, which the canonical URLs already carry.
  const prefix = lead.replace(/\.$/, '').split('.')[0];
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

/**
 * Rewrite the current process's env so every dev host names the stack portless is serving.
 *
 * @returns The variables that changed, for logging. Empty on a plain checkout.
 */
export function applyPortlessPrefix(): readonly string[] {
  const prefix = portlessPrefix();
  if (!prefix) return [];

  const changed: string[] = [];
  for (const name of HOST_BEARING_VARS) {
    if (DELIBERATELY_UNPREFIXED.includes(name)) continue;
    const current = process.env[name];
    if (!current) continue;
    const next = prefixDevHosts(current, prefix);
    if (next === current) continue;
    process.env[name] = next;
    changed.push(name);
  }
  return changed;
}

/**
 * Launcher mode: correct the env, then run the rest of the argv as a child process.
 *
 * @remarks
 * `next dev` reads `NEXT_PUBLIC_*` on startup, so for the web app the correction has to happen in
 * the parent before the child exists. The child inherits stdio and this process mirrors its exit
 * code and signal, so `pnpm dev` and Ctrl-C behave exactly as they did without the wrapper.
 */
function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('portless-env: expected a command to run, e.g. `portless-env next dev`');
    process.exit(2);
  }

  const changed = applyPortlessPrefix();
  if (changed.length > 0) {
    console.log(
      `[portless-env] worktree stack at ${process.env['PORTLESS_URL']} — repointed ${changed.length} vars (${changed.join(', ')})`,
    );
  }

  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

// Only run the launcher when invoked directly; the preload import path must stay side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
