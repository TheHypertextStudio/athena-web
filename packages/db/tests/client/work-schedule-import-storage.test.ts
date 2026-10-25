import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillInvocationRevisionAliases } from '../../src/invocation-revision-backfill';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import { prepareBlueprintRetainedFixture } from '../fixtures/work-template-blueprint-migration';

const client = new PGlite('memory://');
const database = drizzle(client, { schema: fullSchema });
let occurrenceId: string;
let receipt: Record<string, unknown>;
beforeAll(async () => {
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  const fixture = await prepareBlueprintRetainedFixture(database, options);
  await database.execute(
    sql`update process_instance set status='completed',completed_at='2026-10-21' where revision_id=${fixture.forestRevisionId}`,
  );
  await database.execute(
    sql`update process_occurrence set status='completed' where id in(select occurrence_id from process_instance where revision_id=${fixture.forestRevisionId})`,
  );
  await withMigrationPrefix(
    options.migrationsFolder,
    '0167_work_template_copy_reference_integrity',
    (folder) =>
      migrateWithWorkTemplateCheckpoint(database, { ...options, migrationsFolder: folder }),
  );
  await options.applySqlMigrations(options.migrationsFolder);
  await backfillInvocationRevisionAliases(database);
  const [row] = await migrationRows<{ id: string; receipt: Record<string, unknown> }>(
    database,
    sql`
    select o.id,jsonb_build_object(
      'kind','imported_history','revision',1,'execution','nonexecuting','continuation','never',
      'identity',jsonb_build_object('organizationId',o.organization_id,'occurrenceId',o.id,'seriesId',o.series_id,
        'seriesRevisionId',o.series_revision_id,'instanceAlias',o.legacy_instance_id,'externalOccurrenceKey',o.external_occurrence_key,
        'scheduledFor',o.scheduled_for::text,'originalScheduledFor',o.original_scheduled_for::text,'runKind',o.run_kind,'status',o.status::text),
      'source',jsonb_build_object('kind','retained_source','revision',1,'revisionAlias',v.id,'invocationId',v.invocation_id,
        'originalFingerprint',v.original_source_fingerprint,'archiveHash',v.source_archive_hash),
      'historicalArchiveHash',o.historical_archive_hash,'referenceCount',jsonb_array_length(o.historical_archive->'references'),
      'reviewIssueCount',jsonb_array_length(o.historical_archive->'references'),'originalRootRefs',o.blueprint_root_refs) as receipt
    from process_occurrence o join work_template_invocation_revision v on v.invocation_id=o.blueprint_invocation_id and v.organization_id=o.organization_id
    where v.id=${fixture.forestRevisionId}`,
  );
  if (!row) throw new Error('The original archived occurrence must exist.');
  occurrenceId = row.id;
  receipt = row.receipt;
});
afterAll(async () => client.close());

const invalidReceipts: readonly (readonly [
  string,
  (value: Record<string, unknown>) => Record<string, unknown>,
])[] = [
  [
    'another tenant',
    (value: Record<string, unknown>) => ({
      ...value,
      identity: {
        ...(value['identity'] as Record<string, unknown>),
        organizationId: 'foreign-tenant',
      },
    }),
  ],
  [
    'another source alias',
    (value: Record<string, unknown>) => ({
      ...value,
      source: {
        ...(value['source'] as Record<string, unknown>),
        revisionAlias: 'foreign-revision',
      },
    }),
  ],
  ...(
    [
      'occurrenceId',
      'seriesId',
      'seriesRevisionId',
      'instanceAlias',
      'externalOccurrenceKey',
      'scheduledFor',
      'originalScheduledFor',
    ] as const
  ).map(
    (field) =>
      [
        `another ${field}`,
        (value: Record<string, unknown>) => ({
          ...value,
          identity: {
            ...(value['identity'] as Record<string, unknown>),
            [field]: field.includes('For') ? '2001-02-03' : 'foreign-identity',
          },
        }),
      ] as const,
  ),
  ...(['invocationId', 'originalFingerprint', 'archiveHash'] as const).map(
    (field) =>
      [
        `another source ${field}`,
        (value: Record<string, unknown>) => ({
          ...value,
          source: {
            ...(value['source'] as Record<string, unknown>),
            [field]: 'foreign-source-proof',
          },
        }),
      ] as const,
  ),
  [
    'self-consistent but wrong archive',
    (value: Record<string, unknown>) => ({
      ...value,
      historicalArchiveHash: 'sha256:' + 'a'.repeat(64),
    }),
  ],
  ['execution authority', (value: Record<string, unknown>) => ({ ...value, execution: 'applied' })],
  [
    'continuation authority',
    (value: Record<string, unknown>) => ({ ...value, continuation: 'continue' }),
  ],
  [
    'truncated historical references',
    (value: Record<string, unknown>) => ({ ...value, referenceCount: 2 }),
  ],
  [
    'caller-supplied authority',
    (value: Record<string, unknown>) => ({ ...value, authority: true }),
  ],
];
it.each(invalidReceipts)('rejects %s even with a matching envelope hash', async (_name, change) => {
  const encoded = JSON.stringify(change(receipt));
  await expect(
    database.execute(
      sql`update process_occurrence set imported_history_receipt=${encoded}::jsonb,imported_history_receipt_hash=docket_schedule_fingerprint(${encoded}::jsonb) where id=${occurrenceId}`,
    ),
  ).rejects.toMatchObject({ cause: { constraint: 'schedule_import_history_proof' } });
});

it('rejects an exact current-run identity without a writer barrier', async () => {
  await database.execute(
    sql`update process_occurrence set status='expected' where id=${occurrenceId}`,
  );
  try {
    const encoded = JSON.stringify({
      ...receipt,
      identity: { ...(receipt['identity'] as Record<string, unknown>), status: 'expected' },
    });
    await expect(
      database.execute(
        sql`update process_occurrence set imported_history_receipt=${encoded}::jsonb,imported_history_receipt_hash=docket_schedule_fingerprint(${encoded}::jsonb) where id=${occurrenceId}`,
      ),
    ).rejects.toMatchObject({ cause: { constraint: 'schedule_import_history_proof' } });
  } finally {
    await database.execute(
      sql`update process_occurrence set status='completed' where id=${occurrenceId}`,
    );
  }
});

it('stores a complete history-only receipt without granting execution or changing original work', async () => {
  const [before] = await migrationRows<Record<string, unknown>>(
    database,
    sql`select historical_archive,blueprint_root_refs,accepted_claim from process_occurrence where id=${occurrenceId}`,
  );
  const encoded = JSON.stringify(receipt);
  await database.execute(
    sql`update process_occurrence set imported_history_receipt=${encoded}::jsonb,imported_history_receipt_hash=docket_schedule_fingerprint(${encoded}::jsonb) where id=${occurrenceId}`,
  );
  const [after] = await migrationRows(
    database,
    sql`select historical_archive,blueprint_root_refs,accepted_claim,imported_history_receipt as receipt from process_occurrence where id=${occurrenceId}`,
  );
  expect(after).toEqual({ ...before, receipt });
  expect(receipt['referenceCount']).toBe(3);
  expect(receipt['execution']).toBe('nonexecuting');
  expect(receipt['continuation']).toBe('never');
  await database.execute(
    sql`update process_occurrence set imported_history_receipt=${encoded}::jsonb where id=${occurrenceId}`,
  );
  await expect(
    database.execute(
      sql`update process_occurrence set imported_history_receipt=null,imported_history_receipt_hash=null where id=${occurrenceId}`,
    ),
  ).rejects.toMatchObject({ cause: { constraint: 'schedule_import_history_immutable' } });
});
