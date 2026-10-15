import type * as DbModule from '@docket/db';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, seedTaskAccessOrg } from '../support/routes-harness';
import * as templates from '../../src/lib/templates/service';
import { serializableTx } from '../../src/lib/serializable-tx';
import { setDocumentImageReferenceReconciler } from '../../src/content/document-image-reference-registry';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  setDocumentImageReferenceReconciler(undefined);
});
function body(scope = 'organization') {
  return WorkTemplateCreate.parse({
    targetType: 'project',
    scope,
    definition: {
      name: 'Reusable process',
      payload: { targetType: 'project' },
      blueprint: {
        steps: [
          {
            key: 'prepare',
            kind: 'task',
            parentStepKey: null,
            sort: 0,
            fields: { title: 'Prepare' },
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
    },
  });
}

describe('canonical transaction-owned publication', () => {
  it('publishes through the current transaction and returns image effects only for after commit', async () => {
    const f = await seedTaskAccessOrg(schema.db, schema, 'contribute');
    const reconcile = vi.fn(async () => undefined);
    setDocumentImageReferenceReconciler({
      reconcile,
      deleteForSubject: async () => undefined,
      isImageInUse: async () => false,
    });
    const result = await serializableTx(async (tx) => {
      const created = await templates.createPublishedWorkTemplateInTransaction(
        tx,
        {
          orgId: f.orgId,
          actorId: f.humanActorId,
        },
        body(),
      );
      expect(created.row.publicationState).toBe('published');
      expect(created.row.latestPublishedVersionId).toBeTruthy();
      expect(
        await tx
          .select()
          .from(schema.blueprintStep)
          .where(eq(schema.blueprintStep.versionId, created.row.latestPublishedVersionId ?? '')),
      ).toHaveLength(1);
      expect(reconcile).not.toHaveBeenCalled();
      return created;
    });
    await templates.reconcileTemplateCreationEffects(result.effects);
    expect(reconcile).toHaveBeenCalledExactlyOnceWith(f.orgId, 'template', result.row.id);
  });

  it('rolls back the definition, publication and projection with the enclosing legacy authoring write', async () => {
    const f = await seedTaskAccessOrg(schema.db, schema, 'contribute');
    await expect(
      serializableTx(async (tx) => {
        await templates.createPublishedWorkTemplateInTransaction(
          tx,
          { orgId: f.orgId, actorId: f.humanActorId },
          body(),
        );
        throw new Error('Enclosing authoring failed');
      }),
    ).rejects.toThrow('Enclosing authoring failed');
    expect(
      await schema.db
        .select()
        .from(schema.template)
        .where(eq(schema.template.organizationId, f.orgId)),
    ).toHaveLength(4);
    expect(
      await schema.db
        .select()
        .from(schema.blueprintStep)
        .where(eq(schema.blueprintStep.organizationId, f.orgId)),
    ).toEqual([]);
  });

  it('uses live policy and actor facts instead of stale supplied manage capabilities', async () => {
    const f = await seedTaskAccessOrg(schema.db, schema, 'contribute');
    await expect(
      serializableTx(async (tx) => {
        await tx
          .update(schema.organization)
          .set({ workTemplateAuthoring: 'admins' })
          .where(eq(schema.organization.id, f.orgId));
        return templates.createPublishedWorkTemplateInTransaction(
          tx,
          {
            orgId: f.orgId,
            actorId: f.humanActorId,
            capabilities: ['manage'],
          },
          body(),
        );
      }),
    ).rejects.toMatchObject({ name: 'CapabilityError' });
    await expect(
      serializableTx((tx) =>
        templates.createPublishedWorkTemplateInTransaction(
          tx,
          {
            orgId: f.orgId,
            actorId: f.humanActorId,
          },
          body('personal'),
        ),
      ),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});
