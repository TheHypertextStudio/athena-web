/** Actual canonical copy Undo: immutable receipts, current references and live caller authority. */
import type * as DbModule from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkTemplateCreate, WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { getDb, one, seedTask } from '../support/routes-harness';
import {
  galleryUndoState,
  installTemplateGallery,
  otherGalleryMember,
  setGalleryCapability,
  templateGalleryFixture,
  type TemplateGalleryFixture,
} from '../support/template-gallery-fixtures';
import { createWorkTemplate, editWorkTemplateDraft } from '../../src/lib/templates/service';
import { catalogChange } from '../../src/mcp/change-set-catalog';
import { workScheduleUndoAccess } from '../../src/lib/recurrence/work-schedule-undo-access';
import {
  isTemplateCopyChangeSet,
  tryUndoTemplateCopyChangeSet,
} from '../../src/lib/template-gallery/undo';
import {
  recordChangeSet,
  trackedFields,
  undoChangeSet,
  undoChangeSetAtomically,
} from '../../src/mcp/change-set';
import { appProvenance, originFor } from '../../src/lib/provenance/context';
import { requireUndoReceiptAccess } from '../../src/mcp/undo-access';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
type Installed = Awaited<ReturnType<typeof installTemplateGallery>>;

async function editEvent(f: TemplateGalleryFixture, installed: Installed, replacement?: Installed) {
  const row = one(
    await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, installed.root.destinationWorkTypeId)),
  );
  const definition = WorkTemplateDefinition.parse({
    ...row.draftDefinition,
    name: 'Our independently refined Event',
    blueprint: {
      ...row.draftDefinition.blueprint,
      steps: row.draftDefinition.blueprint.steps.map((step) =>
        step.key !== 'book_venue'
          ? step
          : {
              ...step,
              template: replacement
                ? {
                    workTypeId: replacement.vendor.destinationWorkTypeId,
                    selection: {
                      kind: 'pinned',
                      workTypeVersionId: replacement.vendor.reservedFirstVersionId,
                    },
                  }
                : null,
            },
      ),
    },
  });
  return editWorkTemplateDraft(f.caller, row.id, {
    expectedRevision: row.draftRevision,
    definition,
  });
}
function undo(f: TemplateGalleryFixture, installed: Installed) {
  return undoChangeSet(f.orgId, installed.receipt.changeSetId, workScheduleUndoAccess(f.caller));
}

