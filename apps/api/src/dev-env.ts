/**
 * `@docket/api` — dev-only env (re)loader, run as a `tsx --import` preload.
 *
 * @remarks
 * Loads THIS app's own `.env.local` — the one in its package folder (the process cwd in dev) — with
 * `overload: true`, so a running `tsx watch` server picks up edited values on restart instead of
 * holding the environment from when `pnpm dev` first launched. Paired with
 * `tsx watch --include .env.local` (which restarts the server when that file changes), so editing
 * the env (e.g. `pnpm integrations` writing real OAuth credentials) takes effect without a manual
 * full restart. Runs before any app module, so the validated `@docket/env` contract sees fresh
 * values.
 *
 * Env is scoped **per package**: each app reads only the variables in its own folder's
 * `.env.local`, not a monorepo-wide file. `overload: true` lets the file win over any inherited
 * value, and the loader is a no-op when the file is absent (a deployed environment supplies real
 * platform env), so it never clobbers production config.
 *
 * Because that reload also wins over the correction `scripts/portless-env.ts` applied in the
 * parent, the prefix has to be reapplied here. The rules come from `@docket/dev-topology`: this
 * file used to carry its own list of host-bearing variables and its own copy of the rewrite, and
 * that list had drifted — it was missing `MCP_ISSUER_URL`, `MCP_RESOURCE_URL`,
 * `MCP_ALLOWED_ORIGINS` and `OIDC_LOGIN_PAGE_URL`, so a restarted API in a worktree issued MCP
 * tokens for the canonical origin and sent OIDC logins to another checkout's sign-in page.
 */
import { applyDevHostPrefix, assertDevTopology, portlessPrefix } from '@docket/dev-topology';
import dotenvx from '@dotenvx/dotenvx';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  dotenvx.config({ path: envPath, overload: true, quiet: true });
}

// `tsx watch` restarts after `.env.local` changes. Its local reload intentionally wins over the
// parent process, so restore the branch-specific endpoints before the API imports its env schema.
const prefix = portlessPrefix(process.env['PORTLESS_URL'], 'api.docket');
if (prefix) applyDevHostPrefix(process.env, prefix);

// Refuse to boot on a self-contradicting topology. The API is where a mismatch does its damage —
// it owns the origin allowlist, the session cookie and the passkey relying party — and every one
// of those failures reads as an auth bug rather than as the configuration problem it is.
assertDevTopology(process.env);
