import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { one } from '../support/routes-harness';
import { flushDeferredWork } from '../../src/lib/after-response';
import { undoChangeSetAtomically } from '../../src/mcp/change-set';
import { LabelId } from '@docket/work/ids';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  definition,
  fixture,
  newer,
  request,
  review,
  rows,
  updateSchema,
} from './work-template-blueprint-update-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await updateSchema();
});
afterEach(flushDeferredWork);
async function receipts(orgId: string) {
  return schema.db
    .select()
    .from(schema.changeSet)
    .where(eq(schema.changeSet.organizationId, orgId));
}
async function labels(taskId: string) {
  return schema.db.select().from(schema.taskLabel).where(eq(schema.taskLabel.taskId, taskId));
}

describe('selective generated template adoption', () => {
  it.each(['starting-field', 'child-change'] as const)(
    'refuses an unreviewed %s without writing identity, work or receipts',
    async (choice) => {
      const f = await fixture();
      await newer(f);
      const preview = await review(f);
      expect(preview.changes).toEqual([]);
      expect(preview.childChanges.some((change) => change.changeId === 'bp_0000000000000000')).toBe(
        false,
      );
      const before = await rows(f);
      const beforeReceipts = await receipts(f.orgId);
      const response = await request(f, '/update', {
        workTypeId: f.published.id,
        previewToken: preview.previewToken,
        ...(choice === 'starting-field'
          ? { applyFields: ['title'] }
          : { acceptChildChanges: ['bp_0000000000000000'] }),
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'validation_error' });
      expect(await rows(f)).toEqual(before);
      expect(await receipts(f.orgId)).toEqual(beforeReceipts);
    },
  );

  it('adopts reviewed root labels and workflow status in one reversible change without altering child work', async () => {
    const f = await fixture();
    const label = one(
      await schema.db
        .insert(schema.label)
        .values({ organizationId: f.orgId, name: 'Reviewed report', color: 'blue' })
        .returning(),
    );
    const next = WorkTemplateDefinition.parse({
      ...definition(['prep']),
      defaultStatusKey: 'in_progress',
      payload: { targetType: 'task', title: 'Reusable title', labelIds: [LabelId.parse(label.id)] },
    });
    await newer(f, undefined, undefined, next);
    const before = await rows(f);
    const original = one(before.filter((work) => work.id === f.root.id));
    const preview = await review(f, 'change');
    expect(preview.changes.find((change) => change.field === 'labels')).toMatchObject({
      before: [],
      after: ['Reviewed report'],
    });
    expect(preview.changes.find((change) => change.field === 'status')).toMatchObject({
      before: original.state,
      after: 'in_progress',
    });
    const response = await request(f, '', {
      workTypeId: f.published.id,
      previewToken: preview.previewToken,
      applyFields: ['labels', 'status'],
    });
    expect(response.status).toBe(200);
    expect(one((await rows(f)).filter((work) => work.id === f.root.id))).toMatchObject({
      title: 'My report',
      description: '## Authored notes',
      state: 'in_progress',
      blueprintEverStarted: true,
    });
    expect(one((await rows(f)).filter((work) => work.id === f.child.id))).toEqual(f.child);
    expect(await labels(f.root.id)).toMatchObject([{ labelId: label.id }]);
    const receipt = one(
      (await receipts(f.orgId)).filter((entry) => entry.summary === 'Changed template'),
    );
    expect(
      (await undoChangeSetAtomically(f.orgId, receipt.id)).outcomes.every(
        (outcome) => outcome.reverted,
      ),
    ).toBe(true);
    const restored = await rows(f);
    expect(restored.find((work) => work.id === f.root.id)).toMatchObject({
      state: original.state,
      workTypeVersionId: original.workTypeVersionId,
    });
    expect(restored.find((work) => work.id === f.child.id)).toEqual(f.child);
    expect(await labels(f.root.id)).toEqual([]);
  });
  it('accepts one added child and one derived offset without replacing root or child prose', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.task)
      .set({ title: 'Edited preparation', description: '## Edited child' })
      .where(eq(schema.task.id, f.child.id));
    const publication = await newer(f);
    const preview = await review(f);
    expect(preview.changes).toEqual([]);
    const additions = preview.childChanges.filter((change) => change.kind === 'add_child');
    const date = preview.childChanges.find((change) => change.kind === 'set_derived_date');
    expect(additions).toHaveLength(2);
    expect(date).toMatchObject({ previous: '2027-02-09', value: '2027-02-07' });
    const selected = additions.find((change) => change.path[0] === 'review');
    if (!selected || !date) throw new Error('Selective choices missing');
    const beforeReceipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    const response = await request(f, '/update', {
      workTypeId: f.published.id,
      previewToken: preview.previewToken,
      acceptChildChanges: [selected.changeId, date.changeId],
    });
    expect(response.status).toBe(200);
    const actual = await rows(f);
    expect(actual).toHaveLength(3);
    expect(actual.find((row) => row.id === f.root.id)).toMatchObject({
      title: 'My report',
      description: '## Authored notes',
      workTypeVersionId: publication.latestPublishedVersionId,
      workTypeAssignmentSource: 'updated',
    });
    expect(actual.find((row) => row.id === f.child.id)).toMatchObject({
      title: 'Edited preparation',
      description: '## Edited child',
      dueDate: new Date('2027-02-07'),
      blueprintSourceVersionId: f.child.blueprintSourceVersionId,
    });
    expect(actual.filter((row) => row.title === 'review')).toHaveLength(1);
    expect(actual.filter((row) => row.title === 'send')).toHaveLength(0);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toHaveLength(beforeReceipts.length + 1);
    const next = await review(f);
    expect(
      next.childChanges
        .filter((change) => change.kind === 'add_child')
        .map((change) => change.path),
    ).toEqual([['send']]);
  });

  it('keeps all children and dates when an old identity-only request advances the publication', async () => {
    const f = await fixture();
    await newer(f);
    const response = await request(f, '', { workTypeId: f.published.id });
    expect(response.status).toBe(200);
    expect(await rows(f)).toHaveLength(2);
    expect(one((await rows(f)).filter((row) => row.id === f.child.id)).dueDate).toEqual(
      f.child.dueDate,
    );
    expect(
      (await review(f)).childChanges.filter((change) => change.kind === 'add_child'),
    ).toHaveLength(2);
  });

  it('retains a removed child by default and cancels only an explicitly reviewed untouched child', async () => {
    const f = await fixture();
    await newer(f, []);
    const preview = await review(f);
    const removal = preview.childChanges.find((change) => change.kind === 'cancel_removed_child');
    expect(removal).toMatchObject({ selectedByDefault: false, path: ['prep'] });
    if (!removal) throw new Error('Cancellation choice missing');
    expect(
      (
        await request(f, '/update', {
          workTypeId: f.published.id,
          previewToken: preview.previewToken,
        })
      ).status,
    ).toBe(200);
    expect(one((await rows(f)).filter((row) => row.id === f.child.id)).canceledAt).toBeNull();
    const refreshed = await review(f);
    expect(
      (
        await request(f, '/update', {
          workTypeId: f.published.id,
          previewToken: refreshed.previewToken,
          acceptChildChanges: [removal.changeId],
        })
      ).status,
    ).toBe(200);
    expect(one((await rows(f)).filter((row) => row.id === f.child.id)).canceledAt).not.toBeNull();
  });

  it('rejects stale root prose and performs no identity, child or receipt writes', async () => {
    const f = await fixture();
    await newer(f);
    const preview = await review(f);
    const accepted = preview.childChanges
      .filter((change) => change.kind === 'add_child')
      .map((change) => change.changeId);
    await schema.db
      .update(schema.task)
      .set({ description: '## Concurrent notes' })
      .where(eq(schema.task.id, f.root.id));
    const before = await rows(f);
    const receipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    const response = await request(f, '/update', {
      workTypeId: f.published.id,
      previewToken: preview.previewToken,
      acceptChildChanges: accepted,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'blueprint_preview_stale' });
    expect(await rows(f)).toEqual(before);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toEqual(receipts);
  });
  it.each(['manual-date', 'membership', 'grant', 'weekdays', 'dependency', 'offering'] as const)(
    'rejects a reviewed adoption after %s changes without writing anything',
    async (mutation) => {
      const f = await fixture();
      await newer(f);
      const preview = await review(f);
      if (mutation === 'manual-date')
        await schema.db
          .update(schema.task)
          .set({ dueDate: new Date('2027-02-08') })
          .where(eq(schema.task.id, f.child.id));
      if (mutation === 'membership')
        await schema.db.insert(schema.task).values({
          organizationId: f.orgId,
          teamId: f.teamId,
          parentTaskId: f.root.id,
          title: 'Manual child',
          state: 'todo',
          statusId: f.statusId('task', 'todo'),
        });
      if (mutation === 'grant')
        await schema.db
          .update(schema.grant)
          .set({ capabilities: ['contribute'] })
          .where(eq(schema.grant.organizationId, f.orgId));
      if (mutation === 'weekdays')
        await schema.db
          .update(schema.organization)
          .set({ workingWeekdays: [1, 2, 3, 4, 5, 6] })
          .where(eq(schema.organization.id, f.orgId));
      if (mutation === 'dependency')
        await schema.db.insert(schema.taskDependency).values({
          organizationId: f.orgId,
          blockingTaskId: f.root.id,
          blockedTaskId: f.child.id,
        });
      if (mutation === 'offering')
        await schema.db
          .insert(schema.workTypeTeam)
          .values({ organizationId: f.orgId, workTypeId: f.published.id, teamId: f.teamId });
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
    },
  );

  it('serializes duplicate accept requests so only one receipt and child set are created', async () => {
    const f = await fixture();
    await newer(f);
    const preview = await review(f);
    const body = {
      workTypeId: f.published.id,
      previewToken: preview.previewToken,
      acceptChildChanges: preview.childChanges
        .filter((change) => change.kind === 'add_child')
        .map((change) => change.changeId),
    };
    const responses = await Promise.all([request(f, '/update', body), request(f, '/update', body)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await rows(f)).map((row) => row.title).sort()).toEqual([
      'My report',
      'prep',
      'review',
      'send',
    ]);
    const receipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(
        and(
          eq(schema.changeSet.organizationId, f.orgId),
          eq(schema.changeSet.summary, 'Updated template'),
        ),
      );
    expect(receipts).toHaveLength(1);
  });

  it('refuses a hidden descendant without exposing its title or prose', async () => {
    const f = await fixture();
    await newer(f);
    await schema.db.delete(schema.grant).where(eq(schema.grant.organizationId, f.orgId));
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.humanActorId,
      resourceKind: 'task',
      resourceId: f.root.id,
      capabilities: ['contribute'],
    });
    await schema.db
      .update(schema.task)
      .set({ visibility: 'private', title: 'HIDDEN TITLE', description: 'HIDDEN PROSE' })
      .where(eq(schema.task.id, f.child.id));
    const before = await rows(f);
    const response = await request(f, '/preview', { workTypeId: f.published.id, mode: 'update' });
    expect(response.status).toBe(404);
    const result = await response.text();
    expect(result).not.toContain('HIDDEN TITLE');
    expect(result).not.toContain('HIDDEN PROSE');
    expect(await rows(f)).toEqual(before);
  });

  it('never cancels started/reset work or matches a hand-added child by its name', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.task)
      .set({ blueprintEverStarted: true })
      .where(eq(schema.task.id, f.child.id));
    await schema.db.insert(schema.task).values({
      organizationId: f.orgId,
      teamId: f.teamId,
      parentTaskId: f.root.id,
      title: 'review',
      state: 'todo',
      statusId: f.statusId('task', 'todo'),
    });
    await newer(f, ['review']);
    const preview = await review(f);
    expect(preview.childChanges.filter((change) => change.kind === 'cancel_removed_child')).toEqual(
      [],
    );
    expect(preview.childChanges.filter((change) => change.kind === 'add_child')).toHaveLength(1);
    expect(
      (
        await request(f, '/update', {
          workTypeId: f.published.id,
          previewToken: preview.previewToken,
          acceptChildChanges: preview.childChanges
            .filter((change) => change.kind === 'add_child')
            .map((change) => change.changeId),
        })
      ).status,
    ).toBe(200);
    expect((await rows(f)).filter((row) => row.title === 'review')).toHaveLength(2);
  });

  it('skips completed descendants and rejects updating a terminal root', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.task)
      .set({ state: 'done', statusId: f.statusId('task', 'done'), completedAt: new Date() })
      .where(eq(schema.task.id, f.child.id));
    await newer(f);
    const preview = await review(f);
    expect(preview.childChanges.some((change) => change.kind === 'set_derived_date')).toBe(false);
    await schema.db
      .update(schema.task)
      .set({ state: 'done', statusId: f.statusId('task', 'done'), completedAt: new Date() })
      .where(eq(schema.task.id, f.root.id));
    expect(
      (await request(f, '/preview', { workTypeId: f.published.id, mode: 'update' })).status,
    ).toBe(422);
    expect((await request(f, '', { workTypeId: f.published.id })).status).toBe(200);
  });

  it('undoes identity, accepted dates and all new children through the single existing receipt', async () => {
    const f = await fixture();
    await newer(f);
    const preview = await review(f);
    expect(
      (
        await request(f, '/update', {
          workTypeId: f.published.id,
          previewToken: preview.previewToken,
          acceptChildChanges: preview.childChanges.map((change) => change.changeId),
        })
      ).status,
    ).toBe(200);
    const receipt = one(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(
          and(
            eq(schema.changeSet.organizationId, f.orgId),
            eq(schema.changeSet.summary, 'Updated template'),
          ),
        ),
    );
    const undone = await undoChangeSetAtomically(f.orgId, receipt.id);
    expect(undone.outcomes.every((change) => change.reverted)).toBe(true);
    const actual = (await rows(f)).filter((row) => row.archivedAt === null);
    expect(actual).toHaveLength(2);
    expect(actual.find((row) => row.id === f.root.id)?.workTypeVersionId).toBe(
      f.published.latestPublishedVersionId,
    );
    expect(actual.find((row) => row.id === f.child.id)?.dueDate).toEqual(f.child.dueDate);
  });
  it('respects default-off nested optional work inside an accepted new subtree', async () => {
    const f = await fixture();
    const next = definition(['prep', 'review', 'optional']);
    const optional = next.blueprint.steps.find((step) => step.key === 'optional');
    if (!optional) throw new Error('Optional fixture missing');
    optional.parentStepKey = 'review';
    optional.optional = { enabled: true, selectedByDefault: false };
    await newer(f, undefined, undefined, next);
    const preview = await review(f);
    const addition = preview.childChanges.find(
      (change) => change.kind === 'add_child' && change.path[0] === 'review',
    );
    if (!addition) throw new Error('Subtree fixture missing');
    expect(
      (
        await request(f, '/update', {
          workTypeId: f.published.id,
          previewToken: preview.previewToken,
          acceptChildChanges: [addition.changeId],
        })
      ).status,
    ).toBe(200);
    expect((await rows(f)).map((row) => row.title).sort()).toEqual(['My report', 'prep', 'review']);
    const nextReview = await review(f);
    expect(
      nextReview.childChanges
        .filter((change) => change.kind === 'add_child')
        .map((change) => change.path),
    ).toContainEqual(['optional']);
  });

  it('refuses individually selected dates that would invert the actual retained date window', async () => {
    const dated = (start: number, due: number) => {
      const value = definition(['prep'], due);
      const first = value.blueprint.steps[0];
      if (first?.kind !== 'task') throw new Error('Date fixture missing');
      first.dates.startDate = {
        kind: 'anchor',
        anchor: { kind: 'parent' },
        offset: { days: start, unit: 'calendar' },
      };
      return value;
    };
    const f = await fixture(dated(-2, -1));
    await newer(f, undefined, undefined, dated(0, 1));
    const preview = await review(f);
    const start = preview.childChanges.find(
      (change) => change.kind === 'set_derived_date' && change.field === 'startDate',
    );
    if (!start) throw new Error('Date fixture missing');
    const before = await rows(f);
    expect(
      (
        await request(f, '/update', {
          workTypeId: f.published.id,
          previewToken: preview.previewToken,
          acceptChildChanges: [start.changeId],
        })
      ).status,
    ).toBe(422);
    expect(await rows(f)).toEqual(before);
  });
});