describe('canonical gallery aggregate Undo', () => {
  it('deletes the unchanged Event before its Vendor dependency and voids one complete receipt', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    expect(await isTemplateCopyChangeSet(f.orgId, installed.receipt.changeSetId)).toBe(true);
    const result = await undo(f, installed);
    expect(result.outcomes).toEqual([
      { kind: 'template', id: installed.root.destinationWorkTypeId, reverted: true },
      { kind: 'template', id: installed.vendor.destinationWorkTypeId, reverted: true },
    ]);
    const state = await galleryUndoState(f, installed);
    expect(state.templates).toEqual([]);
    expect(state.bundle).toMatchObject({
      state: 'undone',
      undoOutcomes: [
        { entryKey: installed.root.entryKey, outcome: 'deleted' },
        { entryKey: installed.vendor.entryKey, outcome: 'deleted' },
      ],
    });
    expect(state.receipt.undoneAt).toBeInstanceOf(Date);
    expect(state.bundle.undoneAt).toBeInstanceOf(Date);
    expect(
      state.entries.map((entry) => ({
        id: entry.destinationWorkTypeId,
        state: entry.reservationState,
        live: entry.liveWorkTypeId,
        consumed: entry.consumedVersionId,
      })),
    ).toEqual(
      expect.arrayContaining(
        installed.entries.map((entry) => ({
          id: entry.destinationWorkTypeId,
          state: 'void',
          live: null,
          consumed: null,
        })),
      ),
    );
    expect(state.entries.map((entry) => entry.reservedFirstVersionId).sort()).toEqual(
      installed.entries.map((entry) => entry.reservedFirstVersionId).sort(),
    );
  });

  it('retains an edited parent but deletes the old dependency when its actual edge was removed', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    const edited = await editEvent(f, installed);
    const result = await undo(f, installed);
    expect(result.outcomes).toEqual([
      { kind: 'template', id: edited.id, reverted: false, reason: 'changed_since' },
      { kind: 'template', id: installed.vendor.destinationWorkTypeId, reverted: true },
    ]);
    const state = await galleryUndoState(f, installed);
    expect(state.templates).toEqual([edited]);
    expect(
      state.entries.find((entry) => entry.entryKey === installed.vendor.entryKey)?.reservationState,
    ).toBe('void');
  });

  it('protects a new pending dependency in another bundle using the changed parent’s current edge', async () => {
    const f = await templateGalleryFixture(schema),
      original = await installTemplateGallery(f),
      other = await installTemplateGallery(f);
    const edited = await editEvent(f, original, other);
    const second = await undo(f, other);
    expect(second.outcomes).toEqual([
      { kind: 'template', id: other.root.destinationWorkTypeId, reverted: true },
      {
        kind: 'template',
        id: other.vendor.destinationWorkTypeId,
        reverted: false,
        reason: 'in_use',
      },
    ]);
    const first = await undo(f, original);
    expect(first.outcomes).toContainEqual({
      kind: 'template',
      id: original.vendor.destinationWorkTypeId,
      reverted: true,
    });
    const state = await galleryUndoState(f, original);
    expect(state.templates.map((row) => row.id).sort()).toEqual(
      [edited.id, other.vendor.destinationWorkTypeId].sort(),
    );
    expect(one(state.templates.filter((row) => row.id === edited.id))).toEqual(edited);
    expect((await galleryUndoState(f, other)).bundle.undoOutcomes).toContainEqual({
      entryKey: other.vendor.entryKey,
      outcome: 'retained_in_use',
    });
  });

  it('archives published copies and retains their exact immutable first publications', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f, 'published');
    const versions = await schema.db
      .select()
      .from(schema.workTypeVersion)
      .where(
        and(
          eq(schema.workTypeVersion.organizationId, f.orgId),
          inArray(
            schema.workTypeVersion.workTypeId,
            installed.entries.map((entry) => entry.destinationWorkTypeId),
          ),
        ),
      )
      .orderBy(schema.workTypeVersion.id);
    expect(versions).toHaveLength(2);
    expect((await undo(f, installed)).outcomes.every((outcome) => outcome.reverted)).toBe(true);
    const state = await galleryUndoState(f, installed);
    expect(state.templates).toHaveLength(2);
    expect(
      state.templates.every(
        (row) => row.publicationState === 'archived' && row.archivedAt instanceof Date,
      ),
    ).toBe(true);
    expect(
      state.entries.every(
        (entry) =>
          entry.reservationState === 'consumed' &&
          entry.consumedVersionId === entry.reservedFirstVersionId,
      ),
    ).toBe(true);
    expect(
      await schema.db
        .select()
        .from(schema.workTypeVersion)
        .where(
          inArray(
            schema.workTypeVersion.id,
            versions.map((row) => row.id),
          ),
        )
        .orderBy(schema.workTypeVersion.id),
    ).toEqual(versions);
  });

  it('replays stored terminal outcomes with View after authoring revocation without overwriting later edits', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    await editEvent(f, installed);
    const original = await undo(f, installed);
    const current = one((await galleryUndoState(f, installed)).templates);
    const edited = await editWorkTemplateDraft(f.caller, current.id, {
      expectedRevision: current.draftRevision,
      definition: { ...current.draftDefinition, name: 'After Undo, still ours' },
    });
    await setGalleryCapability(f, 'view');
    const before = await galleryUndoState(f, installed);
    expect(await undo(f, installed)).toEqual(original);
    expect(
      await undoChangeSetAtomically(
        f.orgId,
        installed.receipt.changeSetId,
        undefined,
        workScheduleUndoAccess({ orgId: f.orgId, userId: f.userId }),
      ),
    ).toEqual(original);
    expect(await galleryUndoState(f, installed)).toEqual(before);
    expect(one(before.templates)).toEqual(edited);
  });

  it('denies installed Undo after authoring revocation and leaves every copied row unchanged', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    await setGalleryCapability(f, 'view');
    const before = await galleryUndoState(f, installed);
    await expect(undo(f, installed)).rejects.toMatchObject({ status: 403 });
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('keeps a View-only actual agent’s private-copy and random receipt denials identical', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    const agent = await otherGalleryMember(f, 'agent');
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['view'] })
      .where(and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, agent.id)));
    const caller = { orgId: f.orgId, actorId: agent.id };
    const before = await galleryUndoState(f, installed);
    for (const receiptId of [installed.receipt.changeSetId, schema.genId()])
      await expect(requireUndoReceiptAccess(caller, receiptId)).rejects.toMatchObject({
        status: 403,
        code: 'forbidden',
      });
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('keeps a human acceptor’s revoked-View private-copy and random receipt denials identical', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    await schema.db
      .delete(schema.grant)
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    const before = await galleryUndoState(f, installed);
    for (const receiptId of [installed.receipt.changeSetId, schema.genId()])
      await expect(requireUndoReceiptAccess(f.caller, receiptId)).rejects.toMatchObject({
        status: 404,
        code: 'not_found',
      });
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('fails closed for missing callers, agents, another acceptor and a foreign tenant without generic fallback', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    const agent = await otherGalleryMember(f, 'agent'),
      other = await otherGalleryMember(f);
    const foreign = await templateGalleryFixture(schema);
    const before = await galleryUndoState(f, installed);
    await expect(undoChangeSet(f.orgId, installed.receipt.changeSetId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      undoChangeSetAtomically(f.orgId, installed.receipt.changeSetId),
    ).rejects.toMatchObject({ status: 404 });
    for (const caller of [
      { orgId: f.orgId, actorId: agent.id },
      { orgId: f.orgId, actorId: other.id },
      foreign.caller,
    ])
      await expect(
        tryUndoTemplateCopyChangeSet(f.orgId, installed.receipt.changeSetId, caller),
      ).rejects.toMatchObject({ status: 404 });
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('dispatches atomic copy Undo without invoking an unrelated caller’s task/plan callback', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    const callback = vi.fn();
    const result = await undoChangeSetAtomically(
      f.orgId,
      installed.receipt.changeSetId,
      callback,
      workScheduleUndoAccess(f.caller),
    );
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((outcome) => outcome.reverted)).toBe(true);
    expect(callback).not.toHaveBeenCalled();
  });

  it.each(['human', 'agent'] as const)(
    'preserves ordinary %s receipt Undo without requiring human copy membership',
    async (kind) => {
      const f = await templateGalleryFixture(schema);
      const actorId = kind === 'agent' ? (await otherGalleryMember(f, 'agent')).id : f.humanActorId;
      const task = await seedTask(schema.db, schema, f.statusId, {
        organizationId: f.orgId,
        teamId: f.teamId,
        title: 'Ordinary work',
        state: 'todo',
        createdBy: actorId,
      });
      const receiptId = await recordChangeSet({
        orgId: f.orgId,
        actorId,
        origin: originFor('capture', {}, appProvenance('settings')),
        summary: 'Ordinary capture',
        changes: [{ kind: 'task', id: task.id, op: 'create', after: trackedFields('task', task) }],
      });
      if (!receiptId) throw new Error('Missing ordinary receipt');
      expect(await isTemplateCopyChangeSet(f.orgId, receiptId)).toBe(false);
      expect(await tryUndoTemplateCopyChangeSet(f.orgId, receiptId, undefined)).toBeNull();
      const guard =
        kind === 'agent' ? workScheduleUndoAccess({ orgId: f.orgId, actorId }) : undefined;
      expect((await undoChangeSet(f.orgId, receiptId, guard)).outcomes).toContainEqual({
        kind: 'task',
        id: task.id,
        reverted: true,
      });
      expect(
        one(await schema.db.select().from(schema.task).where(eq(schema.task.id, task.id)))
          .archivedAt,
      ).toBeInstanceOf(Date);
    },
  );

  it.each(['human', 'agent'] as const)(
    'keeps callerless ordinary %s template creation receipts outside aggregate copy policy',
    async (kind) => {
      const f = await templateGalleryFixture(schema);
      const actorId = kind === 'agent' ? (await otherGalleryMember(f, 'agent')).id : f.humanActorId;
      const row = await createWorkTemplate(
        { orgId: f.orgId, actorId },
        WorkTemplateCreate.parse({
          targetType: 'task',
          definition: {
            name: 'Ordinary task definition',
            payload: { targetType: 'task', description: '## Outcome' },
          },
        }),
      );
      const receiptId = await recordChangeSet({
        orgId: f.orgId,
        actorId,
        origin: originFor('define_template', {}, appProvenance('settings')),
        summary: 'Defined ordinary work',
        changes: [catalogChange('template', null, row)],
      });
      if (!receiptId) throw new Error('Missing ordinary template receipt');
      expect(await isTemplateCopyChangeSet(f.orgId, receiptId)).toBe(false);
      expect((await undoChangeSet(f.orgId, receiptId)).outcomes).toContainEqual({
        kind: 'template',
        id: row.id,
        reverted: true,
      });
      expect(
        await schema.db.select().from(schema.template).where(eq(schema.template.id, row.id)),
      ).toEqual([]);
    },
  );
});
