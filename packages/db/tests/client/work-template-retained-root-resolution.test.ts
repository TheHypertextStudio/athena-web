import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintRetainedFixture,
} from '../fixtures/work-template-blueprint-migration';
import {
  exerciseRetainedRootResolution,
  exerciseRetainedRootRecovery,
} from '../fixtures/retained-root-resolution';
const client = new PGlite('memory://'),
  database = drizzle(client, { schema: fullSchema });
let fixture: BlueprintRetainedFixture;
beforeAll(async () => {
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  fixture = await prepareBlueprintRetainedFixture(database, options);
  await migrateWithWorkTemplateCheckpoint(database, options);
});
afterAll(async () => client.close());
it('recovers applied roots only from an exact original receipt and freezes the recovered closure', async () => {
  await exerciseRetainedRootRecovery(database, fixture);
});
it('freezes exact private original root resolutions independently of editable public state', async () => {
  await exerciseRetainedRootResolution(database, fixture);
});
