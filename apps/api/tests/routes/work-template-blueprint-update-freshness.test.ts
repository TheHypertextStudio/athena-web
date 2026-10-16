import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { LabelId, WorkTypeId } from '@docket/work/ids';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { flushDeferredWork } from '../../src/lib/after-response';
import { assignWorkTemplate } from '../../src/lib/work-template-assignment';
import {
  createWorkTemplate,
  editWorkTemplateDraft,
  publishWorkTemplate,
  archiveWorkTemplate,
} from '../../src/lib/templates/service';
import { one } from '../support/routes-harness';
import {
  definition,
  fixture,
  newer,
  request,
  review,
  rows,
} from './work-template-blueprint-update-fixture';

afterEach(flushDeferredWork);
describe('whole selective preview freshness', () => {
  it.each(['starting-field', 'child-change'] as const)(
    'requires a preview token for %s choices at the ordinary assignment service boundary',
    async (choice) => {
      const f = await fixture();
      await newer(f);
      const preview = await review(f, 'change');
      const child = preview.childChanges.find((change) => change.kind === 'add_child');
      if (!child) throw new Error('Missing actual reviewed child');
      const before = await rows(f);
      const beforeReceipts = await f.schema.db
        .select()
        .from(f.schema.changeSet)
        .where(eq(f.schema.changeSet.organizationId, f.orgId));
      await expect(
        assignWorkTemplate(f.caller, 'task', f.root.id, {
          workTypeId: WorkTypeId.parse(f.published.id),
          ...(choice === 'starting-field'
            ? { applyFields: ['title' as const] }
            : { acceptChildChanges: [child.changeId] }),
        }),
      ).rejects.toMatchObject({ status: 422, code: 'validation_error' });
      expect(await rows(f)).toEqual(before);
      expect(
        await f.schema.db
          .select()
          .from(f.schema.changeSet)
          .where(eq(f.schema.changeSet.organizationId, f.orgId)),
      ).toEqual(beforeReceipts);
    },
  );
  it('keeps an unavailable publication a not-found response when no reviewed token was submitted', async () => {
    const f = await fixture();
    const before = await rows(f);
    const receipts = await f.schema.db
      .select()
      .from(f.schema.changeSet)
      .where(eq(f.schema.changeSet.organizationId, f.orgId));
    const response = await request(f, '/update', {
      workTypeId: f.published.id,
      workTypeVersionId: f.schema.genId(),
    });
    expect(response.status).toBe(404);
    expect(await rows(f)).toEqual(before);
    expect(
      await f.schema.db
        .select()
        .from(f.schema.changeSet)
        .where(eq(f.schema.changeSet.organizationId, f.orgId)),
    ).toEqual(receipts);
  });
  it.each(['archived-template', 'missing-publication', 'suspended-caller'] as const)(
    'converts a reviewed %s failure into stale preview without writes',
    async (mutation) => {
      const f = await fixture();
      await newer(f);
      const preview = await review(f);
      if (mutation === 'archived-template') await archiveWorkTemplate(f.caller, f.published.id);
      if (mutation === 'suspended-caller')
        await f.schema.db
          .update(f.schema.actor)
          .set({ status: 'suspended' })
          .where(eq(f.schema.actor.id, f.humanActorId));
      const before = await rows(f);
      const receipts = await f.schema.db
        .select()
        .from(f.schema.changeSet)
        .where(eq(f.schema.changeSet.organizationId, f.orgId));
      const response = await request(f, '/update', {
        workTypeId: f.published.id,
        ...(mutation === 'missing-publication' ? { workTypeVersionId: f.schema.genId() } : {}),
        previewToken: preview.previewToken,
        acceptChildChanges: preview.childChanges
          .filter((change) => change.kind === 'add_child')
          .map((change) => change.changeId),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'blueprint_preview_stale' });
      expect(await rows(f)).toEqual(before);
      expect(
        await f.schema.db
          .select()
          .from(f.schema.changeSet)
          .where(eq(f.schema.changeSet.organizationId, f.orgId)),
      ).toEqual(receipts);
    },
  );

  it('refuses update mode after the current work selects a different template identity', async () => {
    const f = await fixture();
    await newer(f);
    const preview = await review(f);
    const bases = await f.schema.db
      .select()
      .from(f.schema.template)
      .where(eq(f.schema.template.organizationId, f.orgId));
    const base = bases.find((entry) => entry.isBase && entry.targetType === 'task');
    if (!base) throw new Error('Missing Task base');
    expect((await request(f, '', { workTypeId: base.id })).status).toBe(200);
    const before = await rows(f);
    const receipts = await f.schema.db
      .select()
      .from(f.schema.changeSet)
      .where(eq(f.schema.changeSet.organizationId, f.orgId));
    const response = await request(f, '/update', {
      workTypeId: f.published.id,
      previewToken: preview.previewToken,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'blueprint_preview_stale' });
    expect(await rows(f)).toEqual(before);
    expect(
      await f.schema.db
        .select()
        .from(f.schema.changeSet)
        .where(eq(f.schema.changeSet.organizationId, f.orgId)),
    ).toEqual(receipts);
  });
  it('rejects changed descendant labels without writing identity, work or another receipt', async () => {
    const f = await fixture();
    await newer(f);
    const preview = await review(f);
    const label = one(
      await f.schema.db
        .insert(f.schema.label)
        .values({ organizationId: f.orgId, name: 'Concurrent label', color: 'blue' })
        .returning(),
    );
    await f.schema.db
      .insert(f.schema.taskLabel)
      .values({ organizationId: f.orgId, taskId: f.child.id, labelId: label.id });
    const before = await rows(f);
    const receipts = await f.schema.db
      .select()
      .from(f.schema.changeSet)
      .where(eq(f.schema.changeSet.organizationId, f.orgId));
    const response = await request(f, '/update', {
      workTypeId: f.published.id,
      previewToken: preview.previewToken,
      acceptChildChanges: preview.childChanges
        .filter((change) => change.kind === 'add_child')
        .map((change) => change.changeId),
    });
    expect(response.status).toBe(409);
    expect(await rows(f)).toEqual(before);
    expect(
      await f.schema.db
        .select()
        .from(f.schema.changeSet)
        .where(eq(f.schema.changeSet.organizationId, f.orgId)),
    ).toEqual(receipts);
  });

  it('rejects a newer nested latest publication even when the root publication is unchanged', async () => {
    const f = await fixture();
    const draft = await createWorkTemplate(f.caller, {
      targetType: 'task',
      scope: 'personal',
      offeredTeamIds: [],
      definition: WorkTemplateDefinition.parse({ name: 'Nested', payload: { targetType: 'task' } }),
    });
    const nested = await publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
    const next = definition(['prep', 'review']);
    const step = next.blueprint.steps.find((value) => value.key === 'review');
    if (!step) throw new Error('Nested fixture missing');
    step.template = { workTypeId: WorkTypeId.parse(nested.id), selection: { kind: 'latest' } };
    await newer(f, undefined, undefined, next);
    const preview = await review(f);
    const edit = await editWorkTemplateDraft(f.caller, nested.id, {
      expectedRevision: nested.draftRevision,
      definition: WorkTemplateDefinition.parse({
        name: 'Nested v2',
        payload: { targetType: 'task', description: '## New nested outline' },
      }),
    });
    await publishWorkTemplate(f.caller, edit.id, edit.draftRevision);
    const before = await rows(f);
    const response = await request(f, '/update', {
      workTypeId: f.published.id,
      previewToken: preview.previewToken,
      acceptChildChanges: preview.childChanges
        .filter((change) => change.kind === 'add_child')
        .map((change) => change.changeId),
    });
    expect(response.status).toBe(409);
    expect(await rows(f)).toEqual(before);
  });

  it('returns a bounded warning when a published child default label is no longer available', async () => {
    const f = await fixture();
    const label = one(
      await f.schema.db
        .insert(f.schema.label)
        .values({ organizationId: f.orgId, name: 'Obsolete label', color: 'blue' })
        .returning(),
    );
    const next = definition(['prep', 'review']);
    const step = next.blueprint.steps.find((value) => value.key === 'review');
    if (step?.kind !== 'task') throw new Error('Task fixture missing');
    step.fields.labelIds = [LabelId.parse(label.id)];
    await newer(f, undefined, undefined, next);
    await f.schema.db.delete(f.schema.label).where(eq(f.schema.label.id, label.id));
    const preview = await review(f);
    expect(preview.warnings).toContainEqual({
      code: 'label_unavailable',
      paths: [['review']],
      count: 1,
    });
  });
});
