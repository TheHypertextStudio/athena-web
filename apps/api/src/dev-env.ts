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
