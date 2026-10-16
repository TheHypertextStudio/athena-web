import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { LabelId } from '@docket/work/ids';
import { TeamId } from '@docket/identity-access/ids';
import { GALLERY_CATALOG } from '@docket/work/template-gallery';
import { WorkTemplateGalleryPreviewRequest } from '@docket/work/template-gallery-contract';
import { getDb, seedTaskAccessOrg, clearDocketPro, one } from '../support/routes-harness';
import { previewTemplateGalleryCopy } from '../../src/lib/template-gallery/preview';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function fixture() {
  const workspace = await seedTaskAccessOrg(schema.db, schema, 'manage');
  await clearDocketPro(schema.db, schema, workspace.orgId);
  return { ...workspace, caller: { orgId: workspace.orgId, actorId: workspace.humanActorId } };
}
function suggestedEntry() {
  const entry = GALLERY_CATALOG.find((value) => value.labelSuggestions.length);
  const suggestion = entry?.labelSuggestions[0];
  if (!entry || !suggestion) throw new Error('Missing released label-suggestion fixture');
  return { entry, suggestion };
}
async function destinationLabel(orgId: string) {
  return one(
    await schema.db
      .insert(schema.label)
      .values({ organizationId: orgId, name: 'Reviewed label', color: '#6750a4' })
      .returning(),
  );
}
describe('actual read-only gallery choices', () => {
  it('shows the authorized concrete label rewrite without allocating identities or publishing', async () => {
    const f = await fixture(),
      { entry, suggestion } = suggestedEntry();
    const label = await destinationLabel(f.orgId);
    const request = WorkTemplateGalleryPreviewRequest.parse({
      roots: [entry.slug],
      release: 1,
      mode: 'private_drafts',
      labels: [{ sourceSlug: entry.slug, suggestion, destinationLabelId: label.id }],
    });
    const preview = await previewTemplateGalleryCopy(f.caller, request);
    expect(
      preview.copies.find((copy) => copy.source.workTypeId === entry.id)?.definition.payload,
    ).toMatchObject({ labelIds: [label.id] });
    expect(
      await schema.db
        .select()
        .from(schema.workTemplateCopyBundle)
        .where(eq(schema.workTemplateCopyBundle.organizationId, f.orgId)),
    ).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.template)
        .where(and(eq(schema.template.organizationId, f.orgId), eq(schema.template.isBase, false))),
    ).toEqual([]);
  });
  it('refuses foreign labels and non-manager team offerings under current grants', async () => {
    const f = await fixture(),
      other = await fixture(),
      { entry, suggestion } = suggestedEntry();
    const label = await destinationLabel(other.orgId);
    const request = WorkTemplateGalleryPreviewRequest.parse({
      roots: [entry.slug],
      release: 1,
      mode: 'private_drafts',
    });
    await expect(
      previewTemplateGalleryCopy(f.caller, {
        ...request,
        labels: [
          { sourceSlug: entry.slug, suggestion, destinationLabelId: LabelId.parse(label.id) },
        ],
      }),
    ).rejects.toThrow();
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['contribute'] })
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    await expect(
      previewTemplateGalleryCopy(f.caller, {
        ...request,
        offerings: [{ sourceSlug: entry.slug, teamIds: [TeamId.parse(f.teamId)] }],
      }),
    ).rejects.toThrow();
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, f.orgId));
    await expect(previewTemplateGalleryCopy(f.caller, request)).rejects.toThrow();
  });
  it('refuses choices for work outside the reviewed copy closure', async () => {
    const f = await fixture(),
      { entry, suggestion } = suggestedEntry();
    const label = await destinationLabel(f.orgId);
    await expect(
      previewTemplateGalleryCopy(
        f.caller,
        WorkTemplateGalleryPreviewRequest.parse({
          roots: ['event'],
          release: 1,
          mode: 'private_drafts',
          labels: [{ sourceSlug: entry.slug, suggestion, destinationLabelId: label.id }],
        }),
      ),
    ).rejects.toThrow();
  });
});
