import { backfillInvocationRevisionAliases } from '../../src/invocation-revision-backfill';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { exercisePrivateIdentityNamespace } from '../fixtures/work-template-identity-namespace';
it('reserves source identities in bounded committed batches while unresolved collisions stay explicitly non-adoptable', async () => {
  const client = new PGlite('memory://'),
    database = drizzle(client, { schema: fullSchema }),
    folder = resolve(import.meta.dirname, '../../drizzle');
  try {
    await exercisePrivateIdentityNamespace(database, {
      predecessor: () =>
        withMigrationPrefix(folder, '0178_schedule_root_placement_registration', (prefix) =>
          migrateWithWorkTemplateCheckpoint(database, {
            migrationsFolder: prefix,
            applySqlMigrations: (target) => migrate(database, { migrationsFolder: target }),
          }),
        ),
      registration: () => backfillInvocationRevisionAliases(database, { batchSize: 1 }),
      expansion: () =>
        withMigrationPrefix(folder, '0179_private_definition_identity_namespace', (prefix) =>
          migrate(database, { migrationsFolder: prefix }),
        ),
    });
  } finally {
    await client.close();
  }
});
