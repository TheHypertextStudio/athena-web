/** Real PostgreSQL concurrency and ordinary aggregate Undo of an exact label conversion. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@docket/db';
import { labelConversionFixture } from '../support/label-conversion-fixtures';
import { installTestProductEntitlementFixture } from '../support/product-entitlement';
import { one } from '../support/routes-harness';
import {
  previewLabelTemplateConversion,
  confirmLabelTemplateConversion,
  reconcileLabelTemplateConversion,
} from '../../src/lib/label-template-conversion/service';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';
import { undoChangeSet } from '../../src/mcp/change-set';
import { workScheduleUndoAccess } from '../../src/lib/recurrence/work-schedule-undo-access';
const url = process.env['LABEL_CONVERSION_PG_URL'] ?? '';
const client = postgres(url, { max: 2, prepare: false });
beforeAll(async () => {
  const target = new URL(url);
  expect(target.hostname).toBe('127.0.0.1');
  expect(target.pathname).toBe('/history_oct25_source_copy');
  expect(process.env['DATABASE_URL']).toBe(url);
  const [row] = await client<
    { version: number; database: string }[]
  >`select current_setting('server_version_num')::integer as version,current_database() as database`;
  expect(row?.version).toBeGreaterThanOrEqual(180000);
  expect(row?.database).toBe('history_oct25_source_copy');
  await installTestProductEntitlementFixture({ exec: (sql) => client.unsafe(sql) });
  await client.unsafe(
    "do $$ begin if not exists(select 1 from pg_roles where rolname='label_conversion_oct25_reader') then create role label_conversion_oct25_reader nologin nosuperuser nobypassrls; end if; end $$",
  );
  await client.unsafe('grant usage on schema public to label_conversion_oct25_reader');
  await client.unsafe(
    'grant select on actor,change_set,change_set_entry to label_conversion_oct25_reader',
  );
});
afterAll(async () => {
  await schema.closeDb();
  await client.end();
});
const confirm: typeof confirmLabelTemplateConversion = (caller, input) =>
  runWithProvenance(appProvenance('settings'), () => confirmLabelTemplateConversion(caller, input));
describe('confirmed label conversion on PostgreSQL', () => {
  it('serializes duplicate confirmation and restores exact identity/labels with ordinary Undo', async () => {
    const f = await labelConversionFixture(schema),
      review = await previewLabelTemplateConversion(f.caller, f.choices);
    const request = {
      ...f.choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    };
    const [first, second] = await Promise.all([
      confirm(f.caller, request),
      confirm(f.caller, request),
    ]);
    expect(first).toBeDefined();
    expect(first).toEqual(second);
    const receipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    expect(receipts.filter((row) => row.origin.tool === 'label_template_conversion')).toHaveLength(
      1,
    );
    const result = await undoChangeSet(
      f.orgId,
      first.changeSetId,
      workScheduleUndoAccess(f.caller),
    );
    expect(result.outcomes.every((outcome) => outcome.reverted)).toBe(true);
    const work = one(
      await schema.db.select().from(schema.task).where(eq(schema.task.id, f.work.id)),
    );
    expect(work).toMatchObject({
      workTypeId: f.work.workTypeId,
      workTypeVersionId: f.work.workTypeVersionId,
      description: f.work.description,
      dueDate: f.work.dueDate,
    });
    expect(
      (
        await schema.db
          .select()
          .from(schema.taskLabel)
          .where(eq(schema.taskLabel.taskId, f.work.id))
      )
        .map((row) => row.labelId)
        .sort(),
    ).toEqual([f.standIn.id, f.unrelated.id].sort());
    expect(await reconcileLabelTemplateConversion(f.caller, request.requestId)).toMatchObject({
      state: 'undone',
      changeSetId: first.changeSetId,
    });
  });
  it('does not apply a competing changed request under an already claimed command id', async () => {
    const f = await labelConversionFixture(schema),
      review = await previewLabelTemplateConversion(f.caller, f.choices);
    const request = {
      ...f.choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    };
    await confirm(f.caller, request);
    await expect(
      confirm(f.caller, { ...request, expectedReviewFingerprint: `sha256:${'0'.repeat(64)}` }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await reconcileLabelTemplateConversion(f.caller, request.requestId)).toMatchObject({
      state: 'converted',
      itemCount: 1,
    });
  });
});
describe('conversion receipt privacy on PostgreSQL', () => {
  it('restricts conversion receipt snapshots to the current confirmed human', async () => {
    const f = await labelConversionFixture(schema),
      review = await previewLabelTemplateConversion(f.caller, f.choices);
    const receipt = await confirm(f.caller, {
      ...f.choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    });
    const other = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Other reviewer' })
        .returning(),
    );
    await client.begin(async (tx) => {
      await tx.unsafe('set local role label_conversion_oct25_reader');
      await tx`select set_config('docket.organization_id',${f.orgId},true),set_config('docket.actor_id',${other.id},true)`;
      expect(await tx`select id from change_set where id=${receipt.changeSetId}`).toHaveLength(0);
      expect(
        await tx`select entity_id from change_set_entry where change_set_id=${receipt.changeSetId}`,
      ).toHaveLength(0);
      await tx`select set_config('docket.actor_id',${f.humanActorId},true)`;
      expect(await tx`select id from change_set where id=${receipt.changeSetId}`).toHaveLength(1);
      expect(
        await tx`select entity_id from change_set_entry where change_set_id=${receipt.changeSetId}`,
      ).toHaveLength(2);
    });
  });
});
