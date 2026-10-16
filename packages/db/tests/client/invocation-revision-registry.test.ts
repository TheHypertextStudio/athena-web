import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { prepareBlueprintRetainedFixture } from '../fixtures/work-template-blueprint-migration';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';

it('expands a private revision registry without activating any retained schedule', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    await prepareBlueprintRetainedFixture(database, options);
    await migrateWithWorkTemplateCheckpoint(database, options);
    const [registry] = await migrationRows<{ exists: boolean }>(
      database,
      sql`select to_regclass('work_template_invocation_revision') is not null as exists`,
    );
    expect(registry?.exists).toBe(true);
    const [activated] = await migrationRows<{ count: number }>(
      database,
      sql`select count(*)::integer as count from recurrence_series_revision where schedule_draft is not null`,
    );
    expect(activated?.count).toBe(0);
  } finally {
    await client.close();
  }
});
