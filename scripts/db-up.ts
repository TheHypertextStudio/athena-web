/**
 * `pnpm db:up` — bring up the local database, picking the right backend from the
 * `DATABASE_URL` scheme.
 *
 * @remarks
 * The data layer ({@link file://../packages/db/src/client.ts}) selects its driver from the
 * `DATABASE_URL` scheme, and the repo ships two first-class local modes (see `.env.example`):
 *
 *   - `pglite:` — embedded, in-process Postgres (PGlite) under `.data/`. This is the
 *     zero-service / "no external accounts" default: there is NO server to start, so
 *     `db:up` is a no-op. Forcing `docker compose up` here would fail on machines with no
 *     Docker daemon and is pointless (PGlite has no container).
 *   - `postgres:` / `postgresql:` / `neon:` — a real TCP Postgres. Locally that is the
 *     Docker container from `docker-compose.yml`, so `db:up` starts and waits on it.
 *
 * Wiring this scheme check HERE (rather than unconditionally `docker compose up`) is what
 * lets `db:migrate` and `dev` — both of which depend on `db:up` in `turbo.json` — run in
 * the embedded PGlite mode with no Docker daemon, while the Docker path is preserved
 * verbatim for the Postgres mode.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** Bring up the DB backend implied by `DATABASE_URL`; no-op for the embedded `pglite:` mode. */
function main(): void {
  const url = process.env['DATABASE_URL'] ?? '';

  if (url.startsWith('pglite:')) {
    console.log('✓ db:up skipped — DATABASE_URL is embedded PGlite (no service to start).');
    return;
  }

  // Real TCP Postgres (local Docker, or a remote Neon/Postgres URL). Start the local
  // container and wait for its healthcheck. Inherit stdio so compose output streams through.
  const result = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'postgres'], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`db:up: failed to invoke docker compose: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
