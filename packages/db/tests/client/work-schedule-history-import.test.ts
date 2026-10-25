import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import { prepareBlueprintRetainedFixture } from '../fixtures/work-template-blueprint-migration';

it('automatically prepares terminal history while keeping current runs explicitly nonexecuting', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const fixture = await prepareBlueprintRetainedFixture(database, options);
    await database.execute(
      sql`update process_instance set status='completed',completed_at='2026-10-21' where revision_id=${fixture.forestRevisionId}`,
    );
    await database.execute(
      sql`update process_occurrence set status='completed' where id in(select occurrence_id from process_instance where revision_id=${fixture.forestRevisionId})`,
    );
    await migrateWithWorkTemplateCheckpoint(database, options);
    const [history] = await migrationRows<{ receipt: unknown }>(
      database,
      sql`select imported_history_receipt as receipt from process_occurrence where historical_archive->'instance'->>'revision_id'=${fixture.forestRevisionId}`,
    );
    expect(history?.receipt).toMatchObject({
      kind: 'imported_history',
      execution: 'nonexecuting',
      continuation: 'never',
      referenceCount: 3,
    });
    const [unchanged] = await migrationRows<{ accepted: unknown; draft: unknown; count: number }>(
      database,
      sql`select accepted_claim as accepted,(select schedule_draft from recurrence_series_revision where id=o.series_revision_id) as draft,(select count(*)::integer from process_occurrence) as count from process_occurrence o where historical_archive->'instance'->>'revision_id'=${fixture.forestRevisionId}`,
    );
    expect(unchanged).toEqual({ accepted: null, draft: null, count: 1 });
    await migrateWithWorkTemplateCheckpoint(database, options);
    const [again] = await migrationRows<{ receipt: unknown }>(
      database,
      sql`select imported_history_receipt as receipt from process_occurrence where historical_archive->'instance'->>'revision_id'=${fixture.forestRevisionId}`,
    );
    expect(again).toEqual(history);
  } finally {
    await client.close();
  }
});

it('records a stable retryable review for active runs, then prepares only after terminal completion', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const fixture = await prepareBlueprintRetainedFixture(database, options);
    await migrateWithWorkTemplateCheckpoint(database, options);
    const [active] = await migrationRows<{ receipt: unknown; review: unknown; status: string }>(
      database,
      sql`select imported_history_receipt as receipt,history_import_review as review,status::text from process_occurrence`,
    );
    expect(active).toEqual({
      receipt: null,
      review: {
        kind: 'history_import_review',
        revision: 1,
        execution: 'nonexecuting',
        code: 'current_run_requires_barrier',
      },
      status: 'expected',
    });
    await migrateWithWorkTemplateCheckpoint(database, options);
    expect(
      await migrationRows(
        database,
        sql`select imported_history_receipt as receipt,history_import_review as review,status::text from process_occurrence`,
      ),
    ).toEqual([active]);
    await database.execute(
      sql`update process_occurrence set status='completed' where organization_id=${fixture.organizationId}`,
    );
    await migrateWithWorkTemplateCheckpoint(database, options);
    const [terminal] = await migrationRows<{ receipt: unknown; review: unknown }>(
      database,
      sql`select imported_history_receipt as receipt,history_import_review as review from process_occurrence`,
    );
    expect(terminal?.receipt).toMatchObject({ execution: 'nonexecuting', continuation: 'never' });
    expect(terminal?.review).toBeNull();
  } finally {
    await client.close();
  }
});

it('preserves every original fact through interrupted preparation and oversized history resume', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const { prepareHistoryImportPredecessor, exerciseHistoryImportCheckpoint } =
      await import('../fixtures/work-schedule-history-import');
    const fixture = await prepareHistoryImportPredecessor(database, options);
    await exerciseHistoryImportCheckpoint(database, options, fixture);
  } finally {
    await client.close();
  }
});

it('rescans a lower-ID history insertion made after the first committed checkpoint', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const { prepareHistoryImportPredecessor, addOversizedHistory } =
      await import('../fixtures/work-schedule-history-import');
    const { backfillScheduleHistoryImports } =
      await import('../../src/work-schedule-history-import');
    const fixture = await prepareHistoryImportPredecessor(database, options);
    await options.applySqlMigrations(options.migrationsFolder);
    const lowerId = '00000000000000000000000001';
    let inserted = false;
    expect(
      await backfillScheduleHistoryImports(database, {
        batchSize: 1,
        onScheduleHistoryImportBatch: async () => {
          if (inserted) return;
          inserted = true;
          await addOversizedHistory(database, fixture, lowerId);
        },
      }),
    ).toEqual({ prepared: 2, deferred: 0 });
    const [row] = await migrationRows<{ receipt: unknown }>(
      database,
      sql`select imported_history_receipt as receipt from process_occurrence where id=${lowerId}`,
    );
    expect(row?.receipt).toMatchObject({
      referenceCount: 601,
      execution: 'nonexecuting',
      continuation: 'never',
    });
  } finally {
    await client.close();
  }
});

it('keeps changed original source deferred until the exact archived source is restored', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const { prepareHistoryImportPredecessor } =
      await import('../fixtures/work-schedule-history-import');
    const { backfillScheduleHistoryImports } =
      await import('../../src/work-schedule-history-import');
    const fixture = await prepareHistoryImportPredecessor(database, options);
    await options.applySqlMigrations(options.migrationsFolder);
    const original = await migrationRows(
      database,
      sql`select source_fingerprint,source_archive,source_archive_hash from work_template_blueprint_conversion where legacy_process_revision_id=${fixture.forestRevisionId}`,
    );
    await database.execute(
      sql`update process_task_spec set title='Changed source cannot be restamped' where step_id=${fixture.forestTaskStepId}`,
    );
    expect(await backfillScheduleHistoryImports(database)).toEqual({ prepared: 0, deferred: 1 });
    const [deferred] = await migrationRows<{ receipt: unknown; review: unknown }>(
      database,
      sql`select imported_history_receipt as receipt,history_import_review as review from process_occurrence`,
    );
    expect(deferred).toEqual({
      receipt: null,
      review: {
        kind: 'history_import_review',
        revision: 1,
        execution: 'nonexecuting',
        code: 'original_source_unproved',
      },
    });
    expect(await backfillScheduleHistoryImports(database)).toEqual({ prepared: 0, deferred: 1 });
    expect(
      await migrationRows(
        database,
        sql`select source_fingerprint,source_archive,source_archive_hash from work_template_blueprint_conversion where legacy_process_revision_id=${fixture.forestRevisionId}`,
      ),
    ).toEqual(original);
    await database.execute(
      sql`update process_task_spec s set title=original.value->>'title' from work_template_blueprint_conversion c,jsonb_array_elements(c.source_archive->'source'->'tasks') original(value) where c.legacy_process_revision_id=${fixture.forestRevisionId} and original.value->>'step_id'=s.step_id and s.step_id=${fixture.forestTaskStepId}`,
    );
    expect(await backfillScheduleHistoryImports(database)).toEqual({ prepared: 1, deferred: 0 });
    const [retried] = await migrationRows<{ review: unknown }>(
      database,
      sql`select history_import_review as review from process_occurrence`,
    );
    expect(retried?.review).toBeNull();
  } finally {
    await client.close();
  }
});
