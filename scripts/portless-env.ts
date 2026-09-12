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
 * describes the stack that is actually running.
 *
 * The host rules themselves live in `@docket/dev-topology`, which is the only place that knows
 * what a dev host looks like or which variables name one. This file is the launcher that applies
 * them; it deliberately holds no list of its own, because the copy it used to hold had already
 * drifted from the copy in `apps/api/src/dev-env.ts`.
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
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  applyDevHostPrefix,
  checkDevTopology,
  formatTopologyFindings,
  portlessPrefix as readPortlessPrefix,
} from '@docket/dev-topology';

/**
 * Load the package-local development environment before applying a Portless prefix.
 *
 * @remarks
 * Next loads `.env.local` only after this launcher has started its child process. Without this
 * eager load, {@link applyPortlessPrefix} sees none of the host-bearing values and leaves the
 * child pointed at a different worktree's canonical hosts.
 */
function loadPackageEnv(): void {
  const envPath = resolve(process.cwd(), '.env.local');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

/**
 * Read the current package's configured Portless service name.
 *
 * @returns The `portless.name` string, or `undefined` outside a Portless package.
 */
function currentPortlessServiceName(): string | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('portless' in parsed)) return undefined;
    const portless = (parsed as { portless?: unknown }).portless;
    if (!portless || typeof portless !== 'object' || !('name' in portless)) return undefined;
    const name = (portless as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the branch hostname prefix out of this service's `PORTLESS_URL`.
 *
 * @returns The prefix (e.g. `feature-x`), or `undefined` on the service's canonical host.
 */
export function portlessPrefix(
  raw = process.env['PORTLESS_URL'],
  serviceName = currentPortlessServiceName(),
): string | undefined {
  return readPortlessPrefix(raw, serviceName);
}

/**
 * Rewrite the current process's env so every dev host names the stack portless is serving.
 *
 * @returns The variables that changed, for logging. Empty on a plain checkout.
 */
export function applyPortlessPrefix(): readonly string[] {
  const prefix = portlessPrefix();
  if (!prefix) return [];
  return applyDevHostPrefix(process.env, prefix);
}

/**
 * Launcher mode: correct the env, then run the rest of the argv as a child process.
 *
 * @remarks
 * `next dev` reads `NEXT_PUBLIC_*` on startup, so for the web app the correction has to happen in
 * the parent before the child exists. The child inherits stdio and this process mirrors its exit
 * code and signal, so `pnpm dev` and Ctrl-C behave exactly as they did without the wrapper.
 *
 * The consistency check runs after the correction and refuses to start the child when the
 * environment still describes more than one stack. Starting anyway is what turns a one-line
 * configuration problem into an afternoon of reading auth logs.
 */
function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('portless-env: expected a command to run, e.g. `portless-env next dev`');
    process.exit(2);
  }

  loadPackageEnv();
  const changed = applyPortlessPrefix();
  if (changed.length > 0) {
    console.log(
      `[portless-env] worktree stack at ${process.env['PORTLESS_URL']} — repointed ${changed.length} vars (${changed.join(', ')})`,
    );
  }

  const findings = checkDevTopology(process.env);
  if (findings.length > 0) {
    console.error(`\n[portless-env] ${formatTopologyFindings(findings)}\n`);
    process.exit(1);
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
