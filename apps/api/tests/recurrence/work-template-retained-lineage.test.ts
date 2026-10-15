import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { WorkTemplateChangePreview } from '@docket/work/work-template-reference';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { retainedFixture } from './work-template-adapter-fixture';
import { materializeTemplateOccurrence } from '../../src/lib/recurrence/work-template-adapter';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { workTemplateAssignmentRoutes } from '../../src/routes/work-template-assignment';
import { authorizeRetainedOccurrence } from '../../src/lib/work-creation/retained-authority';
import {
  loadRetainedBlueprintLineage,
  loadRetainedSnapshotLineage,
  retainedManagedParentPath,
  type RetainedBlueprintLineage,
} from '../../src/lib/work-template-blueprints/retained-lineage';
import { loadRetainedBlueprintRoot } from '../../src/lib/work-template-blueprints/retained';
import { loadBlueprintSnapshot } from '../../src/lib/work-template-blueprints/snapshot';
import { flushDeferredWork } from '../../src/lib/after-response';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(flushDeferredWork);
function definition(name: string) {
  return WorkTemplateDefinition.parse({
    name,
    payload: { targetType: 'task' },
    blueprint: {
      steps: [
        {
          key: 'prep',
          kind: 'task',
          parentStepKey: null,
          sort: 0,
          fields: { title: `${name} preparation`, description: `Preparation for ${name}` },
          template: null,
          teamRule: 'parent_team',
          actorRule: 'unassigned',
          cycleRule: 'none',
          dates: {},
          optional: { enabled: false, selectedByDefault: true },
        },
      ],
      dependencies: [],
    },
  });
}
async function changeTemplate(
  f: Awaited<ReturnType<typeof retainedFixture>>,
  rootId: string,
  templateId: string,
  mode: 'change' | 'update' = 'change',
): Promise<void> {
  const app = appWithActor(
    workTemplateAssignmentRoutes('task'),
    f.orgId,
    ['manage'],
    f.humanActorId,
  );
  const headers = { 'content-type': 'application/json' };
  const response = await app.request(`/${rootId}/template/preview`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ workTypeId: templateId, mode }),
  });
  expect(response.status).toBe(200);
  const preview = WorkTemplateChangePreview.parse(await response.json());
  const change = await app.request(`/${rootId}/template`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workTypeId: templateId,
      workTypeVersionId: preview.workTypeVersionId,
      previewToken: preview.previewToken,
      mode,
      acceptChildChanges: preview.childChanges
        .filter((change) => change.kind === 'add_child')
        .map((change) => change.changeId),
    }),
  });
  expect(change.status).toBe(200);
}
describe('immutable retained child source lineage', () => {
  it.each([false, true])(
    'ignores later foreground samepath generation on retry with nullableowner=%s',
    async (nullable) => {
      const f = await retainedFixture(schema, false, undefined, definition('Original'));
      const first = await schema.db.transaction((tx) =>
        materializeTemplateOccurrence(tx, f.request),
      );
      const rootId = first.result.taskIdsByKey['report'];
      if (!rootId) throw new Error('Missing retained root');
      const original = one(
        await schema.db.select().from(schema.task).where(eq(schema.task.parentTaskId, rootId)),
      );
      const draft = await createWorkTemplate(f.caller, {
        targetType: 'task',
        scope: 'personal',
        offeredTeamIds: [],
        definition: definition('Later'),
      });
      const other = await publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
      await changeTemplate(f, rootId, other.id);
      const children = await schema.db
        .select()
        .from(schema.task)
        .where(eq(schema.task.parentTaskId, rootId));
      expect(children).toHaveLength(2);
      expect(children.map((child) => child.blueprintPath)).toEqual([['prep'], ['prep']]);
      expect(children.find((child) => child.id !== original.id)?.blueprintSourceVersionId).toBe(
        other.latestPublishedVersionId,
      );
      if (nullable)
        await schema.db
          .update(schema.recurrenceSeries)
          .set({ createdBy: null })
          .where(eq(schema.recurrenceSeries.id, f.series.id));
      const before = await schema.db
        .select()
        .from(schema.task)
        .where(eq(schema.task.organizationId, f.orgId));
      const retry = await schema.db.transaction((tx) =>
        materializeTemplateOccurrence(tx, f.request),
      );
      expect(retry.result).toEqual(first.result);
      expect(retry.effects).toEqual([]);
      expect(retry.delta.createdTaskIdsByKey).toEqual({});
      expect(
        await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
      ).toEqual(before);
    },
  );
  it('keeps a later optional sameversion addition outside the immutable accepted run', async () => {
    const initial = definition('Original');
    const step = initial.blueprint.steps[0];
    if (!step) throw new Error('Missing original step');
    step.optional = { enabled: true, selectedByDefault: false };
    const f = await retainedFixture(schema, false, undefined, initial);
    const first = await schema.db.transaction((tx) => materializeTemplateOccurrence(tx, f.request));
    const rootId = first.result.taskIdsByKey['report'];
    if (!rootId) throw new Error('Missing retained root');
    await changeTemplate(f, rootId, f.published.id, 'update');
    const child = one(
      await schema.db.select().from(schema.task).where(eq(schema.task.parentTaskId, rootId)),
    );
    expect(child.blueprintSourceVersionId).toBe(f.published.latestPublishedVersionId);
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ createdBy: null })
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    const retained = await schema.db.transaction(async (tx) => {
      const facts = await authorizeRetainedOccurrence(tx, f.request);
      return loadRetainedBlueprintRoot(tx, { authority: facts.authority, rootKey: 'report' });
    });
    expect([...retained.existingByPath.keys()]).toEqual(['[]']);
    const retry = await schema.db.transaction((tx) => materializeTemplateOccurrence(tx, f.request));
    expect(retry.effects).toEqual([]);
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, child.id))),
    ).toEqual(child);
  });
  it('excludes a later replacement with the same accepted version, step and path', async () => {
    const f = await retainedFixture(schema, false, undefined, definition('Original'));
    const first = await schema.db.transaction((tx) => materializeTemplateOccurrence(tx, f.request));
    const rootId = first.result.taskIdsByKey['report'];
    if (!rootId) throw new Error('Missing retained root');
    const original = one(
      await schema.db.select().from(schema.task).where(eq(schema.task.parentTaskId, rootId)),
    );
    await schema.db
      .update(schema.task)
      .set({ archivedAt: new Date() })
      .where(eq(schema.task.id, original.id));
    await changeTemplate(f, rootId, f.published.id, 'update');
    const children = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.parentTaskId, rootId));
    const replacement = children.find((child) => child.id !== original.id);
    expect(replacement).toBeDefined();
    expect(replacement?.blueprintStepId).toBe(original.blueprintStepId);
    expect(replacement?.blueprintSourceVersionId).toBe(original.blueprintSourceVersionId);
    expect(replacement?.blueprintPath).toEqual(original.blueprintPath);
    if (!replacement) throw new Error('Missing replacement');
    await schema.db.transaction(async (tx) => {
      const facts = await authorizeRetainedOccurrence(tx, f.request);
      const lineage = await loadRetainedBlueprintLineage(tx, {
        authority: facts.authority,
        rootKey: 'report',
      });
      const observed = await loadBlueprintSnapshot(
        tx,
        facts.authority,
        { kind: 'task', id: replacement.id },
        { scope: 'reference' },
      );
      await loadRetainedSnapshotLineage(tx, lineage, observed);
      expect(retainedManagedParentPath(tx, lineage, { ...replacement, kind: 'task' })).toBeNull();
    });
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ createdBy: null })
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    const retained = await schema.db.transaction(async (tx) => {
      const facts = await authorizeRetainedOccurrence(tx, f.request);
      return loadRetainedBlueprintRoot(tx, { authority: facts.authority, rootKey: 'report' });
    });
    expect([...retained.existingByPath.keys()]).toEqual(['[]']);
    const retry = await schema.db.transaction((tx) => materializeTemplateOccurrence(tx, f.request));
    expect(retry.effects).toEqual([]);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.parentTaskId, rootId)),
    ).toEqual(children);
  });
  it('rejects forged and cross-transaction lineage capabilities before inspecting descendant origin', async () => {
    const f = await retainedFixture(schema);
    let lineage: RetainedBlueprintLineage | undefined;
    const row = {
      id: 'not-a-real-row',
      kind: 'task',
      blueprintPath: ['prep'],
      blueprintStepId: 'not-a-real-step',
      blueprintSourceVersionId: 'not-a-real-version',
    };
    await schema.db.transaction(async (tx) => {
      const facts = await authorizeRetainedOccurrence(tx, f.request);
      lineage = await loadRetainedBlueprintLineage(tx, {
        authority: facts.authority,
        rootKey: 'report',
      });
      expect(() => retainedManagedParentPath(tx, { proof: {} }, row)).toThrow();
    });
    const token = lineage;
    if (!token) throw new Error('Missing original token');
    await schema.db.transaction(async (tx) => {
      expect(() => retainedManagedParentPath(tx, token, row)).toThrow();
    });
  });
});
