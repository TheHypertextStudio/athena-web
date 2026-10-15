import { appProvenance } from '../../src/lib/provenance/context';
import { catalogChange } from '../../src/mcp/change-set-catalog';
import { recordChangeSet, undoChangeSet, undoChangeSetAtomically } from '../../src/mcp/change-set';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';
import type templatesRouter from '../../src/routes/templates';

let schema: typeof DbModule;
let router: typeof templatesRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/templates')).default;
});
const headers = { 'content-type': 'application/json' };

async function fixture() {
  const seeded = await seedTaskAccessOrg(schema.db, schema, 'manage');
  return { ...seeded, app: appWithActor(router, seeded.orgId, ['manage'], seeded.humanActorId) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function taskStep(key: string, workTypeId?: string) {
  return BlueprintStep.parse({
    key,
    kind: 'task',
    parentStepKey: null,
    sort: 0,
    fields: { title: key },
    optional: { enabled: false, selectedByDefault: true },
    template: workTypeId ? { workTypeId, selection: { kind: 'latest' } } : null,
    teamRule: 'parent_team',
    actorRule: 'unassigned',
    cycleRule: 'none',
    dates: {},
  });
}
async function draft(f: Fixture, kind: 'project' | 'task', steps: BlueprintStep[] = []) {
  const response = await f.app.request('/definitions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      targetType: kind,
      definition: {
        name: 'Reusable preparation',
        payload: { targetType: kind },
        blueprint: { steps, dependencies: [] },
      },
    }),
  });
  expect(response.status).toBe(201);
  return WorkTemplateOut.parse(await response.json());
}
async function publish(f: Fixture, row: WorkTemplateOut) {
  return f.app.request(`/definitions/${row.id}/publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedRevision: row.revision }),
  });
}
async function versions(id: string) {
  return schema.db
    .select()
    .from(schema.workTypeVersion)
    .where(eq(schema.workTypeVersion.workTypeId, id));
}

describe('work-template blueprint publication', () => {
  it('publishes exact immutable step projections in the same transaction', async () => {
    const f = await fixture();
    const row = await draft(f, 'project', [taskStep('prepare')]);
    const response = await publish(f, row);
    expect(response.status).toBe(200);
    const published = WorkTemplateOut.parse(await response.json());
    const projected = await schema.db
      .select()
      .from(schema.blueprintStep)
      .where(eq(schema.blueprintStep.versionId, published.latestVersion?.id ?? 'missing'));
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      organizationId: f.orgId,
      key: 'prepare',
      kind: 'task',
      step: taskStep('prepare'),
    });
    expect((await versions(row.id))[0]?.definition.blueprint.steps).toEqual([taskStep('prepare')]);
  });

  it('refuses a private child without publishing its parent or widening the parent draft', async () => {
    const f = await fixture();
    const child = await draft(f, 'task');
    const parent = await draft(f, 'project', [taskStep('private_child', child.id)]);
    expect((await publish(f, parent)).status).toBe(404);
    expect(await versions(parent.id)).toHaveLength(0);
    const [retained] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, parent.id));
    expect(retained).toMatchObject({
      scope: 'personal',
      publicationState: 'draft',
      latestPublishedVersionId: null,
    });
  });

  it('refuses a newly authored archived child while retaining its old publication', async () => {
    const f = await fixture();
    const child = await draft(f, 'task');
    expect((await publish(f, child)).status).toBe(200);
    expect(
      (await f.app.request(`/definitions/${child.id}/archive`, { method: 'POST' })).status,
    ).toBe(200);
    const parent = await draft(f, 'project', [taskStep('archived_child', child.id)]);
    expect((await publish(f, parent)).status).toBe(404);
    expect(await versions(parent.id)).toHaveLength(0);
    expect(await versions(child.id)).toHaveLength(1);
  });

  it('refuses a template identity loop across versions without advancing publication', async () => {
    const f = await fixture();
    const row = await draft(f, 'task');
    const first = await publish(f, row);
    expect(first.status).toBe(200);
    const current = WorkTemplateOut.parse(await first.json());
    const edit = await f.app.request(`/definitions/${row.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedRevision: current.revision,
        definition: {
          ...current.definition,
          blueprint: { steps: [taskStep('again', row.id)], dependencies: [] },
        },
      }),
    });
    expect(edit.status).toBe(200);
    const updated = WorkTemplateOut.parse(await edit.json());
    const refused = await publish(f, updated);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'blueprint_loop' });
    expect(await versions(row.id)).toHaveLength(1);
  });

  it('retains an existing published child after that child is archived', async () => {
    const f = await fixture();
    const child = await draft(f, 'task');
    expect((await publish(f, child)).status).toBe(200);
    const parent = await draft(f, 'project', [taskStep('prepare', child.id)]);
    const first = await publish(f, parent);
    expect(first.status).toBe(200);
    const current = WorkTemplateOut.parse(await first.json());
    expect(
      (await f.app.request(`/definitions/${child.id}/archive`, { method: 'POST' })).status,
    ).toBe(200);
    const edit = await f.app.request(`/definitions/${parent.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedRevision: current.revision,
        definition: { ...current.definition, name: 'Renamed preparation' },
      }),
    });
    expect(edit.status).toBe(200);
    expect((await publish(f, WorkTemplateOut.parse(await edit.json()))).status).toBe(200);
    expect(await versions(parent.id)).toHaveLength(2);
  });

  it('keeps archived grandchildren inside an already published child definition', async () => {
    const f = await fixture();
    const grandchild = await draft(f, 'task');
    expect((await publish(f, grandchild)).status).toBe(200);
    const child = await draft(f, 'task', [taskStep('nested', grandchild.id)]);
    expect((await publish(f, child)).status).toBe(200);
    expect(
      (await f.app.request(`/definitions/${grandchild.id}/archive`, { method: 'POST' })).status,
    ).toBe(200);
    const parent = await draft(f, 'project', [taskStep('prepare', child.id)]);
    expect((await publish(f, parent)).status).toBe(200);
    expect(await versions(parent.id)).toHaveLength(1);
  });

  it.each(['key', 'selection'] as const)(
    'refuses a changed direct archived-child %s',
    async (change) => {
      const f = await fixture();
      const child = await draft(f, 'task');
      const childResponse = await publish(f, child);
      expect(childResponse.status).toBe(200);
      const childPublication = WorkTemplateOut.parse(await childResponse.json());
      const parent = await draft(f, 'project', [taskStep('prepare', child.id)]);
      const first = await publish(f, parent);
      expect(first.status).toBe(200);
      const current = WorkTemplateOut.parse(await first.json());
      expect(
        (await f.app.request(`/definitions/${child.id}/archive`, { method: 'POST' })).status,
      ).toBe(200);
      const changed = BlueprintStep.parse({
        ...taskStep(change === 'key' ? 'replacement' : 'prepare', child.id),
        ...(change === 'selection'
          ? {
              template: {
                workTypeId: child.id,
                selection: {
                  kind: 'pinned',
                  workTypeVersionId: childPublication.latestVersion?.id,
                },
              },
            }
          : {}),
      });
      const edit = await f.app.request(`/definitions/${parent.id}/draft`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          expectedRevision: current.revision,
          definition: { ...current.definition, blueprint: { steps: [changed], dependencies: [] } },
        }),
      });
      expect(edit.status).toBe(200);
      expect((await publish(f, WorkTemplateOut.parse(await edit.json()))).status).toBe(404);
      expect(await versions(parent.id)).toHaveLength(1);
    },
  );

  it('keeps retained archived references through the legacy workspace rename adapter', async () => {
    const f = await fixture();
    const child = await draft(f, 'task');
    expect((await publish(f, child)).status).toBe(200);
    const parent = await draft(f, 'project', [taskStep('prepare', child.id)]);
    expect((await publish(f, parent)).status).toBe(200);
    expect(
      (await f.app.request(`/definitions/${child.id}/archive`, { method: 'POST' })).status,
    ).toBe(200);
    const renamed = await f.app.request(`/${parent.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Legacy rename preserves preparation' }),
    });
    expect(renamed.status).toBe(200);
    expect(await versions(parent.id)).toHaveLength(2);
    expect((await versions(parent.id))[1]?.definition.blueprint.steps).toEqual([
      taskStep('prepare', child.id),
    ]);
  });

  it('serializes opposite latest-child publications without committing a loop', async () => {
    const f = await fixture();
    const left = await draft(f, 'task');
    const right = await draft(f, 'task');
    const initial = await Promise.all([publish(f, left), publish(f, right)]);
    expect(initial.map((response) => response.status)).toEqual([200, 200]);
    const [leftPublished, rightPublished] = await Promise.all(
      initial.map(async (response) => WorkTemplateOut.parse(await response.json())),
    );
    if (!leftPublished || !rightPublished) throw new Error('Publication fixture missing');
    const edits = await Promise.all(
      [
        [leftPublished, rightPublished],
        [rightPublished, leftPublished],
      ].map(async ([owner, child]) => {
        if (!owner || !child) throw new Error('Publication fixture missing');
        const response = await f.app.request(`/definitions/${owner.id}/draft`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            expectedRevision: owner.revision,
            definition: {
              ...owner.definition,
              blueprint: { steps: [taskStep('nested', child.id)], dependencies: [] },
            },
          }),
        });
        expect(response.status).toBe(200);
        return WorkTemplateOut.parse(await response.json());
      }),
    );
    const outcomes = await Promise.all(edits.map((row) => publish(f, row)));
    expect(outcomes.map((response) => response.status).sort()).toEqual([200, 422]);
    expect((await versions(left.id)).length + (await versions(right.id)).length).toBe(3);
  });

  it.each(['partial', 'atomic'] as const)(
    'restores archived historical children through %s aggregate template undo',
    async (mode) => {
      const f = await fixture();
      const child = await draft(f, 'task');
      expect((await publish(f, child)).status).toBe(200);
      const changes = [];
      const parentIds: string[] = [];
      for (let index = 0; index < 2; index++) {
        const parent = await draft(f, 'project', [taskStep('retained', child.id)]);
        const first = await publish(f, parent);
        expect(first.status).toBe(200);
        const current = WorkTemplateOut.parse(await first.json());
        const [before] = await schema.db
          .select()
          .from(schema.template)
          .where(eq(schema.template.id, parent.id));
        const edit = await f.app.request(`/definitions/${parent.id}/draft`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            expectedRevision: current.revision,
            definition: { ...current.definition, blueprint: { steps: [], dependencies: [] } },
          }),
        });
        expect(edit.status).toBe(200);
        expect((await publish(f, WorkTemplateOut.parse(await edit.json()))).status).toBe(200);
        const [after] = await schema.db
          .select()
          .from(schema.template)
          .where(eq(schema.template.id, parent.id));
        if (!before || !after) throw new Error('Restoration fixture missing');
        changes.push(catalogChange('template', before, after));
        parentIds.push(parent.id);
      }
      const receipt = await recordChangeSet({
        orgId: f.orgId,
        actorId: f.humanActorId,
        origin: { ...appProvenance(), v: 2, tool: 'define_template' },
        summary: 'Remove child steps from two templates',
        changes,
      });
      expect(receipt).toBeTruthy();
      expect(
        (await f.app.request(`/definitions/${child.id}/archive`, { method: 'POST' })).status,
      ).toBe(200);
      const restored = await (mode === 'atomic' ? undoChangeSetAtomically : undoChangeSet)(
        f.orgId,
        receipt ?? 'missing',
      );
      expect(restored.outcomes.map((outcome) => outcome.reverted)).toEqual([true, true]);
      for (const id of parentIds) {
        const retained = await versions(id);
        expect(retained).toHaveLength(3);
        expect(retained[2]?.definition.blueprint.steps).toEqual([taskStep('retained', child.id)]);
      }
    },
  );

  it('undoes a canonical republish using the previous public blueprint and preserves the reviewed draft', async () => {
    const f = await fixture();
    const parent = await draft(f, 'project');
    const first = await publish(f, parent);
    expect(first.status).toBe(200);
    const current = WorkTemplateOut.parse(await first.json());
    const pending = {
      ...current.definition,
      blueprint: { steps: [taskStep('pending_child')], dependencies: [] },
    };
    const edit = await f.app.request(`/definitions/${parent.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ expectedRevision: current.revision, definition: pending }),
    });
    expect(edit.status).toBe(200);
    const [before] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, parent.id));
    expect((await publish(f, WorkTemplateOut.parse(await edit.json()))).status).toBe(200);
    const [after] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, parent.id));
    if (!before || !after) throw new Error('Restoration fixture missing');
    const receipt = await recordChangeSet({
      orgId: f.orgId,
      actorId: f.humanActorId,
      origin: { ...appProvenance(), v: 2, tool: 'define_template' },
      summary: 'Publish reviewed preparation',
      changes: [catalogChange('template', before, after)],
    });
    const restored = await undoChangeSet(f.orgId, receipt ?? 'missing');
    expect(restored.outcomes[0]?.reverted).toBe(true);
    expect((await versions(parent.id))[2]?.definition.blueprint.steps).toEqual([]);
    const [retained] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, parent.id));
    expect(retained?.draftDefinition.blueprint.steps).toEqual([taskStep('pending_child')]);
  });
});
