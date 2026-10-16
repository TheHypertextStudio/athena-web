import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { genId } from '../../src/id';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillInvocationRevisionAliases } from '../../src/invocation-revision-backfill';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  seedRetainedSingleTask,
} from '../fixtures/work-template-blueprint-migration';
async function fixture(beforeArchives = false) {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  const source = await prepareBlueprintRetainedFixture(database, options);
  await withMigrationPrefix(
    options.migrationsFolder,
    beforeArchives ? '0159_retained_root_resolutions' : '0164_schedule_native_date_undo',
    (folder) =>
      migrateWithWorkTemplateCheckpoint(database, { ...options, migrationsFolder: folder }),
  );
  await options.applySqlMigrations(options.migrationsFolder);
  return { client, database, options, source };
}
it('resumes committed aliases and takes current metadata ownership once without rewriting original proof', async () => {
  const f = await fixture();
  try {
    const stop = new Error('Interrupted alias observer');
    await expect(
      backfillInvocationRevisionAliases(f.database, {
        batchSize: 1,
        onInvocationRevisionBatch: (progress) => {
          if (progress.revisions) throw stop;
        },
      }),
    ).rejects.toBe(stop);
    const [alias] = await migrationRows<{
      head: string;
      id: string;
      fingerprint: string;
      hash: string;
    }>(
      f.database,
      sql`select head_id as head,id,original_source_fingerprint as fingerprint,source_archive_hash as hash from work_template_invocation_revision`,
    );
    if (!alias) throw new Error('Missing committed alias');
    await f.database.execute(
      sql`update process_definition set name='Current metadata between batches',description=null where id=${alias.head}`,
    );
    await backfillInvocationRevisionAliases(f.database, { batchSize: 1 });
    const [head] = await migrationRows<{ name: string; revision: number; owned: boolean }>(
      f.database,
      sql`select name,revision,canonical_authoring_at is not null as owned from work_template_invocation_head where id=${alias.head}`,
    );
    expect(head).toMatchObject({ name: 'Current metadata between batches', owned: true });
    const snapshot = await migrationRows(
      f.database,
      sql`select * from work_template_invocation_revision order by id`,
    );
    await expect(backfillInvocationRevisionAliases(f.database)).resolves.toEqual({
      revisions: 0,
      heads: 0,
      deferred: 0,
    });
    expect(
      await migrationRows(
        f.database,
        sql`select * from work_template_invocation_revision order by id`,
      ),
    ).toEqual(snapshot);
    await expect(
      f.database.execute(
        sql`update process_definition set name='Stale overwrite' where id=${alias.head}`,
      ),
    ).rejects.toThrow();
    const [after] = await migrationRows(
      f.database,
      sql`select head_id as head,id,original_source_fingerprint as fingerprint,source_archive_hash as hash from work_template_invocation_revision where id=${alias.id}`,
    );
    expect(after).toEqual(alias);
    await expect(
      f.database.execute(
        sql`update work_template_invocation_revision set number=number+10 where id=${alias.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      f.database.execute(sql`delete from work_template_invocation_revision where id=${alias.id}`),
    ).rejects.toThrow();
    await expect(
      f.database.execute(
        sql`update work_template_invocation_head set canonical_authoring_at=null,revision=revision+1 where id=${alias.head}`,
      ),
    ).rejects.toThrow();
    await expect(
      f.database.execute(
        sql`insert into work_template_invocation_revision select id,organization_id,head_id,invocation_id,number+1,state,creation_mode,origin,original_source_fingerprint,source_archive_hash,projection,created_by,created_at,published_at from work_template_invocation_revision where id=${alias.id}`,
      ),
    ).rejects.toMatchObject({ cause: { constraint: 'invocation_revision_proof' } });
    const [other] = await migrationRows<{ invocation: string }>(
      f.database,
      sql`select invocation_id as invocation from work_template_invocation_revision where head_id<>${alias.head} limit 1`,
    );
    if (!other) throw new Error('Missing foreign head revision');
    await expect(
      f.database.execute(
        sql`update work_template_invocation_head set draft_invocation_id=${other.invocation},revision=revision+1 where id=${alias.head}`,
      ),
    ).rejects.toMatchObject({ cause: { constraint: 'invocation_head_draft_revision' } });
  } finally {
    await f.client.close();
  }
});
it('retains unproved original ordering without registering canonical ownership', async () => {
  const f = await fixture(true);
  try {
    await f.database.execute(
      sql`update process_definition set name='Unproved root order after header change' where id=(select definition_id from process_revision where id=${f.source.forestRevisionId})`,
    );
    const result = await backfillInvocationRevisionAliases(f.database, { batchSize: 1 });
    expect(result.deferred).toBeGreaterThan(0);
    const [row] = await migrationRows(
      f.database,
      sql`select h.canonical_authoring_at as owned,(select count(*)::integer from work_template_invocation_revision v where v.head_id=h.id) as aliases from work_template_invocation_head h where h.id=(select definition_id from process_revision where id=${f.source.forestRevisionId})`,
    );
    expect(row).toEqual({ owned: null, aliases: 0 });
  } finally {
    await f.client.close();
  }
});
it('preserves an empty pending alias without inventing a publication or schedule draft', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const f = await prepareBlueprintRetainedFixture(database, options);
    const id = genId();
    await database.execute(
      sql`insert into process_revision(id,organization_id,definition_id,number,creation_mode,published_at) select ${id},organization_id,definition_id,4,'when_ready',null from process_revision where id=${f.forestRevisionId}`,
    );
    await migrateWithWorkTemplateCheckpoint(database, options);
    const [row] = await migrationRows(
      database,
      sql`select v.state,v.number,v.projection,h.published_invocation_id=c.invocation_id as original_publication from work_template_invocation_revision v join work_template_invocation_head h on h.id=v.head_id join work_template_blueprint_conversion c on c.legacy_process_revision_id=${f.forestRevisionId} where v.id=${id}`,
    );
    expect(row).toEqual({
      state: 'pending_draft',
      number: 4,
      projection: { revision: 1, steps: [] },
      original_publication: true,
    });
  } finally {
    await client.close();
  }
});
it('permits whole workspace purge with registered private revision history', async () => {
  const f = await fixture();
  try {
    await backfillInvocationRevisionAliases(f.database);
    await f.database.execute(sql`delete from organization where id=${f.source.organizationId}`);
    const [row] = await migrationRows<{ count: number }>(
      f.database,
      sql`select count(*)::integer as count from work_template_invocation_revision where organization_id=${f.source.organizationId}`,
    );
    expect(row?.count).toBe(0);
  } finally {
    await f.client.close();
  }
});

it('defers a retained source with no independent conversion receipt without taking ownership', async () => {
  const f = await fixture();
  try {
    const id = await seedRetainedSingleTask(f.database, f.source);
    const result = await backfillInvocationRevisionAliases(f.database);
    expect(result.deferred).toBe(1);
    const [row] = await migrationRows<{ owned: Date | null; aliases: number }>(
      f.database,
      sql`select h.canonical_authoring_at as owned,(select count(*)::integer from work_template_invocation_revision v where v.head_id=h.id) as aliases from work_template_invocation_head h join process_revision r on r.definition_id=h.id where r.id=${id}`,
    );
    expect(row).toEqual({ owned: null, aliases: 0 });
    await expect(
      f.database.execute(
        sql`update process_definition set name='Still legacy-owned' where id=(select definition_id from process_revision where id=${id})`,
      ),
    ).resolves.toBeDefined();
  } finally {
    await f.client.close();
  }
});
