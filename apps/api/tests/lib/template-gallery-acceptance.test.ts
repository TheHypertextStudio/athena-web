import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, seedTaskAccessOrg, clearDocketPro, one } from '../support/routes-harness';
import { previewTemplateGalleryCopy } from '../../src/lib/template-gallery/preview';
import {
  acceptTemplateGalleryCopy,
  reconcileTemplateGalleryCopy,
} from '../../src/lib/template-gallery/acceptance';
import { readTemplateGalleryCopyBundle } from '../../src/lib/template-gallery/bundle';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';
import type { WorkTemplateGalleryPreviewRequest } from '@docket/work/template-gallery-contract';
import * as catalog from '../../src/lib/template-gallery/catalog';

let schema: typeof DbModule;
let db: typeof DbModule.db;
beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function fixture() {
  const workspace = await seedTaskAccessOrg(db, schema, 'manage');
  await clearDocketPro(db, schema, workspace.orgId);
  const user = one(
    await db
      .insert(schema.user)
      .values({
        name: 'Gallery author',
        email: `gallery-${schema.genId()}@example.test`,
      })
      .returning(),
  );
  await db
    .update(schema.actor)
    .set({ userId: user.id })
    .where(eq(schema.actor.id, workspace.humanActorId));
  return {
    ...workspace,
    principal: { organizationId: workspace.orgId, userId: user.id },
    caller: { orgId: workspace.orgId, actorId: workspace.humanActorId },
  };
}
async function reviewed(
  f: Awaited<ReturnType<typeof fixture>>,
  mode: 'private_drafts' | 'published' = 'private_drafts',
) {
  const body: WorkTemplateGalleryPreviewRequest = {
    roots: ['event'],
    release: 1,
    mode,
    labels: [],
    offerings: [],
  };
  const preview = await previewTemplateGalleryCopy(f.caller, body);
  return {
    ...body,
    requestId: crypto.randomUUID(),
    expectedReviewFingerprint: preview.reviewFingerprint,
  };
}
function accept(
  f: Awaited<ReturnType<typeof fixture>>,
  request: Awaited<ReturnType<typeof reviewed>>,
) {
  return runWithProvenance(appProvenance('settings'), () =>
    acceptTemplateGalleryCopy(f.principal, request),
  );
}
async function copies(orgId: string) {
  return db
    .select()
    .from(schema.template)
    .where(and(eq(schema.template.organizationId, orgId), eq(schema.template.isBase, false)));
}

