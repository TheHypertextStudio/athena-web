import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintRetainedFixture,
} from '../fixtures/work-template-blueprint-migration';

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
it('does not infer full application from historical partial mappings or root metadata', async () => {
  expect(
    (
      await migrationRows<{ blueprint_applied_at: null }>(
        database,
        sql`select blueprint_applied_at from process_occurrence where organization_id=${fixture.organizationId}`,
      )
    )[0]?.blueprint_applied_at,
  ).toBeNull();
});
it('rejects applied markers without an explicit exact invocation', async () => {
  await expect(
    database.execute(
      sql`update process_occurrence set blueprint_invocation_id=null,blueprint_applied_at=now() where organization_id=${fixture.organizationId}`,
    ),
  ).rejects.toThrow();
});
it('rejects applied markers for private drafts or a different retained revision', async () => {
  await expect(
    database.execute(
      sql`update process_occurrence set blueprint_invocation_id=(select id from work_template_blueprint_invocation where organization_id=${fixture.organizationId} and manifest->>'kind'='pending_draft' limit 1),blueprint_applied_at=now() where organization_id=${fixture.organizationId}`,
    ),
  ).rejects.toThrow();
});
it('accepts a checked published instance once and refuses clear, restamp, or rebind', async () => {
  await database.execute(
    sql`update process_occurrence set blueprint_applied_at='2026-11-01T15:30:00Z' where organization_id=${fixture.organizationId}`,
  );
  await expect(
    database.execute(
      sql`update process_occurrence set blueprint_applied_at=null where organization_id=${fixture.organizationId}`,
    ),
  ).rejects.toThrow();
  await expect(
    database.execute(
      sql`update process_occurrence set blueprint_applied_at=blueprint_applied_at+interval '1 second' where organization_id=${fixture.organizationId}`,
    ),
  ).rejects.toThrow();
  await expect(
    database.execute(
      sql`update process_occurrence set blueprint_invocation_id=null where organization_id=${fixture.organizationId}`,
    ),
  ).rejects.toThrow();
});
