/**
 * Drizzle Kit configuration for database migrations.
 *
 * @packageDocumentation
 */

import { defineConfig } from 'drizzle-kit';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/athena';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