describe('manual canonical gallery acceptance', () => {
  it('keeps the complete Event bundle author-only with no publications on a Free workspace', async () => {
    const f = await fixture(),
      request = await reviewed(f);
    const receipt = await accept(f, request);
    const rows = await copies(f.orgId);
    expect(receipt).toMatchObject({
      mode: 'private_drafts',
      state: 'installed',
      roots: [{ targetType: 'project', workTypeVersionId: null }],
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) =>
          row.scope === 'personal' &&
          row.ownerActorId === f.humanActorId &&
          row.latestPublishedVersionId === null,
      ),
    ).toBe(true);
    expect(
      await db
        .select()
        .from(schema.workTypeVersion)
        .where(
          and(
            eq(schema.workTypeVersion.organizationId, f.orgId),
            inArray(
              schema.workTypeVersion.workTypeId,
              rows.map((row) => row.id),
            ),
          ),
        ),
    ).toEqual([]);
    const entries = await db
      .select()
      .from(schema.workTemplateCopyEntry)
      .where(eq(schema.workTemplateCopyEntry.bundleId, receipt.bundleId));
    const event = rows.find((row) => row.targetType === 'project');
    const vendor = entries.find((entry) => entry.targetType === 'task');
    expect(
      event?.draftDefinition.blueprint.steps.find((step) => step.key === 'book_venue')?.template,
    ).toMatchObject({
      workTypeId: vendor?.destinationWorkTypeId,
      selection: { workTypeVersionId: vendor?.reservedFirstVersionId },
    });
    expect(entries.every((entry) => entry.reservationState === 'pending')).toBe(true);
    const bundle = await readTemplateGalleryCopyBundle(f.principal, receipt.bundleId);
    expect(bundle.entries).toHaveLength(2);
    expect(bundle.entries.every((entry) => entry.reservation.state === 'pending')).toBe(true);
    expect(bundle.entries.find((entry) => entry.isRoot)?.template?.latestVersion).toBeNull();
    expect(bundle.entries.every((entry) => entry.catalogOrigin?.kind === 'catalog')).toBe(true);
  });
  it('publishes dependency-first only after explicit workspace publication', async () => {
    const f = await fixture(),
      request = await reviewed(f, 'published');
    const receipt = await accept(f, request),
      rows = await copies(f.orgId);
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) => row.scope === 'organization' && row.publicationState === 'published'),
    ).toBe(true);
    expect(receipt.roots[0]?.workTypeVersionId).not.toBeNull();
    expect(
      await db
        .select()
        .from(schema.workTypeVersion)
        .where(
          and(
            eq(schema.workTypeVersion.organizationId, f.orgId),
            inArray(
              schema.workTypeVersion.workTypeId,
              rows.map((row) => row.id),
            ),
          ),
        ),
    ).toHaveLength(2);
    expect(
      await db.select().from(schema.changeSet).where(eq(schema.changeSet.id, receipt.changeSetId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.changeSetEntry)
        .where(eq(schema.changeSetEntry.changeSetId, receipt.changeSetId)),
    ).toHaveLength(2);
  });
  it('reconciles original outcomes after later edits and authoring revocation without overwriting them', async () => {
    const f = await fixture(),
      request = await reviewed(f);
    const receipt = await accept(f, request),
      root = receipt.roots[0];
    if (!root) throw new Error('Missing original Event outcome');
    const row = one((await copies(f.orgId)).filter((copy) => copy.id === root.workTypeId));
    await db
      .update(schema.template)
      .set({
        draftRevision: row.draftRevision + 1,
        draftDefinition: { ...row.draftDefinition, name: 'Our independent Event' },
      })
      .where(eq(schema.template.id, row.id));
    await db
      .update(schema.grant)
      .set({ capabilities: ['view'] })
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    expect(await accept(f, request)).toEqual(receipt);
    expect(await reconcileTemplateGalleryCopy(f.principal, request.requestId)).toEqual(receipt);
    expect(
      one((await copies(f.orgId)).filter((copy) => copy.id === row.id)).draftDefinition.name,
    ).toBe('Our independent Event');
    const reentry = await readTemplateGalleryCopyBundle(f.principal, receipt.bundleId);
    expect(reentry.entries.find((entry) => entry.isRoot)?.template?.definition.name).toBe(
      'Our independent Event',
    );
    expect(await copies(f.orgId)).toHaveLength(2);
    await expect(accept(f, { ...request, requestId: crypto.randomUUID() })).rejects.toThrow();
    await expect(accept(f, { ...request, mode: 'published' })).rejects.toThrow();
    await expect(accept(f, { ...request, roots: ['community-event'] })).rejects.toThrow();
    await expect(
      accept(f, { ...request, offerings: [{ sourceSlug: 'event', teamIds: [] }] }),
    ).rejects.toThrow();
  });
  it('rolls back stale reviews and denies an unrelated principal without revealing a bundle', async () => {
    const f = await fixture(),
      request = await reviewed(f);
    await expect(
      accept(f, { ...request, expectedReviewFingerprint: `sha256:${'0'.repeat(64)}` }),
    ).rejects.toThrow();
    expect(await copies(f.orgId)).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.workTemplateCopyBundle)
        .where(eq(schema.workTemplateCopyBundle.organizationId, f.orgId)),
    ).toEqual([]);
    await accept(f, request);
    const other = await fixture();
    await expect(
      readTemplateGalleryCopyBundle(other.principal, (await accept(f, request)).bundleId),
    ).rejects.toThrow();
    await expect(
      reconcileTemplateGalleryCopy(
        { ...f.principal, userId: other.principal.userId },
        request.requestId,
      ),
    ).rejects.toThrow();
  });
  it('reconciles the original receipt even when its catalog source is no longer available', async () => {
    const f = await fixture(),
      request = await reviewed(f);
    const receipt = await accept(f, request);
    const source = vi.spyOn(catalog, 'requireGalleryEntry').mockImplementation(() => {
      throw new Error('Removed catalog source must not be reread for a terminal request');
    });
    try {
      expect(await accept(f, request)).toEqual(receipt);
      expect(source).not.toHaveBeenCalled();
    } finally {
      source.mockRestore();
    }
  });
});
