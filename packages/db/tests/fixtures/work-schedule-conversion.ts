import { exercisePrivateScheduleShapeValidation } from './work-schedule-private-shape';
import type { ScheduleConversionReceipt } from '../../src/work-schedule-conversion-types';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { proveScheduleConversion } from '../../src/work-schedule-conversion-proof';
import { backfillScheduleConversions } from '../../src/work-schedule-conversion-prepare';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintFixtureMigration,
} from './work-template-blueprint-migration';

function constraint(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  if ('constraint' in error && typeof error.constraint === 'string') return error.constraint;
  if ('constraint_name' in error && typeof error.constraint_name === 'string')
    return error.constraint_name;
  return 'cause' in error ? constraint(error.cause) : null;
}

/** Exercise exact nonexecuting receipts and forged policy rejection through the real migration/service seam. */
export async function exerciseScheduleConversionPreparation(
  database: Database,
  options: BlueprintFixtureMigration,
): Promise<void> {
  const fixture = await prepareBlueprintRetainedFixture(database, options);
  await migrateWithWorkTemplateCheckpoint(database, options);
  const [manual] = await migrationRows<{ id: string; receipt: unknown; review: unknown }>(
    database,
    sql`select id,conversion_receipt as receipt,conversion_review as review from recurrence_series_revision where process_revision_id=${fixture.forestRevisionId}`,
  );
  if (!manual) throw new Error('Missing original revision');
  expect(manual).toMatchObject({
    receipt: null,
    review: { code: 'timezone_unproved', execution: 'nonexecuting' },
  });
  const before = await migrationRows(
    database,
    sql`select source_fingerprint,source_archive,source_archive_hash from work_template_blueprint_conversion order by legacy_process_revision_id`,
  );
  await database.execute(
    sql`update recurrence_series_revision set trigger_kind='calendar',schedule_kind='daily',interval=1,start_date='2026-10-01',timezone='America/Los_Angeles',end_kind='never',missed_policy='skip',horizon_days=30,minimum_occurrences=1 where id=${manual.id}`,
  );
  const proved = await database.transaction((tx) => proveScheduleConversion(tx, manual.id));
  if (!proved) throw new Error('Missing checked candidate');
  await rejectForgedPolicies(database, manual.id, proved);
  expect(await backfillScheduleConversions(database)).toEqual({ prepared: 1, deferred: 0 });
  const [prepared] = await migrationRows<{
    receipt: Record<string, unknown>;
    hash: string;
    review: unknown;
    draft: unknown;
    fallback: unknown;
    claims: number;
    occurrences: number;
    work: number;
  }>(
    database,
    sql`select conversion_receipt as receipt,conversion_receipt_hash as hash,conversion_review as review,schedule_draft as draft,authoring_fallback as fallback,(select count(*)::integer from process_occurrence where accepted_claim is not null) as claims,(select count(*)::integer from process_occurrence) as occurrences,(select count(*)::integer from task) as work from recurrence_series_revision where id=${manual.id}`,
  );
  if (!prepared) throw new Error('Missing preparation');
  expect(prepared).toMatchObject({
    receipt: {
      kind: 'schedule_conversion',
      execution: 'nonexecuting',
      compiler: 'legacy_schedule_v2.1',
      timezone: { kind: 'calendar_revision', timezone: 'America/Los_Angeles' },
      candidate: { kind: 'imported_schedule', creationMode: 'when_ready' },
    },
    review: null,
    draft: null,
    fallback: null,
    claims: 0,
    occurrences: 1,
    work: 1,
  });
  expect(prepared.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(
    await migrationRows(
      database,
      sql`select source_fingerprint,source_archive,source_archive_hash from work_template_blueprint_conversion order by legacy_process_revision_id`,
    ),
  ).toEqual(before);
  await expect(
    database.execute(
      sql`update recurrence_series_revision set conversion_receipt=conversion_receipt || '{"execution":"active"}'::jsonb where id=${manual.id}`,
    ),
  ).rejects.toSatisfy((error: unknown) => constraint(error) === 'schedule_conversion_immutable');
  expect(await backfillScheduleConversions(database)).toEqual({ prepared: 0, deferred: 0 });
  await exerciseConversionResume(database, manual.id, fixture.forestTaskStepId);
  await exercisePrivateScheduleShapeValidation(database);
}

async function copyCalendarRevision(
  database: Database,
  original: string,
  id: string,
  number: number,
): Promise<void> {
  await database.execute(
    sql`insert into recurrence_series_revision(id,organization_id,series_id,process_revision_id,blueprint_invocation_id,number,effective_from,trigger_kind,schedule_kind,interval,start_date,timezone,end_kind,missed_policy,horizon_days,minimum_occurrences) select ${id},organization_id,series_id,process_revision_id,blueprint_invocation_id,${number},('2026-10-01'::date+${number}::integer),'calendar','daily',1,start_date,timezone,'never','skip',30,1 from recurrence_series_revision where id=${original}`,
  );
}
async function exerciseConversionResume(
  database: Database,
  original: string,
  step: string,
): Promise<void> {
  const high = genId(),
    lower = '00000000000000000000000002';
  await copyCalendarRevision(database, original, high, 2);
  let inserted = false;
  expect(
    await backfillScheduleConversions(database, {
      batchSize: 1,
      onScheduleConversionBatch: async () => {
        if (inserted) return;
        inserted = true;
        await copyCalendarRevision(database, original, lower, 3);
      },
    }),
  ).toEqual({ prepared: 2, deferred: 0 });
  const interrupted = genId(),
    stop = new Error('Post-commit conversion interruption');
  await copyCalendarRevision(database, original, interrupted, 4);
  await expect(
    backfillScheduleConversions(database, {
      onScheduleConversionBatch: async () => {
        const [row] = await migrationRows<{ receipt: unknown }>(
          database,
          sql`select conversion_receipt as receipt from recurrence_series_revision where id=${interrupted}`,
        );
        expect(row?.receipt).toMatchObject({ execution: 'nonexecuting' });
        throw stop;
      },
    }),
  ).rejects.toBe(stop);
  expect(await backfillScheduleConversions(database)).toEqual({ prepared: 0, deferred: 0 });
  const changed = genId();
  await copyCalendarRevision(database, original, changed, 5);
  const [source] = await migrationRows<{ title: string }>(
    database,
    sql`select title from process_task_spec where step_id=${step}`,
  );
  if (!source) throw new Error('Missing original Task');
  await database.execute(
    sql`update process_task_spec set title='Changed original source cannot be restamped' where step_id=${step}`,
  );
  expect(await backfillScheduleConversions(database)).toEqual({ prepared: 0, deferred: 1 });
  const [review] = await migrationRows<{ code: string }>(
    database,
    sql`select conversion_review->>'code' as code from recurrence_series_revision where id=${changed}`,
  );
  expect(review?.code).toBe('original_source_unproved');
  await database.execute(
    sql`update process_task_spec set title=${source.title} where step_id=${step}`,
  );
  expect(await backfillScheduleConversions(database)).toEqual({ prepared: 1, deferred: 0 });
  await copyCalendarRevision(database, original, genId(), 6);
  const raced = await Promise.all([
    backfillScheduleConversions(database),
    backfillScheduleConversions(database),
  ]);
  expect(raced.reduce((sum, row) => sum + row.prepared, 0)).toBe(1);
  expect(raced.reduce((sum, row) => sum + row.deferred, 0)).toBe(0);
}

async function rejectForgedPolicies(
  database: Database,
  id: string,
  proved: ScheduleConversionReceipt,
): Promise<void> {
  for (const change of ['timing', 'title', 'selectedKind']) {
    const forged = forgePolicy(proved, change);
    await expect(
      database.execute(
        sql`update recurrence_series_revision set conversion_receipt=${JSON.stringify(forged)}::jsonb,conversion_receipt_hash=docket_schedule_fingerprint(${JSON.stringify(forged)}::jsonb),conversion_review=null where id=${id}`,
      ),
    ).rejects.toSatisfy((error: unknown) => constraint(error) === 'schedule_conversion_proof');
  }
}

function forgePolicy(proved: ScheduleConversionReceipt, change: string): ScheduleConversionReceipt {
  const forged = structuredClone(proved);
  if (change === 'timing') {
    const rule = forged.candidate.timing.rules[0];
    if (!rule) throw new Error('Missing field rule');
    rule.offset.days += 1;
  } else if (change === 'title') {
    const title = forged.candidate.titles[0];
    if (!title) throw new Error('Missing authored title');
    title.pattern += ' changed';
  } else {
    const selected = forged.candidate.selectedWork[0];
    if (!selected) throw new Error('Missing selected work');
    selected.kind = selected.kind === 'task' ? 'project' : 'task';
  }
  return forged;
}
