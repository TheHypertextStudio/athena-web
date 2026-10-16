import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../support/routes-harness';
import {
  copyStorageContext,
  insertCopyStorageFixture,
  seedCopyStorageWorkspace,
} from './work-template-copy-reference-fixture';
import { PlanDocument } from '@docket/work/plan-draft-contract';
import { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import {
  copyReferencePlan,
  copyReferenceComposer,
  insertCopyReferencingDefinition,
} from './work-template-copy-reference-documents';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  templateCopyBundleMemberInUse,
  templateCopyReceiptRegistered,
  templateChangeSetHasCopyBundle,
  templateCopyPendingSelection,
  templateReferencesInUse,
} from '../../src/lib/templates/copy-reference-integrity';
import { ConflictError } from '../../src/error';
import { createDraft } from '../../src/lib/composer-draft/store';
import { editWorkTemplateDraft } from '../../src/lib/templates/service';
import { ComposerDraftCreate } from '@docket/work/composer-draft-contract';
import { copyReferenceDefinition } from './work-template-copy-reference-documents';
import { deleteTemplate } from '../../src/lib/templates/write';

let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
async function fixture() {
  const workspace = await seedCopyStorageWorkspace(schema.db);
  return schema.db.transaction((tx) => insertCopyStorageFixture(tx, workspace));
}
async function inUse(f: Awaited<ReturnType<typeof fixture>>): Promise<boolean> {
  return schema.db.transaction(async (tx) => {
    await copyStorageContext(tx, f);
    const result: unknown = await tx.execute(
      sql`select docket_copy_template_in_use(${f.organizationId},${f.destinationId}) as used`,
    );
    const rows = z.array(z.object({ used: z.boolean() }));
    return (
      (Array.isArray(result) ? rows.parse(result) : z.object({ rows }).parse(result).rows)[0]
        ?.used === true
    );
  });
}
describe('copy reference integrity', () => {
  it('recognizes active private plan selections without exposing source documents', async () => {
    const f = await fixture();
    await schema.db.insert(schema.planDraft).values({
      organizationId: f.organizationId,
      ownerUserId: f.userId,
      title: 'Private plan',
      document: PlanDocument.parse({
        nodes: [
          {
            ref: 'task',
            kind: 'task',
            parentRef: null,
            initiativeRefs: [],
            initiativeIds: [],
            fields: { title: 'Private' },
            templateId: f.destinationId,
            workTypeVersionId: f.reservedId,
            status: 'draft',
            objectId: null,
          },
        ],
        edges: [],
      }),
    });
    expect(await inUse(f)).toBe(true);
  });
  it('recognizes live composer selections and excludes expired documents', async () => {
    const f = await fixture();
    const [draft] = await schema.db
      .insert(schema.composerDraft)
      .values({
        organizationId: f.organizationId,
        ownerUserId: f.userId,
        kind: 'task',
        payload: ComposerDraftPayload.parse({
          kind: 'task',
          workTypeId: f.destinationId,
          workTypeVersionId: f.reservedId,
        }),
        expiresAt: new Date(Date.now() + 60000),
      })
      .returning();
    expect(await inUse(f)).toBe(true);
    if (!draft) throw new Error('Missing created composer');
    await schema.db
      .update(schema.composerDraft)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.composerDraft.id, draft.id));
    expect(await inUse(f)).toBe(false);
  });
  it('retains a copied pending draft on individual legacy delete', async () => {
    const f = await fixture();
    const result = await deleteTemplate(f.organizationId, f.actorId, f.destinationId);
    expect(result.publicationState).toBe('archived');
    expect(
      await schema.db.select().from(schema.template).where(eq(schema.template.id, f.destinationId)),
    ).toHaveLength(1);
  });
  it('returns a pending ID to a visible viewer after authoring revocation', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['view'] })
      .where(eq(schema.grant.subjectId, f.actorId));
    const rows = await schema.db.transaction(async (tx) => {
      await copyStorageContext(tx, f);
      return tx.execute(
        sql`select * from docket_template_copy_pending_selection(${f.organizationId},${f.destinationId})`,
      );
    });
    const parsed = z.array(
      z.object({ reserved_first_version_id: z.string(), reservation_state: z.string() }),
    );
    expect(
      Array.isArray(rows) ? parsed.parse(rows)[0] : z.object({ rows: parsed }).parse(rows).rows[0],
    ).toMatchObject({ reserved_first_version_id: f.reservedId, reservation_state: 'pending' });
  });
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'protects %s selections in active plans and composers',
    async (kind) => {
      const f = await fixture();
      const target = schema.genId();
      const definition = WorkTemplateDefinition.parse({
        name: 'Selected',
        payload: { targetType: kind },
      });
      await schema.db.insert(schema.template).values({
        id: target,
        organizationId: f.organizationId,
        createdBy: f.actorId,
        targetType: kind,
        name: definition.name,
        scope: 'personal',
        ownerActorId: f.actorId,
        payload: definition.payload,
        draftDefinition: definition,
      });
      const [plan] = await schema.db
        .insert(schema.planDraft)
        .values({
          organizationId: f.organizationId,
          ownerUserId: f.userId,
          title: 'Private',
          document: copyReferencePlan(target, null, kind),
        })
        .returning();
      expect(await inUse({ ...f, destinationId: target })).toBe(true);
      if (!plan) throw new Error('Missing created plan');
      await schema.db
        .update(schema.planDraft)
        .set({ status: 'archived' })
        .where(eq(schema.planDraft.id, plan.id));
      expect(await inUse({ ...f, destinationId: target })).toBe(false);
      await schema.db.insert(schema.composerDraft).values({
        organizationId: f.organizationId,
        ownerUserId: f.userId,
        kind,
        payload: copyReferenceComposer(target, null, kind),
        expiresAt: new Date(Date.now() + 60000),
      });
      expect(await inUse({ ...f, destinationId: target })).toBe(true);
    },
  );
  it.each([false, true])(
    'protects archived private reusable references (Program defaults=%s)',
    async (defaults) => {
      const f = await fixture();
      const parent = await insertCopyReferencingDefinition(schema.db, f, defaults);
      await schema.db
        .update(schema.template)
        .set({ publicationState: 'archived', archivedAt: new Date() })
        .where(eq(schema.template.id, parent));
      expect(await inUse(f)).toBe(true);
      await expect(
        schema.db.delete(schema.template).where(eq(schema.template.id, f.destinationId)),
      ).rejects.toThrow();
      await schema.db
        .update(schema.template)
        .set({
          draftDefinition: WorkTemplateDefinition.parse({
            name: 'Edited retained parent',
            payload: { targetType: defaults ? 'program' : 'task' },
          }),
        })
        .where(eq(schema.template.id, parent));
      expect(await inUse(f)).toBe(false);
    },
  );
  it('rejects new foreign, wrong-kind and unrelated reserved pins in direct reference writes', async () => {
    const f = await fixture(),
      foreign = await fixture();
    for (const payload of [
      copyReferenceComposer(foreign.destinationId, foreign.reservedId),
      copyReferenceComposer(f.destinationId, schema.genId()),
      copyReferenceComposer(f.destinationId, f.reservedId, 'project'),
    ])
      await expect(
        schema.db.insert(schema.composerDraft).values({
          organizationId: f.organizationId,
          ownerUserId: f.userId,
          kind: payload.kind,
          payload,
          expiresAt: new Date(Date.now() + 60000),
        }),
      ).rejects.toThrow();
  });
  it('recognizes protected receipt bindings before caller resolution and requires exact acceptor for member checks', async () => {
    const f = await fixture();
    expect(
      await schema.db.transaction((tx) =>
        templateChangeSetHasCopyBundle(tx, f.organizationId, f.receiptId),
      ),
    ).toBe(true);
    expect(
      await schema.db.transaction((tx) =>
        templateChangeSetHasCopyBundle(tx, schema.genId(), f.receiptId),
      ),
    ).toBe(false);
    const principal = { organizationId: f.organizationId, userId: f.userId };
    expect(
      await schema.db.transaction(
        (tx) =>
          templateCopyBundleMemberInUse(tx, principal, { bundleId: f.bundleId, entryKey: 'root' }),
        { isolationLevel: 'serializable' },
      ),
    ).toBe(false);
    expect(
      await schema.db.transaction((tx) =>
        templateCopyReceiptRegistered(
          tx,
          { orgId: f.organizationId, actorId: f.actorId },
          f.receiptId,
        ),
      ),
    ).toBe(true);
  });
  it('keeps ordinary unused unreserved legacy deletion behavior', async () => {
    const f = await fixture(),
      id = schema.genId();
    const definition = WorkTemplateDefinition.parse({
      name: 'Ordinary draft',
      payload: { targetType: 'task' },
    });
    await schema.db.insert(schema.template).values({
      id,
      organizationId: f.organizationId,
      createdBy: f.actorId,
      targetType: 'task',
      name: definition.name,
      scope: 'personal',
      ownerActorId: f.actorId,
      payload: definition.payload,
      draftDefinition: definition,
    });
    await deleteTemplate(f.organizationId, f.actorId, id);
    expect(
      await schema.db.select().from(schema.template).where(eq(schema.template.id, id)),
    ).toHaveLength(0);
  });

  it('reports stale composer references as an application conflict', async () => {
    const f = await fixture(),
      foreign = await fixture();
    await expect(
      createDraft(
        f.userId,
        ComposerDraftCreate.parse({
          organizationId: f.organizationId,
          kind: 'task',
          payload: copyReferenceComposer(foreign.destinationId, foreign.reservedId),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it('reports stale canonical draft references as an application conflict', async () => {
    const f = await fixture(),
      foreign = await fixture();
    await expect(
      editWorkTemplateDraft({ orgId: f.organizationId, actorId: f.actorId }, f.destinationId, {
        expectedRevision: 0,
        definition: copyReferenceDefinition(foreign),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

it('projects pending selections through the authorized service without requiring authoring', async () => {
  const f = await fixture();
  await schema.db
    .update(schema.grant)
    .set({ capabilities: ['view'] })
    .where(eq(schema.grant.subjectId, f.actorId));
  const caller = { orgId: f.organizationId, actorId: f.actorId };
  expect(
    await schema.db.transaction((tx) => templateCopyPendingSelection(tx, caller, f.destinationId)),
  ).toEqual({ reservedFirstVersionId: f.reservedId });
  expect(
    await schema.db.transaction((tx) => templateCopyPendingSelection(tx, caller, schema.genId())),
  ).toBeNull();
  await schema.db
    .update(schema.grant)
    .set({ capabilities: ['manage'] })
    .where(eq(schema.grant.subjectId, f.actorId));
  expect(
    await schema.db.transaction((tx) => templateReferencesInUse(tx, caller, f.destinationId)),
  ).toBe(false);
  const payload = copyReferenceComposer(f.destinationId, f.reservedId);
  await schema.db.insert(schema.composerDraft).values({
    organizationId: f.organizationId,
    ownerUserId: f.userId,
    kind: payload.kind,
    payload,
    expiresAt: new Date(Date.now() + 60000),
  });
  expect(
    await schema.db.transaction((tx) => templateReferencesInUse(tx, caller, f.destinationId)),
  ).toBe(true);
});

it('does not expose pending selections to inactive, archived or revoked viewers', async () => {
  const f = await fixture();
  const caller = { orgId: f.organizationId, actorId: f.actorId };
  await schema.db
    .update(schema.actor)
    .set({ status: 'suspended' })
    .where(eq(schema.actor.id, f.actorId));
  await expect(
    schema.db.transaction((tx) => templateCopyPendingSelection(tx, caller, f.destinationId)),
  ).rejects.toMatchObject({ status: 404, message: 'Workspace not found' });
  await schema.db
    .update(schema.actor)
    .set({ status: 'active', archivedAt: new Date() })
    .where(eq(schema.actor.id, f.actorId));
  await expect(
    schema.db.transaction((tx) => templateCopyPendingSelection(tx, caller, f.destinationId)),
  ).rejects.toMatchObject({ status: 404, message: 'Workspace not found' });
  await schema.db
    .update(schema.actor)
    .set({ archivedAt: null })
    .where(eq(schema.actor.id, f.actorId));
  await schema.db.delete(schema.grant).where(eq(schema.grant.subjectId, f.actorId));
  await expect(
    schema.db.transaction((tx) => templateCopyPendingSelection(tx, caller, f.destinationId)),
  ).rejects.toMatchObject({ status: 403 });
});
