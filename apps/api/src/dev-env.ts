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
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenvx from '@dotenvx/dotenvx';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  dotenvx.config({ path: envPath, overload: true, quiet: true });
}

/** Host-bearing values that must follow the API worktree's Portless prefix. */
const PORTLESS_HOST_VALUES: readonly string[] = [
  'API_URL',
  'WEB_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_APP_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'BETTER_AUTH_ALLOWED_HOSTS',
  'BETTER_AUTH_PASSKEY_RP_ID',
  'NEXT_PUBLIC_PASSKEY_RP_ID',
];

/** Reapply this API worktree's Portless host prefix after a watched env reload. */
function reapplyPortlessPrefix(): void {
  const rawUrl = process.env['PORTLESS_URL'];
  if (!rawUrl) return;

  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return;
  }

  const serviceHost = 'api.docket.localhost';
  if (!host.endsWith(`.${serviceHost}`)) return;
  const prefix = host.slice(0, -(serviceHost.length + 1));
  if (!prefix) return;

  const hostPattern = /(^|[/@,\s])((?:[\w-]+\.)*)docket\.localhost/g;
  for (const name of PORTLESS_HOST_VALUES) {
    const current = process.env[name];
    if (!current) continue;
    process.env[name] = current.replace(hostPattern, (_match, lead: string, subNames: string) =>
      subNames.startsWith(`${prefix}.`) ? _match : `${lead}${prefix}.${subNames}docket.localhost`,
    );
  }
}

// `tsx watch` restarts after `.env.local` changes. Its local reload intentionally wins over the
// parent process, so restore the branch-specific endpoints before the API imports its env schema.
reapplyPortlessPrefix();
