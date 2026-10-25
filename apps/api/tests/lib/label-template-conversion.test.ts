import { labelConversionFixture } from '../support/label-conversion-fixtures';
import type * as DbModule from '@docket/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { getDb, one, clearDocketPro } from '../support/routes-harness';
import { createWorkTemplate } from '../../src/lib/templates/service';
import {
  previewLabelTemplateConversion,
  confirmLabelTemplateConversion,
} from '../../src/lib/label-template-conversion/service';
import { runWithProvenance, appProvenance } from '../../src/lib/provenance/context';
import { undoChangeSet } from '../../src/mcp/change-set';
import { workScheduleUndoAccess } from '../../src/lib/recurrence/work-schedule-undo-access';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const fixture = () => labelConversionFixture(schema);
const confirm: typeof confirmLabelTemplateConversion = (caller, request) =>
  runWithProvenance(appProvenance('settings'), () =>
    confirmLabelTemplateConversion(caller, request),
  );
async function labels(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await schema.db
      .select()
      .from(schema.taskLabel)
      .where(
        and(eq(schema.taskLabel.organizationId, f.orgId), eq(schema.taskLabel.taskId, f.work.id)),
      )
  )
    .map((row) => row.labelId)
    .sort();
}

describe('explicit conversion of labels into work identities', () => {
  it('previews without changing labels, work, drafts or receipts', async () => {
    const f = await fixture();
    const before = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    const review = await previewLabelTemplateConversion(f.caller, f.choices);
    expect(review.items).toMatchObject([
      {
        id: f.work.id,
        name: 'Community dinner',
        templateName: 'Event',
        removeLabels: [{ id: f.standIn.id, name: 'Event' }],
      },
    ]);
    expect(await labels(f)).toEqual([f.standIn.id, f.unrelated.id].sort());
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.work.id))),
    ).toEqual(f.work);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toEqual(before);
  });
  it('confirms one exact review and undoes identity and selected labels together', async () => {
    const f = await fixture(),
      review = await previewLabelTemplateConversion(f.caller, f.choices);
    const request = {
      ...f.choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    };
    const receipt = await confirm(f.caller, request);
    expect(await confirm(f.caller, request)).toEqual(receipt);
    expect(await labels(f)).toEqual([f.unrelated.id]);
    const changed = one(
      await schema.db.select().from(schema.task).where(eq(schema.task.id, f.work.id)),
    );
    expect(changed).toMatchObject({
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
      title: f.work.title,
      description: f.work.description,
      dueDate: f.work.dueDate,
    });
    await undoChangeSet(f.orgId, receipt.changeSetId, workScheduleUndoAccess(f.caller));
    expect(await labels(f)).toEqual([f.standIn.id, f.unrelated.id].sort());
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.work.id))),
    ).toMatchObject({
      workTypeId: f.work.workTypeId,
      workTypeVersionId: f.work.workTypeVersionId,
      description: f.work.description,
      dueDate: f.work.dueDate,
    });
  });
  it('rejects a stale label set without changing identity', async () => {
    const f = await fixture(),
      review = await previewLabelTemplateConversion(f.caller, f.choices);
    await schema.db
      .delete(schema.taskLabel)
      .where(
        and(eq(schema.taskLabel.taskId, f.work.id), eq(schema.taskLabel.labelId, f.unrelated.id)),
      );
    await expect(
      confirm(f.caller, {
        ...f.choices,
        requestId: crypto.randomUUID(),
        expectedReviewFingerprint: review.reviewFingerprint,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.work.id)))
        .workTypeId,
    ).toBe(f.work.workTypeId);
  });
  it('requires current Pro and current reviewer membership', async () => {
    const f = await fixture();
    await clearDocketPro(schema.db, schema, f.orgId);
    await expect(previewLabelTemplateConversion(f.caller, f.choices)).rejects.toMatchObject({
      code: 'product_required',
    });
    await expect(
      previewLabelTemplateConversion({ ...f.caller, userId: 'forged' }, f.choices),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('refuses callerless generic Undo and preserves the entire batch after a later work edit', async () => {
    const f = await fixture(),
      review = await previewLabelTemplateConversion(f.caller, f.choices);
    const receipt = await confirm(f.caller, {
      ...f.choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    });
    await expect(undoChangeSet(f.orgId, receipt.changeSetId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await schema.db
      .update(schema.task)
      .set({ description: 'A later deliberate edit' })
      .where(eq(schema.task.id, f.work.id));
    await expect(
      undoChangeSet(f.orgId, receipt.changeSetId, workScheduleUndoAccess(f.caller)),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await labels(f)).toEqual([f.unrelated.id]);
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.work.id))),
    ).toMatchObject({ workTypeId: f.published.id, description: 'A later deliberate edit' });
  });
  it('rejects empty, oversized, duplicate and caller-forged selections before any writes', async () => {
    const f = await fixture();
    const selected = one(f.choices.items);
    for (const choices of [
      { ...f.choices, items: [] },
      { ...f.choices, items: Array.from({ length: 101 }, () => selected) },
      { ...f.choices, items: [selected, selected] },
      { ...f.choices, ownerActorId: f.humanActorId },
    ])
      expect(() => previewLabelTemplateConversion(f.caller, choices)).toThrow();
    expect(await labels(f)).toEqual([f.standIn.id, f.unrelated.id].sort());
  });
  it('rejects labels outside the selected group and unpublished identities', async () => {
    const f = await fixture(),
      item = one(f.choices.items);
    await expect(
      previewLabelTemplateConversion(f.caller, {
        ...f.choices,
        items: [{ ...item, removeLabelIds: [f.unrelated.id] }],
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    const draft = await createWorkTemplate(
      f.caller,
      WorkTemplateCreate.parse({
        targetType: 'task',
        scope: 'personal',
        definition: { name: 'Not published', payload: { targetType: 'task' } },
      }),
    );
    await expect(
      previewLabelTemplateConversion(f.caller, {
        ...f.choices,
        items: [{ ...item, workTypeId: draft.id }],
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await labels(f)).toEqual([f.standIn.id, f.unrelated.id].sort());
  });
  it('rechecks authoring rights and Pro after review and refuses changed retries', async () => {
    const f = await fixture(),
      review = await previewLabelTemplateConversion(f.caller, f.choices);
    const request = {
      ...f.choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    };
    const receipt = await confirm(f.caller, request);
    await expect(
      confirm(f.caller, { ...request, expectedReviewFingerprint: `sha256:${'0'.repeat(64)}` }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await clearDocketPro(schema.db, schema, f.orgId);
    expect(await confirm(f.caller, request)).toEqual(receipt);
    const other = await fixture(),
      otherReview = await previewLabelTemplateConversion(other.caller, other.choices);
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['view'] })
      .where(eq(schema.grant.organizationId, other.orgId));
    await expect(
      confirm(other.caller, {
        ...other.choices,
        requestId: crypto.randomUUID(),
        expectedReviewFingerprint: otherReview.reviewFingerprint,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await labels(other)).toEqual([other.standIn.id, other.unrelated.id].sort());
  });
});
