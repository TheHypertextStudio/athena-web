import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';

import { fullSchema } from '../../src/client';
import { exerciseWorkTemplateMigration } from '../fixtures/work-template-migration';

it('preserves populated work and private drafts through an interrupted identity backfill', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  try {
    const result = await exerciseWorkTemplateMigration(database, {
      migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
      applySqlMigrations: (folder) => migrate(database, { migrationsFolder: folder }),
    });
    expect(result).toMatchObject({ workItems: 8, privateDrafts: 2, publishedBaselines: 1 });
  } finally {
    await client.close();
  }
});
