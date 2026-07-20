/**
 * Drizzle Kit config — schema location, migration output, and migrate credentials.
 *
 * @remarks
 * `db:generate` emits SQL from `./src/schema` without a connection. Migrations run
 * over the UNPOOLED string (`DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL`).
 * PGlite migrations are applied by `src/migrate.ts` (the offline runner) rather than
 * `drizzle-kit migrate`, so this config targets the postgres dialect uniformly.
 */
import { defineConfig } from 'drizzle-kit';

import { resolveDatabaseUrl } from './drizzle-url';

const url = resolveDatabaseUrl();
if (!url) {
  throw new Error(
    'DATABASE_URL (or DATABASE_URL_UNPOOLED) is required for drizzle-kit — see .env.example.',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
});
