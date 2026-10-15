import type * as DbModule from '@docket/db';
import { WorkTemplateChangeRequest } from '@docket/work/work-template-reference';
import { TaskCreate } from '@docket/work/task-model';
import { WorkTemplateCreate, WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../support/routes-harness';
import { retainedFixture } from '../recurrence/work-template-adapter-fixture';
import {
  createWorkTemplate,
  publishWorkTemplate,
  editWorkTemplateDraft,
  archiveWorkTemplate,
} from '../../src/lib/templates/service';
import type { TemplateRow } from '../../src/lib/templates/model';
import { createWork } from '../../src/lib/work-creation/service';
import { authorizeRetainedOccurrence } from '../../src/lib/work-creation/retained-authority';
import { loadRetainedBlueprintResolutionProof } from '../../src/lib/work-template-blueprints/resolution-retained';
import {
  readBlueprintClosure,
  lockBlueprintClosures,
} from '../../src/lib/work-template-blueprints/resolve';
import { serializableTx } from '../../src/lib/serializable-tx';
import {
  assignWorkTemplate,
  previewWorkTemplateAssignment,
} from '../../src/lib/work-template-assignment';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';
import { flushDeferredWork } from '../../src/lib/after-response';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(flushDeferredWork);
async function fixture(acceptManifest = true) {
  let child: TemplateRow | undefined;
  const f = await retainedFixture(schema, false, undefined, async (base) => {
    const actor = { orgId: base.orgId, actorId: base.humanActorId, capabilities: ['manage'] };
    const draft = await createWorkTemplate(
      actor,
      WorkTemplateCreate.parse({
        targetType: 'task',
        definition: {
          name: 'Child',
          payload: { targetType: 'task', description: '## Accepted child' },
        },
      }),
    );
    child = await publishWorkTemplate(actor, draft.id, draft.draftRevision);
    return WorkTemplateDefinition.parse({
      name: 'Report',
      payload: { targetType: 'task' },
      blueprint: {
        steps: [
          {
            key: 'nested',
            kind: 'task',
            parentStepKey: null,
            sort: 0,
            fields: { title: 'Preparation' },
            template: { workTypeId: child.id, selection: { kind: 'latest' } },
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
  });
  if (!child) throw new Error('Child publication fixture missing');
  const created = await createWork({
    caller: f.caller,
    kind: 'task',
    body: TaskCreate.parse({
      title: 'Report',
      teamId: f.teamId,
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
    }),
    invocation: { origin: { ...appProvenance(), v: 2, tool: 'task_create' } },
  });
  await schema.db.insert(schema.processInstanceTask).values({
    organizationId: f.orgId,
    instanceId: f.instance.id,
    stepId: f.step.id,
    taskId: created.root.id,
  });
  const state = created.root.row.blueprintState;
  if (!state) throw new Error('Accepted root state missing');
  await schema.db
    .update(schema.processOccurrence)
    .set({
      blueprintRootRefs: [
        {
          key: f.step.key,
          kind: 'task',
          id: created.root.id,
          ...(acceptManifest ? { resolvedManifest: state.resolvedManifest } : {}),
        },
      ],
      blueprintAppliedAt: new Date(),
    })
    .where(eq(schema.processOccurrence.id, f.occurrence.id));
  const selection = {
    organizationId: f.orgId,
    kind: 'task' as const,
    workTypeId: f.published.id,
    workTypeVersionId: f.published.latestPublishedVersionId ?? undefined,
  };
  return { ...f, child, created, selection };
}

describe('checked retained publication resolution', () => {
  it('keeps the accepted archived child version across latest publication and sorted lock rediscovery', async () => {
    const f = await fixture();
    const draft = await editWorkTemplateDraft(f.caller, f.child.id, {
      expectedRevision: f.child.draftRevision,
      definition: WorkTemplateDefinition.parse({
        name: 'Child',
        payload: { targetType: 'task', description: '## New child' },
      }),
    });
    const newer = await publishWorkTemplate(f.caller, f.child.id, draft.draftRevision);
    expect(newer.latestPublishedVersionId).not.toBe(f.child.latestPublishedVersionId);
    await archiveWorkTemplate(f.caller, f.child.id);
    await serializableTx(async (tx) => {
      const authority = await authorizeRetainedOccurrence(tx, f.request);
      const proof = await loadRetainedBlueprintResolutionProof(tx, {
        authority: authority.authority,
        rootKey: 'report',
      });
      expect(proof).toBeDefined();
      const graph = await readBlueprintClosure(
        tx,
        f.selection,
        'retained_schedule',
        undefined,
        proof,
      );
      expect(graph.resolutions.find((entry) => entry.path[0] === 'nested')?.versionId).toBe(
        f.child.latestPublishedVersionId,
      );
      await expect(lockBlueprintClosures(tx, [graph])).resolves.toBeUndefined();
    });
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(2);
  });

  it('keeps the private original accepted closure after foreground update changes public state', async () => {
    const f = await fixture();
    const childDraft = await editWorkTemplateDraft(f.caller, f.child.id, {
      expectedRevision: f.child.draftRevision,
      definition: WorkTemplateDefinition.parse({
        name: 'Child',
        payload: { targetType: 'task', description: '## New child' },
      }),
    });
    const childV2 = await publishWorkTemplate(f.caller, f.child.id, childDraft.draftRevision);
    const rootDraft = await editWorkTemplateDraft(f.caller, f.published.id, {
      expectedRevision: f.published.draftRevision,
      definition: WorkTemplateDefinition.parse({
        ...f.published.draftDefinition,
        name: 'New report',
      }),
    });
    await publishWorkTemplate(f.caller, f.published.id, rootDraft.draftRevision);
    const selected = WorkTemplateChangeRequest.parse({
      workTypeId: f.published.id,
      mode: 'update',
    });
    const preview = await previewWorkTemplateAssignment(
      f.caller,
      'task',
      f.created.root.id,
      selected,
    );
    await runWithProvenance(appProvenance(), () =>
      assignWorkTemplate(f.caller, 'task', f.created.root.id, {
        ...selected,
        previewToken: preview.previewToken,
        applyFields: [],
        acceptChildChanges: [],
      }),
    );
    const [current] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, f.created.root.id));
    expect(
      current?.blueprintState?.resolvedManifest.find((entry) => entry.path[0] === 'nested')
        ?.versionId,
    ).toBe(childV2.latestPublishedVersionId);
    await serializableTx(async (tx) => {
      const authority = await authorizeRetainedOccurrence(tx, f.request);
      const proof = await loadRetainedBlueprintResolutionProof(tx, {
        authority: authority.authority,
        rootKey: 'report',
      });
      expect(proof).toBeDefined();
      const graph = await readBlueprintClosure(
        tx,
        f.selection,
        'retained_schedule',
        undefined,
        proof,
      );
      expect(graph.resolutions.find((entry) => entry.path[0] === 'nested')?.versionId).toBe(
        f.child.latestPublishedVersionId,
      );
    });
  });

  it('fails closed for an applied historical root without private closure or original recurrence receipt', async () => {
    const f = await fixture(false);
    await expect(
      serializableTx(async (tx) => {
        const authority = await authorizeRetainedOccurrence(tx, f.request);
        return loadRetainedBlueprintResolutionProof(tx, {
          authority: authority.authority,
          rootKey: 'report',
        });
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects copied and cross-transaction proofs instead of accepting caller manifests', async () => {
    const f = await fixture();
    const proof = await serializableTx(async (tx) => {
      const authority = await authorizeRetainedOccurrence(tx, f.request);
      const value = await loadRetainedBlueprintResolutionProof(tx, {
        authority: authority.authority,
        rootKey: 'report',
      });
      if (!value) throw new Error('Accepted manifest proof missing');
      await expect(
        readBlueprintClosure(tx, f.selection, 'retained_schedule', undefined, { ...value }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        readBlueprintClosure(tx, f.selection, 'create', undefined, value),
      ).rejects.toMatchObject({ status: 409 });
      return value;
    });
    await expect(
      serializableTx((tx) =>
        readBlueprintClosure(tx, f.selection, 'retained_schedule', undefined, proof),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
